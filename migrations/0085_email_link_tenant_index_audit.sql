-- Tenant-scope index sweep, round 2: email-send + marketing-link tables and
-- everything added after the 0083 audit. Hand-written SQL because db:generate
-- is broken (snapshot collision); IF NOT EXISTS so re-running is safe.
--
-- Audit results for the tables named in the task — already covered, no new
-- index needed:
--   email_sends              → email_sends_tenant_email_status_created_idx (0084)
--   email_send_recipients    → email_send_recipients_tenant_send_status_idx (0084)
--   email_campaign_variants  → email_campaign_variants_tenant_email_idx (0084)
--   email_suppressions       → email_suppressions_tenant_email_uniq (pre-existing)
--   marketing_links          → marketing_links_tenant_campaign_status_idx (0084)
--   marketing_link_clicks    → marketing_link_clicks_tenant_link_clicked_idx (0084)
--   hubspot_contact_id_cache → PRIMARY KEY (tenant_domain, email)
--   hubspot_connections      → UNIQUE (tenant_domain) (0014)
--   website_connections      → UNIQUE (tenant_domain) (0058)
--   outreach_settings        → tenant_domain PRIMARY KEY (0044)
--   rate_limit_buckets       → PRIMARY KEY (tenant_domain, scope, key)
--
-- The sweep DID surface three tenant-scoped indexes that exist in
-- shared/schema.ts but were never written into a migration file, so they are
-- missing from every database provisioned via the migration runner:

-- billing_events: webhook/event lookups by tenant + time
CREATE INDEX IF NOT EXISTS "billing_events_tenant_id_idx"
    ON "billing_events" ("tenant_id", "processed_at");
--> statement-breakpoint

-- consultant_access: access list by tenant + status
CREATE INDEX IF NOT EXISTS "consultant_access_tenant_status_idx"
    ON "consultant_access" ("tenant_id", "status");
--> statement-breakpoint

-- support_tickets: ticket list by tenant + status + recency.
-- NOTE: some environments carry a drifted support_tickets table (tenant_id
-- column instead of tenant_domain — created outside the migration runner), so
-- guard on whichever tenant column actually exists.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'support_tickets' AND column_name = 'tenant_domain'
    ) THEN
        CREATE INDEX IF NOT EXISTS "support_tickets_tenant_status_created_idx"
            ON "support_tickets" ("tenant_domain", "status", "created_at");
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'support_tickets' AND column_name = 'tenant_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS "support_tickets_tenant_status_created_idx"
            ON "support_tickets" ("tenant_id", "status", "created_at");
    END IF;
END $$;
