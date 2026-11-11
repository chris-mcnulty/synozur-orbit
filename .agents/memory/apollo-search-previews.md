---
name: Apollo search preview contract
description: Why Apollo search results are not full contact identities and cannot require employer IDs.
---

Treat Apollo People API Search as discovery previews, not enriched contact records. Its documented response can contain only a first name, an obfuscated surname, and a current-employer name without an employer ID.

**Why:** Production searches returned nonempty people results while Orbit reported no matches because its employer-ID gate discarded name-only employer metadata. Even after resolving employer scope, masked surnames cannot become genuine, importable contact names.

**How to apply:** Preserve employer-ID restrictions on requests. Check exact normalized current-employer identity against the resolved employer when the response omits the ID; reject a conflicting explicit ID or domain. Never fabricate names from obfuscated surnames or infer employers from email. Distinguish matching previews from no matches in the UI and diagnostics.

Revealing identities requires the separate enrichment API and may consume Apollo credits. Do not add automatic credit-consuming enrichment as if it were a free search-contract fix; obtain approval for that behavior and define a bounded budget first.

**Why:** The user has explicitly said they can use Wiza and Sales Navigator externally if Apollo has nothing. Search preview availability does not authorize an unannounced paid reveal workflow.

**How to apply:** Keep web fallback available and truthful without issuing enrichment calls implicitly. The user approved a **reviewed reveal step**, not automatic reveals: explicit person selection and a credit-use confirmation precede enrichment, and import remains a separate decision. This approval does not authorize live paid verification calls during development.

See Apollo's official contract: https://docs.apollo.io/reference/people-api-search.
