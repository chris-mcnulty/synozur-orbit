-- Shared cross-system contact ID cache.
-- Keyed on (tenant_domain, email) — no list FK so it can be upserted freely
-- from both the sales-outreach and marketing-email paths.
CREATE TABLE IF NOT EXISTS "hubspot_contact_id_cache" (
  "tenant_domain" text NOT NULL,
  "email"         text NOT NULL,
  "hubspot_contact_id" text NOT NULL,
  "updated_at"    timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_domain", "email")
);
