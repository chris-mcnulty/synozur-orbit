-- Migration 0056: Prospect-aware marketing suppression
-- Adds the tenant-level default setting for prospect suppression on hubspot_connections,
-- a suppression_reason column on email_send_recipients, and a flag on email_sends
-- so queued sends preserve the exclusion choice made at schedule time.

ALTER TABLE hubspot_connections
  ADD COLUMN IF NOT EXISTS active_prospect_suppression_default text NOT NULL DEFAULT 'warn';

ALTER TABLE email_send_recipients
  ADD COLUMN IF NOT EXISTS suppression_reason text;

ALTER TABLE email_sends
  ADD COLUMN IF NOT EXISTS exclude_active_prospects boolean NOT NULL DEFAULT false;
