---
name: Weekly briefing market isolation
description: The market-scoping contract for automatic intelligence briefing generation and delivery.
---

Automatic intelligence briefings must always resolve exactly one active, tenant-owned market with a baseline profile before loading signals, generating content, persisting a record, or emailing recipients. An absent, mismatched, foreign, archived, or baseline-less market is a fail-closed condition: do not generate or deliver a tenant-wide fallback.

**Why:** A shared internal tenant can contain multiple customer markets. Tenant-wide competitor and signal queries produced emails that mixed unrelated customer intelligence under the internal baseline.

**How to apply:** Keep one canonical market scope through activities, competitors, baseline, news, persistence, notifications, and email labels. Legacy digest preferences have no per-user market, so only the tenant's explicit default market is eligible; suppress delivery if it cannot be resolved or generation fails.