CREATE TABLE "content_briefs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"title" text NOT NULL,
	"format" text DEFAULT 'blog_post' NOT NULL,
	"target_keyword" text,
	"demand_signal" text,
	"funnel_stage" text DEFAULT 'awareness' NOT NULL,
	"differentiation_angle" text,
	"target_reader" text,
	"target_persona_id" varchar,
	"cta" text,
	"channels" text[],
	"estimated_hours" real,
	"status" text DEFAULT 'suggested' NOT NULL,
	"ai_generated" boolean DEFAULT true NOT NULL,
	"content_asset_id" varchar,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_calendars" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"period_start" timestamp,
	"period_end" timestamp,
	"funnel_targets" jsonb,
	"focus" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_calendar_id_editorial_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."editorial_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_target_persona_id_personas_id_fk" FOREIGN KEY ("target_persona_id") REFERENCES "public"."personas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_content_asset_id_content_assets_id_fk" FOREIGN KEY ("content_asset_id") REFERENCES "public"."content_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_calendars" ADD CONSTRAINT "editorial_calendars_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_calendars" ADD CONSTRAINT "editorial_calendars_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;