-- Manual Action Rate Limits (Task #99)
-- Tracks per-tenant cost-driving manual action invocations and admin-granted bonus quotas.

CREATE TABLE IF NOT EXISTS "manual_action_usage" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_domain" text NOT NULL,
    "user_id" varchar,
    "action" text NOT NULL,
    "cost_tier" text NOT NULL DEFAULT 'medium',
    "succeeded" boolean,
    "occurred_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "manual_action_usage_tenant_action_idx"
    ON "manual_action_usage" ("tenant_domain", "action", "occurred_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "manual_action_bonuses" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_domain" text NOT NULL,
    "action" text NOT NULL,
    "delta" integer NOT NULL DEFAULT 0,
    "period_start" timestamp NOT NULL,
    "reason" text,
    "granted_by" varchar,
    "granted_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "manual_action_bonuses_tenant_action_period_idx"
    ON "manual_action_bonuses" ("tenant_domain", "action", "period_start");
--> statement-breakpoint

-- Backfill: ensure existing deployments that may have created the table earlier get the new columns.
ALTER TABLE "manual_action_usage" ADD COLUMN IF NOT EXISTS "cost_tier" text NOT NULL DEFAULT 'medium';
--> statement-breakpoint
ALTER TABLE "manual_action_usage" ALTER COLUMN "succeeded" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "manual_action_usage" ALTER COLUMN "succeeded" DROP DEFAULT;
