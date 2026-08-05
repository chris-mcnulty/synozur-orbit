---
name: Observatory removed from Orbit
description: Observatory (application assurance) was split into its own product; Orbit must stay Observatory-free.
---
Observatory is a separate app (separate Repl + its own GitHub repo) for a different user base. All of its code, routes, pages, scanners, and obs_* tables were removed from Orbit; migration 0076 drops the tables (historic 0070–0074 obs migrations remain as files only).

**Why:** Observatory code leaked into this repo because a remixed Repl pushed to the same GitHub remote. The workspace and `main` diverged into two lineages; resolved via a single 3-way merge (kept main's crawl/email/segmentation subsystems, kept Observatory removal).

**How to apply:** If observatory/obs_* references reappear (e.g. via a bad pull/merge), treat them as leakage and remove them. When git lineages diverge massively, prefer one 3-way merge over replaying a stalled rebase pick-by-pick — then restore any "deleted by ours, needed by theirs" files the merge silently drops (check imports).
