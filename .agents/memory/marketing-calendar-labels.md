---
name: Marketing calendar UI labels vs routes
description: The three marketing calendars were renamed in the UI but their routes/feature keys kept old names — a search gotcha.
---

# Marketing calendar UI labels vs routes

The three "…Calendar" surfaces were renamed for clarity. The **route paths and
feature keys were intentionally left unchanged** (presentation-only), so the
UI label no longer matches the URL/filename. When searching for a surface by
its on-screen name you will not find the route — search by route instead.

| UI label (sidebar/title/breadcrumb) | Route | Page file |
| :-- | :-- | :-- |
| Master Calendar | `/app/marketing/marketing-calendar` | `marketing-calendar.tsx` |
| Content Briefs | `/app/marketing/editorial-calendar` | `editorial-calendar.tsx` |
| Social Posts | `/app/marketing/calendar` | `calendar.tsx` |

**Why:** Renaming routes/feature gates would break deep links and plan
enforcement; only labels/icons/descriptions changed.

**How to apply:** Keep these names consistent across AppLayout sidebar,
PageBreadcrumbs `STATIC_ROUTE_LABELS`, the page `<h1>`s, cross-links, the
Marketing Home cards (`marketing/index.tsx`), and App.tsx feature-gate labels.
Distinct icons: Master=CalendarRange, Social Posts=Share2, Content Briefs=ClipboardList.
