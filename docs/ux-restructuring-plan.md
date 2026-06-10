# Orbit UX Restructuring Plan

**Status:** Proposal for review (rev 2 — adds Product area, unified pipeline across all generators, global Home)
**Date:** June 2026
**Mockups:** see `docs/ux-mockups/`

---

## 1. Diagnosis — why the UX feels fractionated

A full inventory of the current app surfaces the problem concretely:

| Symptom | Evidence in the codebase |
|---|---|
| The left menu is very long and deep | `AppLayout.tsx` defines **6 collapsible groups with nested sub-groups**; the Marketing group alone contains **21 items across 3 sub-groups** (Plan / Calendars / Execute). ~70 routes total in `App.tsx`. |
| Newcomers can't tell what the app *is for* | Strategic tools (Messaging Framework), transactional tools (Composer), setup tasks (Platform Credentials, Social Accounts) and analytics (Performance) all sit side-by-side at the same menu level. |
| Product work is invisible in the IA | `product-detail.tsx` (3,260 lines) has **10 tabs and 8 generation endpoints** — battlecards/spec cards, one-sheets, GTM plans, messaging frameworks, gap analyses, executive summaries, features, roadmap — yet "Products" appears as a single Workspace menu item. Its outputs serve sales, marketing *and* analysis but surface nowhere else. |
| Four parallel content pipelines, built at different times | Social campaigns (`campaigns` → generated posts: `draft → approved → published/exported`), event promotion (`conferences` → anchor/session posts, own promo-window scheduler), email (`generatedEmails`: `draft → approved → sent` + `emailSends`: `pending → queued → sending → sent/failed`), and content briefs (`draft → ready_for_review → approved → in_progress → completed → published`). Each re-implements status badges, approve actions, and generation-job progress. |
| Transactional pages get incredibly long | Campaign detail renders generated posts as a vertical list with full text and full-size images; newsletters and briefs follow the same pattern. One item can fill a screen. |
| No true "home" | `dashboard.tsx` mixes onboarding checklist, research KPIs, positioning chart and recommendations — it is a Research dashboard, not a company-at-a-glance home. |

## 2. Proposed information architecture — the value chain

Organize the app as the **value chain it actually supports**:

> **Home → Research → Product → Marketing → Sales**, with **Admin & Settings** demoted to a gear menu.

Five labeled areas in the header (mockup `01`), each with a **Hub Home** (sub-dashboard + actions) and a *short* contextual sidebar (5–7 items max). The Orbit logo is the Home button.

### 🏠 Home — the company at a glance *(new; reworked `dashboard.tsx`)*
Mockup: `05-global-home.svg`. A pure landing page, not a workspace:
- **Baseline executive summary** front and center — company snapshot, market position, competitive landscape, opportunities (this data already exists on `executive-summary.tsx`)
- **Orbit Score + trend**, intelligence freshness
- **One glance-card per area** — a headline stat and the single most urgent action (e.g., Research: "3 new high-impact signals"; Product: "2 battlecards stale"; Marketing: "12 posts awaiting approval"; Sales: "Q2 report ready")
- Live signals ticker; onboarding checklist appears here only until completed

### 🔭 Research  *(today: Workspace + Intelligence)*
Audience: strategists, analysts. "Understand the market."
- **Hub Home** — staleness summary, latest signals, suggested next analysis
- Competitors (+ detail), Company Profile
- Analysis & Action Items
- Signals & Activity (Activity, Intelligence Feed, SEO/Share-of-Voice merged into one tabbed page)
- Positioning & Visualizations
- Data Health (Data Sources + Refresh Center merged)

### 📦 Product  *(new area; today buried as one menu item)*
Audience: product marketing, product strategy. "Define and equip the offering."
- **Hub Home** — portfolio view: each product with artifact freshness (battlecard ✓/stale, one-sheet generated/missing, roadmap last updated, exec summary date)
- Products (portfolio list → product workspace keeps its tabs: Overview, Features, Roadmap, Feedback)
- **Planning** — gap analysis, strategic recommendations, competitive summary, GTM plan, messaging (the `not_generated → generating → generated` artifacts)
- **Collateral** — spec cards/battlecards, one-sheets, executive summaries

**Products stay one entity; their outputs cross-surface.** A generated one-sheet also appears in the Sales hub and can be attached as a marketing asset; product messaging feeds the Marketing strategy page; roadmap/gap analysis links back to Research analysis. The Product hub is the *factory*; the other hubs show the *outputs* relevant to them, filtered by product.

### 📣 Marketing  *(today's 21-item group, minus setup pages)*
Audience: marketers. "Plan and ship content."
- **Hub Home** — pipeline counts, awaiting-approval queue, upcoming 7 days, quick actions
- Strategy (Messaging Framework, GTM Plan, Personas, Solution Areas as **tabs of one page**)
- Campaigns — **all campaign types in one list**: theme / offering / **event** (conferences become event-type campaigns they already link to via `campaignId`)
- **Content Pipeline** — the unified board (see §3)
- Calendar (Master Calendar as default; social/briefs/email become *filters*)
- Libraries (Content Library + Brand Library as tabs)
- Performance

### 🤝 Sales  *(today: Deliverables + enablement strays)*
Audience: sellers, account leads. "Win the deal."
- **Hub Home** — recent reports, battlecard freshness, assessment status
- Battle Cards & Spec Cards *(generated in Product, consumed here)*
- One-Sheets *(same)*
- Reports
- Relationship Plans
- Assessments

### ⚙️ Admin & Settings  *(gear icon, not a competing tab)*
- Users, Usage & Traffic, Company Roster, Document Storage
- **Connections** — *move* Social Accounts, Platform Credentials, Integrations, Browser Extension here; they are one-time setup, not daily marketing work
- Global-admin pages unchanged (Admin Dashboard, AI Settings, OAuth Clients)

### Navigation model
- **Area switcher in the header** (Home logo + 4 area tabs + gear; collapses to icons on tablet). The left sidebar shows only the *current area's* 5–7 items — no more 6-group accordion.
- Mobile bottom nav maps to Home + the four areas.
- Keep the command palette (Cmd/Ctrl+K); every demoted menu item stays reachable there and via hub quick-links.
- **No URL breaks**: all existing routes keep working (redirects where pages merge).

## 3. One Content Pipeline, many sources

Mockup: `03-content-pipeline-board.svg`. Today there are **four pipelines built in different eras** — this week's briefs work, last week's event campaigns, the earlier email pipeline, and the original social campaigns. Each has its own list page, status badges, approve buttons and generation-job handling. The fix is **one pipeline surface over a shared contract**, not a schema rewrite:

```ts
// PipelineItem adapter — each source maps its own enum to canonical stages
type PipelineItem = {
  type: "social_post" | "event_post" | "email" | "brief" | "one_sheet";
  source: { campaignId? ; conferenceId? ; productId? };
  stage: "draft" | "in_review" | "approved" | "generating" | "ready" | "scheduled" | "live";
  scheduledAt?; failure?; ...
}
```

| Canonical stage | social posts | event posts (conferences) | emails + sends | briefs | product collateral |
|---|---|---|---|---|---|
| Draft | `draft` | `draft` | `draft` | `draft` | `not_generated` |
| In Review | — | — | — | `ready_for_review` | — |
| Approved | `approved` | `approved` | `approved` | `approved` | — |
| Generating | job `running` | job `running` | — | `in_progress` | `generating` |
| Ready | job `done`, undated | job `done`, undated | approved, no send | `completed` | `generated` |
| Scheduled | `scheduledDate` set | promo-window slot | send `pending/queued` | — | — |
| Live / Sent | `published` / `exported` | `published` | send `sent` | `published` | exported/attached |

- **Drag a card between columns to change status** — drop on Scheduled opens a date picker; illegal moves (Live → Draft) snap back with a toast. Failed states (`publish_failed`, send `failed/partial`) render as a red strip inside their column.
- **Cards are compact**: type + source badge, 2-line clamped text, 56px thumbnail, date, owner. Click opens the existing detail drawer — the board never grows past one screen.
- **Optional swimlanes** by campaign or source for multi-campaign weeks; filters for type / campaign / platform / product.
- **View toggle on every transactional list**: `Board | List | Calendar` over the same query, persisted per user. The month calendar becomes a view of the same data, not a separate menu entry.
- **Shared components** extracted once and reused by all sources: `StatusBadge`, `ApprovalActions`, `GenerationJobProgress`, `ScheduleChip` — this retires the per-pipeline duplication.
- **Library:** `@dnd-kit/core` + `@dnd-kit/sortable` (accessible, React 19-compatible; the hand-rolled HTML5 DnD in `calendar.tsx` migrates to it too).

## 4. Density fixes for long pages

Mockup: `04-density-before-after.svg`.

1. **Never render full text / full-size images in lists.** Clamp text to 2–3 lines, thumbnails at fixed 56–64px, full content only in the detail drawer (`vaul` is already installed).
2. **Default to compact rows; offer a density toggle** (`Comfortable | Compact`) and standardize the table↔card toggle that Content Library already has across Campaigns, Newsletters, Briefs.
3. **Virtualize long lists** (`@tanstack/react-virtual`) so Published/Sent archives stay fast.
4. **Sticky page header with filters/status tabs** so users never scroll back up to refine.

## 5. Phased delivery

**Phase 1 — relieve the pain (no nav changes, low risk)**
1. Compact cards + detail drawer on campaign detail, newsletters, briefs (§4)
2. Shared `StatusBadge` / `ApprovalActions` / `GenerationJobProgress` components (§3)
3. Pipeline board for generated posts inside campaign detail, behind a `Board|List` toggle (`@dnd-kit`)
4. Virtualization on the longest lists

**Phase 2 — unify the pipelines + hubs**
5. `PipelineItem` adapters for emails, event posts, briefs → standalone `/app/marketing/pipeline` board spanning all sources
6. Conferences listed as event-type campaigns in the Campaigns list (they already carry `campaignId`)
7. Build hub homes (Marketing first — its `index.tsx` is the seed — then Product, Research, Sales)
8. Merge tab-able siblings: Strategy tabs, Libraries tabs, Signals tabs, Data Health

**Phase 3 — the new shell + Home**
9. Header area switcher (Home · Research · Product · Marketing · Sales · ⚙) + per-area short sidebars in `AppLayout.tsx`; old routes redirect
10. Rework `dashboard.tsx` into the global Home: baseline exec summary + Orbit Score + per-area glance cards
11. Move Connections to Admin & Settings; align mobile bottom nav; retire the 6-group accordion

Each phase ships independently; Phase 1 requires no IA agreement and can start immediately.

## 6. Risks & mitigations

- **Muscle memory of existing users** → keep all routes via redirects, announce in changelog, command palette unchanged.
- **Status semantics differ per source** → the board maps statuses through adapters (§3 table) rather than forcing a shared enum migration; schema untouched in Phases 1–2.
- **Product artifacts are generated, not dragged** → product collateral appears on the board read-mostly (Draft/Generating/Ready); drag-to-stage applies only where a real transition exists.
- **Enterprise/feature gating** → gates move with their items; an area whose items are all gated hides its tab (mirrors current group behavior).
