---
name: Unified Executive Summary (Briefing Room)
description: Cross-area AI briefing feature — naming collision, concurrency claim, and gating rules
---

- **Naming collision:** the schema already had an `executiveSummaries` table (research-area 4-part baseline summary, served by `executive-summary-service.ts` + `executive-regen.ts`). The unified cross-area feature therefore uses `unifiedExecSummaries`/`unified_exec_summaries` and lives in `unified-exec-summary-service.ts`. Never reuse the "executive summary" names for new tables/services here.
- **One-in-flight rule:** manual and scheduled runs share an atomic claim per tenant and market. Never add a separate check-then-insert path.
- **Gating:** on-demand = `executiveSummary` (pro+), auto weekly = `executiveSummaryAuto` AND the base feature — enforce both in scheduler and settings mutation. Plan Seed syncs new registry keys into service_plans rows on boot automatically.
- **Prompt bounds:** all tenant-controlled fact content passes `deepClip` (500-char strings, 10-item arrays) plus a 24k-char fact-sheet budget before synthesis. Any new collector must feed through it.

**Why:** an architect review failed the first version on duplicate-run races, an Auto-without-base gating bypass, and unbounded prompt inputs; and the file overwrite of the legacy service was only caught by typecheck.
**How to apply:** when extending the briefing (PDF export, email delivery) or adding similar "generate + poll" AI reports, reuse the claim pattern and clip inputs.

Reports must be market-specific end to end. Legacy account-wide reports must remain excluded, not reassigned to a default or newly created market. Unscoped source records are not evidence for an explicit market.

**Why:** A new CSI market displayed an older account-wide report that combined a professional-services briefing with a Microsoft GTM plan. It was neither CSI history nor a coherent account summary.

**How to apply:** Scope source collection, prior comparisons, saved report reads, claims, and browser caches. Ground GTM inputs in the same baseline company, excluding project-specific plans. Weekly auto-run remains an account preference, producing a separate report per active market. Preserve legacy reports but never use them as market evidence.
