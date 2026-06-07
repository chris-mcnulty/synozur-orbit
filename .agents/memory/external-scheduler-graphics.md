---
name: External scheduler graphics must be public-hosted
description: How social-post graphics exported to external schedulers must be served so they are anonymously fetchable, and why raw GCS URLs are NOT.
---

# Graphics for external social schedulers must be publicly fetchable

Any image URL we put into a CSV/feed consumed by an external social scheduler
(SocialPilot, Hootsuite, Sprout Social) must be a fully-qualified, no-auth URL
that ends in a real image extension.

**Why raw GCS URLs do NOT work:** A `https://storage.googleapis.com/<bucket>/...`
URL into the Replit-managed bucket returns **HTTP 403 AccessDenied** to anonymous
callers — the bucket is not anonymously readable. Schedulers fetch
server-to-server with no credentials, so these URLs silently yield no graphic.
(The app's `/objects/:objectPath(*)` route is worse: it requires a logged-in
session and 401s.)

**The working approach:** Serve through the app's own unauthenticated public
route, backed by the PUBLIC object-storage search path:
- Route `GET /public-objects/:objectPath(*)` serves only from
  `PUBLIC_OBJECT_SEARCH_PATHS`, rejects `..` traversal, sets a long cache.
- Store the image as a **RELATIVE** path: `/public-objects/<dir>/<uuid>.<ext>`.
  Do NOT bake an absolute host into the DB — that ties the row to the
  environment (dev vs prod) it was generated in.
- Absolutize at the **export boundary** using the request host
  (`x-forwarded-proto` / `x-forwarded-host`), so the exported URL always matches
  wherever the user is exporting from. Only absolutize `/public-objects/...`
  paths — never `/objects/...` (still auth-gated; absolutizing just yields an
  absolute URL that 401s).

**How to apply / self-heal:** Treat a URL as "served" only when it's a relative
`/public-objects/...` path with a valid image extension. Anything else (private
`/objects/...` uploads, legacy raw-GCS URLs, env-hosted absolute URLs) must be
re-published once: read the bytes straight from storage (never depend on the
serving host being reachable), derive content-type+ext, re-save into the public
path, update the row. When reading bytes to heal, map a `/public-objects/...`
path back to the public object and download from storage directly.

## Pitfall: extension-less private paths
Uploaded objects sit at `/objects/uploads/<uuid>` with **no file extension**, so
deriving the ext via `path.split('.').pop()` returns the whole path and yields a
mangled public filename. Schedulers reject media whose URL doesn't end in
`.png/.jpg/.webp/.gif`. Derive the type from the stored file's
`getMetadata().contentType` (fallback to a recorded `fileType`, then
`image/png`) and map MIME→ext.

## Tone for company social copy
Conference/event post copy must use organization voice ("we"/"our team"), never
singular first person ("I"/"I'm going") — these post from a company page, not a
person. Enforce it as an explicit RULE in the generation prompt.

NOTE: SharePoint Embedded (SPE) is a separate, usually-unconfigured store and is
intentionally NOT used for these public graphics.
