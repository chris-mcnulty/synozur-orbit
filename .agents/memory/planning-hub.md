---
name: Campaign & Theme Planning Hub
description: How the planning hub aggregates marketing items per campaign/theme and where new items land.
---

# Planning Hub

A single view per campaign OR theme (solution area) that aggregates content briefs/drafts, social posts, and emails using the existing association columns (campaignId / solutionAreaId) — no schema changes.

- **Scoping (must match the rest of marketing):** generated_posts are tenant-only (no marketId column); generated_emails + content_briefs are tenant + active market. Filtering emails/briefs by `eq(marketId, ctx.marketId)` silently drops rows when ctx.marketId is null — that's the established pattern, not a bug.
- **Manual content items reuse the calendar's manual calendar.** New content actions are filed under the editorial calendar named exactly `"Marketing Calendar (manual)"` — the same name the Unified Marketing Calendar uses. **Why:** keeps a manually-created brief visible in both the hub and the calendar. If you change that name in one place, change it everywhere or items disappear from one surface.
- **Display lifecycle is a 4-stage funnel** (draft → scheduled → approved → posted) derived from each type's raw status, checked highest-first. Raw per-item status is still shown as its own badge.
- **Feature gating depends on scope:** campaign scope → `campaigns`; theme scope → `contentLibrary`. The page route itself is gated on `campaigns`.
