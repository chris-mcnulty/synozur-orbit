-- backfill:always-apply
-- Explicit provenance for externally-sent newsletters (marked sent via
-- HubSpot etc.). status='sent' alone is ambiguous — SendGrid delivery and
-- calendar handoff also set it — so the Sends history page needs a flag
-- stamped only by the mark-sent-externally endpoint.
ALTER TABLE generated_emails ADD COLUMN IF NOT EXISTS sent_externally boolean NOT NULL DEFAULT false;

-- Backfill: emails carrying a HubSpot marketing-email link were necessarily
-- marked sent externally (only that endpoint writes these columns).
UPDATE generated_emails
SET sent_externally = true
WHERE sent_externally = false
  AND (hubspot_email_id IS NOT NULL OR hubspot_email_url IS NOT NULL);
