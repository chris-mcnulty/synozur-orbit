---
name: Push-to-Planner idempotency & tenant scoping
description: How Content Calendar → Marketing Planner push avoids duplicates and stays tenant-safe
---

The Content Calendar (formerly "Master Calendar") pushes briefs into a Marketing
Planner one-way and **idempotently**. The link is `marketing_tasks.source_brief_id`
(FK → content_briefs, ON DELETE SET NULL).

**Rule:** any read of `marketing_tasks` keyed by a brief id (the "already in
Planner" marker in editorial-calendar.ts) MUST join `marketing_plans` and filter
`marketing_plans.tenant_domain = ctx.tenantDomain`. Filtering by `source_brief_id`
alone leaks across tenants in principle (global UUIDs), even though briefs are
tenant-scoped.
**Why:** architect flagged the unscoped lookup as a data-boundary violation; the
codebase requires *explicit* tenant scoping, not implicit trust.
**How to apply:** the push commit route (distribution-planner.ts) is already safe
because it validates the plan via tenant-scoped getMarketingPlan before querying
tasks by (planId, sourceBriefId). The enrichment read in editorial-calendar.ts is
the one that needs the explicit join.

Index `marketing_tasks_plan_source_brief_idx` on (plan_id, source_brief_id) backs
both the idempotency check and the marker lookup (migration 0038).
