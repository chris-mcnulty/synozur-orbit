---
name: Social provider identity consolidation
description: Durable rules for reconnecting or recreating social accounts without duplicating identities or stranding campaign work.
---

Treat the provider's stable identity—not the Orbit row ID or display name—as the canonical social account. For LinkedIn, the selected organization/page URN is authoritative; never infer page sameness from a shared human administrator. A reconnect must preserve the selected page when access remains available, or fail clearly rather than silently switching pages.

When exact duplicate provider identities are consolidated, move pending posts and campaign associations to one canonical connection, but leave published/exported history on the row that actually performed the action. Retired replacement rows must not remain selectable. Explicitly assigning a campaign post may repair its missing campaign association, but must not enable automatic publishing for the rest of the campaign.

**Why:** Delete/recreate and reconnect cycles once split one X user and one LinkedIn page across several rows, scattering campaign links and pending posts while showing duplicate choices. Name-based or administrator-based guessing can also merge genuinely different pages.

**How to apply:** Use exact provider IDs/URNs for all recovery and deduplication paths, preserve historical audit ownership, require an active canonical connection for publishing, and keep campaign-link repair idempotent with automatic publishing off unless the user explicitly enables it.

A missing LinkedIn publishing author may be recovered from the verified member URN only when the saved destination mode is explicitly personal. Never fall back from a company page to its human administrator. Reconnect must preserve a legacy personal selection even if newly discovered company pages are available.

**Why:** Posting-only OAuth can provide the member identity through ACL roleAssignee while omitting company pages. Treating only pages as publishing authors stranded otherwise valid personal connections; selecting the first page on reconnect would also change the intended destination.

**How to apply:** Distinguish the credential owner from the chosen publishing destination. Use verified member URNs, not display names or profile URLs, and leave missing organization identities as explicit failures.