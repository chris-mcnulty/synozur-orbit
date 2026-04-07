CREATE TABLE "competitor_positions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"competitor_id" varchar,
	"company_profile_id" varchar,
	"label" text NOT NULL,
	"x_axis" text DEFAULT 'Market Presence' NOT NULL,
	"y_axis" text DEFAULT 'Innovation' NOT NULL,
	"x_value" integer DEFAULT 50 NOT NULL,
	"y_value" integer DEFAULT 50 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suggested_content_assets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"company_profile_id" varchar NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"page_type" text,
	"reason" text,
	"suggested_category" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis" ADD COLUMN "previous_content" jsonb;--> statement-breakpoint
ALTER TABLE "battlecards" ADD COLUMN "previous_content" jsonb;--> statement-breakpoint
ALTER TABLE "company_profiles" ADD COLUMN "facebook_url" text;--> statement-breakpoint
ALTER TABLE "company_profiles" ADD COLUMN "facebook_content" text;--> statement-breakpoint
ALTER TABLE "company_profiles" ADD COLUMN "facebook_engagement" jsonb;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "facebook_url" text;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "facebook_content" text;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "facebook_engagement" jsonb;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "business_type" text DEFAULT 'b2b' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "facebook_url" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "facebook_content" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "facebook_engagement" jsonb;--> statement-breakpoint
ALTER TABLE "competitor_positions" ADD CONSTRAINT "competitor_positions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_positions" ADD CONSTRAINT "competitor_positions_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_positions" ADD CONSTRAINT "competitor_positions_company_profile_id_company_profiles_id_fk" FOREIGN KEY ("company_profile_id") REFERENCES "public"."company_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggested_content_assets" ADD CONSTRAINT "suggested_content_assets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggested_content_assets" ADD CONSTRAINT "suggested_content_assets_company_profile_id_company_profiles_id_fk" FOREIGN KEY ("company_profile_id") REFERENCES "public"."company_profiles"("id") ON DELETE cascade ON UPDATE no action;