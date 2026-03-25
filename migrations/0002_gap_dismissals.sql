CREATE TABLE IF NOT EXISTS "gap_dismissals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gap_identifier" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'dismissed' NOT NULL,
	"reason" text,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"dismissed_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gap_dismissals" ADD CONSTRAINT "gap_dismissals_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "gap_dismissals" ADD CONSTRAINT "gap_dismissals_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
