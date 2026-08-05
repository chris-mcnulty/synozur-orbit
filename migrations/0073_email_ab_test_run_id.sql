-- Migration: add ab_test_run_id to email_sends so each dispatch is a distinct
-- test run, keeping winner evaluation, holdback release, and results scoped to
-- the run that created the A/B send rows.
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS ab_test_run_id text;
