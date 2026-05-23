-- Solution-area taxonomy + asset-type enum + source-asset link for posts.
-- Mirrors the schema additions in shared/schema.ts: a cross-product
-- taxonomy for "GTM" / "AI" / etc., a first-class asset_type column on
-- content + brand assets, and a sourceAssetId FK on generated_posts so
-- drafts can carry their source content asset's lead image as a base
-- visual.

CREATE TABLE IF NOT EXISTS "solution_areas" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_domain" text NOT NULL,
    "market_id" varchar,
    "name" text NOT NULL,
    "slug" text NOT NULL,
    "description" text,
    "color" text,
    "icon" text,
    "parent_id" varchar,
    "sort_order" integer NOT NULL DEFAULT 0,
    "created_by" varchar NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'solution_areas_market_id_markets_id_fk'
    ) THEN
        ALTER TABLE "solution_areas"
            ADD CONSTRAINT "solution_areas_market_id_markets_id_fk"
            FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE SET NULL;
    END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'solution_areas_created_by_users_id_fk'
    ) THEN
        ALTER TABLE "solution_areas"
            ADD CONSTRAINT "solution_areas_created_by_users_id_fk"
            FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");
    END IF;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "solution_areas_tenant_market_slug_idx"
    ON "solution_areas" ("tenant_domain", "market_id", "slug");
--> statement-breakpoint

-- assetType on content + brand assets. Defaulted to 'other' so backfill
-- is a no-op; admins can re-tag from the library UI.
ALTER TABLE "content_assets"
    ADD COLUMN IF NOT EXISTS "asset_type" text NOT NULL DEFAULT 'other';
--> statement-breakpoint

ALTER TABLE "brand_assets"
    ADD COLUMN IF NOT EXISTS "asset_type" text NOT NULL DEFAULT 'other';
--> statement-breakpoint

-- generated_posts.source_asset_id — FK back to the originating content
-- asset so drafts can resolve the asset's lead image at CSV-export and
-- publish time even after manual edits.
ALTER TABLE "generated_posts"
    ADD COLUMN IF NOT EXISTS "source_asset_id" varchar;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'generated_posts_source_asset_id_content_assets_id_fk'
    ) THEN
        ALTER TABLE "generated_posts"
            ADD CONSTRAINT "generated_posts_source_asset_id_content_assets_id_fk"
            FOREIGN KEY ("source_asset_id") REFERENCES "public"."content_assets"("id") ON DELETE SET NULL;
    END IF;
END $$;
--> statement-breakpoint

-- Join tables. Composite primary keys prevent duplicate links and let
-- ON CONFLICT no-op behavior be added later without a schema change.
CREATE TABLE IF NOT EXISTS "content_asset_solution_areas" (
    "asset_id" varchar NOT NULL,
    "solution_area_id" varchar NOT NULL,
    PRIMARY KEY ("asset_id", "solution_area_id")
);
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'content_asset_solution_areas_asset_id_content_assets_id_fk'
    ) THEN
        ALTER TABLE "content_asset_solution_areas"
            ADD CONSTRAINT "content_asset_solution_areas_asset_id_content_assets_id_fk"
            FOREIGN KEY ("asset_id") REFERENCES "public"."content_assets"("id") ON DELETE CASCADE;
    END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'content_asset_solution_areas_solution_area_id_solution_areas_id_fk'
    ) THEN
        ALTER TABLE "content_asset_solution_areas"
            ADD CONSTRAINT "content_asset_solution_areas_solution_area_id_solution_areas_id_fk"
            FOREIGN KEY ("solution_area_id") REFERENCES "public"."solution_areas"("id") ON DELETE CASCADE;
    END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "brand_asset_solution_areas" (
    "asset_id" varchar NOT NULL,
    "solution_area_id" varchar NOT NULL,
    PRIMARY KEY ("asset_id", "solution_area_id")
);
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'brand_asset_solution_areas_asset_id_brand_assets_id_fk'
    ) THEN
        ALTER TABLE "brand_asset_solution_areas"
            ADD CONSTRAINT "brand_asset_solution_areas_asset_id_brand_assets_id_fk"
            FOREIGN KEY ("asset_id") REFERENCES "public"."brand_assets"("id") ON DELETE CASCADE;
    END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'brand_asset_solution_areas_solution_area_id_solution_areas_id_fk'
    ) THEN
        ALTER TABLE "brand_asset_solution_areas"
            ADD CONSTRAINT "brand_asset_solution_areas_solution_area_id_solution_areas_id_fk"
            FOREIGN KEY ("solution_area_id") REFERENCES "public"."solution_areas"("id") ON DELETE CASCADE;
    END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "campaign_solution_areas" (
    "campaign_id" varchar NOT NULL,
    "solution_area_id" varchar NOT NULL,
    PRIMARY KEY ("campaign_id", "solution_area_id")
);
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'campaign_solution_areas_campaign_id_campaigns_id_fk'
    ) THEN
        ALTER TABLE "campaign_solution_areas"
            ADD CONSTRAINT "campaign_solution_areas_campaign_id_campaigns_id_fk"
            FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;
    END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'campaign_solution_areas_solution_area_id_solution_areas_id_fk'
    ) THEN
        ALTER TABLE "campaign_solution_areas"
            ADD CONSTRAINT "campaign_solution_areas_solution_area_id_solution_areas_id_fk"
            FOREIGN KEY ("solution_area_id") REFERENCES "public"."solution_areas"("id") ON DELETE CASCADE;
    END IF;
END $$;
