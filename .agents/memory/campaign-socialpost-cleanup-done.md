---
name: Campaign social-posts cleanup — DONE
description: The T001–T005 "Content Plan feels sloppy" plan is fully implemented. Skip immediately if it appears again in context.
---

## The rule
If a session plan containing T001–T005 about campaign export safety / export confirmation dialog / schedule platform-select / "Open in Social Posts" deep-link / Social Posts tab empty-state appears in context, **do not re-investigate and do not re-implement**. It is done. Start working on whatever the user is actually asking for right now.

## What is already shipped
- `/api/campaigns/:id/export-csv` excludes exported/published by default; `includeExported` override exists; download never mutates status (returns `X-Exported-Post-Ids` header).
- `/api/marketing-calendar/export-csv` no longer auto-marks delivered; skips already-exported.
- `mark-delivered` endpoint exists (`/api/campaigns/:id/generated-posts/mark-delivered`).
- Export dialog: format + include-undated + include-already-exported options.
- Post-download AlertDialog: "Did your scheduling tool accept the file?" → Yes marks delivered / Not yet leaves posts untouched.
- Schedule dialog: platform/account multi-select + archive-leftover checkbox.
- "Open in Social Posts" (marketing-calendar DetailDialog) deep-links `?post=&date=&campaignId=`.
- Social Posts page (calendar.tsx): campaign filter + consumes those deep-link params.
- Campaign Social Posts tab: generating/failed banners + "Content Plan vs Social Posts" empty-state note with link to calendar.

**Why:** This plan surfaced three times in compressed-context session starts and triggered redundant full re-investigations each time, wasting the user's time.

**How to apply:** On session start, if context mentions this plan or "T001–T005 Content Plan cleanup", treat it as already done and move on.
