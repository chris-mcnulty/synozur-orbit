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
