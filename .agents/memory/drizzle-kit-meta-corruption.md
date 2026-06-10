---
name: drizzle-kit meta journal corruption
description: Why `npm run db:generate` fails with a snapshot collision, and how to add migrations anyway.
---

`npm run db:generate` (drizzle-kit) fails with errors like
`migrations/meta/0018_snapshot.json ... pointing to a parent snapshot ... collision`.

**Why:** The `migrations/meta/_journal.json` + snapshot set is corrupted from prior
parallel task merges — the journal has far fewer entries than there are `.sql` files
and the tags are out of order (e.g. idx 15-17 are tags 0028-0031, then idx 18-19 are
0018-0019). drizzle-kit refuses to generate against this broken meta.

**How to apply:** Do NOT try to repair the meta to use `db:generate`. The runtime
migration runner (`server/db-migrate.ts`) is custom and **ignores** drizzle-kit's
meta journal entirely — it reads every `migrations/*.sql` file in lexicographic
order, applies via a `_migrations` ledger (filename + SHA-256 checksum), and is
idempotent against duplicate-object SQLSTATE codes. So to add a column/table:
edit `shared/schema.ts`, then hand-write the next `NNNN_name.sql` migration file
(use `ADD COLUMN IF NOT EXISTS`), and the runner applies it on boot. Verify with a
direct `psql` query against information_schema, not via drizzle-kit.
