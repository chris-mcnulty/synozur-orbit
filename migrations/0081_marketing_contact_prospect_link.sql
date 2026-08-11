-- Migration: link marketing_contacts back to the originating sales prospect.
-- Set when a prospect is explicitly promoted into marketing contacts so the
-- two sides share one identity (and one HubSpot contact id).

ALTER TABLE "marketing_contacts"
  ADD COLUMN IF NOT EXISTS "source_prospect_id" varchar;

CREATE INDEX IF NOT EXISTS "marketing_contacts_source_prospect_idx"
  ON "marketing_contacts" ("source_prospect_id");
