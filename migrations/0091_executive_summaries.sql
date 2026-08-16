-- Unified Executive Summary ("Briefing Room") — cross-area tenant-level report runs
CREATE TABLE IF NOT EXISTS "unified_exec_summaries" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_domain" text NOT NULL,
  "status" text NOT NULL DEFAULT 'generating',
  "trigger" text NOT NULL DEFAULT 'manual',
  "summary_data" jsonb,
  "error" text,
  "generated_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp
);
CREATE INDEX IF NOT EXISTS "unified_exec_summaries_tenant_created_idx"
  ON "unified_exec_summaries" ("tenant_domain", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "unified_exec_summary_settings" (
  "tenant_domain" text PRIMARY KEY,
  "auto_enabled" boolean NOT NULL DEFAULT false,
  "frequency" text NOT NULL DEFAULT 'weekly',
  "last_auto_run_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
