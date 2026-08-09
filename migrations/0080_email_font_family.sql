-- Add per-email font selection to generated_emails.
-- fontFamily stores the curated font value key (e.g. "MetroNova", "AvenirNextLTPro", "Arial").
-- NULL means "use the default Arial stack" — existing rows are unaffected.
ALTER TABLE generated_emails ADD COLUMN IF NOT EXISTS font_family text;
