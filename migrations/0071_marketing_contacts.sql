-- Migration: marketing_contacts + marketing_contact_events
-- Creates the foundational contact spine and activity timeline tables.

CREATE TABLE IF NOT EXISTS "marketing_contacts" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_domain" text NOT NULL,
  "email" text NOT NULL,
  "first_name" text,
  "last_name" text,
  "company" text,
  "job_title" text,
  "lifecycle_stage" text NOT NULL DEFAULT 'subscriber',
  "hubspot_contact_id" text,
  "source" text NOT NULL DEFAULT 'manual',
  "metadata" jsonb,
  "last_event_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "marketing_contacts_tenant_email_uniq"
  ON "marketing_contacts" ("tenant_domain", "email");

CREATE INDEX IF NOT EXISTS "marketing_contacts_tenant_domain_idx"
  ON "marketing_contacts" ("tenant_domain");

CREATE INDEX IF NOT EXISTS "marketing_contacts_lifecycle_idx"
  ON "marketing_contacts" ("tenant_domain", "lifecycle_stage");

CREATE TABLE IF NOT EXISTS "marketing_contact_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "contact_id" varchar NOT NULL REFERENCES "marketing_contacts"("id") ON DELETE CASCADE,
  "tenant_domain" text NOT NULL,
  "event_type" text NOT NULL,
  "source" text,
  "occurred_at" timestamp NOT NULL DEFAULT now(),
  "metadata" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "marketing_contact_events_contact_idx"
  ON "marketing_contact_events" ("contact_id");

CREATE INDEX IF NOT EXISTS "marketing_contact_events_tenant_occurred_idx"
  ON "marketing_contact_events" ("tenant_domain", "occurred_at");

CREATE INDEX IF NOT EXISTS "marketing_contact_events_type_idx"
  ON "marketing_contact_events" ("tenant_domain", "event_type");
