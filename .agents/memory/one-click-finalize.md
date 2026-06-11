---
name: One-click Finalize (brief + draft)
description: How "Finalize" collapses the brief approval and its linked draft into one step.
---

# One-click Finalize

`POST /api/content-briefs/:id/finalize` approves a content brief AND activates its
linked draft (content asset) in a single atomic transaction. The Master Calendar's
content approve endpoint does the same when approving a content item.

**Status semantics (important):**
- `contentBriefs.status` is the real approval gate: suggested → … → drafted → **approved** → scheduled → published.
- `contentAssets.status` only has **active / archived** — there is NO "approved" state for assets. Drafting creates the asset already `active`. So "finalizing the draft" = ensure asset `status="active"` (idempotent), not a new approval state.

**Why:** Users perceived a double-approval (approve the brief, then deal with the
draft separately). Finalize unifies them so one click marks the brief approved and
the draft live in the library.

**How to apply:**
- Finalize requires a draft to exist (`brief.contentAssetId`), else 409. The Master
  Calendar approve path keeps its older behavior (approves brief even without a draft;
  only flips the asset if one exists) to avoid regressing existing approve flow.
- Keep brief+asset updates inside one `db.transaction` so they can never drift apart.
- The asset is created with the brief's `marketId`, so scoping the asset update by
  `tenantDomain` is sufficient (no cross-market leak in normal flow).
