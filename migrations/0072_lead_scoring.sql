-- Migration: lead scoring rules, lifecycle thresholds, and score column
-- Adds the marketing_scoring_rules and marketing_lifecycle_thresholds tables,
-- plus a score column on marketing_contacts.

-- 1. Add score column to marketing_contacts
ALTER TABLE "marketing_contacts" ADD COLUMN IF NOT EXISTS "score" integer NOT NULL DEFAULT 0;

-- 2. Scoring rules table
CREATE TABLE IF NOT EXISTS "marketing_scoring_rules" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_domain" text NOT NULL,
  "name" text NOT NULL,
  "rule_type" text NOT NULL, -- 'property' | 'event'
  -- property rule: { field, operator, value }
  -- event rule:    { eventType, minCount }
  "condition_json" jsonb NOT NULL DEFAULT '{}',
  "points" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "marketing_scoring_rules_tenant_idx"
  ON "marketing_scoring_rules" ("tenant_domain");

-- 3. Lifecycle threshold table — per-tenant configurable score thresholds
--    that drive automatic stage transitions (lead/mql/sql/opportunity/customer).
CREATE TABLE IF NOT EXISTS "marketing_lifecycle_thresholds" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_domain" text NOT NULL,
  "stage" text NOT NULL,   -- 'lead' | 'mql' | 'sql' | 'opportunity' | 'customer'
  "min_score" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "marketing_lifecycle_thresholds_tenant_stage_uniq"
  ON "marketing_lifecycle_thresholds" ("tenant_domain", "stage");
