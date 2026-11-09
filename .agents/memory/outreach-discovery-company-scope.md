---
name: Outreach discovery company scope
description: Distinguish an explicit one-company search restriction from campaign named-account seeds.
---

An explicit company filter in prospect discovery is a restriction for that search, not a request to find similar companies or change campaign targeting. Keep the existing campaign named-account seed behavior separate.

**Why:** Sellers need to add one known person with as little as an email and discover other prospects at a chosen company without changing the campaign's broader audience. Treating that company as a similarity seed would return unrelated employers.

**How to apply:** Preserve the company restriction across discovery providers and fallbacks. Do not infer a person's employer from their email domain, or turn an email-only contact into an invented personal name.
