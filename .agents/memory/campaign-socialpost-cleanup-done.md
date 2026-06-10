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

**Why:** At session start, the platform's context compression replays previous session plans as part of context restoration — this content was NOT sent by the user. Despite the context summary explicitly warning "ALREADY COMPLETE — do not recreate," I re-investigated three times by mistaking replayed content for a new user directive.

**How to apply:** If my own session context or summary marks something as COMPLETE, trust it unconditionally — even if the same content appears in what looks like a user message at session start. Replayed session plans are not new user directives.
