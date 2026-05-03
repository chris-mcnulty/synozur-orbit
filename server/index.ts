import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { RedisStore } from "connect-redis";
import { createClient as createRedisClient } from "redis";
import fileUpload from "express-fileupload";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { registerSEORoutes, crawlerPrerender } from "./seo";
import { createServer } from "http";
import { startScheduledJobs } from "./services/scheduled-jobs";
import { storage } from "./storage";
import { setPersistenceHooks } from "./services/job-queue";
import pg from "pg";

const app = express();
const httpServer = createServer(app);

// Trust proxy for secure cookies behind reverse proxy (Replit, etc.)
app.set('trust proxy', 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-session" {
  interface SessionData {
    userId: string;
    activeTenantId?: string;
    activeMarketId?: string;
    // Optional same-origin path the user should land on after sign-in
    // (used to resume `/oauth/authorize` flows after Entra/local login).
    postLoginRedirect?: string;
    // Google OAuth state nonce + pending account-link payload (Task #105)
    googleOAuthState?: string;
    pendingGoogleLink?: {
      googleId: string;
      email: string;
      name: string;
      userId: string;
    };
  }
}

// Stripe webhook needs raw body for signature verification.
// Skip JSON parsing for those paths; the routes use express.raw().
app.use((req, res, next) => {
  if (req.path === "/api/stripe/webhook" || req.path === "/api/webhooks/stripe") {
    return next();
  }
  return express.json({
    verify: (req2, _res, buf) => {
      (req2 as any).rawBody = buf;
    },
  })(req, res, next);
});

app.use(express.urlencoded({ extended: false }));

// File upload middleware for logo uploads
app.use(fileUpload({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit (matches validateDocumentUpload)
  abortOnLimit: true,
  useTempFiles: false,
}));

const PgSession = connectPgSimple(session);
const pgPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

pgPool.on("error", (err) => {
  console.error("[PostgreSQL Pool] Unexpected client error:", err.message);
});

process.on("uncaughtException", (err) => {
  console.error("[Process] Uncaught exception (keeping alive):", err.message, err.stack);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Process] Unhandled rejection (keeping alive):", reason);
});

// ========== SESSION STORE ==========
// Use Redis when REDIS_URL is set; fall back to PostgreSQL for zero-config deployments.
function buildSessionStore(): session.Store {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const redisClient = createRedisClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries: number) => Math.min(retries * 100, 3000),
        },
      });
      redisClient.on("error", (err: Error) => {
        console.error("[Redis] Session store error:", err.message);
      });
      redisClient.connect().then(() => {
        log("Redis session store connected");
      }).catch((err: Error) => {
        console.error("[Redis] Failed to connect — sessions will fall back to in-memory:", err.message);
      });
      return new RedisStore({ client: redisClient as any, prefix: "orbit:sess:", ttl: 60 * 60 * 24 * 7 });
    } catch (err) {
      console.error("[Redis] Failed to initialise client, using PostgreSQL session store:", err);
    }
  }
  return new PgSession({
    pool: pgPool,
    tableName: "user_sessions",
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 60, // prune expired sessions every hour
  });
}

app.use(
  session({
    store: buildSessionStore(),
    secret: process.env.SESSION_SECRET || "orbit-secret-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    rolling: true, // Extend session TTL on every authenticated request
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
      sameSite: "lax",
    },
  })
);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        // Truncate response body to keep logs readable
        const jsonStr = JSON.stringify(capturedJsonResponse);
        const truncated = jsonStr.length > 200 ? jsonStr.substring(0, 200) + "...[truncated]" : jsonStr;
        logLine += ` :: ${truncated}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Run startup migrations for tables/columns that may not exist in production yet
  try {
    await pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_dismissed_changelog_version VARCHAR(50)`);
    // Stripe billing columns + audit table
    await pgPool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`);
    await pgPool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`);
    await pgPool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_status TEXT`);
    await pgPool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP`);
    await pgPool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS seat_count INTEGER`);
    await pgPool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_grace_until TIMESTAMP`);
    await pgPool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_managed_manually BOOLEAN NOT NULL DEFAULT false`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS tenants_stripe_customer_idx ON tenants(stripe_customer_id)`);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS billing_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        tenant_id VARCHAR,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        payload JSONB,
        processed_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        ticket_number INTEGER NOT NULL,
        tenant_id VARCHAR NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        subject TEXT NOT NULL,
        description TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'open',
        assigned_to VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        metadata JSONB,
        application_source TEXT NOT NULL DEFAULT 'Orbit',
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now(),
        resolved_at TIMESTAMP,
        resolved_by VARCHAR REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS support_ticket_replies (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        ticket_id VARCHAR NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        is_internal BOOLEAN DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS generated_from_data_as_of TIMESTAMP`);
    await pgPool.query(`ALTER TABLE analysis ADD COLUMN IF NOT EXISTS generated_from_data_as_of TIMESTAMP`);
    await pgPool.query(`ALTER TABLE battlecards ADD COLUMN IF NOT EXISTS generated_from_data_as_of TIMESTAMP`);
    await pgPool.query(`ALTER TABLE long_form_recommendations ADD COLUMN IF NOT EXISTS generated_from_data_as_of TIMESTAMP`);
    await pgPool.query(`ALTER TABLE intelligence_briefings ADD COLUMN IF NOT EXISTS podcast_audio_url TEXT`);
    await pgPool.query(`ALTER TABLE intelligence_briefings ADD COLUMN IF NOT EXISTS podcast_status TEXT DEFAULT 'none'`);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS gap_dismissals (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        gap_identifier TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'dismissed',
        reason TEXT,
        tenant_domain TEXT NOT NULL,
        market_id VARCHAR REFERENCES markets(id) ON DELETE SET NULL,
        dismissed_by VARCHAR REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS briefing_subscriptions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        tenant_domain TEXT NOT NULL,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        market_id VARCHAR REFERENCES markets(id) ON DELETE SET NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        frequency TEXT NOT NULL DEFAULT 'weekly',
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS scheduled_briefing_configs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        tenant_domain TEXT NOT NULL,
        market_id VARCHAR REFERENCES markets(id) ON DELETE SET NULL,
        enabled BOOLEAN NOT NULL DEFAULT false,
        frequency TEXT NOT NULL DEFAULT 'weekly',
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    // Notification Centre
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tenant_domain TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        link TEXT,
        read_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications(user_id)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS notifications_tenant_domain_idx ON notifications(tenant_domain)`);
    await pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS alerts_enabled BOOLEAN DEFAULT false`);
    await pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS alert_threshold TEXT DEFAULT 'high'`);
    await pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS alert_email_enabled BOOLEAN DEFAULT false`);
    await pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mention_email_enabled BOOLEAN DEFAULT true`);
    await pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS assignment_email_enabled BOOLEAN DEFAULT true`);
    // Personas & ICP Builder
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS personas (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        tenant_domain TEXT NOT NULL,
        market_id VARCHAR REFERENCES markets(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        role TEXT,
        industry TEXT,
        company_size TEXT,
        pain_points TEXT[],
        goals TEXT[],
        objections TEXT[],
        preferred_channels TEXT[],
        notes TEXT,
        is_icp BOOLEAN NOT NULL DEFAULT false,
        created_by VARCHAR NOT NULL REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS personas_tenant_domain_idx ON personas(tenant_domain)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS personas_market_id_idx ON personas(market_id)`);
    // Organizations directory columns
    await pgPool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS description TEXT`);
    await pgPool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS category TEXT`);
    await pgPool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS sic_code TEXT`);
    // B2B/B2C market business type
    await pgPool.query(`ALTER TABLE markets ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'b2b'`);
    // Suggested content assets from baseline crawl
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS suggested_content_assets (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        tenant_domain TEXT NOT NULL,
        market_id VARCHAR REFERENCES markets(id) ON DELETE SET NULL,
        company_profile_id VARCHAR NOT NULL REFERENCES company_profiles(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        page_type TEXT,
        reason TEXT,
        suggested_category TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS suggested_content_assets_tenant_idx ON suggested_content_assets(tenant_domain, market_id)`);

    // Facebook social columns
    await pgPool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS facebook_url TEXT`);
    await pgPool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS facebook_content TEXT`);
    await pgPool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS facebook_engagement JSONB`);
    await pgPool.query(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS facebook_url TEXT`);
    await pgPool.query(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS facebook_content TEXT`);
    await pgPool.query(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS facebook_engagement JSONB`);
    await pgPool.query(`ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS facebook_url TEXT`);
    await pgPool.query(`ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS facebook_content TEXT`);
    await pgPool.query(`ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS facebook_engagement JSONB`);

    // UX3: Rollback snapshot columns for analysis and battlecards
    await pgPool.query(`ALTER TABLE analysis ADD COLUMN IF NOT EXISTS previous_content JSONB`);
    await pgPool.query(`ALTER TABLE battlecards ADD COLUMN IF NOT EXISTS previous_content JSONB`);

    // F2: Competitive positioning map table
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS competitor_positions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_domain TEXT NOT NULL,
        market_id VARCHAR REFERENCES markets(id) ON DELETE SET NULL,
        competitor_id VARCHAR REFERENCES competitors(id) ON DELETE CASCADE,
        company_profile_id VARCHAR REFERENCES company_profiles(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        x_axis TEXT NOT NULL DEFAULT 'Market Presence',
        y_axis TEXT NOT NULL DEFAULT 'Innovation',
        x_value INTEGER NOT NULL DEFAULT 50,
        y_value INTEGER NOT NULL DEFAULT 50,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT competitor_positions_entity_xor CHECK (
          (competitor_id IS NOT NULL AND company_profile_id IS NULL) OR
          (competitor_id IS NULL AND company_profile_id IS NOT NULL)
        )
      )
    `);
    // Add CHECK constraint to existing tables that were created without it
    await pgPool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'competitor_positions_entity_xor'
            AND conrelid = 'competitor_positions'::regclass
        ) THEN
          ALTER TABLE competitor_positions ADD CONSTRAINT competitor_positions_entity_xor CHECK (
            (competitor_id IS NOT NULL AND company_profile_id IS NULL) OR
            (competitor_id IS NULL AND company_profile_id IS NOT NULL)
          );
        END IF;
      END $$;
    `);

    await pgPool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS always_hashtags JSONB DEFAULT '[]'`);
    await pgPool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS thematic_brief TEXT`);
    await pgPool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS thematic_url TEXT`);
    await pgPool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS post_generation_job_id VARCHAR`);

    await pgPool.query(`ALTER TABLE grounding_documents ADD COLUMN IF NOT EXISTS product_id VARCHAR`);
    await pgPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'grounding_documents_product_id_products_id_fk'
        ) THEN
          ALTER TABLE grounding_documents
            ADD CONSTRAINT grounding_documents_product_id_products_id_fk
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // PR39/40: support ticket attachments, graph tokens, and Planner sync columns
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS support_ticket_attachments (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        ticket_id VARCHAR NOT NULL,
        reply_id VARCHAR,
        uploaded_by VARCHAR NOT NULL,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        content_type TEXT NOT NULL,
        object_path TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_ticket_attachments_ticket_id_support_tickets_id_fk') THEN
          ALTER TABLE support_ticket_attachments
            ADD CONSTRAINT support_ticket_attachments_ticket_id_support_tickets_id_fk
            FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_ticket_attachments_reply_id_support_ticket_replies_id_fk') THEN
          ALTER TABLE support_ticket_attachments
            ADD CONSTRAINT support_ticket_attachments_reply_id_support_ticket_replies_id_fk
            FOREIGN KEY (reply_id) REFERENCES support_ticket_replies(id) ON DELETE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_ticket_attachments_uploaded_by_users_id_fk') THEN
          ALTER TABLE support_ticket_attachments
            ADD CONSTRAINT support_ticket_attachments_uploaded_by_users_id_fk
            FOREIGN KEY (uploaded_by) REFERENCES users(id);
        END IF;
      END $$;
    `);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_ticket ON support_ticket_attachments (ticket_id)`);

    // User-level Microsoft Graph delegated tokens (Planner OAuth)
    await pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS graph_access_token TEXT`);
    await pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS graph_refresh_token TEXT`);
    await pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS graph_token_expires_at TIMESTAMP`);
    await pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS graph_scopes TEXT`);

    // Task #105: Google SSO peer provider + per-tenant allowed providers
    await pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT`);
    await pgPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_unique ON users(google_id) WHERE google_id IS NOT NULL`);
    await pgPool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS allowed_auth_providers TEXT[] DEFAULT ARRAY['entra','google','password']::text[]`);

    // Planner integration: marketing plan target mapping
    await pgPool.query(`ALTER TABLE marketing_plans ADD COLUMN IF NOT EXISTS planner_group_id TEXT`);
    await pgPool.query(`ALTER TABLE marketing_plans ADD COLUMN IF NOT EXISTS planner_group_name TEXT`);
    await pgPool.query(`ALTER TABLE marketing_plans ADD COLUMN IF NOT EXISTS planner_plan_id TEXT`);
    await pgPool.query(`ALTER TABLE marketing_plans ADD COLUMN IF NOT EXISTS planner_plan_name TEXT`);
    await pgPool.query(`ALTER TABLE marketing_plans ADD COLUMN IF NOT EXISTS planner_bucket_id TEXT`);
    await pgPool.query(`ALTER TABLE marketing_plans ADD COLUMN IF NOT EXISTS planner_bucket_name TEXT`);
    await pgPool.query(`ALTER TABLE marketing_plans ADD COLUMN IF NOT EXISTS planner_connected_by VARCHAR`);
    await pgPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_plans_planner_connected_by_users_id_fk') THEN
          ALTER TABLE marketing_plans
            ADD CONSTRAINT marketing_plans_planner_connected_by_users_id_fk
            FOREIGN KEY (planner_connected_by) REFERENCES users(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    await pgPool.query(`ALTER TABLE marketing_plans ADD COLUMN IF NOT EXISTS planner_sync_enabled BOOLEAN DEFAULT false`);
    await pgPool.query(`ALTER TABLE marketing_plans ADD COLUMN IF NOT EXISTS planner_last_sync_at TIMESTAMP`);
    await pgPool.query(`ALTER TABLE marketing_plans ADD COLUMN IF NOT EXISTS planner_last_sync_error TEXT`);

    // Planner integration: per-task sync state
    await pgPool.query(`ALTER TABLE marketing_tasks ADD COLUMN IF NOT EXISTS planner_task_id TEXT`);
    await pgPool.query(`ALTER TABLE marketing_tasks ADD COLUMN IF NOT EXISTS planner_etag TEXT`);
    await pgPool.query(`ALTER TABLE marketing_tasks ADD COLUMN IF NOT EXISTS planner_last_synced_at TIMESTAMP`);

    // integration_configs — Slack/Teams webhook destinations
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS integration_configs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        tenant_domain TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        encrypted_webhook_url TEXT NOT NULL,
        webhook_host_hint TEXT,
        event_categories TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_by VARCHAR NOT NULL REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now(),
        last_used_at TIMESTAMP,
        last_error TEXT
      )
    `);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_integration_configs_tenant ON integration_configs(tenant_domain)`);

    // ─── Task #97: direct social publishing & email campaign delivery ───
    // Add token storage / publish-tracking columns to existing marketing tables.
    await pgPool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS encrypted_access_token TEXT`);
    await pgPool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS encrypted_refresh_token TEXT`);
    await pgPool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP`);
    await pgPool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS token_scope TEXT`);
    await pgPool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS author_mode TEXT`);
    await pgPool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS author_urn TEXT`);
    await pgPool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS connected_at TIMESTAMP`);
    await pgPool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS connected_by VARCHAR`);
    await pgPool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS last_publish_error TEXT`);

    await pgPool.query(`ALTER TABLE campaign_social_accounts ADD COLUMN IF NOT EXISTS auto_publish BOOLEAN NOT NULL DEFAULT false`);

    await pgPool.query(`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS published_at TIMESTAMP`);
    await pgPool.query(`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS published_url TEXT`);
    await pgPool.query(`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS publish_error TEXT`);
    await pgPool.query(`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS publish_attempt_count INTEGER NOT NULL DEFAULT 0`);
    await pgPool.query(`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS publish_next_attempt_at TIMESTAMP`);
    await pgPool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS available_authors JSONB`);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS social_publish_attempts (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        post_id VARCHAR NOT NULL REFERENCES generated_posts(id) ON DELETE CASCADE,
        social_account_id VARCHAR REFERENCES social_accounts(id) ON DELETE SET NULL,
        tenant_domain TEXT NOT NULL,
        platform TEXT NOT NULL,
        status TEXT NOT NULL,
        published_url TEXT,
        error_code TEXT,
        error_message TEXT,
        response_payload JSONB,
        attempted_at TIMESTAMP NOT NULL DEFAULT now(),
        attempted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_social_publish_attempts_post ON social_publish_attempts(post_id, attempted_at DESC)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_social_publish_attempts_tenant ON social_publish_attempts(tenant_domain, attempted_at DESC)`);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS email_recipient_lists (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        tenant_domain TEXT NOT NULL,
        market_id VARCHAR REFERENCES markets(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        description TEXT,
        recipient_count INTEGER NOT NULL DEFAULT 0,
        created_by VARCHAR NOT NULL REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_email_recipient_lists_tenant ON email_recipient_lists(tenant_domain, market_id)`);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS email_recipients (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        list_id VARCHAR NOT NULL REFERENCES email_recipient_lists(id) ON DELETE CASCADE,
        tenant_domain TEXT NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS email_recipients_list_email_uniq ON email_recipients(list_id, email)`);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS email_suppressions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        tenant_domain TEXT NOT NULL,
        email TEXT NOT NULL,
        reason TEXT NOT NULL,
        source TEXT,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS email_suppressions_tenant_email_uniq ON email_suppressions(tenant_domain, lower(email))`);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS email_sends (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        tenant_domain TEXT NOT NULL,
        market_id VARCHAR REFERENCES markets(id) ON DELETE SET NULL,
        generated_email_id VARCHAR NOT NULL REFERENCES generated_emails(id) ON DELETE CASCADE,
        list_id VARCHAR REFERENCES email_recipient_lists(id) ON DELETE SET NULL,
        test_recipient TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        recipient_count INTEGER NOT NULL DEFAULT 0,
        sent_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        bounce_count INTEGER NOT NULL DEFAULT 0,
        unsubscribe_count INTEGER NOT NULL DEFAULT 0,
        spam_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        created_by VARCHAR NOT NULL REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP`);
    await pgPool.query(`ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS open_count INTEGER NOT NULL DEFAULT 0`);
    await pgPool.query(`ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS click_count INTEGER NOT NULL DEFAULT 0`);
    await pgPool.query(`ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS delivered_count INTEGER NOT NULL DEFAULT 0`);
    await pgPool.query(`ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS track_opens BOOLEAN NOT NULL DEFAULT TRUE`);
    await pgPool.query(`ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS track_clicks BOOLEAN NOT NULL DEFAULT TRUE`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_email_sends_tenant ON email_sends(tenant_domain, created_at DESC)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_email_sends_email ON email_sends(generated_email_id, created_at DESC)`);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS email_send_recipients (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        send_id VARCHAR NOT NULL REFERENCES email_sends(id) ON DELETE CASCADE,
        tenant_domain TEXT NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        unsubscribe_token TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'queued',
        sg_message_id TEXT,
        error_message TEXT,
        sent_at TIMESTAMP,
        delivered_at TIMESTAMP,
        bounced_at TIMESTAMP,
        unsubscribed_at TIMESTAMP
      )
    `);
    // ALTER TABLE additions must run AFTER the CREATE TABLE so a fresh
    // database (where the table does not yet exist) gets the new columns
    // applied to the just-created table rather than failing on the very
    // first ALTER and aborting the rest of the startup migrations.
    await pgPool.query(`ALTER TABLE email_send_recipients ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP`);
    await pgPool.query(`ALTER TABLE email_send_recipients ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMP`);
    await pgPool.query(`ALTER TABLE email_send_recipients ADD COLUMN IF NOT EXISTS open_count INTEGER NOT NULL DEFAULT 0`);
    await pgPool.query(`ALTER TABLE email_send_recipients ADD COLUMN IF NOT EXISTS click_count INTEGER NOT NULL DEFAULT 0`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS email_send_recipients_send_email_idx ON email_send_recipients(send_id, email)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS email_send_recipients_token_idx ON email_send_recipients(unsubscribe_token)`);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS marketing_audit_log (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        tenant_domain TEXT NOT NULL,
        market_id VARCHAR,
        user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id VARCHAR,
        status TEXT NOT NULL DEFAULT 'ok',
        message TEXT,
        details JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS marketing_audit_log_tenant_created_idx ON marketing_audit_log(tenant_domain, created_at DESC)`);

    // OAuth 2.0 partner API tables (Task #96)
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        name TEXT NOT NULL,
        description TEXT,
        logo_url TEXT,
        contact_email TEXT,
        redirect_uris TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
        allowed_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
        client_secret_hash TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        code_hash TEXT NOT NULL UNIQUE,
        client_id VARCHAR NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tenant_domain TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        scopes TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
        code_challenge TEXT NOT NULL,
        code_challenge_method TEXT NOT NULL DEFAULT 'S256',
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS oauth_access_tokens (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        token_hash TEXT NOT NULL UNIQUE,
        client_id VARCHAR NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tenant_domain TEXT NOT NULL,
        scopes TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
        expires_at TIMESTAMP NOT NULL,
        revoked_at TIMESTAMP,
        last_used_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        token_hash TEXT NOT NULL UNIQUE,
        access_token_id VARCHAR,
        client_id VARCHAR NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tenant_domain TEXT NOT NULL,
        scopes TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
        expires_at TIMESTAMP NOT NULL,
        revoked_at TIMESTAMP,
        rotated_to_id VARCHAR,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS oauth_api_audit (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        token_id VARCHAR,
        client_id VARCHAR,
        user_id VARCHAR,
        tenant_domain TEXT,
        route TEXT NOT NULL,
        method TEXT NOT NULL,
        status INTEGER NOT NULL,
        scope TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS oauth_api_audit_tenant_idx ON oauth_api_audit(tenant_domain, created_at)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS oauth_api_audit_client_idx ON oauth_api_audit(client_id, created_at)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS oauth_access_tokens_user_idx ON oauth_access_tokens(user_id)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_user_idx ON oauth_refresh_tokens(user_id)`);
    // Add market_id columns (idempotent) so bearer-token requests can resolve
    // to the same RequestContext (tenant + market) the user consented under.
    await pgPool.query(`ALTER TABLE oauth_authorization_codes ADD COLUMN IF NOT EXISTS market_id VARCHAR`);
    await pgPool.query(`ALTER TABLE oauth_access_tokens ADD COLUMN IF NOT EXISTS market_id VARCHAR`);
    await pgPool.query(`ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS market_id VARCHAR`);

    // Seed Galaxy as the first registered OAuth client (idempotent)
    {
      const existing = await pgPool.query(`SELECT id FROM oauth_clients WHERE name = 'Galaxy' LIMIT 1`);
      if (existing.rows.length === 0) {
        const allScopes = [
          "read:battlecards",
          "read:briefings",
          "read:personas",
          "read:roadmap",
          "read:content-library",
          "read:brand-library",
          "read:campaigns",
          "read:reports",
          "read:posts",
        ];
        const galaxyRedirects = (process.env.GALAXY_OAUTH_REDIRECT_URIS || "https://galaxy.example.com/oauth/callback")
          .split(/[,\s]+/)
          .filter(Boolean);
        await pgPool.query(
          `INSERT INTO oauth_clients (name, description, contact_email, redirect_uris, allowed_scopes, status)
           VALUES ($1, $2, $3, $4, $5, 'active')`,
          [
            "Galaxy",
            "Official Galaxy partner portal — discovery and read-only sync of competitive intelligence.",
            "partners@galaxy.example.com",
            galaxyRedirects,
            allScopes,
          ]
        );
        log("Seeded Galaxy as the first OAuth client");
      }
    }

    // Task #102: Sentiment & tone analysis on competitor content.
    // Adds scoring metadata to the canonical artifact record (`activity`).
    await pgPool.query(`ALTER TABLE activity ADD COLUMN IF NOT EXISTS sentiment_score REAL`);
    await pgPool.query(`ALTER TABLE activity ADD COLUMN IF NOT EXISTS tone_label TEXT`);
    await pgPool.query(`ALTER TABLE activity ADD COLUMN IF NOT EXISTS tone_note TEXT`);
    await pgPool.query(`ALTER TABLE activity ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMP`);
    await pgPool.query(`ALTER TABLE activity ADD COLUMN IF NOT EXISTS analyzer_version TEXT`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS activity_competitor_analyzed_idx ON activity (competitor_id, analyzed_at)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS activity_analyzed_at_idx ON activity (analyzed_at)`);

    // Manual-action quotas (Task #99)
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS manual_action_usage (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        tenant_domain TEXT NOT NULL,
        action TEXT NOT NULL,
        cost_tier TEXT NOT NULL DEFAULT 'medium',
        period_start TIMESTAMP NOT NULL,
        occurred_at TIMESTAMP NOT NULL DEFAULT now(),
        succeeded BOOLEAN,
        actor_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        resource_id VARCHAR,
        metadata JSONB
      )
    `);
    await pgPool.query(`ALTER TABLE manual_action_usage ADD COLUMN IF NOT EXISTS cost_tier TEXT NOT NULL DEFAULT 'medium'`);
    await pgPool.query(`ALTER TABLE manual_action_usage ALTER COLUMN succeeded DROP NOT NULL`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS manual_action_usage_tenant_action_period_idx ON manual_action_usage(tenant_domain, action, period_start)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS manual_action_usage_tenant_period_idx ON manual_action_usage(tenant_domain, period_start)`);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS manual_action_bonuses (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        tenant_domain TEXT NOT NULL,
        action TEXT NOT NULL,
        delta INTEGER NOT NULL,
        period_start TIMESTAMP NOT NULL,
        reason TEXT,
        granted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS manual_action_bonuses_tenant_action_period_idx ON manual_action_bonuses(tenant_domain, action, period_start)`);

    // Task #104 — Marketing Planner Phase 2: per-category bucket mappings,
    // sync log, and Graph change-notification subscription bookkeeping.
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS marketing_plan_bucket_mappings (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        plan_id VARCHAR NOT NULL REFERENCES marketing_plans(id) ON DELETE CASCADE,
        activity_category TEXT NOT NULL,
        bucket_id TEXT NOT NULL,
        bucket_name TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS marketing_plan_bucket_mappings_plan_cat_idx ON marketing_plan_bucket_mappings(plan_id, activity_category)`);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS planner_task_sync_log (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        plan_id VARCHAR NOT NULL REFERENCES marketing_plans(id) ON DELETE CASCADE,
        task_id VARCHAR REFERENCES marketing_tasks(id) ON DELETE SET NULL,
        planner_task_id TEXT,
        occurred_at TIMESTAMP NOT NULL DEFAULT now(),
        direction TEXT NOT NULL,
        fields JSONB,
        success BOOLEAN NOT NULL DEFAULT TRUE,
        error_message TEXT
      )
    `);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS planner_task_sync_log_plan_idx ON planner_task_sync_log(plan_id, occurred_at DESC)`);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS planner_subscriptions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        plan_id VARCHAR NOT NULL REFERENCES marketing_plans(id) ON DELETE CASCADE,
        subscription_id TEXT NOT NULL,
        resource TEXT NOT NULL,
        client_state TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        last_renewed_at TIMESTAMP,
        last_error TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS planner_subscriptions_plan_idx ON planner_subscriptions(plan_id)`);

    // ── Task #100: HubSpot CRM integration (idempotent) ──────────────────
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS hubspot_connections (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        tenant_domain TEXT NOT NULL UNIQUE,
        hubspot_portal_id TEXT,
        hubspot_portal_name TEXT,
        encrypted_access_token TEXT NOT NULL,
        encrypted_refresh_token TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        scopes TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
        auto_push_enabled BOOLEAN NOT NULL DEFAULT false,
        default_owner_id TEXT,
        connected_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        connected_at TIMESTAMP NOT NULL DEFAULT now(),
        last_sync_at TIMESTAMP,
        last_sync_error TEXT,
        last_sync_stats JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pgPool.query(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS hubspot_company_id TEXT`);
    await pgPool.query(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS hubspot_lifecycle_stage TEXT`);
    await pgPool.query(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS hubspot_open_deal_count INTEGER NOT NULL DEFAULT 0`);
    await pgPool.query(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS hubspot_open_deal_value INTEGER NOT NULL DEFAULT 0`);
    await pgPool.query(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS hubspot_last_sync_at TIMESTAMP`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS competitors_hubspot_company_idx ON competitors(hubspot_company_id) WHERE hubspot_company_id IS NOT NULL`);

    log("Startup migrations completed");
  } catch (err) {
    console.error("[Startup] Migration error:", err);
  }

  // Wire job-queue persistence so all queued jobs write lifecycle events to scheduled_job_runs
  setPersistenceHooks({
    async onCreate(job) {
      try {
        const run = await storage.createScheduledJobRun({
          jobType: job.type,
          tenantDomain: job.ctx?.tenantDomain || null,
          targetId: job.ctx?.targetId || null,
          targetName: job.ctx?.targetName || job.label,
          status: "running",
          startedAt: job.startedAt,
        });
        return run.id;
      } catch (err) {
        console.error("[JobQueue persistence] createScheduledJobRun failed:", err);
        return "";
      }
    },
    async onComplete(dbRowId, status, errorMessage) {
      if (!dbRowId) return;
      try {
        const updated = await storage.updateScheduledJobRun(dbRowId, {
          status,
          completedAt: new Date(),
          errorMessage: errorMessage || null,
        });
        // Fan-out failed queued jobs (crawl/monitor/analysis/pdf) through
        // the central notifications dispatcher.
        if (status === "failed" && updated?.tenantDomain) {
          const { notifications } = await import("./services/notifications");
          await notifications.dispatch(updated.tenantDomain, "job_failed", {
            jobType: updated.jobType || "queued_job",
            targetName: updated.targetName || undefined,
            error: errorMessage || "Unknown error",
            attempts: 1,
          });
        }
      } catch (err) {
        console.error("[JobQueue persistence] updateScheduledJobRun failed:", err);
      }
    },
  });

  registerSEORoutes(app);

  app.use(crawlerPrerender);

  await registerRoutes(httpServer, app);
  
  // Seed default service plans if none exist
  await storage.seedDefaultServicePlans();
  
  // Backfill organizations for existing competitors/baselines
  storage.backfillOrganizations().catch(err => console.error("[Startup] Organization backfill error:", err));
  
  // Recover stuck "generating" briefings from previous server restarts
  storage.recoverStuckBriefings().catch(err => console.error("[Startup] Briefing recovery error:", err));
  
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      
      // Start scheduled background jobs for website crawling and social monitoring
      // Jobs run in both development and production now
      startScheduledJobs();
      log("Scheduled jobs started");
    },
  );
})();
