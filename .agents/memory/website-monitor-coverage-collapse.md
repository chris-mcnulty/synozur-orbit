---
name: Website monitor false "abandonment" alerts
description: Why website-monitoring reports false strategic pivots/abandonment, the crawl-coverage guards, and the SPA crawling lessons behind them.
---

# Website monitor false "abandonment" alerts

False alerts like "Company X abandoned AI / Microsoft / thought leadership" come
from crawl **page-coverage variance**, not real content change. If a run reaches
far fewer pages than the stored baseline, all content on the un-crawled pages
reads as "removed" and the change-analysis AI reports a strategic pivot.

## Root cause: SPA crawling
Client-rendered SPAs (e.g. synozur.com) serve one identical shell HTML for every
route; the real per-page content only exists after JS runs. Two consequences that
must both be handled or coverage silently collapses to the homepage:

1. **Discovery** — the static homepage shell has no nav `<a href>` links, so
   link-scraping (findKeyPages) finds nothing. **The sitemap.xml is the only
   reliable page index for a SPA.** Always merge sitemap URLs into the crawl set.
2. **Rendering** — plain HTTP fetch of any route returns the same empty shell.
   Only the headless (Puppeteer) renderer yields real content. So headless MUST
   succeed for *every* discovered page, not just a lucky few.

**Why the headless semaphore matters:** the headless crawler caps concurrency. If
that cap *rejects* extra requests (returning null → HTTP fallback), SPA pages fall
back to the empty shell, and *which* pages win the race varies per run — making
crawls both content-poor and **nondeterministic**, which itself fires false
"change" alerts. Fix pattern: the concurrency gate must **queue/wait** for a slot
(baton-passing semaphore), never reject-and-fall-back.

## Guards (defense in depth, all in website-monitoring.ts)
- `isCoverageCollapse(prevCrawlData, currentPageCount)` — if the site was
  previously multi-page and this run reached far fewer, skip change detection +
  alert and return early WITHOUT overwriting the baseline, preserving the richer
  snapshot. Applied to all 3 monitor paths (competitor, baseline company profile,
  product).
- **Escape hatch (critical):** the collapse guard only holds while the stored
  baseline is fresh (bounded max age). A transient partial crawl self-heals on the
  next full crawl; a *permanent* site shrink ages the baseline out, the guard
  stops firing, and the smaller crawl legitimately becomes the new baseline.
  Without this, a genuinely-shrunk site is stuck comparing against a stale page
  count forever.
- The older empty-crawl guard only catches near-total collapse; a many→1 page drop
  where the homepage is still content-rich slips past it — hence the separate
  coverage guard.
- Change-analysis prompt caveat: a topic absent from the current excerpt is NOT
  evidence of removal; only report removal when current content actively
  replaces/discontinues it.

## Non-obvious rule: stamp freshness on EVERY early return
The scheduler gates each monitor by `now - lastWebsiteMonitor < intervalMs`. Any
early-return/skip/error branch that does NOT stamp `lastWebsiteMonitor` causes the
entity to be re-queued every sweep (scheduler churn). Every skip branch in all
three monitor paths must stamp the timestamp (only the timestamp — never the
content/crawlData on a skip).

**Gotcha:** the collapse guard can't retro-fix a baseline that already collapsed
(prev pages too few = no guard). To restore multi-page fidelity after a collapse
already happened, the user must reset the website baseline (also clears
website_update baseline activities).
