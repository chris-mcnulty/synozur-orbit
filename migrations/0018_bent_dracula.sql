ALTER TABLE "content_briefs" ADD COLUMN "scheduled_at" timestamp;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD COLUMN "campaign_id" varchar;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD COLUMN "solution_area_id" varchar;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD COLUMN "conference_id" varchar;--> statement-breakpoint
ALTER TABLE "generated_emails" ADD COLUMN "scheduled_at" timestamp;--> statement-breakpoint
ALTER TABLE "generated_emails" ADD COLUMN "solution_area_id" varchar;--> statement-breakpoint
ALTER TABLE "generated_emails" ADD COLUMN "conference_id" varchar;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN "solution_area_id" varchar;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_solution_area_id_solution_areas_id_fk" FOREIGN KEY ("solution_area_id") REFERENCES "public"."solution_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_conference_id_conferences_id_fk" FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_emails" ADD CONSTRAINT "generated_emails_solution_area_id_solution_areas_id_fk" FOREIGN KEY ("solution_area_id") REFERENCES "public"."solution_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_emails" ADD CONSTRAINT "generated_emails_conference_id_conferences_id_fk" FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD CONSTRAINT "generated_posts_solution_area_id_solution_areas_id_fk" FOREIGN KEY ("solution_area_id") REFERENCES "public"."solution_areas"("id") ON DELETE set null ON UPDATE no action;