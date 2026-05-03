-- Task #86: Persistent, tenant-aware rate limiter
-- Replaces the in-memory rate limit map with a database-backed one so limits
-- survive server restarts and work across multiple processes.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "public_rate_limit_per_minute" integer;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
  "tenant_domain" text NOT NULL,
  "scope" text NOT NULL,
  "key" text NOT NULL,
  "count" integer NOT NULL DEFAULT 0,
  "reset_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("tenant_domain", "scope", "key")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "rate_limit_buckets_reset_at_idx"
  ON "rate_limit_buckets" ("reset_at");
