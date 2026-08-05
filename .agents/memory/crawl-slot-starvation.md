---
name: Crawl slot semaphore starvation
description: Why the waiting semaphore for headless crawl slots must have a wait cap
---
The headless crawl gate was converted (July 2026 SPA fix) from reject-to-null into a waiting semaphore so every SPA page renders. Unbounded waits created starvation: pages from jobs that had already hit their 300s/900s job timeout stayed queued, took slots when their turn came, and starved live jobs — production ran at 0% crawl completion even on a Reserved VM.

**Rule:** slot waits must be capped (90s) — on timeout return null → HTTP fallback; coverage-collapse guard downstream absorbs shell-only SPA snapshots.
**Why:** the job queue runs up to 4 jobs × ~25 pages each against only 2 browser slots; without an exit, dead jobs' zombie pages dominate the slots forever.
**How to apply:** any shared-slot wait in crawl/monitor paths needs a timeout tied (at least loosely) to the job deadline; ideally thread an AbortSignal so cancelled jobs remove their waiters immediately.
Related prod fixes shipped together: waitUntil networkidle2→load (modern sites never go network-idle) and removal of --single-process Chromium flag (protocol crashes → 130s relaunch loops).
