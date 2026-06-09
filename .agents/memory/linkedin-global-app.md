---
name: LinkedIn global OAuth app + posting gate
description: LinkedIn uses one shared Synozur app (not per-tenant), and direct posting is gated until LinkedIn approval.
---

# LinkedIn is the one global-app platform

LinkedIn does NOT use the per-tenant `tenant_platform_credentials` table like
Twitter/Facebook/Instagram. It resolves from a single Synozur-owned OAuth app
via `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` env vars. `getPlatformCredentials("linkedin")`
short-circuits to env; `linkedin` was removed from `PLATFORM_CREDENTIAL_PLATFORMS`.

**Why:** SaaS antipattern to make every tenant register their own LinkedIn app
and wait weeks for Community Management API approval. Buffer/Hootsuite pattern:
customers click Connect, consent, done.

# Direct posting is gated behind approval

Direct posting stays OFF until LinkedIn approves the shared app's posting scopes
(w_member_social, w_organization_social, rw_organization_admin). Gate:
`LINKEDIN_DIRECT_PUBLISH_ENABLED` env var (default off). When off, oauthConfigured/
authorize/publish all refuse with a "pending LinkedIn app review" message, and the
Social Accounts UI shows "coming soon" instead of a Connect button.

**How to apply:** To go live after approval, set `LINKEDIN_DIRECT_PUBLISH_ENABLED=true`
and register prod + dev redirect URIs `<base-url>/api/social-accounts/oauth/callback`
in the LinkedIn app. No code change needed.
