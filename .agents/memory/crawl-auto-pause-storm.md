---
name: Crawl auto-pause storm recovery
description: Infrastructure outages can auto-pause the whole crawl portfolio; bulk resume-all is the recovery path.
---

Competitors and products are auto-paused (`excludeFromCrawl=true`) after 6 consecutive crawl failures (`CRAWL_AUTO_PAUSE_THRESHOLD`), flagged after 3. An infrastructure-side failure storm (e.g. headless browser launch timeouts) trips this for the *entire* portfolio even though the sites are fine.

**Why:** July 2026 prod incident paused ~260 competitors + 73 products after Autoscale CPU throttling broke Chromium launches.

**How to apply:** Recovery = Global Admin "Resume All" on the admin Flagged Crawl Sites card (`POST /api/admin/flagged-crawls/resume-all`). It resets pause/flag/counters AND dismisses the stale `crawl_health` recommendations. When diagnosing "companies stopped being crawled," check `exclude_from_crawl` / `crawl_flagged_at` in prod before assuming scheduler bugs.
