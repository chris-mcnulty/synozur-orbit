---
name: Apollo person_titles must be atomic
description: ICP persona.role is a free-text sentence; must be split before passing to Apollo person_titles or searches return zero results
---

## The rule
Apollo's `person_titles` filter does fuzzy matching against actual LinkedIn job titles. Each entry must be an atomic title keyword (e.g. "CTO", "Chief Investment Officer"). ICP persona `role` fields are written as combined English sentences like "CTO, Chief Investment Officer, or COO at a private equity firm managing $1B+ AUM" — passing that as a single `person_titles` entry returns zero results because nobody has that as their literal title.

**Why:** Confirmed from production logs — Apollo returned `{"total_entries":0,"people":[]}` with the combined sentence. After splitting into ["CTO", "Chief Investment Officer", "COO"] the search finds real people.

## How to apply
`normalizePersonTitles()` in `apollo-discovery-provider.ts` handles this:
1. Splits on `, ` / ` or ` / ` / ` / ` | ` separators
2. Strips trailing qualifiers: "at a ...", "for ...", "managing ...", "overseeing ...", "within ...", etc.
3. Dedupes case-insensitively, caps at 10 (Apollo API limit)

Called in `searchApollo()` before building `person_titles`: `const titles = normalizePersonTitles(criteria.roles)`.

## AUM ≠ headcount (second issue)
`segmentsToEmployeeRanges()` mapped "Enterprise $1B+ AUM" → `["1001,10000","10001,1000000"]` which excluded boutique PE firms (Silver Lake ~400, Thoma Bravo ~150, Berkshire Partners ~60). Fix: skip segments matching `/\$[\d.]+[mb]|\baum\b|\brevenue\b|\bfund\b/i`.

Additionally, when `namedAccounts` are provided, `organization_num_employees_ranges` is skipped entirely — the firm list already scopes the search and headcount ranges add false precision.
