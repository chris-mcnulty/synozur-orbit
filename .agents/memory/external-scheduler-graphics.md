---
name: External scheduler graphics must be public-hosted
description: Why social-post graphics exported to external schedulers must live in the public object-storage bucket, not the private /objects route.
---

# Graphics for external social schedulers must be publicly fetchable

Any image URL we put into a CSV/feed consumed by an external social scheduler
(SocialPilot, Hootsuite, Sprout Social) must be a fully-qualified, no-auth URL.

**Why:** The app's `/objects/:objectPath(*)` serving route requires
`req.session.userId` and returns 401 to anyone without a logged-in session.
External schedulers fetch the image server-to-server with no cookies, so a
private `/objects/...` (or even absolutized) URL silently yields no graphic in
the post.

**How to apply:** Store such images in the PUBLIC bucket path
(`PUBLIC_OBJECT_SEARCH_PATHS`, e.g. `<bucket>/public/...`) and emit a
`https://storage.googleapis.com/<bucket>/<objectName>` URL. Remember the two
entry points: freshly generated/composited images AND user-*uploaded* images
(those land at private `/objects/uploads/...` via the presigned-upload flow and
must be re-published to public before export). The in-app `<img>` and the
compositing `loadImageBytes()` both already handle absolute https URLs.
