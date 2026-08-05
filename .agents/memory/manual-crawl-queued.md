---
name: Manual crawl endpoints are queued
description: Why manual crawl/refresh HTTP endpoints must enqueue, never crawl inline.
---

Manual crawl endpoints (`POST /api/competitors/:id/crawl`, `POST /api/company-profile/:id/refresh` + its `/crawl` alias) enqueue via the crawl job queue and return `202 { queued: true }` immediately.

**Why:** They previously ran multi-minute crawls + AI analysis inside the HTTP request. Bot-blocked/slow sites hung the request until the deployment proxy timed out, so users saw on-screen "failed to start" errors and nothing was ever queued (July 2026 prod incident). Also `/api/company-profile/:id/crawl` didn't exist for a while — clients called it and silently got 404s.

**How to apply:** Any new "refresh/crawl now" endpoint must validate + guard synchronously, then enqueue the heavy work and respond 202. Inside the queued job, re-fetch entity state before destructive updates (e.g. manual-research protection) — the pre-queue snapshot can be stale. Clients only toast on the response; none rely on synchronous analysis payloads.
