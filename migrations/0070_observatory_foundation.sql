-- Observatory foundation: traceability spine
-- Application → Version → Assessment → Finding → Evidence → Control → Framework
CREATE TABLE IF NOT EXISTS "obs_applications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"name" text NOT NULL,
	"product_family" text,
	"description" text,
	"business_owner" text,
	"technical_owner" text,
	"app_url" text,
	"repo_url" text,
	"hosting_platform" text,
	"auth_method" text,
	"data_classification" text,
	"ai_enabled" boolean DEFAULT false NOT NULL,
	"certification_target" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_versions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"application_id" varchar NOT NULL,
	"version_number" text NOT NULL,
	"release_date" timestamp,
	"environment" text,
	"build_number" text,
	"branch" text,
	"commit_hash" text,
	"notes" text,
	"assessment_status" text DEFAULT 'Draft' NOT NULL,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_assessments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"application_id" varchar NOT NULL,
	"version_id" varchar,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"assessor_name" text,
	"assessor_user_id" varchar,
	"team" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"start_date" timestamp,
	"end_date" timestamp,
	"scope" text,
	"out_of_scope" text,
	"executive_summary" text,
	"overall_score" integer,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_frameworks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"version" text,
	"description" text,
	"category" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "obs_frameworks_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_controls" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"framework_id" varchar NOT NULL,
	"control_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"level" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_findings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"assessment_id" varchar NOT NULL,
	"application_id" varchar NOT NULL,
	"version_id" varchar,
	"title" text NOT NULL,
	"description" text,
	"severity" text DEFAULT 'Medium' NOT NULL,
	"domain" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"recommendation" text,
	"remediation_plan" text,
	"affected_component" text,
	"steps_to_reproduce" text,
	"likelihood" text,
	"impact" text,
	"cwe_id" text,
	"wcag_criterion" text,
	"due_date" timestamp,
	"assigned_to_user_id" varchar,
	"assigned_to_name" text,
	"resolved_at" timestamp,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_evidence" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"evidence_type" text DEFAULT 'document' NOT NULL,
	"file_url" text,
	"file_name" text,
	"file_size" integer,
	"content_type" text,
	"external_url" text,
	"source" text,
	"collected_by" text,
	"collected_at" timestamp,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_finding_evidence" (
	"finding_id" varchar NOT NULL,
	"evidence_id" varchar NOT NULL,
	CONSTRAINT "obs_finding_evidence_finding_id_evidence_id_pk" PRIMARY KEY("finding_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_assessment_evidence" (
	"assessment_id" varchar NOT NULL,
	"evidence_id" varchar NOT NULL,
	CONSTRAINT "obs_assessment_evidence_assessment_id_evidence_id_pk" PRIMARY KEY("assessment_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_version_evidence" (
	"version_id" varchar NOT NULL,
	"evidence_id" varchar NOT NULL,
	CONSTRAINT "obs_version_evidence_version_id_evidence_id_pk" PRIMARY KEY("version_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_control_evidence" (
	"control_id" varchar NOT NULL,
	"evidence_id" varchar NOT NULL,
	CONSTRAINT "obs_control_evidence_control_id_evidence_id_pk" PRIMARY KEY("control_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_finding_controls" (
	"finding_id" varchar NOT NULL,
	"control_id" varchar NOT NULL,
	CONSTRAINT "obs_finding_controls_finding_id_control_id_pk" PRIMARY KEY("finding_id","control_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_audit_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"user_id" varchar,
	"entity_type" text NOT NULL,
	"entity_id" varchar NOT NULL,
	"action" text NOT NULL,
	"summary" text,
	"changes" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "obs_applications" ADD CONSTRAINT "obs_applications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_versions" ADD CONSTRAINT "obs_versions_application_id_obs_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."obs_applications"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_versions" ADD CONSTRAINT "obs_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_assessments" ADD CONSTRAINT "obs_assessments_application_id_obs_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."obs_applications"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_assessments" ADD CONSTRAINT "obs_assessments_version_id_obs_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."obs_versions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_assessments" ADD CONSTRAINT "obs_assessments_assessor_user_id_users_id_fk" FOREIGN KEY ("assessor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_assessments" ADD CONSTRAINT "obs_assessments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_controls" ADD CONSTRAINT "obs_controls_framework_id_obs_frameworks_id_fk" FOREIGN KEY ("framework_id") REFERENCES "public"."obs_frameworks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_findings" ADD CONSTRAINT "obs_findings_assessment_id_obs_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."obs_assessments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_findings" ADD CONSTRAINT "obs_findings_application_id_obs_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."obs_applications"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_findings" ADD CONSTRAINT "obs_findings_version_id_obs_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."obs_versions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_findings" ADD CONSTRAINT "obs_findings_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_findings" ADD CONSTRAINT "obs_findings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_evidence" ADD CONSTRAINT "obs_evidence_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_finding_evidence" ADD CONSTRAINT "obs_finding_evidence_finding_id_obs_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."obs_findings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_finding_evidence" ADD CONSTRAINT "obs_finding_evidence_evidence_id_obs_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."obs_evidence"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_assessment_evidence" ADD CONSTRAINT "obs_assessment_evidence_assessment_id_obs_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."obs_assessments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_assessment_evidence" ADD CONSTRAINT "obs_assessment_evidence_evidence_id_obs_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."obs_evidence"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_version_evidence" ADD CONSTRAINT "obs_version_evidence_version_id_obs_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."obs_versions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_version_evidence" ADD CONSTRAINT "obs_version_evidence_evidence_id_obs_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."obs_evidence"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_control_evidence" ADD CONSTRAINT "obs_control_evidence_control_id_obs_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."obs_controls"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_control_evidence" ADD CONSTRAINT "obs_control_evidence_evidence_id_obs_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."obs_evidence"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_finding_controls" ADD CONSTRAINT "obs_finding_controls_finding_id_obs_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."obs_findings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_finding_controls" ADD CONSTRAINT "obs_finding_controls_control_id_obs_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."obs_controls"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "obs_audit_logs" ADD CONSTRAINT "obs_audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_applications_tenant_idx" ON "obs_applications" ("tenant_domain");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_versions_tenant_idx" ON "obs_versions" ("tenant_domain");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_versions_app_idx" ON "obs_versions" ("application_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_assessments_tenant_idx" ON "obs_assessments" ("tenant_domain");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_assessments_app_idx" ON "obs_assessments" ("application_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_assessments_version_idx" ON "obs_assessments" ("version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_controls_framework_idx" ON "obs_controls" ("framework_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "obs_controls_framework_control_idx" ON "obs_controls" ("framework_id","control_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_findings_tenant_idx" ON "obs_findings" ("tenant_domain");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_findings_assessment_idx" ON "obs_findings" ("assessment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_findings_app_idx" ON "obs_findings" ("application_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_findings_status_idx" ON "obs_findings" ("tenant_domain","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_evidence_tenant_idx" ON "obs_evidence" ("tenant_domain");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_audit_logs_tenant_idx" ON "obs_audit_logs" ("tenant_domain","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_audit_logs_entity_idx" ON "obs_audit_logs" ("entity_type","entity_id");
