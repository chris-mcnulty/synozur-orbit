ALTER TABLE "campaigns" ADD COLUMN "campaign_type" text DEFAULT 'theme' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "objective" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "goal" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "audience_persona_ids" text[];--> statement-breakpoint
ALTER TABLE "conferences" ADD COLUMN "campaign_id" varchar;--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN "seo_title" text;--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN "meta_description" text;--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN "seo_slug" text;--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN "seo_keywords" text[];--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN "seo_optimized_at" timestamp;--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN "repurposed_from_asset_id" varchar;--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN "repurpose_meta" jsonb;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD COLUMN "scheduled_at" timestamp;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD COLUMN "campaign_id" varchar;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD COLUMN "solution_area_id" varchar;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD COLUMN "conference_id" varchar;--> statement-breakpoint
ALTER TABLE "editorial_calendars" ADD COLUMN "campaign_id" varchar;--> statement-breakpoint
ALTER TABLE "generated_emails" ADD COLUMN "scheduled_at" timestamp;--> statement-breakpoint
ALTER TABLE "generated_emails" ADD COLUMN "solution_area_id" varchar;--> statement-breakpoint
ALTER TABLE "generated_emails" ADD COLUMN "conference_id" varchar;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN "post_format" text;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN "carousel_slides" jsonb;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN "repurpose_meta" jsonb;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN "solution_area_id" varchar;--> statement-breakpoint
ALTER TABLE "conferences" ADD CONSTRAINT "conferences_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_repurposed_from_asset_id_content_assets_id_fk" FOREIGN KEY ("repurposed_from_asset_id") REFERENCES "public"."content_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_solution_area_id_solution_areas_id_fk" FOREIGN KEY ("solution_area_id") REFERENCES "public"."solution_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_conference_id_conferences_id_fk" FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_calendars" ADD CONSTRAINT "editorial_calendars_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_emails" ADD CONSTRAINT "generated_emails_solution_area_id_solution_areas_id_fk" FOREIGN KEY ("solution_area_id") REFERENCES "public"."solution_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_emails" ADD CONSTRAINT "generated_emails_conference_id_conferences_id_fk" FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD CONSTRAINT "generated_posts_solution_area_id_solution_areas_id_fk" FOREIGN KEY ("solution_area_id") REFERENCES "public"."solution_areas"("id") ON DELETE set null ON UPDATE no action;