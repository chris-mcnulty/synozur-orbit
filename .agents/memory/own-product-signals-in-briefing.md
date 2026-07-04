---
name: Own-product signals in intelligence briefings
description: Why the client's own product-page monitoring signals must be treated as OWN (baseline), never competitor, and why crawler "% change" is not strategy.
---

# Own product/website signals must never drive competitor synthesis

The intelligence briefing synthesizes risk alerts / competitor movements from
monitoring `activity` rows. Activity `sourceType` can be `competitor`,
`baseline` (the client's own site), or `product` (the client's OWN offering
pages).

**Rule:** `buildSignalSummary` (intelligence-briefing-service.ts) must group
`sourceType in {baseline, product}` as OWN signals ("situational awareness
only") and exclude them from the competitor grouping. Product signals are about
the client's own offerings — grouping them by `competitorName` makes the AI read
an own-product change as a market/competitor movement.

**Why:** A false "Critical" alert claimed the client "pivoted away from AI (99%
website changes removing AI content)". The 99% came from own product-page crawl
artifacts (single-page collapse / failed crawls of the client's own offering
pages) that were classified as competitor signals and fed into risk synthesis.

**Also:** A crawler "% change detected" number is a raw text-diff, NOT a business
decision. The prompt must forbid inferring removal/abandonment/pivot from a
change percentage, a missing page, or a failed/near-empty crawl of the client's
OWN site. High % usually = redesign / CMS migration / partial crawl.

**Reset must purge both classes + regenerate.** `reset-website-baseline` only
cleared baseline rows (by `companyProfileId`); own-product rows have
`sourceType='product'` and NULL `companyProfileId`, so they survived and the
stale briefing kept showing the alert. The reset now also purges own-product
website_update rows (scoped by tenantDomain + marketId; NULL-market legacy rows
only folded in when resetting from the tenant's default market) AND regenerates
the stored briefing so the false narrative clears immediately instead of waiting
for the next scheduled run.

**Also clear product previousWebsiteContent on reset.** Even after purging the
activity rows, the products table (`isBaseline=true`) still holds
`previousWebsiteContent` from the old (possibly large/multi-page) snapshot. The
scheduler keeps crawling those products and comparing against the stale snapshot
→ fresh "99% change" signals are re-created every run. `resetProductWebsiteBaselines(companyProfileId)`
bulk-clears `previousWebsiteContent`, `crawlData`, `lastWebsiteMonitor` on all
own products; their next crawl sets a clean baseline with no comparison.

**The "3 days ago" cards that survived purge**: came from the stored
`intelligence_briefings.briefing_data` JSON (the briefing had the false narrative
baked in as `competitorMovements`/`riskAlerts`). Activity table was already
clean; the displayed cards were from briefing JSON, not activities. Always
check both tables when debugging "signal still showing after purge" situations.
