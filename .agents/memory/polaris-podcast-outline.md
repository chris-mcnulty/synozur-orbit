---
name: Polaris podcast outline asset type
description: How the podcast_outline content format is wired across brief-draft and repurpose paths, including the guest override.
---

`podcast_outline` is a first-class `CONTENT_BRIEF_FORMAT` (shared/schema.ts). Its house-format prompt lives once in `server/services/polaris-outline.ts` as `POLARIS_OUTLINE_GUIDANCE` and is referenced from both `FORMAT_GUIDANCE` (editorial-calendar-core.ts) and `LONGFORM_REPURPOSE_GUIDANCE` (repurpose-core.ts) — keep it single-sourced, do not fork the guidance.

**Guest override:** `polarisGuestBlock(guest?)` emits a "suggest a guest" block when blank and a "use this exact guest" block when supplied. It is appended to the prompt only when `format === 'podcast_outline'`. The guest string flows: route reads `req.body.guest` → `draftFromBrief(opts.guest)` (copywriter-service) or `repurposeToLongForm(params.guest)` (repurpose-service).

**Two entry paths:**
- Campaign brief → set brief format to podcast_outline → draft. Guest input on the brief card (editorial-calendar.tsx), keyed per-brief in `podcastGuest` map.
- Repurpose an existing asset → `RepurposeDialog.tsx` has its own "Polaris podcast outline" section calling `POST /api/content-assets/:id/repurpose-longform` with `{format:'podcast_outline', guest?}` (long-form path → Content Library asset), separate from the social batch path.

**Why:** Out of scope — no AI audio (recorded live), no RECOMMENDED_ASSET_MIX auto-suggest, no guest CRM. Export is the existing branded Word doc via buildBrandedDocx (markdown body); guidance instructs the header block at top of body.
