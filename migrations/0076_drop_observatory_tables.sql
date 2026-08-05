-- Observatory (application assurance) was split into its own product/repo.
-- Drop all obs_* tables from Orbit. Order: junctions/children first, then parents.
DROP TABLE IF EXISTS "obs_performance_scans" CASCADE;
DROP TABLE IF EXISTS "obs_vpat_entries" CASCADE;
DROP TABLE IF EXISTS "obs_reports" CASCADE;
DROP TABLE IF EXISTS "obs_readiness_scores" CASCADE;
DROP TABLE IF EXISTS "obs_pen_test_findings" CASCADE;
DROP TABLE IF EXISTS "obs_pen_tests" CASCADE;
DROP TABLE IF EXISTS "obs_source_review_meta" CASCADE;
DROP TABLE IF EXISTS "obs_review_item_evidence" CASCADE;
DROP TABLE IF EXISTS "obs_review_item_findings" CASCADE;
DROP TABLE IF EXISTS "obs_review_items" CASCADE;
DROP TABLE IF EXISTS "obs_audit_logs" CASCADE;
DROP TABLE IF EXISTS "obs_finding_controls" CASCADE;
DROP TABLE IF EXISTS "obs_control_evidence" CASCADE;
DROP TABLE IF EXISTS "obs_version_evidence" CASCADE;
DROP TABLE IF EXISTS "obs_assessment_evidence" CASCADE;
DROP TABLE IF EXISTS "obs_finding_evidence" CASCADE;
DROP TABLE IF EXISTS "obs_evidence" CASCADE;
DROP TABLE IF EXISTS "obs_findings" CASCADE;
DROP TABLE IF EXISTS "obs_assessments" CASCADE;
DROP TABLE IF EXISTS "obs_versions" CASCADE;
DROP TABLE IF EXISTS "obs_applications" CASCADE;
DROP TABLE IF EXISTS "obs_controls" CASCADE;
DROP TABLE IF EXISTS "obs_frameworks" CASCADE;
