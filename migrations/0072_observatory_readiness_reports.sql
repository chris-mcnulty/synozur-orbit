-- Observatory readiness engine, reporting engine, and VPAT assistant:
-- readiness score snapshots per application version, async report records,
-- and per-criterion VPAT worksheet entries.
CREATE TABLE IF NOT EXISTS "obs_readiness_scores" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "tenant_domain" text NOT NULL,
        "application_id" varchar NOT NULL,
        "version_id" varchar NOT NULL,
        "overall_score" integer NOT NULL,
        "band" text NOT NULL,
        "raw_band" text NOT NULL,
        "blocked" boolean DEFAULT false NOT NULL,
        "domain_scores" jsonb NOT NULL,
        "blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "computed_by" varchar,
        "computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_reports" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "tenant_domain" text NOT NULL,
        "application_id" varchar NOT NULL,
        "version_id" varchar,
        "report_type" text NOT NULL,
        "title" text NOT NULL,
        "status" text DEFAULT 'generating' NOT NULL,
        "html" text,
        "ai_summary" text,
        "include_ai_summary" boolean DEFAULT false NOT NULL,
        "error" text,
        "generated_at" timestamp,
        "created_by" varchar,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_vpat_entries" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "tenant_domain" text NOT NULL,
        "version_id" varchar NOT NULL,
        "application_id" varchar NOT NULL,
        "control_ref" varchar NOT NULL,
        "conformance" text DEFAULT 'Not Evaluated' NOT NULL,
        "remarks" text,
        "reviewer_notes" text,
        "ai_drafted" boolean DEFAULT false NOT NULL,
        "updated_by" varchar,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_readiness_scores" ADD CONSTRAINT "obs_readiness_scores_application_id_obs_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."obs_applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_readiness_scores" ADD CONSTRAINT "obs_readiness_scores_version_id_obs_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."obs_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_readiness_scores" ADD CONSTRAINT "obs_readiness_scores_computed_by_users_id_fk" FOREIGN KEY ("computed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_reports" ADD CONSTRAINT "obs_reports_application_id_obs_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."obs_applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_reports" ADD CONSTRAINT "obs_reports_version_id_obs_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."obs_versions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_reports" ADD CONSTRAINT "obs_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_vpat_entries" ADD CONSTRAINT "obs_vpat_entries_version_id_obs_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."obs_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_vpat_entries" ADD CONSTRAINT "obs_vpat_entries_application_id_obs_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."obs_applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_vpat_entries" ADD CONSTRAINT "obs_vpat_entries_control_ref_obs_controls_id_fk" FOREIGN KEY ("control_ref") REFERENCES "public"."obs_controls"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_vpat_entries" ADD CONSTRAINT "obs_vpat_entries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_readiness_scores_tenant_idx" ON "obs_readiness_scores" USING btree ("tenant_domain");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_readiness_scores_version_idx" ON "obs_readiness_scores" USING btree ("version_id","computed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_reports_tenant_idx" ON "obs_reports" USING btree ("tenant_domain","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_vpat_entries_tenant_idx" ON "obs_vpat_entries" USING btree ("tenant_domain");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_vpat_entries_version_idx" ON "obs_vpat_entries" USING btree ("version_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "obs_vpat_entries_version_control_idx" ON "obs_vpat_entries" USING btree ("version_id","control_ref");
