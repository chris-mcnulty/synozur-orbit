---
name: Headless launch circuit breaker
description: Chromium may be unable to launch in production; the headless crawler must trip a breaker and fall back to HTTP or no crawl ever completes.
---

Chromium can fail to launch entirely in the production deployment (puppeteer times out waiting for the WS endpoint). Without protection, every page burned ~90–120s of launch retries, so multi-page crawls always exceeded the job timeout — over one week prod logged ~942 failed vs 4 completed website crawls before this was caught.

**Why:** Launch failure is environment-level, not per-page. Retrying per page multiplies the cost across the whole crawl and starves the queue.

**How to apply:** The headless crawler has a circuit breaker: after 2 consecutive launch failures, headless is disabled for a 10-minute cooldown (`isHeadlessAvailable()` false) and all fetches go straight to plain HTTP. If crawl success rates crater again with "timed out" jobs, check deployment logs for `[Headless]` launch errors first — and consider extending the breaker to repeated post-launch protocol errors. Diagnosis path: `scheduled_job_runs` in prod (status/error_message) + deployment logs filtered on `(?i)headless`.
