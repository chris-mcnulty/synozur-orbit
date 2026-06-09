---
name: Unified Marketing Calendar
description: How the one-calendar-for-all-content surface aggregates social/email/content and maps lifecycle.
---

# Unified Marketing Calendar

Aggregates three existing content types onto one calendar; opening it never triggers AI.

- **Scoping is NOT uniform across the three sources.** `generated_posts` (social) has no `marketId` column — scope social by `tenantDomain` only. `generated_emails` and `content_briefs` are scoped `tenantDomain` + `marketId`. Don't add a `marketId` filter to social queries; it doesn't exist there.
- **Gated on the existing `editorialCalendar` feature key** (Enterprise). No new plan-policy key was added. The bulk social CSV export action gates on `socialPosts` instead.
- **Lifecycle = derived, not stored.** Each item returns a computed `lifecycle: draft|approved|delivered` from its own raw status: social exported/published→delivered, email sent (or sentAt set)→delivered, brief published→delivered; `approved`→approved; everything else→draft.
- **Manual content items need an editorial calendar parent** because `content_briefs.calendarId` is NOT NULL. A per-tenant/market calendar named `"Marketing Calendar (manual)"` is found-or-created to hold them, so a hand-added blog never goes through AI generation.

**Why:** these three were built separately with different tenancy assumptions; the calendar is a read/coordination layer on top, so it must respect each table's real shape rather than assume a shared scoping model.
