# Cowork Marketing Skills → Orbit In-Product Capabilities Plan

**Status:** Proposal (revised)
**Created:** 2026-06-07
**Owner:** chris.mcnulty@synozur.com
**Source analyzed:** [`chris-mcnulty/copilot-skills`](https://github.com/chris-mcnulty/copilot-skills) — `cowork/copilot-cowork-marketing` (7 marketing skills + installer)

> **Scope note (revised):** This plan covers the **marketing** capabilities only. The Cowork `sales-harness-bundle` (business-development / outbound) is **deferred — out of scope for now**. The goal is **in-product Orbit capabilities**, not more markdown skill files: primarily **content development**, then **scheduling**, and — once the right MCP tool sets are connected — **distribution**.
>
> **Dependency:** A parallel effort is expanding Orbit's per-tenant **brand definitions** (brand colors, font files, logos) which, together with the existing visual asset library, makes content generation far more brand-aligned. This plan treats brand identity as a first-class generation input. **Rebase this branch onto `main` once that brand work lands**, then reconcile the brand-identity references in §3 and §5 against the real schema.

---

## 1. Executive summary

The Cowork marketing skills are a closed loop for Microsoft 365 Copilot: positioning → content strategy → copywriting → repurposing → SEO/AEO → distribution → performance, all grounded in a hand-authored `variables.md` of company intrinsic data (company, products, **ICP**, value prop, **positioning/messaging framework (MPF)**, category, competitors, proof points, tone, channels).

**The insight for Orbit:** Orbit already stores, as live first-class data, almost everything Cowork makes users type into `variables.md` — and once the in-flight brand work lands, it will also hold the **visual brand identity** (colors, fonts, logos, approved assets). So Orbit can deliver these as **in-product capabilities that are brand- and data-grounded by default**, with no onboarding interview.

This revision pivots the deliverable away from authoring `.agents/skills/*.md` files and toward **product features** organized under three pillars:

1. **Content development** (the priority) — generate brand-aligned, demand-grounded marketing content end to end.
2. **Scheduling** — turn that content into a planned editorial calendar on Orbit's existing scheduler/Planner sync.
3. **Distribution** — publish to channels, expanded via MCP tool connections as they come online.

A thin closed-loop **performance feedback** capability ties results back into content development, reproducing the heart of the Cowork chain.

---

## 2. Source analysis — Cowork marketing suite

A closed-loop chain of seven skills plus an installer; each reads/writes a shared `variables.md` and persists artifacts to SharePoint.

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

| Skill | Produces | Key logic / guardrails |
|---|---|---|
| **install-marketing-skills** | Populated `variables.md` + folders | Scans M365 to draft answers, confirms via interview, rejects generic ICP. *(Orbit equivalent: assemble from intrinsic data — no interview.)* |
| **positioning-researcher** | Positioning dossier: `icp_pains`, `competitor_audit`, `gap_analysis`, `voc_signals`, 3 `positioning_options`, 5 `content_battlegrounds`, `sources` | Internal data first, then external research; quotes ≤125 chars; every claim sourced; "unknown" over fabrication. |
| **content-strategist** | 30-day editorial calendar, 15–20 briefs | **Demand-first** (every topic has a search/social signal); funnel balance 40% awareness / 35% consideration / 25% decision; each brief names one target reader + differentiation angle + CTA + est. hours. |
| **copywriter** | Drafts (LinkedIn, blog, newsletter, landing) in brand voice | Works from briefs; voice-matched; ready to edit. |
| **repurposing-engine** | 8–10 variants of one long-form asset | Multiplies velocity across formats/platforms. |
| **seo-aeo-optimizer** | SEO metadata + AEO answer blocks | Dual-stack: SEO (title ≤60c, meta ≤155c, 1 primary + 2-3 secondary keywords) **and** AEO (TL;DR, 3 self-contained answer blocks, 3-5 FAQ, entity reinforcement, internal links, content-gap analysis). |
| **distribution-planner** | Channel/format/posting-window schedule | Prevents content decaying in drafts; human still posts. |
| **performance-analyst** | Weekly report + feedback to content-strategist | **Conversion-first** (rejects impressions/likes); benchmarks against the company's *own* history (≥4-week lookback); outputs 3 actions + 2 experiments + 1 stop-doing; closes the loop. |

### 2.1 The `variables.md` intrinsic-data pattern

`{your_company}`, `{products}`, `{icp_description}`, `{value_prop}`, `{positioning_framework}` (**MPF**), `{your_category}`, `{competitors}`, `{proof_points}`, `{tone}`, `{channels}`, `{time_zones}`, `{sharepoint_root}`.

---

## 3. Orbit's intrinsic data = Cowork's `variables.md` (+ brand identity)

Orbit already holds every `variables.md` field as live, multi-tenant, multi-market data. The in-flight brand work adds the **visual identity** layer that Cowork never had — making Orbit's content generation more brand-aligned than the source skills.

| `variables.md` field | Orbit intrinsic source | Reference |
|---|---|---|
| `{your_company}` | `company_profiles` | `shared/schema.ts` |
| `{products}` | `products`, `product_features` | `server/routes/products.ts` |
| `{icp_description}` | **`personas`** (`isIcp`, painPoints/goals/objections/channels) | `marketing/personas.tsx` |
| `{value_prop}` | `long_form_recommendations` (`messaging_framework`) + `StrategicContext` | `server/services/strategic-context.ts` |
| `{positioning_framework}` (**MPF**) | `long_form_recommendations` (`messaging_framework`) + `competitive_positioning_map` | `server/routes/positioning-map.ts` |
| `{your_category}` | `company_profiles` / `markets` (b2b/b2c) | `shared/schema.ts` |
| `{competitors}` | `competitors`, `competitor_scores`, `analysis`, `battlecards` | `server/routes/competitors.ts` |
| `{proof_points}` | `content_assets` (`case_study`), `battlecards.quickStats` | `server/routes/marketing-saturn.ts` |
| `{tone}` (verbal voice) | **`social_account_voice_profiles`** (tone attributes, preferred/forbidden phrases, sample snippets) | `server/routes/marketing-saturn.ts` |
| `{channels}` | `campaigns`, `social_accounts`, marketing-plan activity groups | `server/routes/analytics-data.ts` |
| `{time_zones}` | `markets` / tenant config | `shared/schema.ts` |
| **Brand identity** *(new — visual voice)* | **In-flight brand work**: per-tenant brand colors, **font files**, **logos** + existing `brand_assets` / `brand_asset_categories` (visual asset library) | `server/routes/marketing-saturn.ts`, brand work (TBD) |
| `{sharepoint_root}` | SharePoint Embedded storage | `server/services/sharepoint-*.ts` |

**Consequence:** Orbit needs **no `install-marketing-skills` interview**. Extend `strategic-context.ts` to emit a complete intrinsic-data bundle — verbal voice (`social_account_voice_profiles`) **plus** visual brand identity (brand colors/fonts/logos/assets) — and surface a **readiness check** that flags thin fields (no ICP persona, no messaging framework, no brand kit) instead of asking questions.

---

## 4. Gap analysis — what Orbit has vs. needs (marketing only)

| Cowork capability | Orbit today | Gap |
|---|---|---|
| Intrinsic context (`variables.md`) | `StrategicContext` assembles messaging, GTM, personas, recommendations, competitive intel | **S** — add products, verbal voice, brand identity, proof points, channels, category; add readiness report |
| positioning-researcher | `analysis` (gaps), `competitor_scores`, `positioning_map`, `battlecards`, news monitoring | **M** — no structured *positioning dossier* artifact; no external VoC mining |
| content-strategist | `marketing_plans` + AI `marketing_tasks`, `tracked_keywords`/`seo_metrics` | **M** — tasks aren't *demand-scored content briefs*; no funnel balancing; no editorial-calendar object |
| copywriter | `generated_posts`, `generated_emails` with voice profiles + rewrite lineage | **S** — strong already; add brand-asset binding + blog/landing formats |
| repurposing-engine | Conference promotion + campaigns fan out; no general repurpose | **M** — no one-asset → 8–10 multi-format flow |
| seo-aeo-optimizer | `seo_metrics`, `tracked_keywords`, SERP via SERP API | **L** — tracking only; **no on-page SEO/AEO content optimization** |
| distribution-planner | Campaign scheduler, Microsoft Planner sync, conference cadence | **S** — scheduling exists; add channel/window *recommendation* layer |
| distribution (publish) | Direct social publishing (`social-publishers/`, `linkedin-api.ts`) | **MCP-gated** — expand channel coverage via MCP tool sets as connected |
| performance-analyst | `analytics_daily` (GA4), `orbit_scores`, page views + UTM, `seo_metrics` | **M** — no per-content conversion attribution; no weekly closed-loop report |

---

## 5. Proposed in-product capabilities

All AI generation reuses existing infrastructure: `completeForFeature()` (`ai-provider.ts`) for caching/retry/multi-provider, the extended `StrategicContext` for grounding, `job-queue.ts` for async 202 + polling, and `plan-policy.ts` `FEATURE_REGISTRY` for gating. Each feature is a real route/service/UI surface in the existing Marketing area — **not** a markdown skill.

### Pillar 0 — Brand & context grounding (foundation)

- **Marketing context assembler + readiness check.** Extend `strategic-context.ts` to bundle verbal voice and **visual brand identity** (colors, fonts, logos, approved assets). Add `GET /api/marketing/context-readiness` returning per-field status + fix links. *Depends on the brand work landing.*
- **Brand-aware generation.** Every generator below consumes the brand kit so copy matches verbal voice and any rendered/visual output (images, PDFs, templated graphics via `sharp`) uses tenant fonts/logos/colors.

### Pillar 1 — Content development *(priority)*

1. **Positioning dossier** (parallel to positioning-researcher). New `positioning_dossiers` table + `POST /api/baseline/positioning-dossier/generate` (async). Grounds in `personas.painPoints`, `competitors`/`analysis.gaps`, `competitor_scores`, `battlecards`, news. Optional external VoC mining via `web-crawler` (sourced, ≤125-char quotes), degrading to internal-only.
2. **Editorial calendar + content briefs** (content-strategist). Extend `marketing_tasks` (or add `content_briefs`) with demand signal, funnel stage, differentiation angle, target persona, CTA, est. hours; enforce demand-signal + funnel-mix guardrails. Demand from `tracked_keywords`/`seo_metrics`; angles from dossier `content_battlegrounds`.
3. **Multi-format copywriter** (copywriter). Extend the existing post/email generators to consume a brief and add **blog** and **landing-page** formats; bind brand assets + voice profile; reuse `AIRewritePanel` + rewrite lineage.
4. **Repurposing engine.** `POST /api/content-assets/:id/repurpose` (async) → 8–10 brand-aligned variants written into the existing posts/campaign pipeline.
5. **SEO/AEO optimizer** *(largest net-new capability)*. New `content_optimizations` table + `POST /api/content/optimize` producing SEO metadata + AEO answer blocks/FAQ + internal-link suggestions + content-gap analysis, with Cowork guardrails (title ≤60c, meta ≤155c, answer blocks 2-3 sentences). Internal-link validation uses the `content_assets` inventory.

### Pillar 2 — Scheduling

6. **Distribution/editorial planner.** A recommendation layer on top of the existing campaign scheduler / Microsoft Planner sync / conference cadence: map each asset to channel + format + posting window using `campaigns`, `social_accounts`, `markets.time_zones`, and performance history; write into the existing calendar/scheduler.

### Pillar 3 — Distribution *(MCP-gated)*

7. **Channel publishing.** Use existing direct publishers (`social-publishers/`, `linkedin-api.ts`) where present; **expand channel coverage through MCP tool sets as they are connected.** Keep the existing draft → approved → published status flow and per-action quotas. Sequence this pillar *after* the right MCP integrations are available.

### Cross-cutting — Performance feedback loop

8. **Marketing performance report** (performance-analyst). Per-content conversion attribution (join UTM/landing analytics to `content_assets`/`generated_posts`) + `marketing_performance_reports` table; conversion-first, benchmarked against tenant history; emits `recommendations` rows so insights feed back into the editorial calendar — closing the loop.

### Feature gating

Add to `FEATURE_REGISTRY` (`server/services/plan-policy.ts`) + plan matrices, gate with `guardFeature()`, meter AI-heavy actions via `manual-action-quota.ts`:

| Feature key | Category | Suggested tiers |
|---|---|---|
| `positioningDossier` | intelligence | pro, enterprise, unlimited |
| `editorialCalendar` | marketing | pro, enterprise, unlimited |
| `contentRepurposing` | marketing | enterprise, unlimited |
| `seoAeoOptimizer` | marketing | enterprise, unlimited |
| `distributionPlanner` | marketing | pro, enterprise, unlimited |
| `marketingPerformance` | marketing | pro (limited), enterprise, unlimited |

---

## 6. Roadmap

**Phase 0 — Grounding (after brand work merges).** Rebase onto `main`; extend `StrategicContext` with verbal voice + visual brand identity; ship context-readiness. Unblocks brand-aligned generation everywhere.

**Phase 1 — Content development (priority).** Positioning dossier → demand-scored editorial calendar/briefs → multi-format copywriter. Reconstructs the front half of the Cowork chain.

**Phase 2 — Production depth + scheduling.** SEO/AEO optimizer (biggest net-new), repurposing engine, distribution/editorial planner on the existing scheduler.

**Phase 3 — Distribution (MCP-gated).** Expand channel publishing as MCP tool sets connect.

**Phase 4 — Close the loop.** Marketing performance report feeding recommendations back into the calendar.

---

## 7. Dependencies, risks & open questions

- **Brand work (blocking for Phase 0).** Colors, font files, logos land via the parallel agent. **Rebase this branch onto `main` once merged**, then reconcile §3/§5 brand references against the real schema (table/column names for brand kit and font/logo storage).
- **MCP for distribution.** Phase 3 depends on which MCP tool sets get connected; sequence it after those land. Until then, distribution rides existing direct publishers.
- **External VoC mining.** positioning-researcher's G2/Reddit quote mining needs outbound web access + raises ToS/quality concerns — internal-data-first, external as an optional sourced, plan-gated add-on.
- **AEO scope.** Ship structural guardrails (TL;DR, answer blocks, FAQ, entity reinforcement); treat AI-citation tracking as a separate measurement effort.
- **Business development:** explicitly deferred. Re-open the sales-harness analysis when prioritized.

---

## 8. Summary

Orbit already supplies the entire Cowork `variables.md` from intrinsic data, and the in-flight brand work adds a visual-identity layer the source skills never had — so Orbit can ship **brand-aligned, data-grounded marketing capabilities in-product**, not as markdown skills. Lead with **content development** (positioning dossier → demand-scored calendar → multi-format, brand-bound copy → SEO/AEO + repurposing), layer in **scheduling** on the existing scheduler, then add **distribution** as MCP tools connect, and finally close the loop with conversion-first performance feedback. Everything reuses Orbit's existing AI provider, strategic-context grounding, job queue, and plan-gating. **Rebase onto `main` once the brand work merges before starting Phase 0.**
