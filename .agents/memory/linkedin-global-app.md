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

# Direct posting is LIVE (approval received June 2026)

`LINKEDIN_DIRECT_PUBLISH_ENABLED=true` is set in the shared environment.
The Connect button and OAuth flow are active. Redirect URIs registered in
the LinkedIn Developer Portal:
- Production: `https://orbit.synozur.com/api/social-accounts/oauth/callback`
- Dev: `https://4bc92ae4-16a8-4580-8f70-f19fac0c101f-00-3oqudcz68oh09.riker.replit.dev/api/social-accounts/oauth/callback`

**How to apply:** Gate is `isLinkedInDirectPublishEnabled()` in `platform-credentials-service.ts`.
To turn off, delete the env var or set it to anything other than "true".
