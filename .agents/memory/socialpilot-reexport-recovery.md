---
name: SocialPilot bulk re-export recovery
description: Safety rules for correcting large batches already delivered to an external scheduler.
---

Bulk re-export recovery must preserve post copy, force recovered rows to CSV-only delivery, refresh source-inherited images while preserving explicit brand overrides, and scope scheduling to the exact recovered IDs.

**Why:** Resetting delivered posts to approved without CSV ownership can make Orbit publish them directly. Browser fan-out scheduling can partially update a 100+ post batch, and an unscoped scheduler can alter unrelated campaign drafts.

CSV media URLs must also be anonymous absolute production URLs. Private `/objects/...` paths must be copied to public object storage during export and emitted through `/public-objects/...`; merely adding a hostname still leaves them authentication-gated.

**How to apply:** Prepare and schedule on tenant-owned campaign endpoints. Clear stale dates, preserve future dates, generate only future slots, apply the recovered schedule transactionally, return directly to Export Review, and validate exported media URLs as an unauthenticated client.

Event exports must transfer selected approved posts to CSV-only ownership before building/downloading the file; the automatic publisher must recheck that ownership when claiming a post, not just when selecting candidates. Ordinary approval must not silently restore automatic ownership.

**Why:** The user splits event promotion across automatic publishing and external schedulers. An event CSV download previously left posts in the pending automatic queue, risking duplicate sends. A worker can retain an older candidate snapshot during the handoff.

**How to apply:** Scope the handoff by tenant, market, events, accounts, and exact post IDs; block claimed sends. Distinguish export-only/import-pending from confirmed external delivery. A failed download stays CSV-only until explicitly resolved; never auto-release it to the native publisher.