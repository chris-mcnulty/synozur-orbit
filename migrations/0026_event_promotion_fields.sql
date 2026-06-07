-- Event Promotion extensions.
-- The "Conference Social Promotion" subsystem is now presented as "Event
-- Promotion" in the UI (used for conferences, webinars, receptions, etc.).
-- Data tables/columns keep their original names; this migration only adds new
-- optional fields:
--   conferences.discount_statement     — optional registration offer woven into copy
--   conference_sessions.speakers       — structured multi-speaker list (jsonb)
--   conference_sessions.session_type   — optional BREAKOUT | WORKSHOP | KEYNOTE | MEETUP
-- All nullable/defaulted so the backfill is a no-op for existing rows.

ALTER TABLE "conferences" ADD COLUMN IF NOT EXISTS "discount_statement" text;
--> statement-breakpoint
ALTER TABLE "conference_sessions" ADD COLUMN IF NOT EXISTS "speakers" jsonb DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "conference_sessions" ADD COLUMN IF NOT EXISTS "session_type" text;
