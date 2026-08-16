# Orbit Strategic Intelligence Stack — Implementation Approach

**Tasks:** #543 (Segment Sizing & Needs Maps) → #544 (GTM Opportunity Matrix) → #547 (Market Study Wizard)
**Status:** Design approach (pre-development)
**Author context:** Grounded in the current Orbit codebase (multi-market model, persona module, AI provider layer, discovery/pricing/web-search services, job-queue + full-regeneration orchestration, MCP client precedent).

---

## 1. Guiding principles (derived from existing Orbit patterns)

1. **Output compatibility is a schema constraint, not a convention.** Wizard-generated data (#547) and hand-built data (#543/#544) must land in *the same tables* so downstream flows (scenario builder, campaign kit, GTM plan generation) never branch on data origin. This is already how `full-regeneration-service.ts` writes into the same `recommendations` / `long_form_recommendations` tables the manual flows use — we extend that discipline.
2. **Everything is scoped `tenantDomain` + `marketId`.** Segments, matrix cells, and studies attach to a `markets` row exactly like `personas`, `recommendations`, `positioning`, and `long_form_recommendations` already do (`toContextFilter(ctx)` from `getRequestContext`).
3. **AI is grounded and cited, never free-floating.** Market numbers must be defensible. We reuse `completeWithWebSearch` (already in `ai-provider.ts`) for public-data grounding, persist every source, and always store `{aiValue, userValue, rationale, sources, confidence}` rather than a bare number.
4. **Reuse the orchestration we already have.** `full-regeneration-service.ts` (staged pipeline + `getRegenerationStatus(jobId)` polling + per-deliverable status lanes) + `job-queue.ts` (`enqueue`, `ProgressReporter`, `updateJobProgress`) + `scheduled_job_runs` (persisted history) are the exact substrate #547 needs. We do not build a new pipeline engine.

---

## 2. Data model (Phase 1 foundation — Task #543)

New tables, all `tenantDomain` + `marketId` scoped, mirroring the `personas` table shape (`schema.ts:3879`).

### 2.1 `market_segments`
Additive **new** table rather than mutating `personas`. Rationale: personas are consumed as grounding by `brief-interview`, `editorial-calendar`, and sales `outreach` flows; widening that hot table risks those paths. Instead a segment optionally *links* to a persona and can be **backfilled** from one.

```
market_segments
  id                uuid pk
  tenantDomain      text  not null
  marketId          varchar -> markets.id (set null)
  personaId         varchar -> personas.id (set null)   -- provenance / seed link
  name              text  not null
  description       text
  -- Sizing (each figure stored as estimate + optional override + provenance)
  tamLow/tamMid/tamHigh        bigint            -- AI estimate, currency-normalized
  samLow/samMid/samHigh        bigint
  sizingCurrency               text default 'USD'
  sizingMethod                 text              -- 'top_down' | 'bottom_up' | 'triangulated'
  sizingRationale              text              -- cited narrative
  sizingConfidence             text              -- 'low' | 'medium' | 'high'
  tamUserOverride / samUserOverride  bigint      -- null unless user edits
  -- Ranking
  priorityScore                integer           -- 1..10, AI-suggested then editable
  priorityScoreSource          text              -- 'ai' | 'user'
  priorityRationale            text
  -- Needs Map (4-field structured profile)
  needsMap                     jsonb             -- { pains[], triggers[], barriers[], buyingCriteria[] }
  needsMapSource               text              -- 'ai' | 'user' | 'mixed'
  firmographics                jsonb             -- { industry, companySize, geography, ... } for bottom-up sizing
  status                       text default 'active'   -- active | archived
  createdBy, createdAt, updatedAt, lastEstimatedAt
  index (tenantDomain, marketId, priorityScore desc)
```

- **Needs Map** is stored as `jsonb` (not columns) so the four fields stay editable and extensible, matching how `personas` uses array columns and how segment rules use `jsonb`.
- Every sizing figure is a **triple** (`low/mid/high`) so the UI can show a range with confidence, which is the honest representation of a market estimate.

### 2.2 `market_intelligence_sources` (shared provenance store)
Used by #543 sizing rationale **and** #547's "Source library panel." One table, referenced polymorphically.

```
market_intelligence_sources
  id, tenantDomain, marketId
  scopeType    text     -- 'segment_sizing' | 'needs_map' | 'matrix_cell' | 'study'
  scopeId      varchar  -- the segment / cell / study id
  url          text
  title        text
  publisher    text
  excerpt      text
  retrievedAt  timestamp
  usedForField text     -- e.g. 'tam' | 'sam' | 'pains'
  index (tenantDomain, scopeType, scopeId)
```

### 2.3 `opportunity_matrix_cells` (Phase 2 — Task #544)
```
opportunity_matrix_cells
  id, tenantDomain, marketId
  segmentId   -> market_segments.id (cascade)
  needKey     text        -- canonical need id (from segment.needsMap or solution area)
  channelKey  text        -- canonical GTM channel (see §4.1)
  revenuePotential  numeric   -- from segment SAM x need/solution alignment
  executionEffort   numeric   -- AI cost/complexity estimate
  roiScore          numeric   -- derived; the ranking key
  scoreRationale    text
  isWhitespace      boolean   -- high ROI + low current coverage
  source            text      -- 'ai' | 'user'
  createdAt, updatedAt
  unique (segmentId, needKey, channelKey)
  index (tenantDomain, marketId, roiScore desc)
```

### 2.4 `market_studies` + `market_study_stages` (Phase 3 — Task #547)
```
market_studies
  id, tenantDomain, marketId
  inputType   text    -- 'url' | 'brief'
  inputValue  text
  depth       text    -- 'explore' | 'focus' | 'dominate'
  status      text    -- pending | running | completed | failed
  jobId       varchar -- ties to job-queue / scheduled_job_runs
  executiveSummary text
  resultRefs  jsonb   -- ids of segments/cells/sources this run produced or refreshed
  parentStudyId varchar -> market_studies.id  -- for refresh/drift lineage
  createdBy, createdAt, completedAt
```
Stage progress is held in-memory during a run (like `full-regeneration-service`'s `activeJobs` map) and mirrored to `scheduled_job_runs` for durable history.

---

## 3. TAM/SAM & market-analytics gathering approach (the core of #543)

This is the highest-risk, highest-value piece. The method must produce **defensible, cited** numbers, not confident hallucinations. We triangulate two independent methods and reconcile.

### 3.1 Register new AI features
Add to `AI_FEATURES` (`schema.ts:1739`) + `AI_FEATURE_LABELS` + per-feature model assignment (`aiFeatureModelAssignments`), so each is independently model-configurable, cached, and cost-logged:
- `market_sizing` (TAM/SAM)
- `segment_needs_map`
- `segment_priority`
- `opportunity_matrix`

Each call routes through `completeForFeature` / `completeWithWebSearch`, is wrapped by `ai-cache` (`getCachedResponse`/`setCachedResponse`, tenant+feature invalidation), and logged via `logAiUsage`.

### 3.2 Grounding corpus (assembled server-side, per segment)
Reuse what Orbit already collects — no new ingestion needed for v1:
- **Competitor corpus** — competitor profiles, analyses, positioning map (`positioning-map`), news (`news-service`).
- **Pricing** — `pricing-intelligence.extractPricingTiers` → competitor ACV / price points (drives revenue-per-account).
- **Solution-area context** — the tenant's own solution areas (fit filter for SAM).
- **Segment firmographics** — from the linked persona / `firmographics` jsonb (industry, company size band, geography).
- **Intelligence briefings** — existing `intelligence_briefing` outputs (pains/triggers grounding).

### 3.3 Method 1 — Top-down (published market data)
`completeWithWebSearch` prompt: retrieve published market-size / analyst figures for the segment's **industry × geography**, returning structured JSON: `{ figure, currency, year, geography, publisher, url, quote }[]`.
- Derive **TAM** from the best-supported total-market figure.
- Derive **SAM** by applying explicit, itemized haircuts (geography reachable, company-size band, solution-fit %) — each haircut carries a one-line rationale.
- Persist every retrieved source into `market_intelligence_sources`.

### 3.4 Method 2 — Bottom-up (population × ACV)
- **Population** — two grounded sources, cross-checked:
  - **U.S. Census Bureau CBP** (Dept. of Commerce, free) via `census-market-data-provider.ts` → authoritative establishment counts by NAICS × geography. NAICS resolved from the segment's industry text by `naics-mapping.ts` (crosswalk fast-path → cached AI resolver). This is the *citable* backbone.
  - **Apollo** (`discovery-service.discoverProspects`) → the *reachable/contactable* subset.
- **ACV** — median from competitor `pricing-intelligence` tiers (or user-supplied).
- **TAM ≈ population × ACV**; **SAM ≈ reachable subset** (channels we can actually serve).
- See §9 for the full data-source catalog (free/gov first).

### 3.5 Reconcile → range + confidence
- Present **low/mid/high** = reconciliation of the two methods (e.g. bottom-up as floor, top-down as ceiling, mid = blended).
- **Confidence** is `high` only when both methods agree within a band *and* have cited sources; `low` when one method is missing or sources are thin.
- Store `sizingMethod`, `sizingRationale` (the cited narrative), `sizingConfidence`, and all sources. User can override any figure; overrides are stored alongside (never overwrite) the AI estimate.

### 3.6 Guardrails (non-negotiable)
- **No uncited number rendered as fact** — UI shows the method, the confidence, and a sources popover per figure.
- **Cost control** — web-search sizing is expensive; cache aggressively, gate by plan + an analysis-limit guard (reuse the `guardAnalysisLimit` pattern), and cap web-search depth by study depth (§5).
- **Currency normalization** at write time (`sizingCurrency`).

### 3.7 Priority score & Needs Map
- **Priority (1–10)** = AI blend of SAM (opportunity), solution-fit (strategic), competitive intensity (from positioning/competitor corpus), and reachability. AI-suggested on first run, then user-editable; Segments view ranks by it with TAM/SAM badges.
- **Needs Map** = `segment_needs_map` AI-suggest over persona + briefings → `{pains, triggers, barriers, buyingCriteria}`, each field editable.

---

## 4. GTM Opportunity Matrix (Task #544)

### 4.1 Dimensions
- **Segments** — `market_segments` rows for the market.
- **Needs** — canonical need keys derived from each segment's Needs Map (+ solution areas).
- **Channels** — a canonical channel list (seed from persona `preferredChannels` + a fixed enum: events, outbound, paid, content/SEO, partner, PLG, etc.).

Each cell scored on **revenuePotential** (segment SAM × need↔solution alignment), **executionEffort** (AI cost/complexity), and derived **roiScore** (the ranking key). Whitespace = high ROI + low current coverage. All cells carry `{source: ai|user, rationale}` and are user-editable.

### 4.2 Architecture decision — Path A vs Path B (resolve before build)
**Recommendation: Path A (native) now, with a Path-B adapter seam reserved.**

Rationale grounded in the codebase:
- Most of what Segmentable's "data-assembly step" would provide **already exists in-house**: `completeWithWebSearch`, `discovery-service`, `pricing-intelligence`, `positioning-map`, `news-service`, and the `full-regeneration-service` orchestration. Path A is largely *composition of existing services*, not net-new capability.
- **Multi-tenant + per-market data partitioning + enterprise security posture** make an external vendor dependency for core scoring a data-residency and reliability liability.
- Path B's value (offloading assembly) is low precisely because assembly is already solved here.

**But** make the orchestration a **strategy boundary** so Path B stays cheap to add later:
- Define a `MarketModelProvider` interface (`estimateSizing`, `buildNeedsMap`, `scoreMatrix`) with a `NativeMarketModelProvider` (Path A).
- A future `SegmentableMcpProvider` implements the same interface via an MCP client **modeled directly on `website-mcp-client.ts`** (`callWebsiteTool` → `callSegmentableTool`; per-tenant connection config; `pingMcpServer`-style health check). The UI and output schema are already path-agnostic, so swapping providers is an adapter, not a rewrite.

This resolves the pending decision as: **Path A for #544/#547 v1; Path B slots in behind the interface if/when vendor economics justify it.**

---

## 5. Market Study Wizard (Task #547)

Model the orchestrator **directly on `full-regeneration-service.ts`**:
- `startMarketStudy(input, depth, ctx)` → creates `market_studies` row + `jobId`, runs staged pipeline, returns id.
- `getMarketStudyStatus(jobId)` → polled by client (v1 is polling, not streaming — matches the task and the existing regen pattern).
- Stages (named, with per-stage status lanes exactly like regen's `deliverables` map):
  `Competitor discovery → Intelligence briefing → Segment modeling (#543) → Market sizing (#543) → GTM matrix (#544) → Executive summary`.
- Long-running steps go through `job-queue.enqueue*` with a `ProgressReporter`; the crawl/discovery timeouts already exist (`enqueueCrawl` = 15 min).

**Depth knobs** (`Explore / Focus / Dominate`) scale breadth + cost, not code paths:
| Knob | Explore | Focus | Dominate |
|---|---|---|---|
| Competitors discovered | few | medium | many |
| Segments modeled | top N | more | full |
| Web-search sizing depth | shallow | standard | deep + both methods |
| Matrix dimensions | segment×need | +channels | full grid + whitespace |

**Output compatibility:** every stage writes into the Phase-1/2 tables (`market_segments`, `opportunity_matrix_cells`, `market_intelligence_sources`) — the Study detail page just *reads* those, so a wizard study and a hand-built market are indistinguishable to downstream flows.

**Study detail page** delivers: executive summary, ranked segments w/ TAM/SAM, matrix, top whitespace, and the source-library panel (reads `market_intelligence_sources`). **PDF export** via existing `pdf-generator` + `enqueuePdf`. **Refresh** = new `market_studies` run with `parentStudyId` set; diff current vs prior to surface drift.

**Explicitly out of scope (v1):** streaming progress, auto-publish without review, "Ask Orbit" Market Twin RAG chat.

---

## 6. Cross-cutting concerns

- **Plan gating** — add `FeatureKey`s to `FEATURE_REGISTRY` (`plan-policy.ts`): `marketSegments`, `opportunityMatrix`, `marketStudyWizard`. Gate to Enterprise (like `personaBuilder` + Saturn), enforce with `guardFeature` on every route; gate AI spend with an analysis-limit guard.
- **Migrations** — one numbered SQL migration per phase in `migrations/`, plus `schema.ts` additions and `insert*Schema` zod exports, following the existing runner conventions (e.g. the 0086 pattern).
- **Cost & abuse** — cache all AI outputs; per-depth web-search budgets; `logAiUsage` on every call; rate-limit wizard starts per tenant.
- **Backfill** — a one-time job seeding a `market_segments` row from each existing `persona` (personaId link), so current tenants land in #543 with data instead of an empty view.

---

## 7. Phasing (matches the #543 → #544 → #547 dependency chain)

- **Phase 0 — Decide & schema. ✅ DONE.** Path A ratified + adapter seam reserved. `market_segments` + `market_intelligence_sources` schema & migration `0087` landed; AI features (`market_sizing`, `segment_needs_map`, `segment_priority`) + `marketSegments` plan flag registered. See §10 for the full pre-#543 foundation checklist.
- **Phase 1 — #543.** Sizing service (dual-method, web-search grounded, cited), priority scoring, Needs Map, ranked Segments view, persona backfill. *(Foundation in place — see §10; #543 fills the three `NativeMarketModelProvider` methods + routes/UI.)*
- **Phase 2 — #544. ✅ DONE.** `opportunity_matrix_cells` + migration 0088; `scoreMatrix` on the provider; `generateMatrixForMarket` service (shared with the wizard); ROI ranking, whitespace detection, heatmap UI, cell overrides.
- **Phase 3 — #547. ✅ DONE (v1).** Wizard orchestrator on the full-regen pattern (`market-studies` + migration 0089), depth knobs, propose-segments-from-brief, staged pipeline (input → segments → sizing → matrix → summary) writing to the shared tables, live-polling detail page, refresh/drift lineage via `parentStudyId`.
  - **Deferred sub-items:** PDF export of a study (design called for `pdf-generator` + `enqueuePdf`), and autonomous competitor discovery/briefing as pipeline stages (v1 reuses the market's existing competitor data + the brief rather than crawling net-new). Out of scope per the task: streaming progress, auto-publish, and the "Ask Orbit" Market Twin RAG chat.

---

## 8. Top risks & mitigations

| Risk | Mitigation |
|---|---|
| AI fabricates market numbers | Web-search grounding + mandatory citations + confidence label + user override; never render uncited numbers as fact |
| Cost blowup (web search × multi-stage × depth) | Aggressive caching, per-depth budgets, plan + analysis-limit gating, usage logging |
| Persona/segment data duplication & drift | Single source of truth in `market_segments`; additive `personaId` link + backfill, not a fork |
| Vendor lock (if Path B chosen later) | Provider interface + MCP adapter modeled on `website-mcp-client`; path-agnostic UI/schema |
| Matrix combinatorial explosion | Cap dimensions by study depth; whitespace surfacing instead of rendering every cell |

---

## 9. Data-source catalog (free / government first)

Bottom-up sizing leans on free, authoritative U.S. government data; top-down uses web-search over published analyst/press figures. Paid analyst feeds are deliberately deferred.

| Source (agency) | Gives | Fit | Access |
|---|---|---|---|
| **Census SUSB** (Commerce) | # firms/establishments, employment, payroll, **receipts** by industry × enterprise size | Revenue-based bottom-up | Free bulk CSV (no live API) — deferred stub |
| **Census CBP** (Commerce) | # establishments, employment, payroll by NAICS × geography × size | Count-based bottom-up (**wired**) | Live API, free key (`CENSUS_API_KEY`) |
| **Census Economic Census / Nonemployer** (Commerce) | Detailed receipts; sole-props/B2C | Revenue anchors; B2C/micro | Free API |
| **BEA** (Commerce) | GDP/value-added by industry; consumer spend (PCE) | Macro industry size; B2C | Free API |
| **BLS** (QCEW/OES) | Employment & wages by industry & area | Headcount/wage-bill sizing | Free API |
| **SEC EDGAR** | Public-company revenues | Competitor/market revenue anchors | Free API |
| **Apollo** (already integrated) | Contactable company population | Reachable SAM subset | Paid (existing) |
| **completeWithWebSearch** (already integrated) | Published market-size figures | Top-down TAM, cited | Existing AI |
| Eurostat / UK ONS / StatCan / OECD | Same firm/industry stats ex-US | International markets | Free APIs (future providers) |

**Deferred (not needed for v1):** Statista API, IBISWorld, Gartner/IDC licensed feeds — web-search already surfaces their headline numbers with attribution.

**Limitations to design around:** Census is US-only (international needs the ex-US providers), NAICS granularity may not fit niche segments, data lags ~1–2 years, and B2C needs the spend-side sources (BEA PCE / Census retail) rather than firm counts.

---

## 10. Pre-#543 foundation — status checklist

Everything #543 depends on, so the #543 build is purely the three estimation methods + routes + UI:

- ✅ **Schema** — `market_segments` (TAM/SAM low/mid/high bigint + overrides, priority 1–10 CHECK, needs_map/firmographics jsonb) and `market_intelligence_sources`; migration `0087`.
- ✅ **Shared type contracts** — `@shared/market-intelligence` (`MoneyRange`, `SegmentSizing`, `NeedsMap`, `Firmographics`, `PrioritySuggestion`, source inputs + constructors/guards) so server, routes, and UI share shapes and output-compatibility is type-enforced.
- ✅ **Provider seam** — `MarketModelProvider` interface + `getMarketModelProvider()` factory (Path A default, Path B branch reserved) + `NativeMarketModelProvider` skeleton (the three methods #543 implements, currently explicit throws so no placeholder data leaks).
- ✅ **Data sourcing** — `census-market-data-provider.ts` (CBP live API + pure `buildCbpQueryUrl`) and `naics-mapping.ts` / `naics-crosswalk.ts` (crosswalk → cached AI resolver).
- ✅ **Provenance persistence** — `market-intelligence-sources.ts` (`recordSources` / `replaceSources` / `getSources`).
- ✅ **Cost metering** — `runMarketSizing` manual-action quota (high cost tier; enterprise 100 / unlimited unmetered / lower tiers 0) alongside the existing `guardAnalysisLimit`-style guards.
- ✅ **AI features & plan flag** — `market_sizing` / `segment_needs_map` / `segment_priority`; `marketSegments` gated to enterprise + unlimited.
- ✅ **Ops** — `CENSUS_API_KEY` documented in `replit.md` (optional; graceful fallback when unset).
- ✅ **Tests** — pure suites for the crosswalk, CBP URL builder, and shared constructors/guards; `tsc` clean.

**#543 remaining (the actual task):** implement `estimateSizing` (dual-method triangulation + confidence), `buildNeedsMap`, `scoreSegmentPriority`; the `market_segments` CRUD routes + `runMarketSizing` guard wiring; the persona→segment backfill; and the ranked Segments view with TAM/SAM badges, Needs Map editor, and per-figure sources popover.
