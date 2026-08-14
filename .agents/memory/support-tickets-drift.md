---
name: support_tickets DB drift
description: Live support_tickets table diverged from shared/schema.ts (tenant_id vs tenant_domain)
---
The production/dev DB's `support_tickets` table has `tenant_id`, `metadata`, `application_source`, `resolved_at`, `resolved_by` — not the `tenant_domain` shape declared in shared/schema.ts. It was altered outside the migration runner (possibly shared with another app).

**Why:** any Drizzle query on `supportTickets.tenantDomain` fails with "column tenant_domain does not exist"; migration 0085 had to guard its index on whichever tenant column exists.

**How to apply:** before touching support-ticket code or writing migrations against it, check the live table shape first (`\d support_tickets`); don't trust schema.ts for this table until the drift is reconciled.
