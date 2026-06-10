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
- Users need to grab the actual assets (full copy + branded graphic + carousel
  slides) directly from the detail views, not just view a snippet. Both detail
  surfaces (Master Calendar DetailDialog in marketing-calendar.tsx + Social Posts
  PostDetailDrawer in calendar.tsx) now have Copy-text and per-image Download.
  Post images are same-origin Orbit object-storage paths, so a fetch->blob->
  anchor-download works (with window.open fallback). The aggregation/calendar
  payloads only carry a truncated preview, so both surfaces fetch the full row
  via GET /api/generated-posts/:id to get complete content + carouselSlides.
