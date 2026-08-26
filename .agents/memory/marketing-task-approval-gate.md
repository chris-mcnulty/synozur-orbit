---
name: Marketing task approval gate
description: Product invariants for AI-suggested marketing tasks vs Planner sync and dedup.
---

**Invariants:**
- AI-suggested marketing tasks never reach Microsoft Planner without explicit user acceptance; acceptance is proven by a durable server-stamped `acceptedAt` — lifecycle status alone (planned/in_progress/completed) never counts as consent, including Planner-side progress changes.
- Report/recommendation/generation/brief provenance is authoritative even if `aiGenerated` is false: force review state at insert and require `acceptedAt` at Planner sync.
- Dismissed suggestions are permanent dedup history: API "delete" of a review-state AI task becomes a dismissal, and Planner-side deletion of an AI task marks it dismissed (never recreated).
- Generation paths must dedup (normalized title + similarity) against existing/accepted/dismissed tasks and stamp generation-run provenance.

**Why:** Pre-gate and misclassified report tasks auto-synced to users' personal Outlook/Planner feeds without approval; externally orphaned tasks can remain after their Orbit source is gone.

**How to apply:** Any task insert, sync path, delete route, or bulk status endpoint must respect generated provenance, `isPlannerSyncEligible`, and the review policy; alter-only migrations need the always-apply marker.
