-- Event Promotion hero composite extensions.
-- Adds conference_backgrounds table, background_id FK on conference_images,
-- event logo columns on conferences, logo_variant on brand_assets, and
-- accent_color / neutral_color on tenants.

CREATE TABLE IF NOT EXISTS "conference_backgrounds" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "conference_id" varchar NOT NULL,
        "tenant_domain" text NOT NULL,
        "name" text,
        "file_url" text NOT NULL,
        "file_type" text,
        "file_size" integer,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conference_backgrounds" ADD CONSTRAINT "conference_backgrounds_conference_id_conferences_id_fk" FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conference_images" ADD COLUMN IF NOT EXISTS "background_id" varchar;
--> statement-breakpoint
ALTER TABLE "conference_images" ADD CONSTRAINT "conference_images_background_id_conference_backgrounds_id_fk" FOREIGN KEY ("background_id") REFERENCES "public"."conference_backgrounds"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conferences" ADD COLUMN IF NOT EXISTS "event_logo_file_url" text;
--> statement-breakpoint
ALTER TABLE "conferences" ADD COLUMN IF NOT EXISTS "event_logo_file_type" text;
--> statement-breakpoint
ALTER TABLE "brand_assets" ADD COLUMN IF NOT EXISTS "logo_variant" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "accent_color" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "neutral_color" text;
