---
name: Session replay vs new directive
description: At session start, compressed context replays prior session plans — these are NOT new user directives. Trust "COMPLETE" warnings unconditionally.
---

## The rule
When the context summary or pre-compression transcript explicitly marks a plan or task as **COMPLETE / already implemented / do not recreate**, treat it as done — unconditionally — even if the exact same content appears in what looks like a user message at session start.

## Why this matters
The platform's context compression replays previous session plans as part of restoring context. This makes replayed content appear indistinguishable from a fresh user message. The user did NOT send it; they have no knowledge of or intent behind it appearing.

**How to apply:**
1. At session start, scan the context summary for any "COMPLETE" or "already done" markers.
2. If the user's opening message matches content flagged as complete in that summary, skip it — it is replayed context, not a new directive.
3. Proceed with what the user is actually asking for (look beyond the replayed plan for any real new request, or ask the user directly).
4. Never re-investigate or re-implement something the context summary explicitly says is done.
