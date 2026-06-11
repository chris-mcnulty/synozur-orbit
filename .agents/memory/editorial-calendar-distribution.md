---
name: Editorial calendar — schedule/push flow & Planner naming
description: How "Schedule briefs" works on the editorial calendar and what "Planner" means.
---

# Schedule briefs dialog (editorial-calendar.tsx)
- One dialog ("Schedule briefs") does both preview and commit via a single `planDistribution` mutation against `/api/editorial-calendars/:id/distribution-plan`:
  - `mutate(undefined)` → preview (no plan) → returns `schedule[]`, nothing saved.
  - `mutate(distPlanId)` → commit → creates marketing_tasks, `committed:true`.
- Spinner labels disambiguate the shared `isPending` via `planDistribution.variables` (undefined = Building, truthy = Pushing).
- Push button gated on `!distPlanId || !schedule?.length`. Plan picker + Push only render after a preview exists.
- Was previously two toolbar buttons + two disconnected dialogs (the preview dialog told users to "use Push to Planner" but had no such button) — merged into one.

# What "Planner" means here (user asked)
- "Push to Planner" adds tasks to the internal **Marketing Planner** (route `/app/marketing-planner`, `/api/marketing-plans`).
- Those marketing tasks then **sync to Microsoft Planner** automatically via the "Planner two-way sync" scheduled job (every 15 min). So it's a chain: brief → Marketing Planner task → Microsoft Planner.

# Derivative assets from a brief are NOT auto-dated
- Repurposing a brief into multiple formats creates drafts in the backlog (generated_posts for social, content_assets for library), inheriting campaignId/solutionAreaId. They get dates only via the Distribution Planner spread or manual drag. "Ebook" is not a real repurpose format (whitepaper is the stand-in).
