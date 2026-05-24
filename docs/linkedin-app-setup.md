# LinkedIn Developer App Setup Guide

## Overview

Synozur Orbit posts to LinkedIn via a **single Synozur-owned LinkedIn Developer App** shared across every tenant — the standard SaaS model used by Buffer, Hootsuite, and Sprout. Customers never register their own LinkedIn app; they click "Connect LinkedIn" on the Social Accounts page, sign in to LinkedIn, and the OAuth flow runs against the Synozur app.

This guide is the one-time setup for that single Synozur app. Plan on ~30 minutes of clicking plus 1–4 weeks waiting for LinkedIn's manual review of the gated scopes.

| Scope | Who does it | Frequency |
|-------|-------------|-----------|
| **Platform-level** | Synozur (LinkedIn page admin) | Once — never repeated |
| **Per-customer** | Customer end users | Self-serve via "Connect LinkedIn" button |

---

## Part A — Prerequisites

1. **Synozur LinkedIn Company Page must exist.** LinkedIn requires every Developer App to be associated with a Company Page; personal accounts can't own apps. Confirm at https://www.linkedin.com/company/synozur/admin/ that you have "Super admin" role on the page.
2. **Privacy policy on synozur.com must be live and reachable**, with a LinkedIn-specific section (see Part E below). LinkedIn fetches this URL during review — a 404 or generic policy is the #1 rejection reason.
3. **Use a durable owner account.** Recommend logging in to LinkedIn as a shared mailbox account (`it@synozur.com` or `marketing@synozur.com`) rather than a personal account, so the app survives staff changes.

---

## Part B — Create the App

1. Go to https://www.linkedin.com/developers/apps/new
2. Fill out:

| Field | Value |
|-------|-------|
| App name | `Synozur Orbit` |
| LinkedIn Page | Synozur Company Page |
| Privacy policy URL | `https://synozur.com/privacy` |
| App logo | Square PNG, ≥100×100, ≤4MB — Synozur logo |

3. Agree to the API Terms of Service. Click **Create app**.

### B.1 — Verify the app with the Company Page

1. On the new app's page → **Settings** tab → click **Verify** next to the Company Page.
2. LinkedIn generates a verification URL. Open it in the same browser. Because you're already a page admin, it auto-confirms.

### B.2 — Grab credentials

1. Open the **Auth** tab.
2. Copy the **Client ID** and **Client Secret** into a password manager. The secret can be regenerated but rotating breaks all customer connections, so keep it safe.

### B.3 — Add redirect URLs

Under **Auth → OAuth 2.0 settings → Authorized redirect URLs**, add every environment that needs to OAuth against this app:

- `https://<your-prod-domain>/api/social-accounts/oauth/callback`
- `https://<your-staging-domain>/api/social-accounts/oauth/callback` (if applicable)
- `http://localhost:5000/api/social-accounts/oauth/callback` (for local dev — LinkedIn does accept `http://localhost`)

Save.

---

## Part C — Request Products (this gates the OAuth scopes)

On the **Products** tab, request each of these:

| Product | Scopes granted | Approval time |
|---------|----------------|---------------|
| **Sign In with LinkedIn using OpenID Connect** | `openid` `profile` `email` | Instant |
| **Share on LinkedIn** | `w_member_social` | Instant |
| **Community Management API** | `w_organization_social` `rw_organization_admin` `r_organization_social` | **1–4 weeks manual review** |

Submit the instant ones first to unblock personal-account testing. The Community Management API form is in Part D.

> While Community Management API is in review, customers can still connect personal LinkedIn accounts and publish to their own feed. Only company-page posting is blocked.

---

## Part D — Community Management API Application

The Community Management API request opens a form. Below is the exact copy to paste into each field. Tailor specifics (employee count, customer examples) but keep the structure — vague applications get rejected.

### D.1 — Use Case Selection

Select: **"Manage organization presence on behalf of organizations my customers administer"**

### D.2 — Application Description

```
Synozur Orbit is a multi-tenant B2B marketing platform used by professional
services firms, consultancies, and small-to-mid-market companies to plan,
draft, and publish marketing content. Approximately 150 organizations use
the platform today; each has its own isolated tenant with its own users
and content.

Posting flow:
1. A customer's authorized marketing user creates a draft post inside Orbit,
   using Orbit's AI-assisted writing tools to align the post with their
   brand voice and approved messaging.
2. The user reviews the draft and either publishes immediately or schedules
   it for a future date/time they choose.
3. To publish, Orbit calls the LinkedIn API using an access token obtained
   via standard 3-legged OAuth — the user clicks "Connect LinkedIn",
   authorizes the Synozur Orbit app on LinkedIn's consent screen, and we
   store the resulting access_token encrypted at rest (AES-256-GCM).
4. The user can disconnect the account at any time, which deletes the
   stored token. They can also revoke access from their LinkedIn account
   settings at any time.

Each Orbit user authorizes their own LinkedIn identity. To publish to a
company page, the authorizing user must already be an admin of that page
on LinkedIn — we use organizationAcls to enumerate which pages each
connected user can administer, and only those pages are surfaced as
publishing options. We do not bypass LinkedIn's admin model.

We do not sell, share, or transfer LinkedIn data to any third party. We do
not store member content beyond what the customer themselves created. We
do not read members' inboxes, connections, or feeds — we use only the
scopes required to publish content the user explicitly authored.
```

### D.3 — Demo Video

A screen recording is **required**. Apps submitted without one are auto-rejected. Make a 60–90 second video showing the full OAuth + publish flow:

1. (0:00–0:10) Show the Orbit Social Accounts page; click "Add LinkedIn account".
2. (0:10–0:25) Click "Connect"; show the LinkedIn consent screen clearly — title "Synozur Orbit", logo, requested permissions.
3. (0:25–0:40) Click Allow on LinkedIn; show redirect back to Orbit with account marked Connected.
4. (0:40–1:00) Compose a post in Orbit; click Publish; show the post on LinkedIn (open linkedin.com in a new tab).
5. (1:00–1:20) Return to Orbit; click Disconnect on the account; show the token is removed.

Upload to YouTube as **Unlisted** (not Private — reviewers can't see private videos; not Public — no need). Paste the URL into the form.

### D.4 — Privacy & Compliance URLs

| Field | URL |
|-------|-----|
| Privacy policy | `https://synozur.com/privacy` |
| Terms of service | `https://synozur.com/terms` |
| Data deletion contact | `privacy@synozur.com` (or whatever inbox you monitor) |

Submit. Status changes to "Review in progress". Watch the email associated with the LinkedIn account that owns the app — that's where the approval notice arrives.

---

## Part E — Privacy Policy Addition

Add this section to `https://synozur.com/privacy` before submitting the Community Management API application. Reviewers fetch the URL and grep for "LinkedIn" — if it's not there, expect a rejection.

```markdown
## LinkedIn Integration

When you connect a LinkedIn account to Synozur Orbit, we use LinkedIn's
official API to publish content you authorize. Specifically:

**What we access**
- Your LinkedIn member ID and display name (to identify the account in
  Orbit).
- The list of LinkedIn Pages on which you have administrator role (so
  Orbit can offer them as publishing destinations).
- A LinkedIn-issued OAuth access token, which we use only to publish
  posts you have written and approved within Orbit.

**What we do NOT access**
- Your LinkedIn inbox, direct messages, or notifications.
- Your connections list, follower list, or follower data.
- Your LinkedIn feed or content authored by others.
- Any data about LinkedIn members other than the authenticated user.

**How we store it**
- Access tokens are encrypted at rest using AES-256-GCM. Plaintext tokens
  are never written to disk and never logged.
- Tokens are deleted immediately when you click "Disconnect" in Orbit or
  revoke access from LinkedIn's app permissions page.

**What we share**
- We do not sell, share, transfer, or otherwise disclose LinkedIn-derived
  data to any third party for any purpose.
- We do not use LinkedIn data to train AI models.

**How to revoke**
- Click "Disconnect" on the connected account inside Orbit, OR
- Go to https://www.linkedin.com/psettings/permitted-services and revoke
  "Synozur Orbit" — this invalidates the stored token immediately.

To request deletion of all LinkedIn-derived data, email privacy@synozur.com.
```

---

## Part F — Configure Orbit

Once you have at least the instant-approval products active (Sign In + Share on LinkedIn), add the credentials to Orbit's deployment environment.

### F.1 — Environment Variables

| Variable | Value | Required |
|----------|-------|----------|
| `LINKEDIN_CLIENT_ID` | From Auth tab → Client ID | Yes |
| `LINKEDIN_CLIENT_SECRET` | From Auth tab → Client Secret | Yes |

Set these wherever your other secrets live (Replit Secrets, fly.io secrets, Vercel project env vars, etc. — alongside `DATABASE_URL` and `SESSION_SECRET`). Restart the app.

### F.2 — Verify Configuration

Orbit's `getPlatformCredentials("<any tenant>", "linkedin")` will now resolve to your env-var values. There is no per-tenant LinkedIn row in `tenant_platform_credentials`; LinkedIn is hidden from the tenant-admin Platform Credentials UI by design.

---

## Part G — Smoke Test

1. In Orbit, navigate to **Marketing → Social Accounts → New**, choose platform LinkedIn, give it a name (e.g., "Chris — Personal"), save. The account row exists but has no token yet.
2. Click **Connect**. You should be redirected to `linkedin.com/oauth/v2/authorization?...`.
3. Confirm the consent screen shows:
   - App name: **Synozur Orbit**
   - Logo: **Synozur logo** (not a generic placeholder)
   - Requested permissions: Sign In, share posts on your behalf, etc.
4. Click **Allow**. You should be redirected back to Orbit with the account marked **Connected**.
5. Compose a short test post; publish; verify it appears on your LinkedIn feed.
6. Once Community Management API is approved, click **Refresh company pages** on the account — Synozur's Company Page (and any other pages you admin) should appear in the author dropdown.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Error `LinkedIn integration is not available — LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET env vars are not set` | Env vars missing or app not restarted after setting them | Confirm vars are set in the deployment env; restart. |
| Error `redirect_uri does not match` on consent screen | The redirect URL isn't registered on the LinkedIn app | Add the URL exactly (scheme + host + path + no trailing slash) under Auth → OAuth 2.0 settings. |
| Consent screen shows wrong app name or no logo | Logo upload failed silently | Re-upload logo on the Settings tab (must be ≥100×100 PNG). Wait ~5 min for CDN refresh. |
| Personal posting works but company pages don't appear | Community Management API not yet approved, OR user isn't a page admin | Check the Products tab for approval status. Confirm the user has Super admin / Content admin on the target page. |
| `unauthorized_scope_error` during OAuth | Requested scope not granted to the app | Either remove the scope from `DEFAULT_SCOPE` in `server/services/social-publishers/linkedin.ts`, or wait for product approval that includes it. |
| Token works for hours then stops | LinkedIn access tokens expire after 60 days; refresh tokens after 365 | Have the user click Reconnect. (Refresh token flow is on the roadmap.) |

---

## Common Rejection Reasons for the Community Management API Application

Pre-empt these before submitting:

1. **No demo video** or a video that doesn't clearly show the OAuth consent screen → auto-rejected.
2. **Privacy policy doesn't mention LinkedIn by name** → rejected. Add the section from Part E.
3. **App logo is a generic placeholder** → flagged. Use the real Synozur logo.
4. **Use-case description says only "marketing automation"** without specifying the user-initiated, opted-in nature → flagged as spam risk. Use the description in Part D.2.
5. **Privacy policy URL returns 404, redirects, or requires login** → rejected. Test the URL in an incognito window before submitting.

---

## Reference

- LinkedIn Developer Portal: https://www.linkedin.com/developers/apps
- Community Management API docs: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/
- OAuth 2.0 flow reference: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
- UGC Posts API (the one Orbit uses): https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/ugc-post-api
- Code in this repo: `server/services/social-publishers/linkedin.ts`, `server/services/platform-credentials-service.ts`
