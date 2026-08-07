---
name: Twitter media upload typed errors
description: How the X publisher distinguishes token vs image-fetch failures; the swallow trap
---
The X publisher's uploadMedia throws typed errors (err.code): `token_expired` on 401 from X's media endpoint, `image_fetch_failed` on non-OK Orbit storage fetches. Its outer catch MUST rethrow errors with a `.code` — a catch-all `return null` there resurfaces the misleading generic "Image could not be fetched from Orbit storage" message.

**Why:** Aug 2026 — the typed 401 error was swallowed by uploadMedia's own outer catch, so users saw a fake storage error when the real problem was a revoked X token needing account reconnection.

**How to apply:** Any new failure branch in uploadMedia (or a sibling publisher) should throw a typed error, and the outer catch must preserve `.code`-tagged errors. publish() falls back to text-only for lead-image-only posts but fails retryably for overrideImageUrl posts.
