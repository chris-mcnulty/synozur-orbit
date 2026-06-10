---
name: Distribution planner channel resolution
description: How the editorial-calendar distribution planner decides a brief's schedule channel (format vs the brief's channels field)
---

# Distribution planner: format decides the schedule channel, not `channels`

In `server/services/distribution-planner-core.ts`, `resolveChannel()` decides which
channel a content brief publishes on for the "Generate calendar"/distribution-plan
preview.

**Rule:** a brief's `format` is the actual deliverable (blog_post, linkedin_post,
newsletter, …). When the format maps to a definitive channel (`FORMAT_CHANNEL`),
the format is authoritative. The brief's `channels` array is treated as
amplification/promotion channels and must NOT override the deliverable. Only
formats with no definitive channel (`other`, `podcast_outline`, future unmapped
formats) fall back to the brief's preferred `channels`, then default to linkedin.

**Why:** the AI brief generator fills `channels` with promotion channels that
often lead with "linkedin". The old code took the first valid entry of `channels`
over the format, so blog_post briefs scheduled onto the linkedin channel and
"blog" never appeared in the schedule — users asked "where are the blog posts
going on schedule?".

**How to apply:** when adding a new value to `CONTENT_BRIEF_FORMATS`, also add it
to `FORMAT_CHANNEL` if it has an obvious publishing channel; otherwise it will
fall back to preferred channels / linkedin. There is a test asserting unmapped
formats (podcast_outline) fall back to preferred channels.
