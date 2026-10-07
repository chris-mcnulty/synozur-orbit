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

The approval requirement applies to every external task destination, including HubSpot. Permission to sync briefing notes, even a manual "push summary" click, is not permission to create action-item tasks or assign them to the connection's default owner. The user approved keeping briefing-note sync enabled while blocking automatic task creation; individual explicit task pushes are separate.

**Why:** A completed market onboarding exported all five briefing recommendations directly as HubSpot tasks, bypassing the Marketing Planner acceptance gate. Their titles matched the user's reported unwanted tasks exactly.

**How to apply:** Audit briefing auto-push separately from Planner sync. Keep informational note sync distinct from task creation; require explicit task approval and assignee selection rather than inheriting account-wide connection defaults.
