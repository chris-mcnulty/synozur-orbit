---
name: Observatory leakage on shared GitHub remote
description: The Observatory Repl shares the synozur-orbit GitHub remote; its commits contaminate Orbit's main branch and require force-push to remove.
---

# Observatory leakage on shared GitHub remote

## The rule
When `origin/main` contains Observatory commits (pen-test workbench, VPAT, accessibility scanner, readiness engine), those are leakage from the separate Observatory Repl — not real Orbit work. Force-push local Orbit main to replace them.

**Why:** The Observatory Repl is configured with the same `github.com/chris-mcnulty/synozur-orbit` remote. Observatory was explicitly removed from Orbit (all obs_* tables dropped). Any re-appearance of Observatory code on origin/main is leakage. Enable branch protection on `main` to prevent recurrence.

**How to apply:** Before pushing, spot-check `git log --oneline origin/main | head -10` for "Observatory", "VPAT", "pen test", "accessibility scanner". If present, verify local main is the correct Orbit codebase then force-push.

## Workflow email compliance rule
Workflow `send_email` steps must use `workflowRecipients` (not `testRecipient`) when calling `dispatchEmailSend`. The `testRecipient` path bypasses emailOptOut, HubSpot-consent, and global-suppression checks — making it a compliance risk for production contact sends.

**Why:** `testRecipient` was designed for preview-only sends to the sender themselves. Using it for enrolled contacts meant opted-out contacts could receive marketing email.

**How to apply:** Always pass `workflowRecipients: [{ email, name }]` for workflow single-contact sends; never `testRecipient`.
