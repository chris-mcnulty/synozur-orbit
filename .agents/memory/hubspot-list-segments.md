---
name: External-list send audiences
description: Safety invariants when mirroring an external (e.g. HubSpot) list into a send audience
---
- Externally-mirrored segments are INBOUND only: never push their membership back to the external system, and never rule-evaluate them.
- Every send-audience type must be supported by both normal delivery resolution and the A/B cohort snapshot at dispatch. Cohort membership is immutable after dispatch; eligibility is not — suppression/opt-out checks must re-run at every delivery.
- Never return a silently truncated external audience: reject oversized lists and non-terminating pagination explicitly.

**Why:** each violation misdelivers commercial email, omits recipients, or corrupts the customer's external list with no visible error.
