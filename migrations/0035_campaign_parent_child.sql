-- Add self-referential parent_campaign_id FK to campaigns so mainline campaigns
-- can own child social campaigns. ON DELETE SET NULL so archiving a parent
-- does not cascade-delete or cascade-archive its children.

ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "parent_campaign_id" varchar;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_parent_campaign_id_campaigns_id_fk" FOREIGN KEY ("parent_campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;
