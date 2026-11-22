---
name: Context-switch action isolation
description: Drafts and queued requests must not migrate between tenant or market contexts.
---

Context-bound workspaces must observe context changes at the component that owns their lifecycle, discard local action state on a switch, and reject queued requests from an old scope before request headers are captured.

**Why:** Reading session storage to calculate a remount key does not subscribe the parent to changes. Child query refreshes cannot update that parent's key, while automatic API headers immediately follow the newly selected context. An old create draft can otherwise be saved into another authorized workspace.

**How to apply:** Use the existing tab-context external-store notification mechanism for lifecycle boundaries. Test switching with real context setters, without manually rerendering; include queued mutations and responses that arrive after a switch. Query-key separation alone does not protect draft state.
