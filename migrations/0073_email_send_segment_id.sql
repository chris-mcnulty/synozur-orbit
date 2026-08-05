-- Migration: add segment_id to email_sends
-- Allows queued sends to target a saved contact segment instead of a static recipient list.

ALTER TABLE "email_sends"
  ADD COLUMN IF NOT EXISTS "segment_id" varchar
    REFERENCES "marketing_contact_segments"("id") ON DELETE SET NULL;
