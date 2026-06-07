CREATE TABLE "tenant_fonts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"name" text NOT NULL,
	"font_family" text,
	"font_weight" text,
	"font_style" text,
	"font_usage" text NOT NULL,
	"file_url" text NOT NULL,
	"file_type" text,
	"file_size" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_assets" ADD COLUMN "font_family" text;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD COLUMN "font_weight" text;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD COLUMN "font_style" text;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD COLUMN "font_usage" text;--> statement-breakpoint
ALTER TABLE "tenant_fonts" ADD CONSTRAINT "tenant_fonts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;