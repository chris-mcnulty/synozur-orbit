---
name: HubSpot full-refresh job recovery
description: Safety rules for long-running, operator-triggered HubSpot population imports.
---

Full HubSpot population imports must persist a page cursor and cumulative counts after every completed page, resume incomplete work at startup, use a per-tenant claim lock, and use conditional stale-state transitions. A worker must only claim a pending job atomically and must verify its persisted lease before requesting or merging more contacts.

**Why:** An in-memory queue can delay or lose work on restart. Non-atomic status checks can launch duplicate CRM scans or allow an old worker to overwrite a later failure/completion state.

**How to apply:** Persist the next cursor and cumulative counts after every page, requeue pending/running rows during startup, make cancellation observable between work units, and predicate cleanup updates on the still-current status and stale timestamp/heartbeat. Keep full-refresh controls distinct from bounded enrichment and normal integration syncs.