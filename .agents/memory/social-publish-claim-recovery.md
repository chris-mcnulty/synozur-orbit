---
name: Social publish claim recovery
description: Safety rule for overlapping, expired, and uncertain social provider calls.
---

An expired social publish claim must be terminalized as an outcome-unknown failure for explicit review. Never let the request that discovers expiry immediately acquire the post and call the provider again.

**Why:** A provider request can still complete after its database lease expires. Stealing the expired claim and automatically retrying can create a duplicate post, and a database failure after confirmed provider success must never re-enter automatic retry.

**How to apply:** Acquire durable owner-token claims atomically before provider calls; guard all post success/failure writes by owner and token; sweep expired claims independently of current publish eligibility; isolate post-provider persistence errors from retryable provider failures.