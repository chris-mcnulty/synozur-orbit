-- Marketing Segments: rule-based active lists that recompute membership
-- from contact properties and timeline events on a configurable cadence.

CREATE TABLE IF NOT EXISTS "marketing_segments" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_domain" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "rule_json" jsonb NOT NULL DEFAULT '{}',
  "refresh_interval_minutes" integer NOT NULL DEFAULT 60,
  "last_refreshed_at" timestamp,
  "hubspot_list_id" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "marketing_segments_tenant_idx" ON "marketing_segments" ("tenant_domain");
CREATE INDEX IF NOT EXISTS "marketing_segments_active_idx" ON "marketing_segments" ("tenant_domain", "is_active");

-- Materialised membership table — refreshed on cadence or on-demand.
CREATE TABLE IF NOT EXISTS "marketing_segment_members" (
  "segment_id" varchar NOT NULL REFERENCES "marketing_segments"("id") ON DELETE CASCADE,
  "contact_id" varchar NOT NULL REFERENCES "marketing_contacts"("id") ON DELETE CASCADE,
  "tenant_domain" text NOT NULL,
  "added_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("segment_id", "contact_id")
);

CREATE INDEX IF NOT EXISTS "marketing_segment_members_segment_idx" ON "marketing_segment_members" ("segment_id");
CREATE INDEX IF NOT EXISTS "marketing_segment_members_contact_idx" ON "marketing_segment_members" ("contact_id");
CREATE INDEX IF NOT EXISTS "marketing_segment_members_tenant_idx" ON "marketing_segment_members" ("tenant_domain");

-- Add segment_id FK to email_sends so a send can target a segment instead of a static list.
ALTER TABLE "email_sends" ADD COLUMN IF NOT EXISTS "segment_id" varchar REFERENCES "marketing_segments"("id") ON DELETE SET NULL;
