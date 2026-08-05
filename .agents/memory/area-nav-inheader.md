---
name: Area nav inHeader must stay true for Research/Product/Marketing/Sales
description: Task agents repeatedly reset inHeader to false, hiding the top-nav area tabs.
---

The four main app areas (research, product, marketing, sales) must have `inHeader: true` in `client/src/lib/areaNavigation.ts`. `home` and `settings` intentionally have `inHeader: false`.

**Why:** `AppLayout.tsx` filters `areas.filter(a => a.inHeader)` to build the desktop header tabs. If any main area is set to `false`, its tab disappears from the UI entirely. Task agents adding items to areaNavigation.ts have repeatedly copied the `home` area block (which has `inHeader: false`) as a template and applied the same flag to other areas.

**How to apply:** After any task-agent merge that touches `areaNavigation.ts`, verify that research/product/marketing/sales all have `inHeader: true`. If the area tabs disappear from the app header, this is almost certainly the cause.
