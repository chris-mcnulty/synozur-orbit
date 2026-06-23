-- HubSpot marketing-email sync — Phase 1 (contact resolution + consent pull).
-- Additive, nullable columns only; safe to apply online. No data backfill.

-- Auto-create missing HubSpot contacts on send (default on; admin opt-out).
ALTER TABLE "hubspot_connections"
  ADD COLUMN IF NOT EXISTS "auto_create_hubspot_contacts" boolean NOT NULL DEFAULT true;
--> statement-breakpoint

-- Per-send recipient → HubSpot contact link + sync state.
ALTER TABLE "email_send_recipients"
  ADD COLUMN IF NOT EXISTS "hubspot_contact_id" text;
--> statement-breakpoint
ALTER TABLE "email_send_recipients"
  ADD COLUMN IF NOT EXISTS "hs_sync_status" text;
--> statement-breakpoint
ALTER TABLE "email_send_recipients"
  ADD COLUMN IF NOT EXISTS "hs_last_event_synced_at" timestamp;
--> statement-breakpoint
ALTER TABLE "email_send_recipients"
  ADD COLUMN IF NOT EXISTS "hs_sync_error" text;
--> statement-breakpoint

-- Durable list-level contact cache so we don't re-search HubSpot every send.
ALTER TABLE "email_recipients"
  ADD COLUMN IF NOT EXISTS "hubspot_contact_id" text;
--> statement-breakpoint
ALTER TABLE "email_recipients"
  ADD COLUMN IF NOT EXISTS "hs_sync_status" text;
--> statement-breakpoint
ALTER TABLE "email_recipients"
  ADD COLUMN IF NOT EXISTS "hs_last_synced_at" timestamp;
