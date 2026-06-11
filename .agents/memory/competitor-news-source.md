---
name: Competitor News Mentions data source
description: How the competitor "News Mentions" tab fetches news, and why it was switched off DuckDuckGo
---

The competitor **News Mentions** tab (Data Sources page → `data-sources.tsx`, served by
`POST /api/data-sources/news/refresh` in `server/routes/analytics-data.ts`) is powered by
`server/services/news-monitoring.ts` — a **separate** code path from the ideation/founding-signals
scan in `news-service.ts`.

**Decision:** `news-monitoring.ts.searchNews()` now uses the **GNews API** (`GNEWS_API_KEY`,
`in=title,description`, 30-day `from` window, `sortby=publishedAt`). It previously scraped
`html.duckduckgo.com/html/` with regex.

**Why:** DDG HTML scraping was unreliable — frequent blocking/rate-limiting and brittle CSS-class
regex meant scans returned 0 mentions even with competitors present ("20 sources but nothing shows").
Results are still **not persisted**; every visit starts empty until the user scans.

**How to apply:**
- GNews has **no `site:` operator** — build queries from the quoted competitor name only, not `site:domain`.
- The refresh endpoint scans **all** competitors (the old `slice(0, 5)` cap was removed).
- `monitorMultipleCompetitorsNews` runs a small worker pool (concurrency 3) with a global deadline
  (~50s) that returns partial results, because the endpoint is **synchronous** — a serial loop over
  many competitors (GNews + Anthropic sentiment each) risks HTTP timeouts. If competitor counts grow
  large, the proper fix is to make this an async job (202 + polling), like relationship reports.
