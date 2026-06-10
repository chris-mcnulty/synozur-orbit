-- WS4: link a conference (event) to a parent campaign so its promotion posts
-- roll up into the campaign's master view.

ALTER TABLE "conferences" ADD COLUMN IF NOT EXISTS "campaign_id" varchar;--> statement-breakpoint
ALTER TABLE "conferences" ADD CONSTRAINT "conferences_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;
