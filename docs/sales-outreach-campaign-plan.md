# Sales Outreach Campaign — Implementation Plan

**Status:** Proposal
**Created:** 2026-06-13
**Owner:** chris.mcnulty@synozur.com
**Requested by:** Wes
**Branch:** `claude/sales-outreach-campaign-xbbtzs`
**Source analyzed:** [`chris-mcnulty/copilot-skills`](https://github.com/chris-mcnulty/copilot-skills) — `cowork/sales-harness-bundle` (prospector → composer → cadence + ICP, outbound-voice, compliance, kill-switches)
**Companion doc:** [`docs/cowork-skills-orbit-plan.md`](./cowork-skills-orbit-plan.md) (the marketing equivalent — the same "skills → in-product capabilities" thesis applied to sales)

> **Locked decisions (from kickoff):**
> 1. **Send model = draft + human approval.** Orbit generates personalized outreach into the seller's **Outlook Drafts**; a human clicks Send. No silent auto-send in v1. This mirrors the Cowork harness invariant: *"every send goes through Outlook Drafts and waits for a human click."*
> 2. **Plumbing:** **Outlook** via Orbit's **existing M365 Graph connection**; **HubSpot** via the **existing HubSpot OAuth client**; **LinkedIn** via a **new server-side MyMCP/MCP client** (the LinkedIn MCP server). LinkedIn is the only net-new integration architecture.

---

## 1. Executive summary

Wes wants a **sales outreach campaign system**: given a sales/product goal, Orbit should **prospect**, **score/qualify**, **draft personalized outreach** (Outlook email + LinkedIn), **sequence follow-ups**, and **manage the campaign** — with the seller's real voice, no AI clichés, and a human in the loop on every send.

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

**Consequence:** the harness's hand-authored `variables.md`/`icp-definition.md`/`voice-dna.md` are replaced by intrinsic loaders + a **readiness check** that flags thin fields (no ICP persona, no messaging framework, no voice profile, HubSpot not connected, Outlook scope not granted).

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

### 5.1 Data model (new tables in `shared/schema.ts`)

> The harness's "MD file is the prospect" becomes relational. All tables tenant-scoped (`tenantDomain` + `marketId`), mirroring existing conventions.

- **`outreach_campaigns`** — the goal-driven container. `id`, `tenantDomain`, `marketId`, `name`, `salesGoal` (free text — "book 10 discovery calls for Polaris in mid-market healthcare"), `productId`, `targetPersonaIds[]`, `channels[]` (`email`/`linkedin`), `cadenceTemplateId`, `voiceProfileId`, `status` (`draft|active|paused|completed|archived`), `createdBy`, timestamps.
- **`prospects`** — the state machine. `id`, `campaignId`, `tenantDomain`, `marketId`, `name`, `title`, `companyName`, `email`, `linkedinUrl`, `hubspotContactId`, `hubspotCompanyId`, `source` (`hubspot|manual|linkedin|import`), `icpScore` (int), `scoreBreakdown` (jsonb — per-signal), `disqualifiedReason`, `researchDossier` (text/markdown), `signals` (jsonb), **`status`** (the enum from §2.1), `ownerUserId`, `nextActionAt`, timestamps.
- **`cadence_templates`** + **`cadence_steps`** — reusable sequences. Step: `stepNumber`, `channel`, `dayOffset`, `businessHoursOnly`, `templateHint`, `purpose` (`intro|value|case_study|breakup`).
- **`outreach_touches`** — generated drafts + history (one row per touch). `id`, `prospectId`, `campaignId`, `channel`, `stepNumber`, `subject`, `body`, **`status`** (`draft_pending_approval|approved|sent|skipped|bounced|replied`), `outlookDraftId` (Graph message id), `linkedinThreadRef`, `complianceFlags` (jsonb), `voiceProfileId`, `generatedAt`, `approvedBy`, `sentAt`.
- **`outreach_settings`** (per tenant) — kill-switches/caps: `globalPause` (bool), `dailySendCap`, `weeklyPerDomainCap`, `minReplyRateFloor`, `defaultVoiceProfileId`. (Suppression reuses **`email_suppressions`**.)

Migrations follow the repo convention: edit `shared/schema.ts` → `npm run db:generate` → `npm run db:push` (see `drizzle.config.ts`, `migrations/`).

### 5.2 Services (new)

| File | Type | Responsibility |
|---|---|---|
| `server/services/prospector-core.ts` | pure | ICP scoring math (weighted signals vs. persona), disqualifier rules, score→qualified/disqualified threshold. Unit-tested. |
| `server/services/prospector-service.ts` | side-effecting | Pull candidates from HubSpot (+ optional LinkedIn MCP research), call `completeForFeature('prospectResearch', …)` for the dossier, write `prospects` rows, advance `new→researched`. |
| `server/services/outbound-voice-service.ts` | side-effecting | **Voice-DNA extraction** from the seller's Graph **Sent Items** (the harness's "20+ replied messages"); produce/update a `social_account_voice_profiles`-shaped outbound profile. Reuses `voice-service.ts`. |
| `server/services/outreach-composer-core.ts` | pure | Prompt assembly from dossier + voice + battlecard objections; per-channel format/length guardrails. |
| `server/services/outreach-composer-service.ts` | side-effecting | `completeForFeature('outreachComposer', …)` → draft; runs compliance scan; writes `outreach_touches` as `draft_pending_approval`. Reuses `copywriter-service.ts` patterns + `AIRewritePanel` lineage. |
| `server/services/compliance-core.ts` | pure | **AI-cliché / banned-phrase scanner** (seeded from `voice-guidelines.md` banned register + voice profile `forbiddenPhrases`), suppression + self-email guard, CAN-SPAM/GDPR structural checks. Returns `{ pass, flags[], suggestedFixes[] }`. Unit-tested. |
| `server/services/cadence-core.ts` | pure | State-machine transitions, timing-window/business-hours math, due-step computation, cap & kill-switch enforcement. Unit-tested. |
| `server/services/cadence-service.ts` | side-effecting | Detect sends/replies by reading the seller's Graph **Sent Items + Inbox**; advance states; queue next-step drafts. Runs on a schedule (`scheduled-jobs.ts`). |
| `server/services/outlook-draft-service.ts` | side-effecting | Extend `entra-graph-service.ts`: create a **draft** in the seller's mailbox, read sent/inbox for cadence detection. **Requires `Mail.ReadWrite` Graph scope (new).** |
| `server/services/linkedin-mcp-client.ts` | side-effecting | **New** server-side MCP client for the LinkedIn MCP server (prospect research + messaging where permitted). Net-new integration architecture. |

HubSpot reuse: `hubspot-integration.ts` already does read (contacts/companies/deals) + write (notes/tasks) — log each approved/sent touch as a HubSpot **engagement/task** and import contacts as prospects.

### 5.3 Routes (`server/routes/sales-outreach.ts`, registered in `server/routes.ts`)

Each route gates with `guardFeature(req, res, …)` and meters AI-heavy actions via `reserveManualAction()` (commit on success/fail), exactly like `editorial-calendar.ts`.

- `POST /api/sales-outreach/campaigns` — create from goal + product + personas + channels
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

- `outreach-campaigns.tsx` — list/create campaigns by goal; readiness banner.
- `campaign-detail.tsx` — prospects table (state badges, ICP score, next action); bulk compose/approve.
- `prospect-detail.tsx` — dossier, score breakdown, touch timeline, **draft editor with compliance flags** (reuse `components/marketing/AIRewritePanel.tsx`), "Approve → Outlook" button.
- `outreach-settings.tsx` — voice profile + extraction, caps/kill-switch (global pause), suppression.

### 5.5 Feature gating & metering

Add to `FEATURE_REGISTRY` (`server/services/plan-policy.ts`) + plan matrices; register AI features in the `AIFeature` union for `completeForFeature()`:

| Feature key | Category | Suggested tiers | Metered action |
|---|---|---|---|
| `salesOutreachCampaigns` | sales | enterprise, unlimited | — |
| `prospectResearch` | sales | enterprise, unlimited | `generateProspectDossier` |
| `outreachComposer` | sales | enterprise, unlimited | `generateOutreachDraft` |
| `outreachCadence` | sales | enterprise, unlimited | — |

---

## 6. Roadmap

**Phase 0 — Grounding & schema.** Add the 5 tables; extend `strategic-context.ts` with a sales bundle (products + battlecard objections + ICP personas + voice); ship `GET /readiness`. Register feature keys + `AIFeature`s.

**Phase 1 — Prospector.** Campaign creation from a goal; HubSpot contact/company import; `prospector-core` scoring + `completeForFeature` dossier; `prospects` state machine `new→researched`. Outbound **voice-DNA extraction** from Graph Sent Items.

**Phase 2 — Composer + Outlook drafts.** `outreach-composer` (email + LinkedIn copy) grounded in dossier + voice + objections; **`compliance-core` cliché/banned-phrase + suppression + CAN-SPAM scan** on every draft; **`Mail.ReadWrite` Graph scope** + `outlook-draft-service` to push approved drafts to the seller's Outlook Drafts. HubSpot activity logging.

**Phase 3 — Cadence + kill-switches.** `cadence-core` state machine + timing windows; `cadence-service` reply/send detection via Graph (scheduled); follow-up drafting; `outreach_settings` caps + global pause + reply-rate floor.

**Phase 4 — LinkedIn MCP + performance loop.** Wire the LinkedIn **MCP client** for research/messaging; close the loop — reply/meeting rates and HubSpot deal attribution feed back into ICP scoring (mirrors the marketing performance-analyst).

---

## 7. Dependencies, risks & open questions

- **Graph scope (blocks Phase 2).** Today's Graph connection is **app-only, read** (`msal-config.ts`). Creating drafts in a seller's mailbox needs **`Mail.ReadWrite`** (app-only with a target user, or delegated) — a new admin-consented scope. Confirm the tenant-admin consent path before Phase 2.
- **Reading the seller's mailbox (privacy).** Cadence reply/send detection and voice-DNA extraction read Sent Items + Inbox. Needs explicit per-seller opt-in and a clear data-use note; scope to the connected user only.
- **LinkedIn MCP (Phase 4).** Net-new server-side MCP-client architecture (none exists in `server/` today). Which MCP server, auth model, and **LinkedIn ToS** for automated messaging must be settled before build; until then LinkedIn is **copy-assist** (generate text, seller pastes).
- **Draft-only invariant.** v1 never auto-sends. Auto-send (reusing the SendGrid pipeline) is a deliberate later decision, not in scope.
- **Voice DNA quality.** Extraction needs enough real sent mail ("20+ replied messages"); readiness check warns when thin and falls back to the messaging-framework tone.
- **Reuse vs. new.** Suppression reuses `email_suppressions`; voice reuses `social_account_voice_profiles`. Confirm we're not duplicating the marketing campaign tables (`campaigns`, `generatedEmails`) — these are **1:1 sales** objects, intentionally separate.

---

## 8. Summary

Orbit already holds the sales-harness config as live data, has a connected HubSpot CRM and M365 Graph, and ships a battle-tested marketing AI pipeline whose architecture maps **one-to-one** onto this feature. We translate Cowork's three agents into three Orbit services (**prospector → composer → cadence**) over a relational `prospects` state machine, keep the **human-approval-in-Outlook** invariant, ground every draft in brand voice with **AI-cliché removal**, and enforce **kill-switches/caps** — reusing the AI provider, strategic-context grounding, job queue, and plan-gating throughout. Outlook rides the existing Graph connection (+`Mail.ReadWrite`), HubSpot the existing OAuth client, and LinkedIn a new MCP client sequenced last.
