---
name: Asset image replacement propagation
description: Rules for replacing a content asset image without corrupting scheduled or in-flight social posts.
---

Changing a content asset lead image must atomically update linked unpublished posts that still inherit the old or null image. Preserve differing per-post overrides, brand-asset overrides, and terminal delivered posts.

**Why:** Generated posts snapshot asset images. Updating only the asset leaves scheduled posts stale, while changing an actively claimed post can make the stored record disagree with what the provider actually sent.

**How to apply:** Serialize the asset update and post propagation in one transaction. If a claimed publish succeeds, restore the exact override held by that attempt; if it fails, retain the replacement so retry uses the new image.

## Image inheritance must match delivery

Campaign previews, the posting queue, the shared editor, and both publishing modes must resolve the same inherited image. Do not add client-only article or campaign-image fallbacks that the publisher never receives. Treat an inherited image as required once selected for a publish attempt, rather than silently falling back to text-only when retrieval fails.

**Why:** The user reported that a campaign showed article images while the queue said “No graphic” and actual posts were text-only. The campaign viewer had been inferring an image that the publishing path never resolved.

**How to apply:** Keep resolution tenant-scoped and preserve explicit overrides. Snapshot the image actually attempted when publishing succeeds. Do not infer a newly inherited image for an already delivered post or make historical text-only sends look image-bearing.