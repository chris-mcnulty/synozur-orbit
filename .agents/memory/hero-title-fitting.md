---
name: Hero/social-card title fitting
description: How branded hero & social quote-card titles are sized/wrapped so long titles fit without ugly mid-thought truncation.
---

`compositeHeroImage` (server/services/conference-promotion-service.ts) renders BOTH conference hero graphics and standalone branded social/quote cards (via `generateBrandedPostGraphic`). Title sizing is responsive, not fixed.

- `layoutTitle(text, usableWidth, fits?)` picks the largest font from `TITLE_TIERS` ([72,64,58,50,44]px) whose word-wrapped lines (`wrapWords`, no cap) fit the line budget AND pass the optional `fits(lineCount, lineHeight)` predicate. Last resort = 44px, line count reduced until `fits` passes, then `wrapText` truncates with a word-boundary "…".
- **Why:** a fixed 64px/3-line/28-char cap chopped provocative quotes mid-sentence with "…". Scaling the font keeps the whole thought on the card.
- **Conference path is vertically constrained:** title sits at fixed `CONFERENCE_TITLE_TOP=380` with location/dates below, so the caller passes `fitsVertically = 380 + lineCount*lh + 16 + subtitleRows*40 <= H-16` (H=675). Without this, big tiers overflow the canvas and clip subtitles. The fallback MUST also honor `fits` or pathological titles overflow.
- **Post/quote-card path** (no event logo) has `fits = () => true` and vertically centers the variable-height block: `titleStartY = round((H - (n-1)*lineHeight)/2)`.
- Headlines for post cards come from `derivePostHeadline` (server/routes/marketing-posts.ts) → `clampToBoundary` (cut on comma/word boundary, never mid-word, 140-char cap; "…" only when text actually dropped).

**How to apply:** when changing canvas height, `CONFERENCE_TITLE_TOP`, or subtitle layout, update the `fitsVertically` formula in lockstep. AVG_CHAR=0.54 is an Avenir-bold width estimate; re-tune if the heading font changes.
