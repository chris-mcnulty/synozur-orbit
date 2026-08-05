-- A/B test config columns on generated_emails
ALTER TABLE generated_emails
  ADD COLUMN IF NOT EXISTS ab_test_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ab_test_split integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS ab_winner_metric text,
  ADD COLUMN IF NOT EXISTS ab_evaluation_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS ab_winner_variant_label text,
  ADD COLUMN IF NOT EXISTS ab_winner_declared_at timestamp;

-- B variant storage (A is the original email row)
CREATE TABLE IF NOT EXISTS email_campaign_variants (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_email_id varchar NOT NULL REFERENCES generated_emails(id) ON DELETE CASCADE,
  tenant_domain text NOT NULL,
  variant_label text NOT NULL,
  subject text NOT NULL,
  html_body text NOT NULL DEFAULT '',
  text_body text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ecv_email_idx ON email_campaign_variants(generated_email_id);
CREATE UNIQUE INDEX IF NOT EXISTS ecv_email_variant_uniq ON email_campaign_variants(generated_email_id, variant_label);

-- Per-variant label on email_sends for per-variant analytics
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS ab_variant_label text;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS is_ab_holdback boolean NOT NULL DEFAULT false;
