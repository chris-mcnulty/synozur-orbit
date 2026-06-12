---
name: Campaign interview "Plan outputs" expand legs
description: How the interview Plan step splits into doc-brief vs social-post backend legs, and the idempotency trap on retry.
---

# Campaign interview Plan step — two expand legs

The campaign content interview's "Plan outputs" step fans a kept concept out to
two **separate, non-idempotent** backend calls:

- `POST /api/campaign-interview/:campaignId/expand-plan` → document briefs (Word-doc formats).
- `POST /api/campaign-interview/:campaignId/expand-social` → real schedulable `generatedPosts`,
  one row per channel per scheduled date (LinkedIn/twitter/facebook/instagram). These are
  NOT doc drafts and need no draft→repurpose round trip; they land status=draft, postFormat=single.

Social doc formats (`linkedin_post`, `x_post`) are deliberately hidden from the document-format
checkboxes in this step — channel picker owns them. `newsletter` stays under docs (it's "Email").

**Why the idempotency trap:** the client calls expand-plan then expand-social sequentially. If
the first succeeds and the second throws, a naive retry re-runs BOTH and duplicates the briefs.
Fix in place: client remembers each leg's result in a ref and skips a leg whose ref is already
set; refs reset when entering Step 2 or clicking Back to re-edit. `expand-social` returns
`failedConceptIds` for per-concept partial failures (Promise.allSettled) — surface it, don't drop it.

**How to apply:** any new "expand" leg added here must either be idempotent server-side or be
guarded by the same per-leg success tracking, and partial-failure ids must be shown to the user.
