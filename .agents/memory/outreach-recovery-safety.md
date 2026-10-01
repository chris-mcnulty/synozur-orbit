---
name: Outreach recovery safety
description: Historical outreach recovery must not restart sending or infer current consent.
---

Restore historical outreach as held data, not as permission to resume sending. Preserve historical sent entries, but require review of unsent messages, cadence activity, and current contact consent.

**Why:** A historical backup cannot establish whether someone opted out later. A recovery intended to restore missing records must not unintentionally send old invitations or resume expired campaigns.

**How to apply:** Validate tenant-scoped recovery in rollback-only temporary tables, preserve original membership/history IDs, fail rather than overwrite existing tenant data, and keep private recovery payloads out of version control. Check all delivery paths; holding a scheduled timestamp alone is not a complete send hold.