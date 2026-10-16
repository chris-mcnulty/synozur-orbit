# Event anchor image pools

## Editor behavior

- An event can have **20 active anchor images**. The server serializes creates and restores under an event-row lock, including concurrent requests. Archive an image to free a slot.
- Uploads and HTTPS links become validated PNG copies served by Orbit's anonymous `/public-objects/` route. Private internal paths require a recent upload grant for the same editor/tenant/market or an in-scope registered asset. External links use the existing DNS-pinned, redirect-checked, timeout- and size-bounded social image loader.
- Downloads are limited to 20 MB; image decoding is limited to 40 megapixels. Actual pixels, not the filename or reported MIME type, determine validity. Images are normalized to at most 2400 × 2400.
- Uploaded/linked originals remain independent choices. **Add branded variant** creates another record, using the original as its source. It does not replace the original or existing posts.
- Composites can use an event pool image, an eligible Brand Library image, an event background, or an intentionally selected branded gradient.
- Headline (180 characters) and supporting text (240 characters) persist for regeneration. Company logo, market/tenant colors, and configured heading typography are reused. An event-specific logo is optional; if supplied, the richer conference layout is retained.
- Saving changed source/overlay controls marks the preview stale without deleting it. A failed render preserves the previous output, exposes a sanitized actionable error, and keeps the image out of future generation until repaired. Concurrent edits cannot be overwritten by an old render. A removed selected source cannot silently become a gradient.
- Archived pool images stay out of future generation. Archiving/restoring an entire event does not reactivate independently archived pool images.

## Sessionless promotion

For an event with no sessions, existing eligible promotion days × posts/day determine the drop count **per selected account**, regardless of image count. Without an end date, the existing daily cadence supplies one day's drops. Weekend settings and existing schedule-slot logic still apply.

Each account rotates through ready images in creation order, using the image ID as a stable tie-breaker, then repeats. Failed, stale, and archived choices are excluded. Copy is grounded in the event name, description, saved facts, and registration link; sessionless copy is checked for unconfirmed session/speaker/attendance claims and retried before a batch is replaced. Posts remain drafts with manual review and existing publishing/export controls.

The conference path with sessions retains its existing mixed anchor/session moment order and schedule behavior. This change adds no general post-volume selector and does not automatically regenerate an existing campaign.

## Verification

Production logs on 2026-10-16 identified the reported generic render failure as the mandatory event-logo check, not a demonstrated font or image-download failure. The source-normalization path separately discarded Brand Library selections for anchors; route and raster tests cover retaining that selection.

Run:

```sh
npm run check
npm test -- server/services/__tests__/conference-image-intake.test.ts \
  server/services/__tests__/conference-image-pool-routes.test.ts \
  server/services/__tests__/conference-sessionless-series.test.ts \
  server/services/__tests__/conference-graphics-regression.test.ts \
  server/services/__tests__/conference-copy-grounding.test.ts \
  server/services/__tests__/conference-graphic-source.test.ts \
  server/services/__tests__/image-retrieval.test.ts
npm run build
```

The development-only smoke harness `script/verify-event-anchor-pool.ts` was bundled with esbuild's Node/CJS production format, with project dependencies external, and run with `--development-fixtures`. It successfully used real database rows, object storage, Sharp, Metro Nova font outlines, and the real anonymous image-serving handler to verify Brand Library and event-background webinar anchors without an event logo, persisted overlay/source settings, public PNG retrieval, failed-regeneration recovery, and original-image retention. The harness cleans up its isolated fixture rows and objects. Do not run it against production.

The application restarted successfully with the forward migration. The screenshot tool reached the sign-in page; it cannot authenticate, so the signed-in editor UI was not visually verified. Route tests cover its server contract, and the frontend passed the typecheck and production build.

### Production-only verification after merge

No production content was created, modified, regenerated, or published during diagnosis. The changed code is not deployed from this task branch. After merge, confirm the original event renders and its new output is anonymously accessible through the actual published host, then exercise a real AI-generated draft batch through review/export without publishing. Automated series tests use a deterministic copy provider and verify two accounts/channels, more drops than images, exclusion, registration grounding, counts, and rotation; a live AI-provider call was not part of the smoke harness.
