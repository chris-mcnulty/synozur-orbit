---
name: Outreach discovery company scope
description: Distinguish an explicit one-company search restriction from campaign named-account seeds.
---

An explicit company filter in prospect discovery is a restriction for that search, not a request to find similar companies or change campaign targeting. Keep the existing campaign named-account seed behavior separate.

**Why:** Sellers need to add one known person with as little as an email and discover other prospects at a chosen company without changing the campaign's broader audience. Treating that company as a similarity seed would return unrelated employers.

**How to apply:** Preserve the company restriction across discovery providers and fallbacks. Do not infer a person's employer from their email domain, or turn an email-only contact into an invented personal name.

When a company-restricted search returns no matches, relax industry keywords and title wording within that same employer before giving up. Preserve the employer restriction, geography, and hard exclusions; a fallback must not broaden to similar companies.

**Why:** Persona industry prose can exclude a known suitable employer, and exact job titles miss equivalent practice or alliance leadership roles. Zero search results do not establish that the company has no relevant people or that event attendance was checked.

**How to apply:** Use bounded retries with the resolved employer IDs on every request. Keep original campaign criteria for scoring and review rather than rewriting campaign targeting. Web fallback may interpret role wording more broadly but must retain the same company boundary.
