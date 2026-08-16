---
name: Unified Executive Summary (Briefing Room)
description: Cross-area AI briefing feature — naming collision, concurrency claim, and gating rules
---

- **Naming collision:** the schema already had an `executiveSummaries` table (research-area 4-part baseline summary, served by `executive-summary-service.ts` + `executive-regen.ts`). The unified cross-area feature therefore uses `unifiedExecSummaries`/`unified_exec_summaries` and lives in `unified-exec-summary-service.ts`. Never reuse the "executive summary" names for new tables/services here.
- **One-in-flight rule:** run claims are atomic — pg advisory xact lock on `unified_exec_summary:<tenant>` + in-transaction inflight check (<10 min) + insert. Both the manual route and the weekly scheduler go through the same claim; never add a separate check-then-insert path.
- **Gating:** on-demand = `executiveSummary` (pro+), auto weekly = `executiveSummaryAuto` AND the base feature — enforce both in scheduler and settings mutation. Plan Seed syncs new registry keys into service_plans rows on boot automatically.
- **Prompt bounds:** all tenant-controlled fact content passes `deepClip` (500-char strings, 10-item arrays) plus a 24k-char fact-sheet budget before synthesis. Any new collector must feed through it.

**Why:** an architect review failed the first version on duplicate-run races, an Auto-without-base gating bypass, and unbounded prompt inputs; and the file overwrite of the legacy service was only caught by typecheck.
**How to apply:** when extending the briefing (PDF export, email delivery) or adding similar "generate + poll" AI reports, reuse the claim pattern and clip inputs.
