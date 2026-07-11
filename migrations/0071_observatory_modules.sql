-- Observatory specialized assessment modules:
-- review workbench checklist rows (accessibility / source code / architecture /
-- architecture azure checklist / privacy / AI governance), source review
-- metadata, penetration tests + pen-test finding extensions, and
-- source file/line columns on shared findings.
CREATE TABLE IF NOT EXISTS "obs_review_items" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "tenant_domain" text NOT NULL,
        "assessment_id" varchar NOT NULL,
        "module" text NOT NULL,
        "category" text NOT NULL,
        "status" text DEFAULT 'Not Tested' NOT NULL,
        "notes" text,
        "reviewer" text,
        "reviewed_at" timestamp,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "created_by" varchar,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_review_item_findings" (
        "review_item_id" varchar NOT NULL,
        "finding_id" varchar NOT NULL,
        CONSTRAINT "obs_review_item_findings_review_item_id_finding_id_pk" PRIMARY KEY("review_item_id","finding_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_review_item_evidence" (
        "review_item_id" varchar NOT NULL,
        "evidence_id" varchar NOT NULL,
        CONSTRAINT "obs_review_item_evidence_review_item_id_evidence_id_pk" PRIMARY KEY("review_item_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_source_review_meta" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "tenant_domain" text NOT NULL,
        "assessment_id" varchar NOT NULL,
        "repository_url" text,
        "branch" text,
        "commit_hash" text,
        "language" text,
        "framework" text,
        "component" text,
        "review_tool" text,
        "notes" text,
        "created_by" varchar,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_pen_tests" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "tenant_domain" text NOT NULL,
        "assessment_id" varchar NOT NULL,
        "test_name" text NOT NULL,
        "firm" text,
        "lead_tester" text,
        "methodology" text,
        "start_date" timestamp,
        "end_date" timestamp,
        "executive_summary" text,
        "result" text,
        "created_by" varchar,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obs_pen_test_findings" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "tenant_domain" text NOT NULL,
        "pen_test_id" varchar NOT NULL,
        "finding_id" varchar NOT NULL,
        "cvss_score" real,
        "cvss_vector" text,
        "exploitability" text,
        "validation_status" text DEFAULT 'Not Started' NOT NULL,
        "validated_by" text,
        "validated_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "obs_findings" ADD COLUMN IF NOT EXISTS "source_file" text;
--> statement-breakpoint
ALTER TABLE "obs_findings" ADD COLUMN IF NOT EXISTS "source_line" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_review_items" ADD CONSTRAINT "obs_review_items_assessment_id_obs_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."obs_assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_review_items" ADD CONSTRAINT "obs_review_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_review_item_findings" ADD CONSTRAINT "obs_review_item_findings_review_item_id_obs_review_items_id_fk" FOREIGN KEY ("review_item_id") REFERENCES "public"."obs_review_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_review_item_findings" ADD CONSTRAINT "obs_review_item_findings_finding_id_obs_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."obs_findings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_review_item_evidence" ADD CONSTRAINT "obs_review_item_evidence_review_item_id_obs_review_items_id_fk" FOREIGN KEY ("review_item_id") REFERENCES "public"."obs_review_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_review_item_evidence" ADD CONSTRAINT "obs_review_item_evidence_evidence_id_obs_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."obs_evidence"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_source_review_meta" ADD CONSTRAINT "obs_source_review_meta_assessment_id_obs_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."obs_assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_source_review_meta" ADD CONSTRAINT "obs_source_review_meta_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_pen_tests" ADD CONSTRAINT "obs_pen_tests_assessment_id_obs_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."obs_assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_pen_tests" ADD CONSTRAINT "obs_pen_tests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_pen_test_findings" ADD CONSTRAINT "obs_pen_test_findings_pen_test_id_obs_pen_tests_id_fk" FOREIGN KEY ("pen_test_id") REFERENCES "public"."obs_pen_tests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "obs_pen_test_findings" ADD CONSTRAINT "obs_pen_test_findings_finding_id_obs_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."obs_findings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_review_items_tenant_idx" ON "obs_review_items" USING btree ("tenant_domain");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_review_items_assessment_idx" ON "obs_review_items" USING btree ("assessment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "obs_review_items_assessment_module_category_idx" ON "obs_review_items" USING btree ("assessment_id","module","category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_source_review_meta_tenant_idx" ON "obs_source_review_meta" USING btree ("tenant_domain");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "obs_source_review_meta_assessment_idx" ON "obs_source_review_meta" USING btree ("assessment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_pen_tests_tenant_idx" ON "obs_pen_tests" USING btree ("tenant_domain");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "obs_pen_tests_assessment_idx" ON "obs_pen_tests" USING btree ("assessment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_pen_test_findings_tenant_idx" ON "obs_pen_test_findings" USING btree ("tenant_domain");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obs_pen_test_findings_pen_test_idx" ON "obs_pen_test_findings" USING btree ("pen_test_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "obs_pen_test_findings_finding_idx" ON "obs_pen_test_findings" USING btree ("finding_id");
