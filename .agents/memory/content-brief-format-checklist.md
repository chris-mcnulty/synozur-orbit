---
name: Adding a content brief format
description: Every place a new CONTENT_BRIEF_FORMATS value must be threaded, including the easy-to-miss hardcoded AI prompt list.
---

Adding a new value to `CONTENT_BRIEF_FORMATS` (shared/schema.ts) requires touching several spots. Only one is compiler-enforced, so the rest fail silently (missing label, wrong channel, or AI never emits the format).

**Compiler-enforced (TS will flag):**
- `FORMAT_GUIDANCE` in `server/services/editorial-calendar-core.ts` — it's `Record<ContentBriefFormat, string>`.

**Silent — must update by hand:**
- `briefFormatToAssetType()` in editorial-calendar-core.ts (has a `default`, so a missing case maps to "other" silently).
- `FORMAT_CHANNEL` in `server/services/distribution-planner-core.ts` (`Record<string, Channel>`, falls back to "linkedin").
- Server label maps: `server/routes/editorial-calendar.ts`, `server/routes/marketing-calendar.ts`.
- Frontend pickers/label maps: `editorial-calendar.tsx` (FORMAT_LABELS + BRIEF_FORMAT_OPTIONS), `marketing-calendar.tsx` (FORMAT_MARKERS + add-format Select), `planning-hub.tsx` Select, `campaign-detail.tsx` label map.
- **Easy to miss:** the AI calendar-generation prompt in `server/services/editorial-calendar-service.ts` hardcodes its own `"format": one of ...` list (NOT derived from CONTENT_BRIEF_FORMATS). If you skip it, the backend accepts the format but AI-generated plans will never produce it.

**Why:** the format list is duplicated in ~10 places instead of derived from the enum; an architect review caught the AI-prompt list being out of sync when "ebook" was added.

**How to apply:** grep an existing format value (e.g. `whitepaper`) across server/ and client/ before declaring a new format done; the AI-prompt list won't show up in any type error.
