---
name: Twitter media upload errors & v2 endpoint
description: X media upload must use v2 /2/media/upload with media.write scope; typed errors for 401/403/image-fetch failures.
---
- The legacy v1.1 upload.twitter.com/1.1/media/upload.json endpoint returns **403 for OAuth 2.0 apps** regardless of token validity (X retired it). Uploads must POST `${API_HOST}/2/media/upload` (multipart, `media` + `media_category=tweet_image`), response shape `{ data: { id } }`.
- The OAuth scope must include **media.write** or v2 upload also 403s; connections made before the scope was added need a reconnect to grant it.
- uploadMedia throws `.code`-tagged errors (`token_expired` 401, `media_scope_missing` 403, `image_fetch_failed` storage fetch) and the outer catch must rethrow `.code` errors — otherwise callers show the fake generic "Orbit storage" message.
- **Why:** two rounds of misdiagnosis ("Orbit storage", then "revoked token") both traced to swallowed/mislabeled upload errors; a 403 here is an endpoint/scope problem, not a storage or token problem.
- **How to apply:** any new X media path (video, carousels) goes through v2 with media.write; always log status+body and surface typed errors.
