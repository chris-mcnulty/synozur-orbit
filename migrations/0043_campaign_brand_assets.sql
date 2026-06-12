CREATE TABLE "campaign_brand_assets" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" varchar NOT NULL REFERENCES "campaigns"("id") ON DELETE cascade,
  "brand_asset_id" varchar NOT NULL REFERENCES "brand_assets"("id") ON DELETE cascade,
  "sort_order" integer NOT NULL DEFAULT 0,
  "added_at" timestamp NOT NULL DEFAULT now()
);
