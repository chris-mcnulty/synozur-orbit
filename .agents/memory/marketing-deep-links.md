---
name: Marketing single-item deep-links
description: One helper builds every "jump to the exact brief/email/post" link; which pages honor which params.
---

Every rollup surface that nudges toward ONE content item deep-links through
`itemDeepLinkHref` in `client/src/lib/marketing-deep-links.ts` (itemType =
"brief" | "email" | "social"). Reused by the Next-actions cards
(`NextActionsByBatch.tsx` `singleItemHref`), the Planning Hub item list
(`hub-components.tsx`), and the Master Marketing Calendar detail (`editorHref`
in `marketing-calendar.tsx`).

**Param contract the target pages honor** (they scroll+highlight or auto-open):
- brief  → `/app/marketing/editorial-calendar?brief=<id>` (+ optional `calendar=`, `campaignId=`)
- email  → `/app/marketing/email-newsletters?emailId=<id>`
- social → `/app/marketing/campaigns/<campaignId>?post=<id>#posts` when a campaign
           is known, else Master Social Calendar `/app/marketing/calendar?post=<id>`
           (+ optional `date=` to land the right month).

**Why:** approvers were landing on lists/tabs and hunting. Keep new outbound
links going through the helper so the item-level contract stays consistent.

**Gotcha:** the Master Social Calendar (`calendar.tsx`) resolves `?post=` only
against posts loaded for the current month grid — but its query passes
`includeUnscheduled: true`, so undated posts resolve without a `date`; dated ones
need the correct month, which the `date=` param supplies.
