---
name: Social-format content drafts vs schedulable posts in calendar export
description: Why LinkedIn/X content briefs never appear in the social CSV, and the convert path that fixes it.
---

A contentBrief with format `linkedin_post` / `x_post` (SOCIAL_BRIEF_FORMATS) is a *content draft*, NOT a schedulable social post. It has no socialAccount and the social CSV is built only from `generatedPosts`, so these drafts are silently absent from the export. Users see them as purple "LinkedIn" items on the Master Calendar and reasonably expect them to export.

**Why:** the social CSV writer (`buildPostsCsv`) iterates `generatedPosts` only; briefs live in a different table and pipeline.

**How to apply:**
- To include a draft in the CSV, convert it via `POST /api/marketing-calendar/content-to-post` (brief+asset → generatedPost, then brief status set to `published` to retire the duplicate). Conversion is wrapped in a transaction + guarded `ne(status,"published")` flip so a double-click can't create two posts.
- The converted post inherits `scheduledAt`; if the brief had none, the new post is undated and STILL won't export until dated (the CSV drops past/undated by default via `excludeUndated`).
- `export-preview` returns `pendingSocialDrafts` so the UI can warn about these excluded drafts instead of failing silently.
- Social CSV "missing account numbers" was fixed by resolving active tenant+market `socialAccounts` → `fallbackAccountIds` passed to `buildPostsCsv` (per-platform account fallback). "Missing dates" was past-dated posts getting blanked — now filtered out by default.
- Export now mirrors the campaign flow: pre-check dialog (counts) → download (`X-Exported-Post-Ids` header) → delivery-confirm → `POST mark-delivered`. Downloading alone does NOT mark posts delivered.
