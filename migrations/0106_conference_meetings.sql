ALTER TABLE conferences ADD COLUMN IF NOT EXISTS presence jsonb;
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS meeting_brief jsonb;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS meeting jsonb;
ALTER TABLE outreach_touches ADD COLUMN IF NOT EXISTS meeting_context jsonb;
