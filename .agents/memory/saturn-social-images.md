---
name: Saturn social campaign image variety
description: How generated social posts get images and why batches can repeat the same image
---

# Saturn social campaign images

- Generated posts (`generated_posts`) get their image from a **small static pool only**: a content asset's `leadImageUrl` (`overrideImageUrl`), a selected Brand Library image (`overrideBrandAssetId`), or the source asset's lead image. There is **no AI image generation** — each post's `imagePrompt` is written by the AI and stored but **never rendered into an actual image**.
- Posts are built as an **image-outer / variant-inner grid** and start **undated**; dates are assigned later, client-side, in the campaign-detail "distribute/schedule" mutation. The order posts are handed to consecutive day-slots is what determines which image lands on which day.
- `generated_posts` has **no sortOrder column** and the list endpoint orders by `platform, desc(createdAt)` — all batch rows share one `createdAt`, so insertion order is NOT a reliable schedule order. Ordering for variety must be enforced at distribute time, not via insertion.

**Why this matters:** users saw the same image on consecutive days because consecutive day-slots were filled in grid order (all of image #1, then all of image #2). Fix lives in the client distribute step: bucket each account's posts by resolved image, then greedily emit the largest remaining bucket whose image differs from the previous slot (classic max-count task-scheduler) — guarantees no same-image-on-consecutive-days whenever no single image exceeds half the batch.

**To get true variety beyond the provided pool** you would need to actually generate a unique image per post from `imagePrompt` (uses AI image credits) — not implemented; user opted for rotating the provided images only.
