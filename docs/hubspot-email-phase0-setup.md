# HubSpot Marketing-Email Sync — Phase 0 Setup (operator checklist)

**Companion to:** [`docs/hubspot-email-functions-plan.md`](./hubspot-email-functions-plan.md)
**Audience:** whoever administers the Orbit HubSpot **public app** (developer account) + Orbit deploy config.

Phase 0 has a code half (shipped) and an out-of-band half (this checklist). The
code half adds the OAuth scopes, the re-authorization banner, and the
auto-create-contacts toggle. The steps below are the HubSpot-console and
deploy-config actions that code can't perform.

---

## 1. Add OAuth scopes to the HubSpot app

In the HubSpot developer account → your public app → **Auth** → Scopes, add:

| Scope | Why |
|---|---|
| `timeline` | Write engagement events to contact timelines (Phase 2). |
| `communication_preferences.read` | Read subscription/opt-out state for the pre-send consent pull (Phase 1). |
| `communication_preferences.write` | Push unsubscribes back to HubSpot (Phase 3). |

These are already in `HUBSPOT_OAUTH_SCOPES` (`shared/schema.ts`), so Orbit
requests them on every new/renewed authorization automatically.

> **Re-consent is required.** Existing tenant connections were authorized
> before these scopes existed and will keep working for CRM enrichment, but
> `GET /api/integrations/hubspot/status` now returns `needsReauth: true` for
> them and Settings shows a **"Re-authorize"** banner. Sync paths
> (`hasHubspotEmailScopes()`) no-op until the tenant clicks it. No data loss —
> re-authorizing only adds scopes.

## 2. Create timeline event templates (needed for Phase 2, define now)

Timeline event templates live on the **app**, not per tenant. Create one
template per event with these tokens, and record the returned template IDs.

| Event key | Suggested header | Tokens |
|---|---|---|
| `email_sent` | "Marketing email sent" | `subject`, `campaign`, `sendId` |
| `email_delivered` | "Marketing email delivered" | `subject`, `sendId` |
| `email_opened` | "Opened marketing email" | `subject`, `openCount`, `sendId` |
| `email_clicked` | "Clicked a link" | `subject`, `url`, `clickCount`, `sendId` |
| `email_bounced` | "Marketing email bounced" | `subject`, `reason`, `sendId` |
| `email_unsubscribed` | "Unsubscribed" | `subject`, `subscriptionType`, `sendId` |

Create via `POST /crm/v3/timeline/{appId}/event-templates` (app developer token)
or the developer UI. Phase 2 will read the template IDs from config — store
them as env (one per event) or in a small mapping table; see the plan §8.2.

## 3. Deploy config

No new required env vars for Phase 0/1 beyond the existing HubSpot OAuth pair
(`HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`). Optional tunables already wired:

| Env var | Default | Purpose |
|---|---|---|
| `MARKETING_HS_CONSENT_PULL_MAX` | `1000` | Max per-send consent lookups before skipping the pull (bulk endpoint is the follow-up). |
| `MARKETING_HS_CONSENT_CONCURRENCY` | `5` | Concurrency for the consent pull. |
| `MARKETING_HS_MAX_CREATE_PER_SEND` | `500` | Cap on contacts auto-created per send. |

Phase 2 will add the timeline template IDs to this list.

## 4. Verify

1. Connect (or re-authorize) a test tenant in **Settings → HubSpot CRM**.
2. `GET /api/integrations/hubspot/status` should return `needsReauth: false`
   and `connection.emailSyncReady: true`.
3. The **"Auto-create contacts for email sync"** toggle becomes enabled
   (it's disabled until `emailSyncReady`).
4. Send a marketing email to a list: recipients should resolve to HubSpot
   contacts (`email_send_recipients.hs_sync_status = resolved`), and contacts
   opted out in HubSpot should be suppressed from the send.
