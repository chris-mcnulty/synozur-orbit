---
name: Asset image replacement propagation
description: Rules for replacing a content asset image without corrupting scheduled or in-flight social posts.
---

Changing a content asset lead image must atomically update linked unpublished posts that still inherit the old or null image. Preserve differing per-post overrides, brand-asset overrides, and terminal delivered posts.

**Why:** Generated posts snapshot asset images. Updating only the asset leaves scheduled posts stale, while changing an actively claimed post can make the stored record disagree with what the provider actually sent.

**How to apply:** Serialize the asset update and post propagation in one transaction. If a claimed publish succeeds, restore the exact override held by that attempt; if it fails, retain the replacement so retry uses the new image.