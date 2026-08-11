---
name: Website blog import enrichment contract
description: Rules for the website MCP import routes — image field names, category backfill, async summaries, scope-safe counters.
---

Rules for the website→content-library import routes (bulk + selective dialog):

- The website MCP returns `heroImageUrl` (fallback `ogImageUrl`), NEVER `leadImageUrl`. Reading the wrong field silently drops images. (WebsitePostSummary interface is the contract.)
- Imported blog posts must land fully formed: leadImageUrl, Blog Post category (resolve-or-create per tenant+market, ilike "blog post", COALESCE backfill only when categoryId is null), and an AI summary.
- AI summaries are generated asynchronously AFTER the response is sent (queueImportSummaries) so a slow AI call or proxy timeout can never truncate the import.
- Counters used in `res.json` must be declared OUTSIDE the try block. Declaring them inside caused a ReferenceError after all DB writes committed — the route 500'd with partial data written ("fails with partial import"). This was also the source of the long-standing "baseline" tsc shorthand-property errors in the marketing routes — those baseline errors were a live prod bug, not noise.
- Never trust client-supplied `existingId`: scope updates to tenant + market, use `.returning()`, and fall through to insert when no row matches.

**Why:** Aug 2026 prod incident — imports "timed out" leaving rows with no image/summary/category; all four issues above combined.
**How to apply:** any new import path (episodes, landing pages, future kinds) must follow the same contract; re-running the import repairs previously partial rows (update path backfills image/category, summary queue fills empty aiSummary).
