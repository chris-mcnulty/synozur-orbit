# HubSpot Marketing Email Parity — Implementation Plan

**Status:** Proposal
**Created:** 2026-06-22
**Owner:** chris.mcnulty@synozur.com
**Branch:** `claude/hubspot-email-functions-plan-zuo5nm`
**Scope:** Duplicate HubSpot's marketing-email capabilities inside Orbit — compose/send marketing email, track per-contact engagement, and present an unsubscribe experience — while keeping **HubSpot as the CRM system-of-record** by syncing engagement activity and subscription/unsubscribe status **back into HubSpot**.

> **Locked decisions (from kickoff):**
> 1. **Sending engine = SendGrid.** All marketing email is delivered through Orbit's existing SendGrid integration (Task #97). HubSpot is **not** used to send — it has no Marketing Hub dependency here. HubSpot is purely the CRM that *receives* engagement + subscription state.
> 2. **HubSpot connection = the existing tenant OAuth client** (Task #100, `hubspot_connections`). We extend its scopes; we do not add a second app.
> 3. **Bidirectional unsubscribe.** A footer/preference link drives unsubscribe; the choice is written to Orbit's suppression list **and** synced to HubSpot subscription preferences. HubSpot opt-outs are pulled back **before each send** so HubSpot remains authoritative for consent.
> 4. **Contact-level activity.** Sent / delivered / open / click / bounce / unsubscribe land on the matching **HubSpot Contact timeline** (CRM Timeline Events API), so marketing engagement is visible next to sales activity.

---

## 1. Executive summary

Orbit **already has** ~80% of "HubSpot marketing email" built:

- **Email pipeline (Task #97)** — AI-drafted emails (`generatedEmails`), managed audiences (`emailRecipientLists` / `emailRecipients`), send dispatch with per-tenant rate caps and scheduling (`email-campaign-sender.ts`), SendGrid delivery, **open/click/bounce/unsubscribe tracking** per recipient (`emailSendRecipients`), a tenant **suppression list** (`emailSuppressions`), a **public unsubscribe** flow (`/u/:token` + `List-Unsubscribe` one-click header + visible footer), and a **SendGrid event webhook** (`/api/webhooks/sendgrid`).
- **HubSpot integration (Task #100)** — per-tenant OAuth with encrypted token storage and auto-refresh (`hubspot-integration.ts`, `hubspot_connections`), **contacts read/write** already in scope, plus owners/companies/deals and outbound Notes/Tasks.

What's **missing** is the *bridge* between the two. This plan adds three things:

1. **Contact resolution** — link each marketing email recipient to a HubSpot Contact (by email/contact-id) so events have a home.
2. **Activity sync** — push send/delivery/engagement events to the HubSpot **Contact timeline** as custom timeline events.
3. **Subscription sync** — make unsubscribe bidirectional via HubSpot's **Communication Preferences / Subscriptions API**, surfaced through the email footer and a hosted preference page.

Plus a **reporting** surface that reconciles Orbit's send metrics with what landed in HubSpot.

**One-line thesis:** *Send with SendGrid, remember in HubSpot.*

---

## 2. What exists today (do not rebuild)

| Concern | Where | Notes |
|---|---|---|
| Email drafts | `generatedEmails` (`shared/schema.ts`) | subject, htmlBody, textBody, status, sentAt |
| Audiences | `emailRecipientLists`, `emailRecipients` | tenant-scoped lists |
| Send dispatch | `server/services/email-campaign-sender.ts` (687 lines) | batch + scheduled, rate caps, "send to me" |
| Per-recipient tracking | `emailSendRecipients` | `status, sentAt, deliveredAt, bouncedAt, unsubscribedAt, openedAt, clickedAt, openCount, clickCount`, `unsubscribeToken` |
| Send rollup | `emailSends` | `recipientCount, sentCount, bounceCount, unsubscribeCount, openCount, clickCount` |
| Suppression | `emailSuppressions` | `email, reason, source (public_unsub / sendgrid / manual)` |
| Unsubscribe UX | `marketing-delivery.ts` `GET/POST /u/:token`; footer + `List-Unsubscribe` header in `email-campaign-sender.ts:167,504,517` | RFC 8058 one-click |
| ESP events | `POST /api/webhooks/sendgrid` | open, click, bounce, dropped, spam, unsubscribe |
| HubSpot auth | `hubspot-integration.ts`, `hubspot_connections` | OAuth, encrypted tokens, refresh, `autoPushEnabled` |
| HubSpot scopes | `HUBSPOT_OAUTH_SCOPES` (`shared/schema.ts:3720`) | contacts read/write already present |
| Audit | `marketingAuditLog` | append-only: `email_send`, `email_unsubscribe`, `email_bounce`, `rate_limited` |
| Feature gating | `plan-policy.ts` (`directEmailDelivery`, `hubspotIntegration`) | per-plan registry |

**Implication:** this is largely an *integration* effort layered on proven foundations, not a greenfield build.

---

## 3. The gaps (what this plan delivers)

1. **No contact mapping.** `emailSendRecipients` has `email` but no `hubspotContactId`. (Sales `prospects` already carries `hubspotContactId` — we mirror that pattern.)
2. **No activity sync.** Engagement is recorded only in Orbit's DB; nothing reaches the HubSpot contact timeline.
3. **One-way unsubscribe.** Footer unsubscribe writes to `emailSuppressions` only. It is not written to HubSpot, and HubSpot opt-outs are not pulled into Orbit before sending — so the two systems can disagree on consent.
4. **No subscription types.** HubSpot models consent per *subscription type* (e.g. "Marketing Newsletter"). Orbit has a single global suppression with no type concept.
5. **Reporting** doesn't reconcile "sent in Orbit" vs "synced to HubSpot."

---

## 4. Target architecture & data flow

```
        ┌──────────────── Orbit (multi-tenant) ─────────────────┐
        │                                                        │
 compose│  generatedEmails ──► email-campaign-sender ──► SendGrid│──► inbox
        │        │                     │                         │
        │        │            emailSendRecipients                │
        │        │            (+ hubspotContactId, sync state)   │
        │        ▼                     ▲                          │
        │  contact-resolver            │ engagement events       │
        │  (email→HS contactId)        │                          │
        │        │                     │                          │
        │        ▼              SendGrid Event Webhook  ◄─────────┼── opens/clicks/
        │  hubspot-email-sync ◄────────┘  /api/webhooks/sendgrid  │   bounces/spam
        │   ├─ timeline events (sent/open/click/bounce)           │
        │   └─ subscription writes (unsub)                        │
        │        │                                                │
        └────────┼────────────────────────────────────────────────┘
                 ▼  (HubSpot OAuth, existing tenant connection)
        ┌──────────────────── HubSpot CRM ──────────────────────┐
        │  Contact timeline (custom event templates)             │
        │  Subscription preferences (consent system-of-record)   │
        └────────────────────────────────────────────────────────┘
                 ▲  pulled BEFORE each send (suppress opt-outs)
                 └── consent reconciliation
```

**Send path:** unchanged (SendGrid).
**New, async, non-blocking sidecars:** (a) resolve recipients → HubSpot contacts, (b) push timeline events, (c) push/pull subscription state. None of these are allowed to block or fail a send.

---

## 5. HubSpot APIs we will use (and required scopes)

| Capability | HubSpot API | Scope(s) to add |
|---|---|---|
| Contact lookup/create by email | CRM Contacts (`crm.objects.contacts.*`) | already present |
| Push engagement to contact timeline | **CRM Timeline Events API** (custom event templates on the app) | `timeline` (app-level event templates; created once per app) |
| Read subscription type definitions | **Communication Preferences / Subscriptions API** | `communication_preferences.read` |
| Write opt-out / opt-in | same | `communication_preferences.write` (or `.read_write`) |

Update `HUBSPOT_OAUTH_SCOPES` (`shared/schema.ts:3720`) to add `timeline`, `communication_preferences.read`, `communication_preferences.write`. **Scope changes require tenants to re-authorize** — see §11 (rollout) for the re-consent banner.

**Timeline event templates** are defined **once on the HubSpot app** (developer account), not per tenant. We define templates: `email_sent`, `email_delivered`, `email_opened`, `email_clicked`, `email_bounced`, `email_unsubscribed`, each with tokens (subject, campaign name, send id, link url, open count, etc.). Template IDs are stored in app config / env.

> **Auth note:** HubSpot requires an **OAuth access token** (not a private-app key / API key) to create timeline events. Orbit already uses OAuth per tenant, so this is satisfied — but it's the reason we extend the existing OAuth app rather than introduce a key-based path.

> **Consent constraint:** HubSpot will **not let you programmatically re-subscribe** a contact who opted out *via an email link*. Our sync therefore treats HubSpot as authoritative for consent and only ever *adds* suppression on conflict — never silently re-enables sending.

---

## 6. Subscription types (consent model)

Introduce a tenant-configurable mapping between Orbit email "purposes" and **HubSpot subscription types**:

- New table **`emailSubscriptionTypes`**: `id, tenantDomain, name, description, hubspotSubscriptionId (nullable), isDefault, createdAt`.
- On connect (or in settings), fetch HubSpot subscription definitions and let an admin map each Orbit purpose to a HubSpot subscription type (e.g. "Newsletter" → HS id 12345).
- Each `emailSends` row gains `subscriptionTypeId` so a send is associated with a consent category.
- Footer/preference page operates **per subscription type** plus a global "unsubscribe from all."

This is what makes the experience true HubSpot parity (granular preferences) rather than a single on/off flag.

---

## 6.5 Marketing list (audience) database — Orbit stores & syncs

**Orbit is the system-of-record for the marketing list database.** Audiences live in `emailRecipientLists` / `emailRecipients` and are managed in Orbit (import, segment, edit, send). HubSpot is kept in sync so the two never drift:

- **Membership sync (Orbit ⇄ HubSpot).** Each `emailRecipients` row gains `hubspotContactId` (resolved by the contact-resolver, §8.1). A list can optionally be **mirrored to a HubSpot active/static list** so a marketer can see and reuse the same audience in HubSpot.
  - *Push:* Orbit list → HubSpot static list (membership write).
  - *Pull/import:* seed an Orbit list from a HubSpot list or saved view (one-time import or scheduled refresh).
- **Consent is layered on top.** The list defines *who could receive*; the subscription/suppression state (§6) defines *who is allowed to receive*. Sends always intersect list membership with consent pulled from HubSpot (§5).
- **Dedup & identity.** Email (lowercased) is the join key; `hubspotContactId` is the durable link once resolved. Re-imports upsert rather than duplicate.
- **New columns:** `emailRecipients + hubspotContactId, hsSyncStatus, hsLastSyncedAt`; `emailRecipientLists + hubspotListId (nullable), syncDirection (none|push|pull|both), lastSyncedAt`.
- **New service:** `server/services/hubspot-list-sync.ts` — `pushListMembership(tenant, listId)`, `importFromHubspotList(tenant, hubspotListId)`, scheduled refresh via `scheduled-jobs.ts`. Pure diff logic in `*-core.ts`.

> This makes Orbit the **operational marketing-list database** (compose & send happen here, on SendGrid) while HubSpot stays the **CRM mirror** for contacts, list membership, engagement timeline, and consent.

---

## 7. Data model changes (`shared/schema.ts` + migration)

```
emailSendRecipients   + hubspotContactId        text     (resolved HS contact)
                      + hsSyncStatus             text     pending|synced|skipped|error
                      + hsLastEventSyncedAt      timestamp
                      + hsSyncError              text

emailSends            + subscriptionTypeId       fk → emailSubscriptionTypes
                      + hsTimelineSyncEnabled    boolean  default true

emailSuppressions     + subscriptionTypeId       fk (nullable; null = global)
                      + hubspotSyncedAt          timestamp
                      + originSystem             text     orbit|hubspot

emailRecipients      + hubspotContactId        text     (durable CRM link)
                     + hsSyncStatus             text     pending|synced|skipped|error
                     + hsLastSyncedAt           timestamp

emailRecipientLists  + hubspotListId            text     (mirrored HS list, nullable)
                     + syncDirection            text     none|push|pull|both
                     + lastSyncedAt             timestamp

NEW emailSubscriptionTypes  (see §6)

NEW hubspotTimelineTemplates  (id, eventKey, hubspotTemplateId)   -- if not env-config
```

A new migration `00NN_hubspot_email_sync.sql` adds the above (additive, nullable columns — safe online migration).

---

## 8. New / changed code

### 8.1 New services (pure-core + side-effecting, matching Orbit conventions)

- **`server/services/hubspot-contact-resolver.ts`**
  `resolveContactId(tenant, email)` → search HubSpot by email; cache the id on `emailSendRecipients.hubspotContactId`. Optionally **create** a contact when missing (admin-gated; default: do not create, mark `skipped`). Pure matching logic in a `*-core.ts`, the HubSpot call in the service.

- **`server/services/hubspot-email-sync.ts`**
  - `syncTimelineEvent(tenant, recipient, eventKey, payload)` → POST CRM Timeline Event using the app's template id; idempotent per (recipient, eventKey, timestamp).
  - `pushUnsubscribe(tenant, contactId, subscriptionTypeId|null)` → opt out via Communication Preferences API.
  - `pullSubscriptionStatus(tenant, emails[])` → returns HubSpot opt-out state for pre-send suppression reconciliation.
  - All wrapped with the existing token-refresh client (`getTenantClient`) and plan gate.

- **`server/services/hubspot-email-sync-core.ts`** (pure, unit-tested)
  Maps Orbit event → HubSpot timeline token payload; decides idempotency keys; merges Orbit vs HubSpot consent (HubSpot wins on opt-out).

### 8.2 Wire-in points (existing files)

- **`email-campaign-sender.ts`**
  - *Before send:* call `pullSubscriptionStatus` + existing suppression check, drop HubSpot opt-outs (reconciliation), then enqueue `email_sent` timeline events.
  - *Footer:* extend the existing footer (line ~167) to include a **"Manage preferences"** link to the hosted preference page in addition to the one-click unsubscribe. Keep `List-Unsubscribe` headers.
- **`marketing-delivery.ts`**
  - `POST /u/:token`: after writing local suppression, fire `pushUnsubscribe` to HubSpot (async, best-effort, audit-logged).
  - `POST /api/webhooks/sendgrid`: after updating `emailSendRecipients`, enqueue the corresponding timeline event (`opened`/`clicked`/`bounced`/`unsubscribed`). Webhook stays fast; sync is queued.
  - **New** `GET/POST /api/email-preferences/:token` → hosted, per-subscription-type preference center (HubSpot parity); writes both local + HubSpot.
- **`hubspot-integration.ts`** — add the scopes, the timeline-event POST helper, and the subscriptions read/write helpers next to the existing Note/Task push helpers.
- **`plan-policy.ts`** — new feature flag `hubspotEmailSync` (gate to the same tiers as `hubspotIntegration`); `directEmailDelivery` continues to gate sending.
- **`scheduled-jobs.ts`** — a **retry/backfill job** that drains `emailSendRecipients` with `hsSyncStatus in (pending,error)` (handles HubSpot rate limits / transient failures) and a periodic **consent pull** to keep suppression current.

### 8.3 Frontend

- **`client/src/pages/app/marketing/email-newsletters.tsx`** — add a **"HubSpot sync"** column/badge to the send analytics (synced / pending / skipped / error counts) and a per-send "View in HubSpot" deep link.
- **HubSpot settings** (existing integrations page) — subscription-type mapping UI + toggles: *resolve contacts*, *create missing contacts*, *push timeline events*, *sync unsubscribes*.
- **Hosted preference center** page rendered for `/api/email-preferences/:token`.

---

## 9. Engagement → HubSpot event mapping

| Orbit event (source) | `emailSendRecipients` field | HubSpot timeline template | Idempotency key |
|---|---|---|---|
| Dispatched to SendGrid | `sentAt` | `email_sent` | `${sendId}:${recipientId}:sent` |
| SendGrid `delivered` | `deliveredAt` | `email_delivered` | `…:delivered` |
| SendGrid `open` | `openedAt`/`openCount` | `email_opened` | `…:open:${ts}` |
| SendGrid `click` | `clickedAt`/`clickCount` | `email_clicked` (+url token) | `…:click:${ts}:${urlHash}` |
| SendGrid `bounce`/`dropped` | `bouncedAt` | `email_bounced` | `…:bounce` |
| Unsubscribe (footer or SG) | `unsubscribedAt` | `email_unsubscribed` | `…:unsub` |

Idempotency prevents duplicate timeline entries on webhook retries.

---

## 10. Compliance, edge cases & guardrails

- **HubSpot is authoritative for consent.** Pre-send pull means a contact who opted out in HubSpot is suppressed in Orbit even if Orbit never recorded it. Never auto-resubscribe (HubSpot blocks it for email-link opt-outs anyway).
- **Best-effort, non-blocking.** Sync failures never block a SendGrid send and never lose an Orbit-side record; failures land in `hsSyncStatus=error` and are retried by the backfill job.
- **Rate limits.** HubSpot API limits → batch timeline events, exponential backoff, queue-based drain (reuse the network-retry pattern in the git/HubSpot helpers).
- **No HubSpot connection / scope not yet re-consented.** Feature silently no-ops (sends still work); UI shows a "Connect/Re-authorize HubSpot to enable sync" banner.
- **Contact not found & create disabled.** Mark `skipped`; surface count in reporting.
- **Multi-tenant isolation.** All sync scoped by `tenantDomain`; tokens already encrypted at rest.
- **Audit.** Every push/pull writes `marketingAuditLog` (`hubspot_timeline_push`, `hubspot_unsub_sync`, `hubspot_consent_pull`).

---

## 11. Rollout plan

1. **Phase 0 — Scopes & templates.** Add scopes; create timeline event templates on the HubSpot app; store template ids. Ship a **re-authorization banner** for already-connected tenants (scope change forces re-consent).
2. **Phase 1 — Contact resolution + read-only consent pull.** Resolve recipients to contacts; pull HubSpot opt-outs into pre-send suppression. *(Improves correctness immediately, writes nothing to HubSpot.)*
3. **Phase 2 — Timeline activity push.** Enable engagement → timeline events behind `hubspotEmailSync` flag; start with `sent`/`opened`/`clicked`.
4. **Phase 3 — Bidirectional unsubscribe + preference center.** Footer "Manage preferences," subscription types, push unsubscribe to HubSpot.
5. **Phase 4 — Reporting reconciliation + backfill job.** Sync-status surfacing, retry job, periodic consent pull.

Each phase is independently shippable and gated; the send path keeps working if any phase is disabled.

---

## 12. Testing

- **Unit (`*-core.ts`, Vitest):** event→token mapping; idempotency keys; consent merge (HubSpot opt-out wins); subscription-type resolution.
- **Integration (Supertest):** `/u/:token` and `/api/email-preferences/:token` write local + enqueue HubSpot push; SendGrid webhook enqueues correct event; pre-send suppression honors pulled opt-outs.
- **HubSpot client:** mocked token refresh, 429 backoff, partial-failure → `error` + retry.
- **E2E (Playwright):** compose → send (SendGrid sandbox) → simulate webhook → assert recipient tracking + sync badges; unsubscribe via footer → assert suppression + HubSpot push call.

---

## 13. Open questions (for sign-off)

1. **Create missing HubSpot contacts** on send, or only sync engagement for contacts that already exist? (Default proposed: **do not create**; admin opt-in.)
2. **Subscription-type granularity** — one default "Marketing" type to start, or expose full per-type mapping in v1? (Proposed: one default type in Phase 1, full mapping in Phase 3.)
3. **Timeline event volume** — push `delivered` and every `open`/`click`, or collapse opens/clicks to first-occurrence + counts to reduce timeline noise and API usage? (Proposed: first-occurrence + running counts.)
4. **Plan gating** — should `hubspotEmailSync` ride on the existing `hubspotIntegration` tier, or be a distinct upsell? (Proposed: same tier.)

---

## 14. Effort estimate (relative)

| Phase | Surface | Size |
|---|---|---|
| 0 | scopes, templates, re-consent banner | S |
| 1 | contact resolver + consent pull | M |
| 2 | timeline push service + webhook wiring + backfill | M |
| 3 | subscription types + preference center + footer + unsub push | L |
| 4 | reporting reconciliation + scheduled jobs | M |

Foundations (SendGrid send/track, HubSpot OAuth, suppression, audit) are **already done**, so the net new work is concentrated in the sync sidecars and the preference center.
