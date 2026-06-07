# Cowork Skills → Orbit Parallel Capabilities Plan

**Status:** Proposal
**Created:** 2026-06-07
**Owner:** chris.mcnulty@synozur.com
**Source analyzed:** [`chris-mcnulty/copilot-skills`](https://github.com/chris-mcnulty/copilot-skills) — `cowork/copilot-cowork-marketing` (7 marketing skills + installer) and `cowork/sales-harness-bundle` (business-development agents)

---

## 1. Executive summary

The Cowork skills are markdown "skills" for Microsoft 365 Copilot that chain together a marketing operation (positioning → strategy → copy → repurposing → SEO/AEO → distribution → performance) and an outbound business-development operation (prospect → compose → cadence). Every skill is grounded in a single hand-authored `variables.md` file that captures the company's intrinsic data: company, products, **ICP**, value proposition, **positioning/messaging framework (MPF)**, category, competitors, proof points, tone, channels, and time zones.

**The core insight for Orbit:** Orbit already stores, as live first-class data, almost everything the Cowork skills ask a user to type into `variables.md`. Personas *are* the ICP; `long_form_recommendations` (type `messaging_framework`) *is* the MPF; `products` + `product_features` *are* the product list; `competitors` + `analysis` + `battlecards` *are* the competitive landscape; `social_account_voice_profiles` *are* the tone/brand voice. Orbit can therefore reproduce these capabilities **without an onboarding interview**, assembling the equivalent of `variables.md` on demand from `server/services/strategic-context.ts`.

This plan (a) inventories the Cowork skills, (b) maps each Cowork `variables.md` field to its intrinsic Orbit source, (c) does a gap analysis against Orbit's existing features, and (d) proposes a phased build of **parallel Orbit Agent Skills** (in `.agents/skills/`, matching the existing `cowork-gtm-analysis` precedent) backed by a prioritized set of **product capability gaps** (new endpoints/services/tables) where Orbit lacks the underlying data or generation step.

---

## 2. Source analysis — the Cowork skills

### 2.1 Marketing suite (`cowork/copilot-cowork-marketing`)

A closed-loop chain of seven skills plus an installer. Each reads/writes shared `variables.md` and persists artifacts to SharePoint folders.

```
install-marketing-skills  (interview + Work IQ scan → variables.md + folders)
        │
positioning-researcher → content-strategist → copywriter
                              ▲                    │
                              │              repurposing-engine
                              │                    │
        performance-analyst ──┘             seo-aeo-optimizer
              ▲                                    │
              └──────── distribution-planner ◀─────┘
```

| Skill | What it produces | Key logic / guardrails |
|---|---|---|
| **install-marketing-skills** | Populated `variables.md` + 8 SharePoint folders | Scans M365 (tenant profile, SharePoint one-pagers, CRM, Outlook, published content) to draft answers, then confirms via 7-section interview. Rejects generic ICP answers. |
| **positioning-researcher** | Positioning dossier (JSON): `icp_pains`, `competitor_audit`, `gap_analysis`, `voc_signals`, 3 `positioning_options`, 5 `content_battlegrounds`, `sources` | Grounds in M365 first, then external research (G2/Reddit/LinkedIn). Verbatim quotes ≤125 chars; every claim sourced; writes "unknown" rather than fabricate. |
| **content-strategist** | 30-day editorial calendar, 15–20 content briefs | **Demand-first** — every topic needs a search/social demand signal. Funnel balance 40% awareness / 35% consideration / 25% decision. Each brief: keyword, demand signal, differentiation angle, one named target reader, CTA, time estimate. |
| **copywriter** | Drafts (LinkedIn, blog, newsletter, landing) in brand voice | Works from content briefs; voice-matched; ready-to-edit. |
| **repurposing-engine** | 8–10 variants of one long-form asset across formats/platforms | Multiplies content velocity without restarting. |
| **seo-aeo-optimizer** | SEO metadata + AEO answer blocks | Dual-stack: traditional SEO (title ≤60c, meta ≤155c, 1 primary + 2-3 secondary keywords) **and** answer-engine optimization (TL;DR, 3 self-contained answer blocks, 3-5 FAQ, entity reinforcement, internal links, content-gap analysis). |
| **distribution-planner** | Channel/format/posting-window schedule synced to Outlook | Prevents content decaying in drafts; execution still requires a human posting. |
| **performance-analyst** | Weekly performance report (JSON) + feedback to content-strategist | **Conversion-first** — rejects impressions/likes as success. Benchmarks against the company's *own* history (≥4-week lookback). Output: top/under performers, channel efficiency, patterns, SEO/AEO movement, 3 actions + 2 experiments + 1 stop-doing. Closes the loop. |

### 2.2 Business-development suite (`cowork/sales-harness-bundle`)

A three-agent, human-in-the-loop outbound system (no auto-send in v1). Lead state machine: `new → researched → draft_pending_approval → sent → awaiting_reply`.

| Agent / skill | Role |
|---|---|
| **Prospector** + **ICP-Research** + **Prospect-Files** | Research leads against the ICP; write research dossiers (markdown + YAML metadata). |
| **Composer** + **Outbound-Voice** | Draft personalized messages in the firm's voice DNA; write to Outlook Drafts. |
| **Cadence** + **Cadence-Rules** | Detect replies, queue templated follow-ups, enforce send caps and reply-rate monitoring. |
| **Compliance** + **Kill-Switches** + **Outlook-Ops** | Compliance checks, throttles, and the Outlook draft/send integration. **Every send waits for a human click.** |

> **Interpretation note:** the task says "marketing analytics **and development**." Read in the Cowork context, "development" = **business development** (the sales-harness outbound suite), not software development. This plan treats it that way; flag if a different meaning was intended.

### 2.3 The `variables.md` intrinsic-data pattern

| Cowork variable | Meaning |
|---|---|
| `{your_company}` | Org name + core value |
| `{products}` | Offerings with descriptions |
| `{icp_description}` | Target buyer profile / segment |
| `{value_prop}` | Specific outcome delivered |
| `{positioning_framework}` | **MPF** — market position vs. competitors |
| `{your_category}` | Product classification |
| `{competitors}` | 3–5 direct rivals |
| `{proof_points}` | Cases, metrics, endorsements |
| `{tone}` | Voice / communication style |
| `{channels}` | Distribution platforms |
| `{time_zones}` | ICP geo/temporal spread |
| `{sharepoint_root}` | Asset repository |

---

## 3. Orbit's intrinsic data = Cowork's `variables.md`

Orbit already holds every `variables.md` field as live, multi-tenant, multi-market data. This is the foundation of the "rely on intrinsic data whenever possible" directive.

| `variables.md` field | Orbit intrinsic source (table / service) | Reference |
|---|---|---|
| `{your_company}` | `company_profiles` | `shared/schema.ts` |
| `{products}` | `products`, `product_features` | `server/routes/products.ts` |
| `{icp_description}` | **`personas`** (`isIcp` flag, painPoints/goals/objections/preferredChannels) | `client/.../marketing/personas.tsx` |
| `{value_prop}` | `long_form_recommendations` (`messaging_framework`) + `StrategicContext.messagingFramework` | `server/services/strategic-context.ts` |
| `{positioning_framework}` (**MPF**) | `long_form_recommendations` (`messaging_framework`) + `competitive_positioning_map` | `server/routes/positioning-map.ts` |
| `{your_category}` | `company_profiles` / `markets` (b2b/b2c) | `shared/schema.ts` |
| `{competitors}` | `competitors`, `competitor_scores`, `analysis`, `battlecards` | `server/routes/competitors.ts`, `battlecards.ts` |
| `{proof_points}` | `content_assets` (`case_study`), `battlecards.quickStats` | `server/routes/marketing-saturn.ts` |
| `{tone}` | **`social_account_voice_profiles`** (tone attributes, preferred/forbidden phrases, sample snippets) | `server/routes/marketing-saturn.ts` |
| `{channels}` | `campaigns`, `social_accounts`, marketing-plan activity groups | `server/routes/analytics-data.ts` |
| `{time_zones}` | `markets` / tenant config | `shared/schema.ts` |
| `{sharepoint_root}` | SharePoint Embedded storage | `server/services/sharepoint-*.ts` |

**Consequence:** Orbit does **not** need a `install-marketing-skills` interview. Instead it needs a thin "marketing context assembler" that extends `StrategicContext` to emit the full intrinsic-data bundle, plus a readiness check that tells the user which fields are thin (e.g., "no ICP persona defined", "messaging framework not generated") — the same red-flags the Cowork installer surfaces, but driven by data presence instead of an interview.

---

## 4. Gap analysis — what Orbit already has vs. what's missing

| Cowork capability | Orbit today | Gap to close |
|---|---|---|
| Intrinsic context (`variables.md`) | `StrategicContext` already assembles messaging, GTM, personas, recommendations, competitive intel | **Small** — add products, voice, proof points, channels, category; add a "context readiness" report |
| positioning-researcher | `analysis` (gaps), `competitor_scores`, `positioning_map`, `battlecards`, `news-monitoring` | **Medium** — no structured *positioning dossier* artifact; no external VoC mining (G2/Reddit reviews) |
| content-strategist | `marketing_plans` + `marketing_tasks` (AI-generated from GTM), `tracked_keywords`/`seo_metrics` | **Medium** — tasks aren't *demand-signal-scored* content briefs; no funnel-stage balancing; no editorial calendar object |
| copywriter | `generated_posts`, `generated_emails` with voice profiles + rewrite lineage | **Small** — already strong; extend formats (blog, landing page) |
| repurposing-engine | Conference promotion fans out per-session posts; campaigns fan out per-account | **Medium** — no general one-asset → 8–10 multi-format repurpose flow |
| seo-aeo-optimizer | `seo_metrics`, `tracked_keywords`, SERP via SERP API | **Large** — tracking only; no *on-page* SEO/**AEO** content optimization (titles, meta, answer blocks, FAQ, internal links) |
| distribution-planner | Campaign scheduler, direct social publishing, Microsoft Planner sync, conference cadence | **Small** — scheduling exists; add channel/window *recommendation* layer |
| performance-analyst | `analytics_daily` (GA4), `orbit_scores`, page views + UTM, `seo_metrics` | **Medium** — no per-content-piece conversion attribution; no weekly closed-loop report feeding content-strategist |
| Prospector / ICP-Research | `personas` (ICP), HubSpot CRM enrichment, `competitors` | **Large** — no lead/prospect data model; no prospect dossier generation |
| Composer / Outbound-Voice | Voice profiles, email generation, Entra Graph (Outlook) access | **Medium** — outbound 1:1 drafting exists in pieces; needs prospect-scoped composer |
| Cadence / Cadence-Rules | Job queue, scheduled jobs, notifications | **Large** — no outbound sequence/cadence engine, reply detection, or send caps |
| Compliance / Kill-Switches | Plan gating, manual-action quotas, approval statuses | **Small** — quota/approval primitives already exist; add outbound-specific governance |

---

## 5. Proposed parallel capabilities

### 5.1 Architecture decision

Build in **two layers**, mirroring the existing repo precedent (`.agents/skills/cowork-gtm-analysis/SKILL.md`):

1. **Orbit Agent Skills** (`.agents/skills/<name>/SKILL.md`) — cheap, markdown-only orchestration guides that tell an operator (or an in-app assistant) exactly how to drive Orbit's data + AI endpoints to reproduce each Cowork skill, *grounded in intrinsic data*. These ship first and deliver immediate value on top of existing features.
2. **Product capability gaps** — the new endpoints/services/tables needed where Orbit can't yet produce the artifact (positioning dossier, content briefs, AEO optimizer, repurposing, performance report, prospect/cadence engine). These are the real engineering investment, prioritized in §6.

All AI generation reuses existing infrastructure: `completeForFeature()` (`server/services/ai-provider.ts`) for caching/retry/multi-provider, `StrategicContext` for grounding, `job-queue.ts` for async 202 + polling, and `plan-policy.ts` `FEATURE_REGISTRY` for gating.

### 5.2 Skill-by-skill build plan

Each entry lists the **new skill**, the **intrinsic data** it consumes, and the **product gap** (if any) it needs.

#### A. `orbit-marketing-context` (parallel to `install-marketing-skills`)
- **Skill:** Documents how Orbit assembles the `variables.md` equivalent automatically, and runs a "context readiness" check (which intrinsic fields are present/thin).
- **Intrinsic data:** all of §3 via `StrategicContext`.
- **Product gap (S):** extend `strategic-context.ts` to include products, voice profiles, proof points, channels, category; add `GET /api/marketing/context-readiness` returning per-field status + fix links (reuse the red-flag style of `cowork-gtm-analysis`).

#### B. `orbit-positioning-researcher`
- **Skill:** Produce a positioning dossier (icp_pains, competitor_audit, gap_analysis, voc_signals, 3 positioning_options, 5 content_battlegrounds) from Orbit data.
- **Intrinsic data:** `personas.painPoints`, `competitors.crawlData`/`analysis.gaps`, `competitor_scores`, `battlecards`, `news-monitoring`.
- **Product gap (M):** new `positioning_dossiers` table + `POST /api/baseline/positioning-dossier/generate` (async, 202). Optional external VoC mining via `web-crawler`/news (G2/Reddit) with ≤125-char sourced quotes; degrade gracefully to internal-only when unavailable.

#### C. `orbit-content-strategist`
- **Skill:** Build a demand-signal-scored editorial calendar of 15–20 briefs with funnel balancing (40/35/25), grounded in SEO demand + gaps + personas.
- **Intrinsic data:** `tracked_keywords`/`seo_metrics` (demand), `analysis.gaps`/positioning dossier `content_battlegrounds`, `personas` (named target reader).
- **Product gap (M):** extend `marketing_tasks` (or add `content_briefs`) with fields: demand signal, funnel stage, differentiation angle, target persona, CTA, est. hours; enforce funnel-mix and demand-signal guardrails in the generator.

#### D. `orbit-copywriter`
- **Skill:** Voice-matched drafting from a content brief across formats.
- **Intrinsic data:** `social_account_voice_profiles`, `messaging_framework`, content brief.
- **Product gap (S):** Orbit already drafts posts/emails; extend the existing generator to consume a brief and add blog/landing-page formats. Reuse `AIRewritePanel` + rewrite-lineage.

#### E. `orbit-repurposing-engine`
- **Skill:** Turn one long-form asset into 8–10 channel/format variants.
- **Intrinsic data:** `content_assets` source piece, voice profiles, campaign target accounts.
- **Product gap (M):** `POST /api/content-assets/:id/repurpose` (async) producing variants written into the existing posts/campaign pipeline.

#### F. `orbit-seo-aeo-optimizer`
- **Skill:** Generate SEO metadata + AEO answer blocks/FAQ + internal links + content-gap analysis for a draft.
- **Intrinsic data:** `tracked_keywords`/`seo_metrics`, `content_assets` inventory (internal-link validation), category.
- **Product gap (L):** new `content_optimizations` table + `POST /api/content/optimize`. Enforce Cowork guardrails (title ≤60c, meta ≤155c, answer blocks 2-3 sentences). This is Orbit's biggest net-new marketing capability — Orbit *tracks* SEO but doesn't *optimize* content.

#### G. `orbit-distribution-planner`
- **Skill:** Recommend channel + format + posting window per asset and push to the scheduler.
- **Intrinsic data:** `campaigns`, `social_accounts`, `markets.time_zones`, performance history.
- **Product gap (S):** add a scheduling-recommendation step on top of the existing campaign scheduler / Planner sync / conference cadence.

#### H. `orbit-performance-analyst`
- **Skill:** Weekly conversion-first performance report that benchmarks against Orbit's own history and feeds recommendations back to the content-strategist.
- **Intrinsic data:** `analytics_daily` (GA4), page views + UTM, `orbit_scores`, `seo_metrics`, `generated_posts.publishedUrl` engagement.
- **Product gap (M):** per-content-piece conversion attribution (join UTM/landing analytics to `content_assets`/`generated_posts`) + `marketing_performance_reports` table; emit `recommendations` rows so the loop closes into existing planning.

#### I. Business-development: `orbit-prospector`, `orbit-composer`, `orbit-cadence`
- **Skills:** Prospect research dossier → voice-matched outbound draft → reply-aware follow-up cadence, all human-approved before send (mirror the `new → researched → draft_pending_approval → sent → awaiting_reply` state machine).
- **Intrinsic data:** `personas` (ICP), HubSpot CRM, `social_account_voice_profiles`, `messaging_framework`, `battlecards` (objection handling), Entra Graph (Outlook drafts).
- **Product gap (L):** new `prospects` + `outbound_sequences` + `outbound_messages` tables; cadence engine on `job-queue.ts`/`scheduled-jobs.ts`; reply detection via Entra Graph; send caps via `manual-action-quota.ts`. **No auto-send** — drafts only, human click to send, matching the existing draft/approved/published status pattern.

### 5.3 Feature gating

Add to `FEATURE_REGISTRY` (`server/services/plan-policy.ts`) and the plan matrices:

| New feature key | Category | Suggested tiers |
|---|---|---|
| `positioningDossier` | intelligence | pro, enterprise, unlimited |
| `editorialCalendar` | marketing | pro, enterprise, unlimited |
| `contentRepurposing` | marketing | enterprise, unlimited |
| `seoAeoOptimizer` | marketing | enterprise, unlimited |
| `distributionPlanner` | marketing | pro, enterprise, unlimited |
| `marketingPerformance` | marketing | pro (limited), enterprise, unlimited |
| `outboundProspecting` | planning | enterprise, unlimited |
| `outboundCadence` | planning | enterprise, unlimited |

Gate each route with `guardFeature(req, res, "<key>")` and meter AI-heavy actions via `manual-action-quota.ts`.

---

## 6. Phased roadmap

**Phase 0 — Skills layer (days, low risk).** Author the nine `.agents/skills/` SKILL.md guides (B–I + context) against *existing* endpoints, exactly like `cowork-gtm-analysis`. Immediate value, zero schema change. Also ship the `context-readiness` endpoint (gap A) so operators know their intrinsic data is complete.

**Phase 1 — Close the marketing loop (highest ROI).**
1. `orbit-positioning-researcher` (dossier table + endpoint).
2. `orbit-content-strategist` (briefs/calendar fields + funnel guardrails).
3. `orbit-performance-analyst` (attribution + report + feedback into `recommendations`).
These three reconstruct the positioning → strategy → performance feedback loop that is the heart of the Cowork suite.

**Phase 2 — Content production depth.**
4. `orbit-seo-aeo-optimizer` (largest net-new marketing capability).
5. `orbit-repurposing-engine`.
6. `orbit-copywriter` brief/format extensions + `orbit-distribution-planner` recommendation layer.

**Phase 3 — Business development.**
7. Prospect data model + `orbit-prospector`.
8. `orbit-composer` (Outlook drafts via Entra Graph).
9. `orbit-cadence` engine + compliance/kill-switches.

---

## 7. Risks & open questions

- **"Development" interpretation.** Assumed = business development (sales-harness outbound). Confirm before investing in Phase 3.
- **External VoC mining.** positioning-researcher's G2/Reddit quote mining needs outbound web access and raises ToS/quality concerns; recommend internal-data-first with external as an optional, sourced, plan-gated add-on.
- **Outbound deliverability/compliance.** A cadence engine touches CAN-SPAM/GDPR and sender reputation; keep v1 human-in-the-loop with no auto-send, reusing existing approval + quota primitives.
- **AEO scope.** Answer-engine optimization is fast-moving; ship the structural guardrails (TL;DR, answer blocks, FAQ, entity reinforcement) and treat citation tracking as a separate measurement effort.
- **Skills vs. in-app assistant.** These SKILL.md guides assume an operator (or agent) with access to Orbit's API. If the intent is an *in-product* AI assistant, the same skills double as its playbooks, but that assistant is a separate workstream.

---

## 8. Summary

Orbit's intrinsic data model already supplies the entire `variables.md` that the Cowork skills depend on — so the parallel capabilities can be **data-grounded by default**, skipping the onboarding interview. The fastest path is to (1) ship the markdown skills layer on top of what exists today, then (2) build the marketing feedback loop (positioning dossier → demand-scored briefs → conversion-first performance), (3) add content-production depth (AEO + repurposing), and (4) extend into human-in-the-loop business development. Each step reuses Orbit's existing AI provider, strategic-context grounding, job queue, and plan-gating infrastructure.
