---
name: Global Synozur-owned social OAuth apps (no per-tenant apps)
description: X/Facebook/Instagram (and LinkedIn) use ONE shared Synozur OAuth app each; tenants never register their own. Per-tenant credentials are retired.
---

# One shared app per platform (Buffer/Hootsuite model)

Tenants do NOT bring their own OAuth app. Expecting every tenant to register +
get app-review approval for their own X / Facebook / Instagram app is a SaaS
antipattern that doesn't happen. There is one Synozur-owned OAuth app per
platform; tenants click Connect on Social Accounts, log into their own account,
and a per-account token is stored tenant-scoped. **Tenant isolation is intact:**
the shared app is just the client_id/client_secret; connected accounts + tokens
live in `social_accounts` (tenant_domain scoped). No tenant sees another's.

# Where credentials live

- **twitter / facebook** → `global_platform_credentials` table (singleton per
  platform, unique `platform`), encrypted at rest. Managed by a **Global Admin**
  at `/app/admin/platform-credentials` (routes in `server/routes/admin.ts`,
  `/api/admin/platform-credentials`). NOT env vars, NOT per-tenant.
- **instagram** → rides on the Facebook/Meta app; no separate row. Publishers
  call `getPlatformCredentials(tenant, "facebook")` for it.
- **linkedin** → unchanged: still resolves from `LINKEDIN_CLIENT_ID` /
  `LINKEDIN_CLIENT_SECRET` env vars + `LINKEDIN_DIRECT_PUBLISH_ENABLED` gate.

`getPlatformCredentials(tenantDomain, platform)` ignores tenantDomain now
(kept for signature compat) and resolves from the global store/env.

# Posting gate

`isDirectPublishEnabled(platform)` (in `platform-credentials-service.ts`) is the
safety switch. For twitter/facebook it reads the `direct_publish_enabled` column
(a Global Admin toggles it in the UI once Meta/X approve posting scopes — no env
var, no redeploy). For linkedin it delegates to the env-var gate. Each
publisher's `oauthConfigured()` checks this before reporting configured.

# Retired

Per-tenant page (`client/.../marketing/platform-credentials.tsx`), the
`/api/tenant/platform-credentials` routes, and the per-tenant service fns were
removed. `tenant_platform_credentials` table + `PLATFORM_CREDENTIAL_PLATFORMS`
are left in schema (no destructive migration) but marked DEPRECATED — nothing
reads/writes them. Migration: `migrations/0051_global_platform_credentials.sql`.
