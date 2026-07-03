---
name: Pipeline board brief↔post dedup
description: When the unified content pipeline collapses a brief that has been fanned out into posts, and why only native-social formats.
---

The unified Content Pipeline board aggregates posts + emails + briefs. A brief
and the posts generated from it are separate rows, so a fanned-out brief can nag
twice. Generating posts from a brief does NOT change the brief's status (it's used
only as AI grounding), so the brief keeps showing.

**Rule:** the board hides a brief only when BOTH hold:
1. its format is a *native social* format — content IS the post
   (`NATIVE_SOCIAL_BRIEF_FORMATS` in `client/src/lib/pipeline.ts`:
   linkedin_post, linkedin_carousel, x_post), AND
2. a post references it via `generatedPosts.sourceBriefId` (surfaced in the
   `/api/generated-posts/calendar` payload; dedup happens client-side in
   `pipeline.tsx` allItems).

**Why:** long-form briefs (blog, whitepaper, video_script, etc.) also spawn posts
via `sourceBriefId`, but those are *promo* posts — the source piece is still the
primary deliverable and must stay visible. Only native social drafts become
redundant once their posts exist. Blanket-deduping on `sourceBriefId` alone would
wrongly hide legitimate long-form briefs.

**How to apply:** if you add a new brief format whose content is itself a social
post, add it to `NATIVE_SOCIAL_BRIEF_FORMATS`. Content approval nudges live only
in the Next Actions system — they are NOT mirrored into notifications/activity_feed,
so there are no cross-system content duplicates to collapse.
