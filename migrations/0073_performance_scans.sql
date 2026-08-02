-- Observatory performance scan history table.
-- Stores one row per headless browser scan run against a performance assessment.
CREATE TABLE IF NOT EXISTS "obs_performance_scans" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "tenant_domain" text NOT NULL,
        "assessment_id" varchar NOT NULL,
        "application_id" varchar NOT NULL,
        "scan_url" text NOT NULL,
        "status" text DEFAULT 'running' NOT NULL,
        "ttfb_ms" integer,
        "load_time_ms" integer,
        "lcp_ms" integer,
        "cls_score" real,
        "tti_ms" integer,
        "sla_config" jsonb,
        "finding_count" integer DEFAULT 0 NOT NULL,
        "scan_error" text,
        "warnings" jsonb DEFAULT '[]'::jsonb,
        "scanned_at" timestamp,
        "triggered_by" varchar,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_performance_scans" ADD CONSTRAINT "obs_performance_scans_assessment_id_obs_assessments_id_fk"
   FOREIGN KEY ("assessment_id") REFERENCES "public"."obs_assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_performance_scans" ADD CONSTRAINT "obs_performance_scans_application_id_obs_applications_id_fk"
   FOREIGN KEY ("application_id") REFERENCES "public"."obs_applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_performance_scans" ADD CONSTRAINT "obs_performance_scans_triggered_by_users_id_fk"
   FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_perf_scans_tenant_idx"
  ON "obs_performance_scans" USING btree ("tenant_domain");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_perf_scans_assessment_idx"
  ON "obs_performance_scans" USING btree ("assessment_id", "created_at");
--> statement-breakpoint
-- Add performance SLA configuration column to obs_applications
DO $$ BEGIN
 ALTER TABLE "obs_applications" ADD COLUMN "perf_sla_config" jsonb;
EXCEPTION
 WHEN duplicate_column THEN null;
END $$;
