---
name: HubSpot contact sync UX
description: Contact-level HubSpot matching belongs in the normal Contacts workflow; bounded batches must not be presented as full syncs.
---

Marketing and sales share the same contact record, but that does not remove the need for a normal user to resolve a single person against HubSpot. Give a Contacts user an immediate per-contact action that looks up the email, reports match/no-match clearly, and preserves Orbit-owned fields.

**Why:** A daily background enrichment run and a hidden admin batch leave users unable to resolve a person who did not originate in a sales campaign. Calling a capped batch “sync all” is misleading and creates false confidence that every record was considered.

**How to apply:** Keep the per-contact HubSpot action in the contact detail UI and return an explicit outcome. Reserve any bulk “full refresh” language for durable, rate-limit-safe work that processes every eligible record with visible progress; otherwise label the operation as a bounded batch and show its limit and scope.

## Scheduled batch observability

The bounded scheduled enrichment result is distinct from the general CRM “Sync now” result. Retain the most recent batch counts and its own completion time when an operator runs a CRM-only sync, and show batch failure separately from a successful zero-match run.

**Why:** Manual CRM sync does not run the bounded contact batch. Replacing its result would make an older batch appear to have run just now, or hide an important failure.

**How to apply:** Keep scheduled contact-batch status as structured metadata alongside primary CRM stats. Preserve it across CRM-only syncs, and render the batch timestamp plus examined/matched/updated/skipped/failed outcomes independently.