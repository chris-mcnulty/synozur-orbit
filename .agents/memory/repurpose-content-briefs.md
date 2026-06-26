---
name: Repurpose → Content Briefs model
description: Long-form repurposed content creates a Content Brief (not a Content Library asset). Content Library is for curated live assets only.
---

# Repurpose → Content Briefs model

## The rule
Long-form repurposed drafts (blog_post, newsletter, whitepaper, podcast_outline,
video_script) are the same category as social post drafts — they go to their
pipeline (Content Briefs, status=drafted) not the Content Library.

Content Library = curated, URL-fronted, live assets a human promotes there by
adding a URL. Never auto-populated by generation flows.

**Why:** Confirmed by user. "Not every blog post is worthy of that attention."
Even published podcasts are only 10-20% Library-worthy.

## Implementation
`repurpose-longform` route accepts optional `calendarId` in the request body.

If `calendarId` is provided and the format maps to a brief format
(`LONGFORM_TO_BRIEF_FORMAT` constant in `content-production.ts`), the route:
1. Creates the `content_asset` (no URL, no fileUrl — excluded from Library)
2. Looks up the editorial calendar (tenant-scoped)
3. Inserts a `content_brief` (status=drafted, contentAssetId=new asset) in that calendar
4. Returns `{ asset, brief, slideImages, usage, model }`

Client (`RepurposeDialog`): accepts `calendarId` prop; passes it through to the
server for the podcast-outline path. `onOpenContentBriefs` callback for navigation.

Trigger in `editorial-calendar.tsx`: when opening repurpose from a brief card,
passes `b.calendarId` as `repurposeTarget.calendarId`.

## What stays as bare asset (no brief)
- `carousel` — social content, no brief format equivalent
- Anything called without a `calendarId` (e.g., from Content Library repurpose)
  stays as a bare content_asset. No URL → excluded from Library, lives in limbo
  (acceptable — Library-origin repurpose is rare and calendarId is unavailable)
