CREATE TABLE "content_optimizations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"content_asset_id" varchar,
	"source_title" text NOT NULL,
	"seo_title" text,
	"meta_description" text,
	"slug" text,
	"target_keyword" text,
	"keywords" text[],
	"answer_blocks" jsonb,
	"faq" jsonb,
	"internal_links" jsonb,
	"content_gaps" jsonb,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_optimizations" ADD CONSTRAINT "content_optimizations_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_optimizations" ADD CONSTRAINT "content_optimizations_content_asset_id_content_assets_id_fk" FOREIGN KEY ("content_asset_id") REFERENCES "public"."content_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_optimizations" ADD CONSTRAINT "content_optimizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;