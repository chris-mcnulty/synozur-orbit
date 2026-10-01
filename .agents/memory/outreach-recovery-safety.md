---
name: Outreach recovery safety
description: Historical outreach recovery must not restart sending or infer current consent.
---

Restore historical outreach as held data, not as permission to resume sending. Preserve historical sent entries, but require review of unsent messages, cadence activity, and current contact consent.

**Why:** A historical backup cannot establish whether someone opted out later. A recovery intended to restore missing records must not unintentionally send old invitations or resume expired campaigns.

**How to apply:** Validate tenant-scoped recovery in rollback-only temporary tables, preserve original membership/history IDs, fail rather than overwrite existing tenant data, and keep private recovery payloads out of version control. Check all delivery paths; holding a scheduled timestamp alone is not a complete send hold.

Recovery validation must copy real supporting-table schemas rather than invent simplified ones.

**Why:** A dry run using an invented market schema passed a tenant-ownership check that then failed in production. A passing fixture test cannot establish production schema compatibility.

**How to apply:** Inspect production column metadata, use real-schema TEMP table copies for supporting joins, and verify ownership through the actual tenant relationship. When the SQL console requires automatic batch transactions, omit only top-level transaction delimiters and execute the entire recovery as one batch.

Treat a SQL console crash as an unknown transaction outcome, not proof of rollback.

**Why:** The console reported a generic failure and crashed even though the recovery committed successfully.

**How to apply:** Before retrying any recovery after a console failure, read production counts, linkage, and send-hold invariants independently. Do not infer database failure from the browser result.