-- WS1: Campaign as orchestrating umbrella — intent (type/objective/goal/audience)
-- and a content-plan link from editorial calendars back to a campaign.

ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "campaign_type" text DEFAULT 'theme' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "objective" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "goal" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "audience_persona_ids" text[];--> statement-breakpoint
ALTER TABLE "editorial_calendars" ADD COLUMN IF NOT EXISTS "campaign_id" varchar;--> statement-breakpoint
ALTER TABLE "editorial_calendars" ADD CONSTRAINT "editorial_calendars_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
