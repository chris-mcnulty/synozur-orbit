---
name: content-to-post multi-channel fan-out
description: How a social content draft converts into one schedulable post per channel, with per-channel AI tailoring.
---

The `/api/marketing-calendar/content-to-post` route accepts an optional `platforms[]` and creates one `generatedPost` per requested channel (linkedin/twitter/facebook/instagram; `x` aliases to twitter via `coercePlatform`).

**Key design rules:**
- The brief's *native* channel (`x_post` → twitter, else linkedin) uses the draft's asset.content verbatim. Every other requested channel is tailored to its native style via `repurposeAsset()`.
- The AI tailoring call happens BEFORE the DB transaction opens — never hold a row lock across an AI call. The brief→published flip stays guarded inside the tx with `ne(status,"published")`, so concurrent double-clicks still can't duplicate (loser gets 409). The wasted AI cost on the loser is accepted.
- `platforms[]` is validated strictly: unknown channel strings return 400 rather than silently coercing to linkedin. Empty array → 400. Omitted → defaults to native only.
- Deselecting native is legitimate (e.g. Facebook+Instagram only) — the insert loop iterates `requested`, so the native entry seeded in `contentByPlatform` is simply unused when native isn't requested.
- Response returns `posts[]` plus back-compat `postId`/`platform` (first post).

**Why:** Users wanted a range of posts across all supported channels from one draft, LinkedIn-led. Short-form social is framed multi-channel both in the concept-gen prompt (brief-interview-service.ts) and by pre-selecting BOTH linkedin_post + x_post for short_form briefs in the interview plan step (campaign-interview.tsx, flatMap seed).
