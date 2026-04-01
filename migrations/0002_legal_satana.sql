CREATE TABLE "gap_dismissals" (
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
CREATE TABLE "notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"link" text,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"name" text NOT NULL,
	"role" text,
	"industry" text,
	"company_size" text,
	"pain_points" text[],
	"goals" text[],
	"objections" text[],
	"preferred_channels" text[],
	"notes" text,
	"is_icp" boolean DEFAULT false NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis" ADD COLUMN "generated_from_data_as_of" timestamp;--> statement-breakpoint
ALTER TABLE "battlecards" ADD COLUMN "generated_from_data_as_of" timestamp;--> statement-breakpoint
ALTER TABLE "long_form_recommendations" ADD COLUMN "generated_from_data_as_of" timestamp;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "generated_from_data_as_of" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "alerts_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "alert_threshold" text DEFAULT 'high';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "alert_email_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "gap_dismissals" ADD CONSTRAINT "gap_dismissals_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gap_dismissals" ADD CONSTRAINT "gap_dismissals_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;