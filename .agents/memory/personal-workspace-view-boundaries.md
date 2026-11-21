---
name: Personal workspace view boundaries
description: Product scope for saved workspace preferences versus audience definitions and action state.
---
Saved workspace views are personal browser-local filter/sort preferences for the first release, not marketing contact audience segments.

**Why:** The user explicitly separated resuming a working context from defining a reusable sending audience. Reusing audience segments for this feature would change that product boundary.

**How to apply:** Keep view preferences client-only unless a later request explicitly expands storage scope. Never include selections, dialogs, editor content, drafts, revealed contacts, or action-execution state. Explicit URL filters and item links remain authoritative; browser preferences are never authorization.
