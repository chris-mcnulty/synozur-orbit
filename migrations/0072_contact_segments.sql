-- Migration: marketing_contact_segments
-- Adds named, saved segment definitions (filter rules as JSON) that resolve
-- to a dynamic list of marketing_contacts rows at evaluation time.

CREATE TABLE IF NOT EXISTS "marketing_contact_segments" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_domain" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "rules" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "preview_count" integer,
  "previewed_at" timestamp,
  "created_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "marketing_contact_segments_tenant_idx"
  ON "marketing_contact_segments" ("tenant_domain");
