---
name: Repurpose campaign/theme inheritance
description: Why repurposed posts must inherit campaign/theme from the content_brief, not the content_asset
---

When repurposing a content asset into posts/carousels, campaign and theme
(solutionArea) must be inherited from the linked **content_briefs** row, not the
content_assets row.

**Why:** content_assets has NO campaignId/themeId columns — campaign/theme live
on the content_brief (FK content_briefs.contentAssetId → content_assets.id).
Repurposed generated_posts that defaulted campaignId=null were orphaned: the
campaign filter on the Social Posts page and Master Calendar found nothing, and
they only showed up in the undated backlog with no campaign tag.

**How to apply:** In the repurpose-batch handler, select the most-recent
content_brief by contentAssetId + tenantDomain and copy campaignId +
solutionAreaId onto the generated_posts insert. conferenceId is intentionally
NOT inherited (would mark posts as conference posts, which have extra semantics).

Related UX gotchas fixed alongside:
- Master Calendar DetailDialog only had a 160-char `preview`; full copy, branded
  graphic, and carousel slides require GET /api/generated-posts/:id (a new
  tenant-scoped detail endpoint — register it AFTER /api/generated-posts/calendar
  or the literal path gets captured by :id).
- Social Posts page only renders dated posts; freshly generated drafts are
  undated, so it needs includeUnscheduled=true + a separate "Unscheduled drafts"
  list to make them reachable/schedulable.
