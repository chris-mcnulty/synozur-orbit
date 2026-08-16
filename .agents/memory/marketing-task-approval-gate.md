---
name: Marketing task approval gate
description: Product invariants for AI-suggested marketing tasks vs Planner sync and dedup.
---

**Invariants:**
- AI-suggested marketing tasks never reach Microsoft Planner without explicit user acceptance; acceptance is proven by a durable server-stamped `acceptedAt` — lifecycle status alone (planned/in_progress/completed) never counts as consent, including Planner-side progress changes.
- Dismissed suggestions are permanent dedup history: API "delete" of a review-state AI task becomes a dismissal, and Planner-side deletion of an AI task marks it dismissed (never recreated).
- Generation paths must dedup (normalized title + similarity) against existing/accepted/dismissed tasks and stamp generation-run provenance.

**Why:** Pre-gate, suggestions auto-synced to users' personal Planner lists and reappeared after deletion — the original Task-757 bug.

**How to apply:** Any new sync path, delete route, or bulk status endpoint touching marketing tasks must respect `isPlannerSyncEligible` and the review-state policy module; alter-only migrations for this table need the always-apply marker.
