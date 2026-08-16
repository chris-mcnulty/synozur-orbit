-- Link a generated email to the HubSpot marketing email it was sent as, so
-- campaign history can jump straight to HubSpot's performance report (and a
-- future metrics sync has a stable key).
ALTER TABLE generated_emails ADD COLUMN IF NOT EXISTS hubspot_email_id text;
ALTER TABLE generated_emails ADD COLUMN IF NOT EXISTS hubspot_email_url text;
