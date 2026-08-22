---
name: LinkedIn page-access checks
description: Prevent LinkedIn ACL health checks from incorrectly hiding a newly reconnected company-page account.
---

A successful LinkedIn OAuth callback that includes the selected organization page is stronger evidence than one later conflicting organization-ACL response. Preserve the usable connection after the first discrepancy, refresh the cached authors from that response, and require a later independent mismatch—or a real publishing failure—before moving the account to `needs_reconnect`.

**Why:** A one-off ACL response marked a freshly authorized company-page account as disconnected, hiding it from post editors and stranding pending work despite a usable token and recent authorization.

**How to apply:** Treat the saved selected author in `availableAuthors` as the first-confirmation marker. The account settings view must include `needs_reconnect` rows so the user can reach the same record's reconnect action; keep retired inactive duplicates hidden by default.