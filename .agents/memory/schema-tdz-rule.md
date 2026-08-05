---
name: Schema table-before-relations TDZ rule
description: Every pgTable declaration must appear BEFORE the relations() call that references it in shared/schema.ts, or tests crash with "Cannot access X before initialization".
---

# Schema table-before-relations TDZ rule

## The rule
In `shared/schema.ts`, every `pgTable(...)` declaration **must appear before** any `relations(...)` call that references it. Violating this causes a JavaScript temporal dead zone (TDZ) crash at test import time: `ReferenceError: Cannot access 'tableName' before initialization`.

**Why:** Drizzle `relations()` calls execute at module load time and dereference the table variable. If the table is declared later in the file with `const`, the JS engine hasn't initialized it yet — TDZ crash.

**How to apply:** After any rebase or merge that touches `shared/schema.ts`, grep for the pattern and verify order:
```bash
grep -n "export const marketingSegment" shared/schema.ts
# marketingSegments table must appear before marketingSegmentsRelations
# marketingSegmentMembers table must appear before marketingSegmentMembersRelations
```

## Known recurring offender
`marketingSegmentMembers` (from the segmentation engine) kept getting re-broken by rebase commits that placed `marketingSegmentMembersRelations` before the `marketingSegmentMembers` pgTable declaration. Fix every time: move the `pgTable(...)` block above the `relations(...)` block.

The correct order in `shared/schema.ts`:
1. `marketingSegments` pgTable
2. `marketingContactSegments` pgTable  
3. `marketingSegmentMembers` pgTable  ← must be HERE
4. Type exports (`MarketingSegmentMember`, `InsertMarketingSegment`, etc.)
5. `insertMarketingSegmentSchema`
6. `marketingSegmentsRelations`        ← relations AFTER table
7. `marketingSegmentMembersRelations`  ← relations AFTER table
