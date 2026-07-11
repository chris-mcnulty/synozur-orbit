---
name: Drizzle correlated subquery counts return 0
description: sql`` correlated subqueries referencing the outer table's column silently return 0; use leftJoin+groupBy counts instead.
---

# Drizzle correlated subquery counts return 0

A select field like
`sql<number>\`(select count(*)::int from child c where c.parent_id = ${parentTable.id})\``
silently returned 0 for every row even though child rows existed.

**Why:** interpolating the outer table's column inside a raw `sql` subquery does
not correlate reliably in this codebase's Drizzle version — no error is thrown,
the count is just wrong.

**How to apply:** for per-row child counts, use
`.leftJoin(child, eq(child.parentId, parent.id)).groupBy(parent.id)` with
`count(child.id)::int`. Verify counts against a direct SQL query when adding
aggregate fields — a 0 that should be nonzero is the tell.
