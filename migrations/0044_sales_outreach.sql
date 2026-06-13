-- Sales Outreach Campaigns (Phase 0 — schema foundation).
-- Goal-driven 1:1 outbound: prospect -> score -> draft -> sequence -> manage,
-- with a human approving every send in Outlook. See
-- docs/sales-outreach-campaign-plan.md.

CREATE TABLE IF NOT EXISTS "outreach_campaigns" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_domain" text NOT NULL,
  "market_id" varchar REFERENCES "markets"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "goal_type" text NOT NULL DEFAULT 'meeting',
  "sales_goal" text,
  "interview" jsonb,
  "product_id" varchar REFERENCES "products"("id") ON DELETE SET NULL,
  "target_persona_ids" text[],
  "targeting_filter" jsonb,
  "channels" text[],
  "conference_id" varchar REFERENCES "conferences"("id") ON DELETE SET NULL,
  "event_date" timestamp,
  "cadence_template_id" varchar,
  "voice_profile_id" varchar REFERENCES "social_account_voice_profiles"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "created_by" varchar NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_campaigns_tenant_idx" ON "outreach_campaigns" ("tenant_domain");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_campaigns_tenant_status_idx" ON "outreach_campaigns" ("tenant_domain","status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "cadence_templates" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_domain" text NOT NULL,
  "name" text NOT NULL,
  "archetype" text NOT NULL DEFAULT 'meeting_drive',
  "anchor" text NOT NULL DEFAULT 'start_date',
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cadence_templates_tenant_idx" ON "cadence_templates" ("tenant_domain");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "cadence_steps" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template_id" varchar NOT NULL REFERENCES "cadence_templates"("id") ON DELETE cascade,
  "step_number" integer NOT NULL,
  "channel" text NOT NULL DEFAULT 'email',
  "day_offset" integer NOT NULL DEFAULT 0,
  "business_hours_only" boolean NOT NULL DEFAULT true,
  "purpose" text NOT NULL DEFAULT 'intro',
  "template_hint" text,
  "resource_type" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cadence_steps_template_step_idx" ON "cadence_steps" ("template_id","step_number");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "prospects" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" varchar NOT NULL REFERENCES "outreach_campaigns"("id") ON DELETE cascade,
  "tenant_domain" text NOT NULL,
  "market_id" varchar REFERENCES "markets"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "title" text,
  "company_name" text,
  "email" text,
  "linkedin_url" text,
  "hubspot_contact_id" text,
  "hubspot_company_id" text,
  "source" text NOT NULL DEFAULT 'manual',
  "icp_score" integer,
  "score_breakdown" jsonb,
  "disqualified_reason" text,
  "research_dossier" text,
  "signals" jsonb,
  "status" text NOT NULL DEFAULT 'new',
  "owner_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "next_action_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospects_campaign_idx" ON "prospects" ("campaign_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospects_tenant_status_idx" ON "prospects" ("tenant_domain","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospects_next_action_idx" ON "prospects" ("next_action_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "outreach_touches" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "prospect_id" varchar NOT NULL REFERENCES "prospects"("id") ON DELETE cascade,
  "campaign_id" varchar NOT NULL REFERENCES "outreach_campaigns"("id") ON DELETE cascade,
  "tenant_domain" text NOT NULL,
  "channel" text NOT NULL DEFAULT 'email',
  "step_number" integer NOT NULL DEFAULT 1,
  "subject" text,
  "body" text,
  "status" text NOT NULL DEFAULT 'draft_pending_approval',
  "outlook_draft_id" text,
  "linkedin_thread_ref" text,
  "compliance_flags" jsonb,
  "voice_profile_id" varchar REFERENCES "social_account_voice_profiles"("id") ON DELETE SET NULL,
  "generated_at" timestamp NOT NULL DEFAULT now(),
  "approved_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "sent_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_touches_prospect_idx" ON "outreach_touches" ("prospect_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_touches_campaign_status_idx" ON "outreach_touches" ("campaign_id","status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "outreach_campaign_resources" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" varchar NOT NULL REFERENCES "outreach_campaigns"("id") ON DELETE cascade,
  "tenant_domain" text NOT NULL,
  "resource_type" text NOT NULL DEFAULT 'other',
  "label" text,
  "content_asset_id" varchar REFERENCES "content_assets"("id") ON DELETE SET NULL,
  "marketing_link_id" varchar REFERENCES "marketing_links"("id") ON DELETE SET NULL,
  "inject_at_step" integer,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_campaign_resources_campaign_idx" ON "outreach_campaign_resources" ("campaign_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "outreach_settings" (
  "tenant_domain" text PRIMARY KEY NOT NULL,
  "global_pause" boolean NOT NULL DEFAULT false,
  "master_daily_cap" integer NOT NULL DEFAULT 100,
  "email_daily_cap" integer NOT NULL DEFAULT 50,
  "email_weekly_cap" integer NOT NULL DEFAULT 200,
  "linkedin_daily_cap" integer NOT NULL DEFAULT 15,
  "linkedin_weekly_cap" integer NOT NULL DEFAULT 50,
  "weekly_per_domain_cap" integer NOT NULL DEFAULT 3,
  "min_reply_rate_floor" real NOT NULL DEFAULT 0,
  "default_voice_profile_id" varchar REFERENCES "social_account_voice_profiles"("id") ON DELETE SET NULL,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "outreach_send_ledger" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_domain" text NOT NULL,
  "touch_id" varchar REFERENCES "outreach_touches"("id") ON DELETE SET NULL,
  "channel" text NOT NULL,
  "recipient_domain" text,
  "owner_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "occurred_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_send_ledger_tenant_channel_time_idx" ON "outreach_send_ledger" ("tenant_domain","channel","occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_send_ledger_domain_time_idx" ON "outreach_send_ledger" ("tenant_domain","recipient_domain","occurred_at");
