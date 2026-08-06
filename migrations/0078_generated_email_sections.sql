-- Structured email sections (case study / upcoming events / recent updates)
ALTER TABLE generated_emails ADD COLUMN IF NOT EXISTS sections jsonb;
ALTER TABLE generated_emails ADD COLUMN IF NOT EXISTS sections_html text;
