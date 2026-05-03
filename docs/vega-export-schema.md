# Vega Launchpad Export Schema

**Schema version:** `vega-export/2.0`

The Vega Launchpad export is produced by
`GET /api/marketing-plans/:id/vega-export?format=<zip|json>`. It is built
around a **Big Rocks + OKRs** model so the Launchpad can render an
executable strategic plan, not just a flat task list.

## Formats

| `format` query | Response                                                      |
| -------------- | ------------------------------------------------------------- |
| `json` (default for programmatic use) | Single `plan.json` file (`Content-Type: application/json`). |
| `zip` (default) | Zip archive containing `plan.json` and a human-readable `plan.md` runbook (`Content-Type: application/zip`). |

## `plan.json` shape

```json
{
  "schemaVersion": "vega-export/2.0",
  "exportedAt": "2026-05-03T18:30:00.000Z",
  "tenantDomain": "example.com",
  "marketId": "uuid-or-null",
  "plan": {
    "id": "uuid",
    "name": "FY26 Marketing Plan",
    "fiscalYear": "2026",
    "description": "string|null",
    "status": "draft|active|archived",
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601"
  },
  "context": {
    "company": {
      "name": "Acme Inc",
      "website": "https://acme.com",
      "industry": "string|null",
      "description": "string|null"
    },
    "gtmPlan": {
      "lastGeneratedAt": "ISO-8601|null",
      "summary": "First ~280 chars of the GTM plan markdown."
    },
    "messagingFramework": {
      "lastGeneratedAt": "ISO-8601|null",
      "summary": "First ~280 chars of the messaging framework markdown."
    },
    "configMatrix": { "...": "verbatim plan configMatrix" }
  },
  "objectives": [
    {
      "id": "<planId>:Q1",
      "quarter": "Q1",
      "statement": "Q1 — advance Digital, Events for FY2026",
      "keyResults": [
        {
          "id": "<taskId>",
          "statement": "Launch Q1 partner webinar series",
          "status": "in_progress",
          "sourceTaskId": "<taskId>",
          "plannerTaskId": "string|null"
        }
      ]
    }
  ],
  "bigRocks": [
    {
      "id": "<taskId>",
      "title": "Launch Q1 partner webinar series",
      "description": "string|null",
      "theme": "Digital",
      "quarter": "Q1",
      "priority": "High",
      "status": "in_progress",
      "ownerUserId": "uuid|null",
      "dueDate": "ISO-8601|null",
      "sourceTaskId": "<taskId>",
      "plannerTaskId": "string|null",
      "plannerDeepLink": "https://tasks.office.com/.../Task/<id>?planId=<planId>"
    }
  ],
  "planner": {
    "groupId": "string|null",
    "groupName": "string|null",
    "planId": "string|null",
    "planName": "string|null",
    "defaultBucketId": "string|null",
    "defaultBucketName": "string|null",
    "deepLinkBase": "https://tasks.office.com/.../plantaskboard?planId=<planId>",
    "categoryBucketMappings": [
      { "activityCategory": "events", "bucketId": "...", "bucketName": "Events" }
    ]
  }
}
```

## Field semantics

### `objectives`

Quarterly OKR statements derived from the plan:

- One objective per quarter that has at least one Big-Rock-priority task
  (`priority === "High"`) — or, if no quarter has any Big Rocks, the top
  task in that quarter is used so no quarter is empty.
- The `statement` is templated from the quarter's themes (activity groups)
  and the plan's fiscal year.
- `keyResults` are the High-priority task titles for that quarter, capped
  at 5. Each key result keeps a back-pointer to its source Orbit task
  (`sourceTaskId`) and Planner task (`plannerTaskId`) so the Launchpad
  can render two-way deep links.

### `bigRocks`

Strategic anchor tasks — **one Big Rock per (quarter × activity-category)
cluster**:

- For every distinct combination of quarter (`timeframe`) and
  `activityGroup` represented in the plan, exactly one Big Rock is
  emitted. Within each cluster the highest-priority task is selected
  (High → Medium → Low → first task).
- This guarantees the Launchpad sees a representative anchor per theme
  per quarter without flooding it with low-signal tasks.
- `plannerDeepLink` opens the task directly in Microsoft Planner when
  the plan is connected (`https://tasks.office.com/<tenant>/Home/Task/<id>?planId=<planId>`);
  otherwise `null`.

### `context.gtmPlan` / `context.messagingFramework`

Summarized excerpts (first ~320 chars, headings stripped) of the most
recent `long_form_recommendations` of type `gtm_plan` and
`messaging_framework` for the company profile in scope. The full markdown
is intentionally not embedded — the Launchpad should fetch the canonical
copy from Orbit when needed.

### `planner`

Always present when the plan is connected to Microsoft Planner. The
`categoryBucketMappings` array reflects the per-category bucket routing
from `marketing_plan_bucket_mappings` so the Launchpad can mirror the
Orbit categorisation when rendering Big Rocks.

## Backwards compatibility

`schemaVersion` is bumped any time the shape changes in a non-additive
way. Consumers must check the version before parsing — a `vega-export/1.0`
bundle is a flat task dump and is not interchangeable with `2.0`.
