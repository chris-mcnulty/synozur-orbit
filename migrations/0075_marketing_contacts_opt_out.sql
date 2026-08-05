-- Migration: add cross-channel email opt-out fields to marketing_contacts
-- Contacts who unsubscribe via any channel (SendGrid event, HubSpot, webbase
-- form) have emailOptOut=true and are suppressed before every email delivery.

ALTER TABLE "marketing_contacts"
  ADD COLUMN IF NOT EXISTS "email_opt_out" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "email_opt_out_at" timestamp,
  ADD COLUMN IF NOT EXISTS "email_opt_out_source" text;

CREATE INDEX IF NOT EXISTS "marketing_contacts_opt_out_idx"
  ON "marketing_contacts" ("tenant_domain", "email_opt_out")
  WHERE "email_opt_out" = true;
