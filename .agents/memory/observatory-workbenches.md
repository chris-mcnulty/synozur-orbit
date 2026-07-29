---
name: Observatory assessment workbenches
description: Design decisions for the six Observatory review workbenches (review items, pen tests, AI governance gate)
---

# Observatory assessment workbenches

- All six workbench modules share one generic review-items checklist table keyed by `module`; the Architecture workbench renders two modules (standard + Azure Well-Architected) in one page, split client-side.
- Pen-test findings wrap shared findings rows so they surface in every shared surface (reports, traceability) regardless of origin. **Why:** one findings register is the traceability backbone; parallel finding tables would fork it.
- CVSS→severity uses 9/7/4 thresholds (Critical/High/Medium, else Low, 0 = Informational).
- Guards are server-side, not just UI: AI Governance init requires the application be flagged AI-enabled; each module can only initialize on its matching assessment type(s); source-code findings require an affected source file.
- API enums are Title Case display values (`Pass`, `Critical`, `Not Tested`), not snake_case.
- Server request context carries no user display name — routes can auto-stamp dates but never reviewer names.
- Scanner/repo integrations are intentionally design-only interfaces (no live scanning in v1).

## V1 insights layer (readiness / reports / VPAT)

- Readiness weights and bands are a product contract, not tunables: A11y 25 / Sec 25 / Source 15 / Arch 10 / Priv 10 / Docs 10 / AIGov 5; bands at 90/75/60; hard blockers (open Critical findings, unvalidated critical pen-test findings, missing evidence on completed assessments) force any Ready band down to Remediation Required. AI Governance weight re-normalizes across the other domains when the app isn't AI-enabled. **Why:** executives compare scores across apps and over time — silent weight changes would rewrite history; snapshots are persisted per version.
- Report generation must degrade gracefully when AI is unavailable: the AI executive summary is best-effort (report still generates without it), while the VPAT ai-draft endpoint surfaces the failure. **How to apply:** never let an AI provider outage block report/PDF delivery.
- The mandatory VPAT disclaimer ("Draft VPAT support content only. Requires human review and validation. Not a legal certification.") is returned by the API and shown in UI + exports — do not remove it from any new VPAT surface.
