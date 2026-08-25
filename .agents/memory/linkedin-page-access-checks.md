---
name: LinkedIn page-access checks
description: Prevent LinkedIn ACL health checks from incorrectly hiding a newly reconnected company-page account.
---

A successful LinkedIn OAuth callback that includes the selected organization page is stronger evidence than a conflicting organization-ACL response. The ACL finder is paginated and can repeatedly omit valid pages, so absence is advisory—not authoritative. Enumerate all pages, deduplicate organizations, preserve known authors, and move an account to `needs_reconnect` only after an actual organization-post rejection (or a definitive token failure).

**Why:** Repeated successful ACL responses omitted a page whose owner remained a full admin, falsely disconnecting the account and then blocking reconnect. The same API had previously returned that page for the same credential.

**How to apply:** On reconnect, an omitted selected page may be preserved only when the old and fresh OAuth grants expose the same immutable LinkedIn `roleAssignee` person URN; otherwise fail closed. Explicitly project `roleAssignee`. The settings view must include `needs_reconnect` rows while hiding retired inactive duplicates.