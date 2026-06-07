---
name: Event Promotion social-account scoping
description: Why the conference/Event Promotion account list must stay market-scoped, never tenant-wide
---

# Event Promotion social-account scoping

The Event Promotion (conference) account selector must list social accounts scoped to the **event's own market**, never tenant-wide across markets.

**Why:** In this product a *market* represents a distinct client/brand (e.g. Adobe, Microsoft, Willows Lodge all live under one tenant). One client's event must never be able to publish to another client's connected social accounts. Tenant-only scoping (filtering by `tenantDomain` but not `marketId`) crosses that client boundary even though it stays inside the tenant.

**How to apply:**
- `loadConference` enforces `conference.marketId == activeContext.marketId`, so the conference detail page only loads when the active market equals the conference's market. Therefore the standard market-scoped `GET /api/social-accounts` (filters by active `marketId`) is already correctly scoped to the event's own market — do not "fix" it to be tenant-wide.
- If an event's account list is empty, the cause is almost always that the event was created in the wrong market (one with no connected accounts), not a scoping bug. Fix the data (move the conference's `market_id`), not the query.
- `generateConferencePostsAsync` validates selected accounts by `tenantDomain` only; the real boundary is enforced upstream by the market-scoped list + `loadConference`.
