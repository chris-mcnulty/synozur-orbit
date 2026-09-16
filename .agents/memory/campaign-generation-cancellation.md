---
name: Campaign generation cancellation
description: Reliability rules for long-running campaign post generation and timeout recovery.
---

Campaign post generation may use a longer deadline than the global analysis queue, but whole-job retries must remain disabled because generation can create duplicate drafts and tracked links.

**Why:** AI calls can finish after the queue deadline. A pre-write abort check alone is insufficient: timeout can occur during a database write or transaction commit, leaving a failed job with late-created posts or links.

**How to apply:** Pass the queue abort signal through every AI and persistence boundary. Commit tracked links, generated posts, and completion status atomically; check cancellation after awaited writes and after commit; if cancellation races commit, compensate using the exact generation job identity and exact created link identities.