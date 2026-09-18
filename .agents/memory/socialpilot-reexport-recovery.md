---
name: SocialPilot bulk re-export recovery
description: Safety rules for correcting large batches already delivered to an external scheduler.
---

Bulk re-export recovery must preserve post copy, force recovered rows to CSV-only delivery, refresh source-inherited images while preserving explicit brand overrides, and scope scheduling to the exact recovered IDs.

**Why:** Resetting delivered posts to approved without CSV ownership can make Orbit publish them directly. Browser fan-out scheduling can partially update a 100+ post batch, and an unscoped scheduler can alter unrelated campaign drafts.

**How to apply:** Prepare and schedule on tenant-owned campaign endpoints. Clear stale dates, preserve future dates, generate only future slots, apply the recovered schedule transactionally, and return directly to Export Review.