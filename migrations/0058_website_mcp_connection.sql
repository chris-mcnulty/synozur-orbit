CREATE TABLE IF NOT EXISTS "website_connections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"endpoint" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"default_author_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"last_error" text,
	CONSTRAINT "website_connections_tenant_domain_unique" UNIQUE("tenant_domain")
);
--> statement-breakpoint
ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS website_post_id text;--> statement-breakpoint
ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS website_post_slug text;
