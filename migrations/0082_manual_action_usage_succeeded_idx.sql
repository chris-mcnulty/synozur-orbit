-- Partial index on manual_action_usage for the succeeded=true filter used by
-- getManualActionUsageSummary. The existing index (tenant_domain, action,
-- occurred_at) cannot satisfy the succeeded predicate without a heap fetch,
-- causing a full table scan on large tenants and making /api/tenant/info
-- take 80+ seconds (production incident Aug 2026).
CREATE INDEX IF NOT EXISTS "manual_action_usage_tenant_succeeded_period_idx"
    ON "manual_action_usage" ("tenant_domain", "action", "occurred_at")
    WHERE succeeded = true;
