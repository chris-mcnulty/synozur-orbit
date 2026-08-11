---
name: User-triggered crawls must stamp scheduler freshness fields
description: Restored setup/analyze crawl paths and the stamping contract that prevents scheduled-sweep double crawls.
---

The "remove Observatory" cleanup wrongly stubbed user-triggered crawl endpoints with 503 "no longer available in Orbit" (company-profile analyze, markets analyze-url, product scan, auto-build steps 1/2/5/7, full-regen step 1, market-unarchive refresh). All were restored from git history (pre-gutting commit `47c3e86f`).

**Rule:** any user-triggered crawl that persists crawlData must also stamp the fields the scheduled sweeps gate on, or the overnight sweep re-crawls the same site:
- crawl sweep gates on `lastFullCrawl` (competitor/org)
- website monitor sweep gates on `lastWebsiteMonitor` (+ org-level propagation)
- product monitor sweep gates on `product.lastWebsiteMonitor`
- also store `previousWebsiteContent` (first 100k chars) so the monitor's change-detection baseline exists

**Why:** user explicitly wants setup/manual crawls working AND no duplicate overnight runs; the sweeps' dedupe is purely timestamp-based.

**How to apply:** when adding/restoring any manual crawl path, mirror the stamping block in `server/services/scheduled-jobs.ts` (~line 350) including org sync. Unarchive-refresh fire-and-forget calls still bypass queue dedupe (follow-up exists).
