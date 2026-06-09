---
name: Editorial brief → draft flow
description: Where campaign/theme/category assignment lives across brief vs draft in the editorial calendar.
---

# Brief → draft assignment surfaces

In the editorial calendar, a content brief and its generated draft (a content
asset) hold assignments in different places:

- **Campaign** and **Theme** (solution area) live on the **brief**
  (`contentBriefs.campaignId`, `contentBriefs.solutionAreaId`) — assignable any time.
- **Category** lives on the **draft / content asset** (`contentAssets.categoryId`),
  so it can only be assigned **after** a draft exists. The category select is
  disabled until `brief.contentAssetId` is set.

**Why:** No DB column for category on briefs; reusing the existing content-asset
category keeps a single source of truth and avoids a migration.

**How to apply:** The GET `/api/editorial-calendars/:id` enriches each brief with
`draftTitle` + `draftCategoryId` by joining `contentAssets` on `contentAssetId`
(tenant+market scoped). Category changes PATCH `/api/content-assets/:id`; campaign/
theme changes PATCH `/api/content-briefs/:id`. The `/api/campaigns` endpoint returns
a raw array only when called without pagination params.
