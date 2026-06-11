-- Speed up idempotent Push-to-Planner checks and the "already in Planner"
-- lookup, both of which filter marketing_tasks by (plan_id, source_brief_id).

CREATE INDEX IF NOT EXISTS "marketing_tasks_plan_source_brief_idx" ON "marketing_tasks" ("plan_id", "source_brief_id");
