---
name: Content repurposer image outputs
description: How repurpose endpoints attach branded images without new schema
---

The multi-format content repurposer attaches branded visuals by reusing
existing image fields — no new tables/columns were added.

- **Social repurpose** (`/api/content-assets/:id/repurpose`): after inserting
  generatedPosts, renders one branded graphic per variant via
  `generateBrandedPostGraphic` and stores it in the post's `overrideImageUrl`.
  Best-effort with `Promise.allSettled` — a failed render leaves that post
  image-less rather than failing the batch. Response includes `imagesGenerated`.

- **Carousel** (`/api/content-assets/:id/repurpose-longform`, format `carousel`):
  `extractCarouselSlides(body)` (pure parser in repurpose-core.ts, tolerant of
  "### Slide N" headings, plain headings, or blank-line blocks) →
  `generateBrandedCarouselSlides` renders one image per slide (brand inputs
  resolved once). First image becomes the asset's `leadImageUrl`; all slide
  images are embedded into the asset's markdown body as `![Slide N](url)` so they
  persist without new columns. Response includes `slideImages`.

**Why no schema change:** contentAssets has only a single `leadImageUrl` (plus
`repurposedFromAssetId`), no image array — so multi-image carousels live in the
markdown body. docx-generator renders standalone image-markdown lines as an
italic caption (it can't fetch+embed remote bytes synchronously).

**Per-image regeneration:** social post graphics regen via the existing
`/api/generated-posts/:id/generate-image` (accepts optional `headline`/`subtitle`,
updates `overrideImageUrl`). Carousel slide regen
(`/api/content-assets/:id/regenerate-carousel-slide`, body `{ index, headline?,
subtitle? }`) must do BOTH: swap the embedded `![Slide N: ...](url)` markdown line
in the asset body (regex on the literal slide index) AND, when `index === 1`,
refresh `leadImageUrl`. There is no per-slide row to update — the body markdown +
leadImageUrl ARE the persistence, so any single-slide regen must keep them in sync.
If no supplied headline, reuse the alt text parsed from the existing markdown line.
