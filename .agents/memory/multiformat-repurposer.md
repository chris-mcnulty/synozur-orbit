---
name: Multi-format content repurposer
description: How the "Repurpose" action fans one source asset into many formats + branded images, and where each output lands.
---

# Multi-format repurposer

One source content asset → a batch of formats via `POST /api/content-assets/:id/repurpose-batch` (guarded by the `contentRepurposing` feature). Picker + grouped-results UI is the reusable `RepurposeDialog` (wired into both editorial-calendar and content-library).

**Routing rule (durable):** LinkedIn single posts + carousels persist to the **posts pipeline** (`generatedPosts`, `status: "draft"`, `sourceAssetId` set, shared `variantGroup`). All snippet types (video script/shot list, blog/whitepaper/email) persist to the **Content Library** (`contentAssets`, `status: "draft"`, `repurposedFromAssetId` set).

**Why:** mirrors Cowork's repurposer; posts need the social scheduling pipeline, snippets need library editing + Word export.

**Voice:** Synozur anti-hype/wartime, sentence case, NO em dashes, NO hashtags — enforced by `applySynozurVoice` sanitizer in `repurpose-core.ts`, not just the prompt.

**Images degrade gracefully:** branded purple/magenta graphics (single per post, 5-slide set per carousel) are generated per item inside try/catch; failures push to `imageWarnings` and the draft is still created. Never let image failure abort persistence.

**Legacy social-only path stays intact:** the old `/repurpose` endpoint + service remain; only the UI button was repointed to the multi-format dialog.
