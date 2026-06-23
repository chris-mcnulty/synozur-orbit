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

Tokens below match exactly what the code sends (the helper script declares the
same set). Only `email_sent` carries `subject`; the webhook-driven events do
not. `email_delivered` is intentionally not pushed in Phase 2.

| Event key | Suggested header | Tokens |
|---|---|---|
| `email_sent` | "Marketing email sent" | `subject`, `campaign`, `sendId` |
| `email_opened` | "Opened marketing email" | `openCount`, `sendId` |
| `email_clicked` | "Clicked a link" | `url`, `clickCount`, `sendId` |
| `email_bounced` | "Marketing email bounced" | `reason`, `sendId` |
| `email_unsubscribed` | "Unsubscribed" | `sendId` |

Create via `POST /crm/v3/timeline/{appId}/event-templates` (managed with your
**developer API key**, not the OAuth connection). The easiest path is the
helper script — it creates all 5 and prints the env lines:

```bash
APP_ID=<your app id> DEV_KEY=<your developer API key> \
  ./scripts/hubspot-create-timeline-templates.sh
```

(`APP_ID`: Developer account → Apps → your app. `DEV_KEY`: Developer account →
"Get HubSpot API key".) **Phase 2 reads the template IDs from env**, one per event
key. Until at least one is set, timeline push is dormant (every event is
skipped — nothing is sent), so the templates can be created and wired without
risk:

| Env var | Event |
|---|---|
| `HUBSPOT_TLT_EMAIL_SENT` | `email_sent` |
| `HUBSPOT_TLT_EMAIL_OPENED` | `email_opened` (first open + count) |
| `HUBSPOT_TLT_EMAIL_CLICKED` | `email_clicked` (first click + count + url) |
| `HUBSPOT_TLT_EMAIL_BOUNCED` | `email_bounced` |
| `HUBSPOT_TLT_EMAIL_UNSUBSCRIBED` | `email_unsubscribed` |

Events are pushed against the resolved contact (`objectId`) with a stable
`id` so webhook replays/backfill update rather than duplicate.

## 3. Deploy config

No new required env vars for Phase 0/1 beyond the existing HubSpot OAuth pair
(`HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`). Optional tunables already wired:

| Env var | Default | Purpose |
|---|---|---|
| `MARKETING_HS_CONSENT_PULL_MAX` | `1000` | Max per-send consent lookups before skipping the pull (bulk endpoint is the follow-up). |
| `MARKETING_HS_CONSENT_CONCURRENCY` | `5` | Concurrency for the consent pull. |
| `MARKETING_HS_MAX_CREATE_PER_SEND` | `500` | Cap on contacts auto-created per send. |
| `MARKETING_HS_TIMELINE_CONCURRENCY` | `5` | Concurrency for `email_sent` timeline pushes. |
| `MARKETING_HS_BACKFILL_BATCH` | `10` | Sends processed per backfill tick (Phase 4). |
| `MARKETING_HS_BACKFILL_DAYS` | `7` | Lookback window for the backfill job. |
| `HUBSPOT_DEFAULT_SUBSCRIPTION_ID` | — | Portal-agnostic fallback subscription id for unsubscribe write-back. Prefer setting it **per tenant** in Settings → HubSpot CRM ("Marketing subscription ID"). |

## 5. Subscription type & preference center (Phase 3)

Unsubscribe write-back targets a single HubSpot **subscription type** (v1).
Configure it per tenant in **Settings → HubSpot CRM → Marketing subscription ID**
(find the id under HubSpot Settings → Marketing → Email → Subscription types).
If unset, unsubscribes are still honored locally (recipients are suppressed)
but are **not** written back to HubSpot.

Every send footer now links a hosted **preference center** at `/p/:token`
(alongside one-click `/u/:token`). It lets recipients unsubscribe or
resubscribe; both update Orbit's suppression list and sync to HubSpot. HubSpot
remains authoritative — a resubscribe HubSpot blocks (email-link opt-outs) is
re-suppressed on the next send by the consent pull.

## 4. Verify

1. Connect (or re-authorize) a test tenant in **Settings → HubSpot CRM**.
2. `GET /api/integrations/hubspot/status` should return `needsReauth: false`
   and `connection.emailSyncReady: true`.
3. The **"Auto-create contacts for email sync"** toggle becomes enabled
   (it's disabled until `emailSyncReady`).
4. Send a marketing email to a list: recipients should resolve to HubSpot
   contacts (`email_send_recipients.hs_sync_status = resolved`), and contacts
   opted out in HubSpot should be suppressed from the send.
