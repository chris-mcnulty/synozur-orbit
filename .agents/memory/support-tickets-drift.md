---
name: support_tickets tenant scope
description: Durable decisions - tenant scoping for support_tickets and migration-runner rules learned during the drift fix.
---

# support_tickets tenant scope

Tickets are tenant-scoped by `tenant_domain` (text) with **no FK to tenants(id)**.
**Why:** the whole app keys tenant scope by domain string; an id-keyed FK (from an external writer) broke every ticket query.
**How to apply:** never reintroduce a tenants(id) FK here; new ticket queries filter on tenant_domain.

# Migration runner rules (learned the hard way)

- Never edit a migration file after any environment applied it — the checksum ledger aborts startup. Put fixes in a new migration. Auto-checkpoint commits can capture your edit, so restore "original" files from the base branch commit, not HEAD.
- First-boot backfill stamps alter-only/DO-block migrations without running them; a reconciliation migration must carry the `-- backfill:always-apply` marker (and be idempotent) to actually execute.
- `pg_get_serial_sequence()` still returns the owned sequence after `DROP DEFAULT` — detect a missing serial default via `information_schema.columns.column_default IS NULL`, not sequence ownership.
