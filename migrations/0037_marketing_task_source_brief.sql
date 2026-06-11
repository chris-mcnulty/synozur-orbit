-- Idempotent Push to Planner: link a marketing_task back to the content brief
-- it was created from, so re-pushing a calendar skips briefs already pushed.

ALTER TABLE "marketing_tasks" ADD COLUMN IF NOT EXISTS "source_brief_id" varchar;--> statement-breakpoint
ALTER TABLE "marketing_tasks" ADD CONSTRAINT "marketing_tasks_source_brief_id_content_briefs_id_fk" FOREIGN KEY ("source_brief_id") REFERENCES "public"."content_briefs"("id") ON DELETE set null ON UPDATE no action;
