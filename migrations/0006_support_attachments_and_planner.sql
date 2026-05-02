-- Support ticket attachments
CREATE TABLE IF NOT EXISTS "support_ticket_attachments" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "ticket_id" varchar NOT NULL,
    "reply_id" varchar,
    "uploaded_by" varchar NOT NULL,
    "file_name" text NOT NULL,
    "file_size" integer NOT NULL,
    "content_type" text NOT NULL,
    "object_path" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_ticket_attachments_ticket_id_support_tickets_id_fk') THEN
        ALTER TABLE "support_ticket_attachments"
            ADD CONSTRAINT "support_ticket_attachments_ticket_id_support_tickets_id_fk"
            FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade;
    END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_ticket_attachments_reply_id_support_ticket_replies_id_fk') THEN
        ALTER TABLE "support_ticket_attachments"
            ADD CONSTRAINT "support_ticket_attachments_reply_id_support_ticket_replies_id_fk"
            FOREIGN KEY ("reply_id") REFERENCES "public"."support_ticket_replies"("id") ON DELETE cascade;
    END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_ticket_attachments_uploaded_by_users_id_fk') THEN
        ALTER TABLE "support_ticket_attachments"
            ADD CONSTRAINT "support_ticket_attachments_uploaded_by_users_id_fk"
            FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id");
    END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_ticket_attachments_ticket"
    ON "support_ticket_attachments" ("ticket_id");
--> statement-breakpoint

-- Microsoft Planner integration: marketing plan target mapping
ALTER TABLE "marketing_plans" ADD COLUMN IF NOT EXISTS "planner_group_id" text;
--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN IF NOT EXISTS "planner_group_name" text;
--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN IF NOT EXISTS "planner_plan_id" text;
--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN IF NOT EXISTS "planner_plan_name" text;
--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN IF NOT EXISTS "planner_bucket_id" text;
--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN IF NOT EXISTS "planner_bucket_name" text;
--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN IF NOT EXISTS "planner_connected_by" varchar;
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_plans_planner_connected_by_users_id_fk') THEN
        ALTER TABLE "marketing_plans"
            ADD CONSTRAINT "marketing_plans_planner_connected_by_users_id_fk"
            FOREIGN KEY ("planner_connected_by") REFERENCES "public"."users"("id") ON DELETE set null;
    END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN IF NOT EXISTS "planner_sync_enabled" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN IF NOT EXISTS "planner_last_sync_at" timestamp;
--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN IF NOT EXISTS "planner_last_sync_error" text;
--> statement-breakpoint

-- Marketing tasks: per-task Planner sync state
ALTER TABLE "marketing_tasks" ADD COLUMN IF NOT EXISTS "planner_task_id" text;
--> statement-breakpoint
ALTER TABLE "marketing_tasks" ADD COLUMN IF NOT EXISTS "planner_etag" text;
--> statement-breakpoint
ALTER TABLE "marketing_tasks" ADD COLUMN IF NOT EXISTS "planner_last_synced_at" timestamp;
--> statement-breakpoint

-- User-level Microsoft Graph delegated tokens for Planner (and future delegated ops)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "graph_access_token" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "graph_refresh_token" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "graph_token_expires_at" timestamp;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "graph_scopes" text;
