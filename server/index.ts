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
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// File upload middleware for logo uploads
app.use(fileUpload({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
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
