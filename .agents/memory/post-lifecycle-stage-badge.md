---
name: Post lifecycle stage badge
description: How generated-post status maps to the single human-readable stage badge shown in campaign lists/grids.
---

# Post lifecycle stage badge

`getPostStage(post)` + `<PostStageBadge>` (campaign-detail.tsx) collapse a generated
post's raw `status` (draft / approved / exported / published / publish_failed /
rejected) plus `publishedAt` / `publishError` / `scheduledDate` into ONE clear stage
label: Draft → Ready to post → Scheduled/Exported → Posted, with Rejected / Posting
failed as side states.

**Precedence (order matters):** posted (`publishedAt` || `published`) > rejected >
failed (`publish_failed` || `publishError`) > exported > approved > draft.

**Why:** rejected must beat `publishError` or an explicitly-rejected post that also
carries a stale publish error would mislabel as "Posting failed". `exported` shows
"Scheduled" only when it has a `scheduledDate`, otherwise "Exported".

**How to apply:** reuse this badge for any new surface that lists generated posts
(lists, calendars, hub) instead of printing the raw status string. Calendars use a
separate `LIFECYCLE_META` map (marketing-calendar.tsx) — keep the two visually
consistent if you touch one.
