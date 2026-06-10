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
