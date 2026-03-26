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
        await storage.updateScheduledJobRun(dbRowId, {
          status,
          completedAt: new Date(),
          errorMessage: errorMessage || null,
        });
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
