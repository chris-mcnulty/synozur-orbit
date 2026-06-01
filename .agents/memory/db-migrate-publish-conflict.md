---
name: Startup migration runner vs Replit Publish-flow schema diff
description: Why Orbit deploys can fail at the promote/health-check step, and how the startup migration runner must stay idempotent.
---

# Startup migrations conflict with Replit's Publish-flow schema diff

Orbit runs a custom startup migration runner (`server/db-migrate.ts`, called from
`server/index.ts` before `httpServer.listen`). Replit's managed-Postgres Publish
flow ALSO diffs the dev schema against production and applies the change
out-of-band when the user clicks Publish.

**The failure mode:** Publish applies a new migration's objects (columns,
constraints, indexes) to prod, but does NOT update the app's `_migrations`
ledger. On the next deploy the startup runner sees that migration missing from
the ledger, re-runs its `ALTER TABLE … ADD COLUMN …` / `ADD CONSTRAINT` /
`CREATE INDEX`, Postgres throws "already exists", `runMigrations` throws.

**Why it surfaces as a silent deploy failure:** `server/index.ts` installs
`uncaughtException`/`unhandledRejection` handlers that only log ("keeping alive")
and do NOT exit. So the thrown migration error is swallowed, `listen` is never
reached, idle pg connections drain, and the process exits **code 0** with no
"serving on port". Build phase succeeds; the **promote/health-check** step fails
because the autoscale startup probe (`GET /`) never gets a 200. Symptom in logs:
migrations run → `command finished successfully with exit code 0` / `main done,
exiting`, repeated. Works fine locally because the dev DB already has the
migration in its ledger (skipped).

**The fix:** make `applyMigration` idempotent — run each statement inside a
SAVEPOINT and treat duplicate-object SQLSTATEs (42701, 42P07, 42710, 42P06,
42723) as benign (skip + still stamp the file). Chunks with `$$` dollar-quoted
blocks are kept whole; everything else is split on `;` (after stripping `--`
comments) so individual statements can be skipped.

**Why:** the runner and Publish flow both apply prod schema, so the runner must
tolerate schema already present.

**How to apply / diagnose:** if a deploy fails to publish and runtime logs show
migrate-then-clean-exit with no "serving on port", query the prod ledger
read-only (`SELECT filename FROM _migrations`) and compare against
`migrations/*.sql`; check whether the missing migration's objects already exist
in prod (`information_schema.columns`, `pg_constraint`). The agent CANNOT write
to prod (read-only) — the fix ships in code and takes effect on the next Publish.
Note: the silent exit-0 is worsened by the keep-alive process handlers masking
fatal startup errors.
