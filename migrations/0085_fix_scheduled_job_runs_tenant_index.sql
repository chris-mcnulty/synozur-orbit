-- Follow-up to 0084: EXPLAIN (ANALYZE, BUFFERS) verification on a prod-scale
-- snapshot (184k rows, ~48% tenant_domain IS NULL) showed the planner ignores
-- scheduled_job_runs_tenant_type_created_idx for both hot storage.ts queries:
--
--   getScheduledJobRunsByTenant: WHERE tenant_domain = ? ORDER BY created_at DESC LIMIT 50
--     -> job_type in the middle of the index blocks the ordered scan; planner
--        fell back to a 22ms parallel seq scan (2,750 buffers).
--   getScheduledJobRunsByType:   WHERE job_type = ? ORDER BY created_at DESC LIMIT 50
--     -> tenant_domain-leading index cannot serve a job_type-only filter.
--
-- Replacements (both verified to produce 0.1ms index scans on the same data):
--   * (tenant_domain, created_at DESC) PARTIAL WHERE tenant_domain IS NOT NULL —
--     system-wide job rows (NULL tenant) are never queried by tenant, so the
--     partial index is half the size.
--   * (job_type, created_at DESC) for the by-type log view.
--
-- All other 0084 indexes were confirmed chosen by the planner (generated_posts,
-- content_briefs, ai_usage, recommendations) or correctly skipped only because
-- the tables are currently too small for an index to beat a seq scan
-- (products, content_assets, campaigns, assessments — planner will switch to
-- the indexes as those tables grow; no column-order changes needed).

DROP INDEX IF EXISTS "scheduled_job_runs_tenant_type_created_idx";

CREATE INDEX IF NOT EXISTS "scheduled_job_runs_tenant_created_idx"
    ON "scheduled_job_runs" ("tenant_domain", "created_at" DESC)
    WHERE "tenant_domain" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "scheduled_job_runs_type_created_idx"
    ON "scheduled_job_runs" ("job_type", "created_at" DESC);
