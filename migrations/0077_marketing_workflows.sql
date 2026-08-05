-- Migration: 0077_marketing_workflows
-- Adds the native marketing workflow engine tables:
--   marketing_workflows, marketing_workflow_steps,
--   marketing_workflow_enrollments, marketing_workflow_step_runs

CREATE TABLE IF NOT EXISTS marketing_workflows (
  id           VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_domain TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  trigger_json JSONB NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'draft',
  re_enroll_policy TEXT NOT NULL DEFAULT 'never',
  re_enroll_days   INTEGER,
  created_by   VARCHAR NOT NULL REFERENCES users(id),
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS marketing_workflows_tenant_idx
  ON marketing_workflows (tenant_domain);

CREATE INDEX IF NOT EXISTS marketing_workflows_status_idx
  ON marketing_workflows (tenant_domain, status);

CREATE TABLE IF NOT EXISTS marketing_workflow_steps (
  id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id   VARCHAR NOT NULL REFERENCES marketing_workflows(id) ON DELETE CASCADE,
  step_type     TEXT NOT NULL,
  config_json   JSONB NOT NULL DEFAULT '{}',
  step_order    INTEGER NOT NULL DEFAULT 0,
  next_step_id       VARCHAR,
  branch_no_step_id  VARCHAR,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS marketing_workflow_steps_workflow_order_idx
  ON marketing_workflow_steps (workflow_id, step_order);

CREATE TABLE IF NOT EXISTS marketing_workflow_enrollments (
  id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id     VARCHAR NOT NULL REFERENCES marketing_workflows(id) ON DELETE CASCADE,
  contact_id      VARCHAR NOT NULL REFERENCES marketing_contacts(id) ON DELETE CASCADE,
  tenant_domain   TEXT NOT NULL,
  current_step_id VARCHAR,
  status          TEXT NOT NULL DEFAULT 'active',
  enrolled_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMP,
  exited_at       TIMESTAMP,
  exit_reason     TEXT,
  next_run_at     TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS marketing_workflow_enrollments_workflow_contact_idx
  ON marketing_workflow_enrollments (workflow_id, contact_id);

CREATE INDEX IF NOT EXISTS marketing_workflow_enrollments_tenant_status_idx
  ON marketing_workflow_enrollments (tenant_domain, status);

CREATE INDEX IF NOT EXISTS marketing_workflow_enrollments_next_run_idx
  ON marketing_workflow_enrollments (next_run_at)
  WHERE next_run_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS marketing_workflow_step_runs (
  id             VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id  VARCHAR NOT NULL REFERENCES marketing_workflow_enrollments(id) ON DELETE CASCADE,
  step_id        VARCHAR NOT NULL REFERENCES marketing_workflow_steps(id) ON DELETE CASCADE,
  ran_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  outcome_json   JSONB,
  error          TEXT
);

CREATE INDEX IF NOT EXISTS marketing_workflow_step_runs_enrollment_idx
  ON marketing_workflow_step_runs (enrollment_id);
