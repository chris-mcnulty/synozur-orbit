-- Indexes to fix 10+ second home page load times for the synozur.com tenant.
--
-- Root causes (per production logs):
--   /api/markets (10 s)   → markets.tenant_id and company_profiles.tenant_domain
--                           had no indexes; full table scans on every page load.
--   /api/competitors (6 s) → competitors queried by (tenant_domain, market_id,
--                           project_id) with ORDER BY created_at DESC; no composite
--                           index; four sequential full scans per request.
--   /api/activity (4 s)   → activity queried by (tenant_domain, market_id) ORDER BY
--                           created_at DESC; no index; full table scan each time.

-- 1. markets: getMarketsByTenant → WHERE tenant_id = ?
CREATE INDEX IF NOT EXISTS "markets_tenant_id_idx"
    ON "markets" ("tenant_id");

-- 2. company_profiles: getCompanyProfilesByTenantDomain → WHERE tenant_domain = ?
CREATE INDEX IF NOT EXISTS "company_profiles_tenant_domain_idx"
    ON "company_profiles" ("tenant_domain");

-- 3. competitors: primary getCompetitorsByContext query
--    WHERE tenant_domain = ? AND market_id = ? AND project_id IS NULL
--    ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS "competitors_tenant_market_project_created_idx"
    ON "competitors" ("tenant_domain", "market_id", "project_id", "created_at" DESC);

-- 4. competitors: legacy NULL-tenantDomain query
--    WHERE tenant_domain IS NULL AND market_id = ? AND project_id IS NULL
--    ORDER BY created_at DESC
--    Also covers the NULL-marketId + NULL-tenantDomain legacy path via market_id prefix.
CREATE INDEX IF NOT EXISTS "competitors_market_project_created_idx"
    ON "competitors" ("market_id", "project_id", "created_at" DESC);

-- 5. activity: getActivityByContext
--    WHERE tenant_domain = ? AND (market_id = ? OR market_id IS NULL)
--    ORDER BY created_at DESC
--    The OR is handled via BitmapOr on this index (one probe for exact market_id,
--    one for IS NULL); including created_at DESC avoids a sort on the merged bitmap.
CREATE INDEX IF NOT EXISTS "activity_tenant_market_created_idx"
    ON "activity" ("tenant_domain", "market_id", "created_at" DESC);
