---
name: DB pool isolation (primary vs crawl)
description: Why background/crawl work and its telemetry must run on crawlDb, never the primary pool, to protect time-sensitive scheduled-post publishing.
---

# Two Postgres pools: primary vs crawl

`server/db.ts` exposes two pools/drizzle clients:
- **primary `db`** — API requests + time-sensitive workers (marketing publish worker, email send worker). Max 15 (raised July 2026 from 5 after a tenant-wide "run all intelligence" storm starved social/news sweeps, HubSpot sync, and even session auth on the primary pool).
- **crawl `crawlDb`** — all non-urgent background work: web crawls, monitors, AND job-lifecycle telemetry.

**Rule:** anything that fires on the hot crawl/monitor path — including bookkeeping/telemetry writes — must use `crawlDb`, never `storage`/`db`.

**Why:** On a small connection-limited Postgres (Neon/Replit ~10 conns), 78 crawl jobs cycling through, each doing start+finish telemetry writes on the *primary* pool, plus the startup burst of recurring sweeps, exhausted `connectionTimeoutMillis` and cascaded "Connection terminated" failures that killed every worker — including the publish worker, so scheduled social posts silently stopped publishing in production. Crawl work is not time-sensitive; scheduled posts are. Non-urgent work must yield connections to urgent work.

**How to apply:**
- Job-queue persistence hooks (`setPersistenceHooks` in `server/index.ts`) and `trackJobStart`/`trackJobComplete`/`cleanupStuckJobs` (`scheduled-jobs.ts`) all write `scheduled_job_runs` via `crawlDb` directly (insert/update/select on the `scheduledJobRuns` schema), not `storage.*`.
- There are **two** telemetry paths for queued scheduled jobs: the job-queue hooks (every enqueued job) AND `trackJobRun` (wraps the work fn). Both write `scheduled_job_runs` → two rows per job (pre-existing). `trackJobRun` swallows errors and returns the id, so the queue's `work()` always resolves "completed" — the queue hook never emits a failure notification for wrapped jobs; `trackJobComplete` is the sole `job_failed` notifier (no duplicate notifications).
- Low-frequency jobs (weeklyDigest ~weekly, scheduledBriefing) and admin API routes (`operations.ts`) may stay on the primary pool — negligible load.
- Crawl/monitor per-type concurrency is 1 (job-queue `DEFAULT_CONFIG`) so background work trickles instead of bursting.
- Crawl/monitor job-queue default timeout is 5 min (was 10): bot-blocked sites hang the full timeout serially, so a handful of hung sites can stall a full-tenant refresh for hours. Callers may still pass explicit timeouts.
- Recurring sweep first-ticks are staggered in `scheduled-jobs.ts` so they don't all collide at startup T+120s.
