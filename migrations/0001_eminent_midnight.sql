CREATE TABLE "briefing_subscriptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"user_id" varchar NOT NULL,
	"market_id" varchar,
	"enabled" boolean DEFAULT true NOT NULL,
	"frequency" text DEFAULT 'weekly' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_briefing_configs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"enabled" boolean DEFAULT false NOT NULL,
	"frequency" text DEFAULT 'weekly' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intelligence_briefings" ADD COLUMN "podcast_audio_url" text;--> statement-breakpoint
ALTER TABLE "intelligence_briefings" ADD COLUMN "podcast_status" text DEFAULT 'none';--> statement-breakpoint
ALTER TABLE "briefing_subscriptions" ADD CONSTRAINT "briefing_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefing_subscriptions" ADD CONSTRAINT "briefing_subscriptions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_briefing_configs" ADD CONSTRAINT "scheduled_briefing_configs_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;