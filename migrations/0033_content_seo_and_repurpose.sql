-- WS3: persist headline SEO/AEO fields onto content assets, and record when an
-- asset was produced by repurposing another asset.

ALTER TABLE "content_assets" ADD COLUMN IF NOT EXISTS "seo_title" text;--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN IF NOT EXISTS "meta_description" text;--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN IF NOT EXISTS "seo_slug" text;--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN IF NOT EXISTS "seo_keywords" text[];--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN IF NOT EXISTS "seo_optimized_at" timestamp;--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN IF NOT EXISTS "repurposed_from_asset_id" varchar;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_repurposed_from_asset_id_fk" FOREIGN KEY ("repurposed_from_asset_id") REFERENCES "public"."content_assets"("id") ON DELETE set null ON UPDATE no action;
