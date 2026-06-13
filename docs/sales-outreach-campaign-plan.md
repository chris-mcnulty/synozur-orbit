# Sales Outreach Campaign — Implementation Plan

**Status:** Proposal
**Created:** 2026-06-13
**Owner:** chris.mcnulty@synozur.com
**Branch:** `claude/sales-outreach-campaign-xbbtzs`
**Source analyzed:** [`chris-mcnulty/copilot-skills`](https://github.com/chris-mcnulty/copilot-skills) — `cowork/sales-harness-bundle` (prospector → composer → cadence + ICP, outbound-voice, compliance, kill-switches)
**Companion doc:** [`docs/cowork-skills-orbit-plan.md`](./cowork-skills-orbit-plan.md) (the marketing equivalent — the same "skills → in-product capabilities" thesis applied to sales)

> **Locked decisions (from kickoff):**
> 1. **Send model = draft + human approval.** Orbit generates personalized outreach into the seller's **Outlook Drafts**; a human clicks Send. No silent auto-send in v1. This mirrors the Cowork harness invariant: *"every send goes through Outlook Drafts and waits for a human click."*
> 2. **Plumbing:** **Outlook** via Orbit's **per-user delegated M365 Graph connection**; **HubSpot** via the **existing tenant HubSpot OAuth client**; **LinkedIn** via a **flexible provider** (§5.2a) — a **new MCP client** that works *now*, with Orbit's **already-built direct LinkedIn OAuth publisher** (currently gated pending LinkedIn app review) preferred automatically once approved.
> 5. **Master circuit breakers.** Beyond per-tenant caps, a hard global ceiling that **trips and pauses all outreach** when crossed — with **stricter, LinkedIn-specific limits** (LinkedIn punishes volume with account restrictions). See §5.6.
> 6. **LinkedIn MCP also serves marketing.** The same LinkedIn provider gives the marketing engine **direct LinkedIn posting** — the *first* direct-publishing channel to come online, ahead of the other social publishers (`bluesky/facebook/instagram/twitter`), which today are stubbed/awaiting approval. See §5.2a.
> 3. **Two-tier configuration.** A **per-tenant** layer (HubSpot connection, firm brand/messaging, LinkedIn MCP, caps/kill-switches) **and** a **per-user** layer (the seller's own delegated mailbox + their **personal voice profile**, so drafts sound like *that* person). See §3a.
> 4. **Campaign onboarding = guided interview.** A new campaign is created through a conversational **interview wizard** (goal → message → target ICP → refinements → offering → CTA → optional event/resources), reusing the existing brief/campaign-interview pattern. See §5.0.

---

## 1. Executive summary

We want a **sales outreach campaign system**: given a sales/product goal, Orbit should **prospect**, **score/qualify**, **draft personalized outreach** (Outlook email + LinkedIn), **sequence follow-ups**, and **manage the campaign** — with the seller's real voice, no AI clichés, and a human in the loop on every send.

The Cowork `sales-harness-bundle` is exactly this loop, expressed as M365 Copilot skills over markdown "prospect files." Orbit's advantage is the same one the marketing plan exploits: **Orbit already holds the intrinsic data the harness makes you type into config** — products, ICP personas, competitive battlecards/objections, messaging framework, brand voice, and a live HubSpot connection — so we build it as **brand- and data-grounded in-product features**, not markdown skills.

This plan **mirrors the existing, proven marketing pipeline** (editorial-calendar → copywriter → distribution → performance) one-for-one: pure testable `*-core.ts` + side-effecting `*-service.ts` + a route module + `completeForFeature()` grounding via `strategic-context.ts`, plan-gating via `FEATURE_REGISTRY`, and metering via `manual-action-quota.ts`. Everything reuses Orbit's AI provider, job queue, and grounding.

**The Cowork → Orbit translation in one line:** "the MD file is the prospect" becomes a **relational `prospects` table + state machine**, and the three Copilot agents become **three Orbit services** (prospector, composer, cadence) behind a Sales-area UI.

---

## 2. Source analysis — Cowork `sales-harness-bundle`

A three-agent outbound loop on M365 Copilot. State lives in YAML-frontmatter markdown ("the MD file is the prospect"); all agents read/write those files and **never auto-send**.

```
prospector ──→ composer ──→ cadence
   ▲   (ICP score + dossier)   │ (detect sends/replies,
   │                           │  queue follow-up drafts)
   └──────── outbound-voice ◀──┘
        (voice DNA from 20+ real sent messages)

   compliance ⨯ kill-switches  (cross-cutting hard stops on every draft)
```

| Skill | Produces | Key logic / guardrails |
|---|---|---|
| **icp-research** (`icp-definition.md`, `disqualifiers.md`) | ICP definition + exclusion criteria | Defines who qualifies and who is auto-disqualified. *(Orbit equivalent: `personas` where `isIcp=true` + disqualifier rules.)* |
| **prospector** | Research summary + ICP **score** written into the prospect dossier; advances `new → researched` | Scores signals against ICP, applies disqualifiers, "unknown" over fabrication. |
| **outbound-voice** (`voice-dna.md`, `voice-dna-extract.md`) | Voice DNA personality | Extracted from **20+ real sent messages that got replies** — not a generic descriptor. |
| **composer** | Drafts in the firm's authentic voice; advances to `draft_pending_approval` | Reads dossier + voice DNA; per-channel adaptation; ready to edit. |
| **cadence** + **cadence-rules** | Detects sends/replies, queues templated follow-ups as **drafts**; advances states | Timing windows, business-hours, reply detection. Never auto-sends. |
| **compliance** (`suppression-list.md`) | Pass/flag on every draft | **Banned-phrase scan (AI-cliché removal)**, suppression-list + self-email guard, CAN-SPAM/GDPR checks. |
| **kill-switches** | Global controls | Daily send cap, weekly **domain** caps, minimum reply-rate floor, **global pause**. |
| **prospect-files** | MD schema + state machine | YAML frontmatter = state; body = history. |
| **outlook-ops** | Outlook interaction patterns | All sends land in **Drafts**; human clicks Send. |

### 2.1 Prospect state machine (canonical — we reproduce this exactly)

```
new → researched → draft_pending_approval → sent → awaiting_reply → replied
                                                          │
                                                          └→ cadence_step_due → (compose) → draft_pending_approval
any state → dormant   (exhausted / disqualified / opted-out / closed)
```

---

## 3. Orbit's intrinsic data = the harness config (`sales-harness-config.md`)

Orbit already supplies, as live multi-tenant data, almost everything the harness makes you hand-author. **No config interview needed** — assemble from intrinsic data and surface a readiness check (same approach as the marketing plan's Pillar 0).

| Harness input | Orbit intrinsic source | Reference (verified) |
|---|---|---|
| ICP definition / disqualifiers | **`personas`** (`isIcp`, `painPoints`, `goals`, `objections`, `preferredChannels`) | `shared/schema.ts:3606` |
| Firm / product context (the "what we sell, why") | `company_profiles`, `products`, `long_form_recommendations` (messaging framework) | `server/services/strategic-context.ts` |
| Objection handling / proof / talk tracks | **`battlecards`** (`objections`, `talkTracks`, `quickStats`, `ourAdvantages`) | `shared/schema.ts:674` |
| Outbound voice DNA / tone / banned phrases | **`social_account_voice_profiles`** (`toneAttributes`, `forbiddenPhrases`, `preferredPhrases`, `sampleSnippets`) + voice-service | `shared/schema.ts:2839`, `server/services/voice-service.ts` |
| Contacts / companies / deals | **HubSpot** (live OAuth client: read contacts/companies/deals, write notes/tasks) | `server/services/hubspot-integration.ts` |
| Suppression list | **`email_suppressions`** (unsubscribe/bounce/spam/manual) | `shared/schema.ts:3874` |
| Send rail (Outlook) | M365 **Graph** connection | `server/services/entra-graph-service.ts`, `server/auth/msal-config.ts` |
| Relationship posture / account strategy | `relationship_reports` (`cooperate/compete/sell_to/...`) | `shared/schema.ts:722` |
| Events to drive meetings around (e.g. Seattle, Aug) | **`conferences`** (conferences/webinars/receptions) | `shared/schema.ts:3251` |
| Digital resources to send (product info, scheduler, event details) | **`content_assets`** + **`marketing_links`** (trackable URLs) | `shared/schema.ts:2475`, `:3434` |

**Consequence:** the harness's hand-authored `variables.md`/`icp-definition.md`/`voice-dna.md` are replaced by intrinsic loaders + a **readiness check** that flags thin fields (no ICP persona, no messaging framework, no voice profile, HubSpot not connected, Outlook scope not granted). The firm-intrinsic data needs no interview — but the **campaign brief** (goal/ICP slice/offer/CTA/event) is goal-specific and time-bound, so it *is* gathered via the §5.0 interview.

---

## 3a. Configuration — two tiers (tenant + per-user)

Outreach config splits cleanly into a shared firm layer and a personal seller layer. **Both already have a home in the schema** — the per-user piece is the part that makes a draft sound like the specific seller, not the firm.

| Layer | What it holds | Storage (verified) |
|---|---|---|
| **Per-tenant connection** | HubSpot OAuth (read contacts/companies/deals, write notes/tasks); brand voice + messaging framework; LinkedIn MCP credentials; Entra/Graph app registration; campaign caps + global pause + reply-rate floor | `hubspot_connections` (`schema.ts:3709`); `social_account_voice_profiles` (firm voice, `:2839`); `outreach_settings` (new) |
| **Per-user connection & voice** | The seller's **delegated Graph token** — used to (a) read **their** Sent Items for voice-DNA extraction and (b) create drafts in **their** Outlook; plus the seller's **personal voice profile** ("sound like *me*") | **`users.graphAccessToken/graphRefreshToken/graphScopes`** already exist (`schema.ts:34`, "captured via incremental consent… mailbox actions"); per-user voice profile = a `social_account_voice_profiles` row scoped to the user (new `ownerUserId`) |

**Why this matters:** the existing delegated-token store means we do **not** need a new app-only `Mail.ReadWrite` grant — each seller grants **incremental consent** for their own mailbox (the same mechanism already used for Planner sync). Voice is resolved with precedence **personal → firm default**, so a campaign run by Chris drafts in Chris's voice, by Wes in Wes's.

---

## 4. Gap analysis — what Orbit has vs. needs

| Harness capability | Orbit today | Gap |
|---|---|---|
| Intrinsic context | `strategic-context.ts` already assembles messaging, personas, competitive intel, brand identity | **S** — add products/objections/voice + a sales-readiness report |
| Prospect store ("MD file is the prospect") | No prospect/lead store; HubSpot holds contacts | **L** — net-new `prospects` table + state machine; HubSpot import/sync |
| ICP scoring / qualification | `personas.isIcp`, manual | **M** — net-new scoring engine + dossier generation |
| Outbound voice DNA | `social_account_voice_profiles` (manual), `voice-service.ts` | **M** — add **DNA extraction from the seller's Graph Sent Items** (the "20+ real replies" step) |
| Composer (email + LinkedIn) | `generatedEmails`, `copywriter-service.ts` (marketing) | **M** — reuse generators; add 1:1 personalization + LinkedIn format + brief→draft from a prospect dossier |
| Compliance / cliché removal | `email_suppressions`, voice `forbiddenPhrases`; no scanner | **M** — net-new `compliance-core` scanner (cliché/banned-phrase + suppression + CAN-SPAM/self-email) |
| Cadence / sequencing | Marketing scheduler + Planner sync; nothing 1:1 | **L** — net-new cadence engine + reply/send detection from Graph |
| Kill-switches / caps | Per-action quotas (`manual-action-quota.ts`), bulk send caps | **S** — add daily/weekly-domain caps, global pause, reply-rate floor as tenant settings |
| Outlook send (drafts) | Graph is **app-only read** today; no draft/send | **M** — extend Graph service to create drafts in a mailbox (scope: `Mail.ReadWrite`) |
| LinkedIn send | RapidAPI **read-only**; no messaging API | **L (MCP-gated)** — new server-side LinkedIn **MCP client** |

---

## 5. Proposed architecture (mirrors the marketing module exactly)

All AI generation reuses `completeForFeature()` (`server/services/ai-provider.ts`) for caching/retry/multi-provider, the extended `StrategicContext` for grounding, `job-queue.ts` for async 202 + polling on long operations (prospecting a list), and `plan-policy.ts` `FEATURE_REGISTRY` + `manual-action-quota.ts` for gating/metering. Every service is a pure `*-core.ts` (unit-tested) + a side-effecting `*-service.ts`, following `editorial-calendar-core/service.ts` and `distribution-planner-core/service.ts`.

### 5.0 Campaign onboarding — the interview wizard *(the front door)*

A new campaign is created through a **conversational, AI-assisted wizard**, reusing the proven pattern in `server/services/brief-interview-core.ts` + `client/src/pages/app/marketing/campaign-interview.tsx` (multi-step, debounced autosave, AI suggestions, editable accepted text). The wizard captures the **campaign brief**, then hands a structured config to the prospector.

**Interview steps (each pre-filled from intrinsic data, all editable):**
1. **Goal / outcome** — free text, e.g. *"book 10 discovery calls"*; classified into a goal type (`meeting | event_invite | intro | nurture`).
2. **Core message / offering** — pre-populated from `products` + messaging framework; the value prop and which product/service this is about.
3. **Target ICP** — choose/confirm `personas` (`isIcp`) and named roles (e.g. *PE CIOs and ops leaders*, *IT directors evaluating Copilot*, *VC/PE leadership*).
4. **Refinements** — **geography** (city/region — drives event-proximity targeting), **industry**, company size/segment, named-account list. These become the prospecting filter (HubSpot query + LinkedIn MCP research).
5. **Call to action** — the concrete ask + its mechanism (a **meeting scheduler** link, an **event invite**, a resource).
6. **Event (optional)** — link to a `conferences` record; anchors cadence windows to the event date.
7. **Resources (optional)** — attach `content_assets` / `marketing_links` to inject at the right step (§5.1).
8. **Voice** — confirm which **personal voice profile** drafts in (§3a).

Output: an `outreach_campaigns` row (with the brief stored as structured `interview` jsonb, like `campaigns.interview` already does) + a cadence template + a prospecting filter. The interview's classification of goal type also selects a **default cadence archetype** (a meeting-drive sequence vs. an event-invite sequence are timed differently).

**Worked examples (campaign archetypes the wizard must handle):**

| Goal | ICP + refinement | Offering | CTA | Cadence archetype |
|---|---|---|---|---|
| Drive a meeting | Mid-market **PE CIOs & ops leaders** | AI value-realization services | Book a discovery call (scheduler link) | meeting-drive (3–4 touches) |
| Introduce a product | **IT directors** evaluating Copilot | **Zenith** platform | Short intro call (scheduler link) | meeting-drive |
| Invite to an event | **VC/PE leadership in a given city** | Industry dinner / roundtable | RSVP (event details + reply) | event-invite (anchored to event date) |
| **Conference (Seattle, end of Aug)** | **Financial leadership** in/near Seattle | Meet at / near the event | Book a slot at the conference (scheduler link) | event-anchored, **back-dated from the event** |

### 5.1 Data model (new tables in `shared/schema.ts`)

> The harness's "MD file is the prospect" becomes relational. All tables tenant-scoped (`tenantDomain` + `marketId`), mirroring existing conventions.

- **`outreach_campaigns`** — the goal-driven container. `id`, `tenantDomain`, `marketId`, `name`, `goalType` (`meeting|event_invite|intro|nurture`), `salesGoal` (free text), `interview` (jsonb — the captured brief, mirrors `campaigns.interview`), `productId`, `targetPersonaIds[]`, `targetingFilter` (jsonb — geography/industry/segment/named accounts), `channels[]` (`email`/`linkedin`), **`conferenceId`** (FK → `conferences`, nullable — event-anchored campaigns), **`eventDate`** (anchors cadence windows), `cadenceTemplateId`, `voiceProfileId` (the **personal** profile from §3a), `status` (`draft|active|paused|completed|archived`), `createdBy`, timestamps.
- **`outreach_campaign_resources`** — digital assets attached to a campaign, injected at the right cadence step. `campaignId`, `resourceType` (`product_info|scheduler|event_details|case_study|other`), `contentAssetId` (FK → `content_assets`), `marketingLinkId` (FK → `marketing_links` for trackable scheduler/event URLs), `injectAtStep` (which cadence step surfaces it), `label`.
- **`prospects`** — the state machine. `id`, `campaignId`, `tenantDomain`, `marketId`, `name`, `title`, `companyName`, `email`, `linkedinUrl`, `hubspotContactId`, `hubspotCompanyId`, `source` (`hubspot|manual|linkedin|import`), `icpScore` (int), `scoreBreakdown` (jsonb — per-signal), `disqualifiedReason`, `researchDossier` (text/markdown), `signals` (jsonb), **`status`** (the enum from §2.1), `ownerUserId`, `nextActionAt`, timestamps.
- **`cadence_templates`** + **`cadence_steps`** — reusable sequences. Template carries an `archetype` (`meeting_drive|event_invite|nurture`) and an optional `anchor` (`start_date|event_date` — event-invite steps are back-dated from `eventDate`). Step: `stepNumber`, `channel`, `dayOffset` (negative offsets allowed when anchored to an event), `businessHoursOnly`, `templateHint`, `purpose` (`intro|value|case_study|invite|breakup`), `resourceType` (which attached resource to surface).
- **`outreach_touches`** — generated drafts + history (one row per touch). `id`, `prospectId`, `campaignId`, `channel`, `stepNumber`, `subject`, `body`, **`status`** (`draft_pending_approval|approved|sent|skipped|bounced|replied`), `outlookDraftId` (Graph message id), `linkedinThreadRef`, `complianceFlags` (jsonb), `voiceProfileId`, `generatedAt`, `approvedBy`, `sentAt`.
- **`outreach_settings`** (per tenant) — circuit breakers + caps (see §5.6): `globalPause` (bool), per-channel daily/weekly caps (with **separate, stricter LinkedIn limits**), `weeklyPerDomainCap`, hard master ceilings, `minReplyRateFloor`, `defaultVoiceProfileId`. (Suppression reuses **`email_suppressions`**.)
- **`outreach_send_ledger`** — append-only record of every send/draft-approval, per channel + day, so circuit-breaker counting is authoritative across sellers and survives restarts (the caps can't be enforced from in-memory counters alone).

Migrations follow the repo convention: edit `shared/schema.ts` → `npm run db:generate` → `npm run db:push` (see `drizzle.config.ts`, `migrations/`).

### 5.2 Services (new)

| File | Type | Responsibility |
|---|---|---|
| `server/services/outreach-interview-core.ts` | pure | Interview step graph, pre-fill from intrinsic data, goal-type classification → cadence-archetype selection, targeting-filter normalization. Unit-tested. Mirrors `brief-interview-core.ts`. |
| `server/services/outreach-interview-service.ts` | side-effecting | Runs the wizard turns via `completeForFeature('outreachInterview', …)`; on finish writes the `outreach_campaigns` row + cadence template + targeting filter. |
| `server/services/prospector-core.ts` | pure | ICP scoring math (weighted signals vs. persona), disqualifier rules, score→qualified/disqualified threshold, **geo/industry refinement filters** (incl. event-proximity). Unit-tested. |
| `server/services/prospector-service.ts` | side-effecting | Pull candidates from HubSpot (+ optional LinkedIn MCP research), call `completeForFeature('prospectResearch', …)` for the dossier, write `prospects` rows, advance `new→researched`. |
| `server/services/outbound-voice-service.ts` | side-effecting | **Voice-DNA extraction** from the seller's Graph **Sent Items** (the harness's "20+ replied messages"); produce/update a `social_account_voice_profiles`-shaped outbound profile. Reuses `voice-service.ts`. |
| `server/services/outreach-composer-core.ts` | pure | Prompt assembly from dossier + voice + battlecard objections; per-channel format/length guardrails. |
| `server/services/outreach-composer-service.ts` | side-effecting | `completeForFeature('outreachComposer', …)` → draft; runs compliance scan; writes `outreach_touches` as `draft_pending_approval`. Reuses `copywriter-service.ts` patterns + `AIRewritePanel` lineage. |
| `server/services/compliance-core.ts` | pure | **AI-cliché / banned-phrase scanner** (seeded from `voice-guidelines.md` banned register + voice profile `forbiddenPhrases`), suppression + self-email guard, CAN-SPAM/GDPR structural checks. Returns `{ pass, flags[], suggestedFixes[] }`. Unit-tested. |
| `server/services/cadence-core.ts` | pure | State-machine transitions, timing-window/business-hours math, due-step computation, cap & kill-switch enforcement. Unit-tested. |
| `server/services/cadence-service.ts` | side-effecting | Detect sends/replies by reading the seller's Graph **Sent Items + Inbox**; advance states; queue next-step drafts. Runs on a schedule (`scheduled-jobs.ts`). |
| `server/services/outlook-draft-service.ts` | side-effecting | Extend `entra-graph-service.ts`: create a **draft** in the seller's mailbox, read sent/inbox for cadence detection. **Requires `Mail.ReadWrite` Graph scope (new).** |
| `server/services/linkedin/provider.ts` | side-effecting | **The flexible LinkedIn seam** (see §5.2a) — one interface, two interchangeable backends: an MCP client (works now) and the already-built direct-OAuth publisher (pending review). Covers both **posting** (marketing) and **messaging/research** (outreach). |

HubSpot reuse: `hubspot-integration.ts` already does read (contacts/companies/deals) + write (notes/tasks) — log each approved/sent touch as a HubSpot **engagement/task** and import contacts as prospects.

### 5.2a The LinkedIn provider — flexible by design

Orbit **already has** a direct LinkedIn OAuth publisher (`server/services/social-publishers/linkedin.ts`, UGC Posts API, Synozur-owned app) behind a shared `SocialPublisher` interface (`social-publishers/index.ts:80`). It's complete but **gated off** (`isLinkedInDirectPublishEnabled()` → `false`) **pending LinkedIn's app review**. So we don't choose MCP *vs.* OAuth — we abstract over both:

```
                 ┌────────────── LinkedInProvider (selector) ──────────────┐
  marketing  →   │  pickBackend():                                          │
  posting        │    if isLinkedInDirectPublishEnabled() → DirectOAuth     │ → post / message / research
  outreach   →   │    else → MCP                                            │
  messaging      └─────────────────────────────────────────────────────────┘
```

- **Posting** reuses the existing `SocialPublisher` contract; the MCP backend becomes a second implementation alongside `LinkedInPublisher`. The selector prefers direct OAuth when approved, MCP otherwise — **no caller changes** when the app clears review.
- **Messaging / connection / research** (outreach-only) is an extension the OAuth member API doesn't expose; that stays MCP-backed regardless, subject to ToS and the §5.6 LinkedIn breakers.
- **Sequencing consequence:** wiring the MCP backend lights up **LinkedIn direct posting for the marketing engine first** — ahead of the other still-stubbed social publishers — satisfying the marketing plan's Pillar 3 ("expand channel coverage as MCP tool sets connect", `cowork-skills-orbit-plan.md` §5).

### 5.3 Routes (`server/routes/sales-outreach.ts`, registered in `server/routes.ts`)

Each route gates with `guardFeature(req, res, …)` and meters AI-heavy actions via `reserveManualAction()` (commit on success/fail), exactly like `editorial-calendar.ts`.

- `POST /api/sales-outreach/interview` / `…/interview/:id/turn` — run the onboarding wizard (conversational, autosave); on finish creates the campaign
- `POST /api/sales-outreach/campaigns` — create directly (skip-wizard path) from goal + product + personas + channels
- `GET/POST /api/sales-outreach/campaigns/:id/resources` — attach/list digital resources (scheduler, event details, product info) + `injectAtStep`
- `POST /api/sales-outreach/campaigns/:id/prospect` — find/import + score (async **202 + job-queue**)
- `GET  /api/sales-outreach/prospects?campaignId=` / `GET …/prospects/:id` (dossier + touch history)
- `POST /api/sales-outreach/prospects/:id/research` — re-score + dossier
- `POST /api/sales-outreach/prospects/:id/compose` — draft next step (runs compliance scan)
- `POST /api/sales-outreach/touches/:id/compliance-check` — preview cliché/compliance flags
- `POST /api/sales-outreach/touches/:id/approve` — push to **Outlook draft** via Graph; mark approved
- `POST /api/sales-outreach/cadence/tick` — scheduled: detect replies/sends, queue follow-ups
- `GET/PUT /api/sales-outreach/settings` — caps, global pause, default voice
- `POST /api/sales-outreach/voice/extract` — extract outbound voice DNA from Sent Items
- `GET  /api/sales-outreach/readiness` — readiness check (personas/messaging/voice/HubSpot/Graph scope)

### 5.4 Frontend (`client/src/pages/app/sales/…`)

New pages, wired into `client/src/App.tsx` and `client/src/lib/areaNavigation.ts` (Sales area `items`, currently `areaNavigation.ts:185`; add to `SALES_PREFIXES` at `:242`). React Query + `useMutation`, mirroring `pages/app/marketing/editorial-calendar.tsx`.

- `outreach-interview.tsx` — the **onboarding wizard** (clone `campaign-interview.tsx`): goal → message → ICP → refinements → CTA → event → resources → voice.
- `outreach-campaigns.tsx` — list/create campaigns by goal; readiness banner; "New campaign" launches the wizard.
- `campaign-detail.tsx` — prospects table (state badges, ICP score, next action); bulk compose/approve; attached-resources panel; event banner when `conferenceId` set.
- `prospect-detail.tsx` — dossier, score breakdown, touch timeline, **draft editor with compliance flags** (reuse `components/marketing/AIRewritePanel.tsx`), resource chips, "Approve → Outlook" button.
- `outreach-settings.tsx` — **per-user**: connect mailbox (incremental Graph consent) + extract/preview personal voice; **per-tenant** (admin): caps/kill-switch (global pause), suppression, LinkedIn MCP, HubSpot.
- **Active Outreach widget on Sales home** (`pages/app/sales.tsx`) — a live rollup card alongside the existing deliverable cards: **what's running** (active campaigns), **how long** (days running), **contacts developed** (prospects researched/qualified), **in communication** (prospects in `awaiting_reply`/`replied`/`cadence_step_due`), and **success rate** (reply / meeting-booked rate). Backed by `GET /api/sales-outreach/summary` (a rollup over `prospects` states + `outreach_touches` outcomes, same query style as the current home counts / `calendar-rollup-core`). **Not Phase 0** — it needs live state + reply data, so it lands in Phase 3 (a counts-only version is possible from Phase 1).

### 5.6 Master circuit breakers & caps *(safety-critical)*

1:1 outreach that goes too fast is worse than slow outreach — especially on LinkedIn, where volume triggers **account restrictions**. So caps are layered, channel-aware, and fail **closed**. All counting reads the authoritative `outreach_send_ledger` (not in-memory), enforced in `cadence-core.ts` (pure, unit-tested) before any draft is queued or approved.

- **Master breaker (global).** A hard tenant-wide ceiling on total approvals/sends per day. When crossed, it **sets `globalPause` and halts every campaign** until a human clears it — the Cowork `kill-switches` "global pause" with teeth. Failure mode is **stop**, never "send anyway."
- **Per-channel caps, LinkedIn the strictest.** Separate daily/weekly limits per channel; LinkedIn defaults far below email (e.g. a small daily connection/message cap + a weekly ceiling) and additionally honors **per-recipient cooldowns** and a **new-connection/day** sub-limit. These are *independent* breakers — tripping LinkedIn never raises the email ceiling.
- **Per-domain weekly cap.** Existing harness rule — no more than N touches into one company's domain per week.
- **Reply-rate floor.** If a campaign's reply rate falls below `minReplyRateFloor` over a rolling window, it auto-pauses (don't keep burning a list/voice that isn't landing).
- **Suppression + self-email guard.** Every draft re-checks `email_suppressions` and blocks sending to internal/own domains (compliance-core).
- **Surfaced in `outreach-settings.tsx`** with live "used / remaining" per channel, the global breaker state, and a one-click **global pause** for admins.

> Defaults ship conservative and are plan-gated; raising them is an explicit admin action, and the master breaker has an absolute hard cap that per-tenant config cannot exceed.

### 5.5 Feature gating & metering

Add to `FEATURE_REGISTRY` (`server/services/plan-policy.ts`) + plan matrices; register AI features in the `AIFeature` union for `completeForFeature()`:

| Feature key | Category | Suggested tiers | Metered action |
|---|---|---|---|
| `salesOutreachCampaigns` | sales | enterprise, unlimited | — |
| `outreachInterview` | sales | enterprise, unlimited | `runOutreachInterview` |
| `prospectResearch` | sales | enterprise, unlimited | `generateProspectDossier` |
| `outreachComposer` | sales | enterprise, unlimited | `generateOutreachDraft` |
| `outreachCadence` | sales | enterprise, unlimited | — |

---

## 6. Roadmap

**Phase 0 — Grounding, config & schema.** Add the tables; extend `strategic-context.ts` with a sales bundle (products + battlecard objections + ICP personas + voice); ship `GET /readiness`. Stand up **two-tier config** (§3a): per-user incremental Graph consent for the mailbox + per-user voice profile, per-tenant caps. Register feature keys + `AIFeature`s.
> **Status (in progress):** ✅ schema (8 tables + migration `0044_sales_outreach.sql`), ✅ `AIFeature`s + `FEATURE_REGISTRY`/plan-gating/quota keys (`sales` category), ✅ readiness core+loader+route (`GET /api/sales-outreach/readiness`) with unit tests, ✅ circuit-breaker settings route (`GET/PUT /api/sales-outreach/settings`). **Remaining:** per-user incremental Graph consent flow for the mailbox, the per-user voice-profile `ownerUserId` column, and the settings/readiness UI surface.

**Phase 1 — Interview + Prospector.** The **onboarding wizard** (reuse `brief-interview` pattern) → campaign brief + targeting filter; HubSpot contact/company import filtered by geography/industry; `prospector-core` scoring + `completeForFeature` dossier; `prospects` state machine `new→researched`. Per-user **voice-DNA extraction** from the seller's Graph Sent Items.
> **Status (in progress):** ✅ `prospector-core` (ICP scoring, disqualifiers, geo/industry match, criteria builder) + unit tests; ✅ `outreach-interview-core` (step graph, goal classification, cadence archetypes incl. event-anchored back-dating, targeting normalization) + unit tests; ✅ `outreach-interview-service` (creates campaign + default cadence from the brief, in one txn); ✅ `prospector-service` (deterministic score + grounded AI dossier, advances `new→researched`/`dormant`); ✅ routes: campaigns CRUD, prospect add/list, metered `POST /prospects/:id/research`. **Remaining:** the React interview-wizard + campaign/prospect UI, HubSpot bulk import, and per-user Graph Sent-Items voice-DNA extraction (+ the `ownerUserId` voice-profile column).

**Phase 2 — Composer + Outlook drafts + resources.** `outreach-composer` (email + LinkedIn copy) grounded in dossier + **personal** voice + objections, surfacing the right **campaign resource** (scheduler/event/product) per step; **`compliance-core` cliché/banned-phrase + suppression + CAN-SPAM scan** on every draft; `outlook-draft-service` pushes approved drafts to the seller's Outlook Drafts via their **delegated token** (incremental `Mail.ReadWrite` consent). HubSpot activity logging.

**Phase 3 — Cadence + events + kill-switches + Sales-home widget.** `cadence-core` state machine + timing windows, including **event-anchored** sequences back-dated from `eventDate` (the Seattle conference case); `cadence-service` reply/send detection via Graph (scheduled); follow-up drafting; `outreach_settings` caps + global pause + reply-rate floor. Ship the **Active Outreach widget** on Sales home (`GET /api/sales-outreach/summary`: running campaigns, days running, contacts developed, in communication, success rate) — now that prospect states and reply data are flowing.

**Phase 4 — LinkedIn MCP + performance loop.** Wire the LinkedIn **MCP client** for research/messaging; close the loop — reply/meeting rates and HubSpot deal attribution feed back into ICP scoring (mirrors the marketing performance-analyst).

---

## 7. Dependencies, risks & open questions

- **Graph scope (resolved, smaller than it looked).** Orbit **already stores per-user delegated Graph tokens** (`users.graphAccessToken/...`, used for Planner sync + "mailbox actions"). Outlook drafts + Sent-Items voice extraction ride that rail via **incremental consent** for `Mail.ReadWrite` per seller — no new app-only grant. Confirm the existing consent flow can request the added scope.
- **Reading the seller's mailbox (privacy).** Cadence reply/send detection and voice-DNA extraction read Sent Items + Inbox. Needs explicit per-seller opt-in and a clear data-use note; scoped to the connected user's own token only.
- **Seattle conference timing (act now).** The conference is **end of August**; an event-anchored sequence back-dates touches from the event date, so meaningful lead time means **standing up Phases 0–2 (config → interview → prospector → composer/drafts) within roughly the next 6–8 weeks**. Recommendation: prioritize the *meeting-drive* and *event-invite* archetypes first; the full automated cadence engine (Phase 3) can follow, with early sends approved manually from the draft queue.
- **LinkedIn provider (flexible, two backends).** Direct OAuth posting is **already built but gated pending LinkedIn app review** (`social-publishers/linkedin.ts`); the **MCP backend is the path that works now** and also unblocks marketing's first direct-publishing channel. The §5.2a selector prefers OAuth automatically once approved, so we don't bet the design on either. Open items: which LinkedIn MCP server + its auth model, and **LinkedIn ToS** for automated messaging/connections (governed by the §5.6 LinkedIn breakers). Until the MCP backend lands, outreach LinkedIn is **copy-assist** (generate text, seller pastes).
- **Circuit breakers fail closed.** Caps must be enforced from the durable `outreach_send_ledger`, not memory, and default conservative — a bug that *over*-counts (pauses early) is acceptable; one that *under*-counts (sends too much, esp. on LinkedIn) is not.
- **Draft-only invariant.** v1 never auto-sends. Auto-send (reusing the SendGrid pipeline) is a deliberate later decision, not in scope.
- **Voice DNA quality.** Extraction needs enough real sent mail ("20+ replied messages"); readiness check warns when thin and falls back to the messaging-framework tone.
- **Reuse vs. new.** Suppression reuses `email_suppressions`; voice reuses `social_account_voice_profiles`. Confirm we're not duplicating the marketing campaign tables (`campaigns`, `generatedEmails`) — these are **1:1 sales** objects, intentionally separate.

---

## 8. Summary

Orbit already holds the sales-harness config as live data, has a connected HubSpot CRM and M365 Graph, and ships a battle-tested marketing AI pipeline whose architecture maps **one-to-one** onto this feature. We translate Cowork's three agents into three Orbit services (**prospector → composer → cadence**) over a relational `prospects` state machine, keep the **human-approval-in-Outlook** invariant, ground every draft in brand voice with **AI-cliché removal**, and enforce **kill-switches/caps** — reusing the AI provider, strategic-context grounding, job queue, and plan-gating throughout. Outlook rides the existing Graph connection (+`Mail.ReadWrite`), HubSpot the existing OAuth client, and LinkedIn a new MCP client sequenced last.
