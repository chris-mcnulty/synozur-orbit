-- Add naturalistic posting delay (jitter) support
-- tenants: global on/off toggle (default on)
-- generated_posts: per-post exact-schedule override + publish-not-before gate

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS social_posting_jitter_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE generated_posts
  ADD COLUMN IF NOT EXISTS exact_schedule boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS publish_not_before timestamp;
