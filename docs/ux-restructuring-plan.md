# Orbit UX Restructuring Plan

**Status:** Proposal for review
**Date:** June 2026
**Mockups:** see `docs/ux-mockups/`

---

## 1. Diagnosis — why the UX feels fractionated

A full inventory of the current app surfaces the problem concretely:

| Symptom | Evidence in the codebase |
|---|---|
| The left menu is very long and deep | `AppLayout.tsx` defines **6 collapsible groups with nested sub-groups**; the Marketing group alone contains **21 items across 3 sub-groups** (Plan / Calendars / Execute). ~70 routes total in `App.tsx`. |
| Newcomers can't tell what the app *is for* | Strategic tools (Messaging Framework), transactional tools (Composer), setup tasks (Platform Credentials, Social Accounts) and analytics (Performance) all sit side-by-side at the same menu level. |
| Transactional pages get incredibly long | Campaign detail renders generated posts as a vertical list with full text and full-size images; email newsletters and content briefs follow the same pattern. One item can fill a screen. |
| Status workflows exist but have no workflow UI | Posts already carry `draft → approved → published / publish_failed / exported`; briefs carry `draft → ready_for_review → approved → in_progress → completed → published`; newsletters carry `draft → approved → sent`. All of this is shown only as colored badges on cards — there is **no board view** anywhere in the app. |
| No "home" per functional area | Only the global dashboard exists. Marketing has an `index.tsx` hub but the sidebar still enumerates every page, so the hub doesn't reduce menu load. |

## 2. Proposed information architecture — four areas

Reorganize ~70 routes into **four top-level areas**, each with its own **Hub Home** (sub-dashboard + actions) and a *short* contextual sidebar (5–7 items max). Mockup: `01-information-architecture.svg`.

### 🔭 Research  *(today: Workspace + Intelligence)*
Audience: strategists, analysts. "Understand the market."
- **Hub Home** — staleness summary, latest signals, suggested next analysis
- Competitors (+ detail), Company Profile, Products
- Analysis & Action Items
- Signals & Activity (Activity, Intelligence Feed, SEO/Share-of-Voice merged into one tabbed page)
- Positioning & Visualizations
- Data Health (Data Sources + Refresh Center merged)

### 📣 Marketing  *(today: the 21-item Marketing group, minus setup pages)*
Audience: marketers. "Plan and ship content."
- **Hub Home** — pipeline counts, awaiting-approval queue, upcoming 7 days, quick actions
- Strategy (Messaging Framework, GTM Plan, Personas, Solution Areas as **tabs of one page**)
- Campaigns (+ Planning Hub folded into campaign detail)
- **Content Pipeline** — the new kanban board (see §3) unifying posts, briefs, newsletters
- Calendar (Master Calendar as default; Social/Briefs become *filters*, not separate menu items)
- Libraries (Content Library + Brand Library as tabs)
- Performance

### 🤝 Sales  *(today: Deliverables + sales-enablement strays)*
Audience: sellers, account leads. "Win the deal."
- **Hub Home** — recent reports, battlecard freshness, assessment status
- Battle Cards
- Reports
- Relationship Plans
- Assessments

### ⚙️ Admin & Settings  *(today: Admin group + setup pages hiding in Marketing)*
- Users, Usage & Traffic, Company Roster, Document Storage
- **Connections** — *move* Social Accounts, Platform Credentials, Integrations, Browser Extension here; they are one-time setup, not daily marketing work
- Global-admin pages unchanged (Admin Dashboard, AI Settings, OAuth Clients)

### Navigation model
- **Area switcher in the header** (4 labeled tabs; collapses to icons on tablet). The left sidebar then only shows the *current area's* 5–7 items — no more 6-group accordion.
- **Hub Home is each area's landing page**: KPI tiles, a "Needs your attention" action queue, quick actions, recent items. Mockup: `02-hub-home-marketing.svg`.
- Mobile bottom nav maps 1:1 to the four areas + Home.
- Keep the command palette (Cmd/Ctrl+K) as the power-user escape hatch; every demoted menu item stays reachable there and via hub quick-links.
- **No URL breaks**: all existing routes keep working (redirects where pages merge).

## 3. The Content Pipeline board (kanban)

Mockup: `03-content-pipeline-board.svg`. This is the highest-impact single change for the "long transactional list" pain.

**Canonical pipeline columns**, mapped from the status enums already in the schema:

| Column | posts | briefs | newsletters |
|---|---|---|---|
| Draft | `draft` | `draft` | `draft` |
| In Review | — | `ready_for_review` | — |
| Approved | `approved` | `approved` | `approved` |
| Generating / In Progress | (generation job `running`) | `in_progress` | — |
| Generated / Ready | (job `done`, unscheduled) | `completed` | — |
| Scheduled | `scheduledDate` set | — | `queued` |
| Published / Sent | `published` / `exported` | `published` | `sent` |

- **Drag a card between columns to change status** — drag Draft→Approved approves it; drop on Scheduled opens a date picker; illegal moves (e.g. Published→Draft) are rejected with a snap-back and a toast.
- **Cards are compact**: platform/type badge, 2-line clamped text, 56px thumbnail, due/scheduled date, owner avatar. Click opens the existing detail drawer for full text and full-size imagery — the board itself never grows past one screen height.
- **View toggle on every transactional list**: `Board | List | Calendar` over the same query, persisted per user. The existing month calendar becomes the third view of the same data instead of a separate menu entry.
- Columns with large counts (Published) load collapsed with a count chip.
- **Library:** add `@dnd-kit/core` + `@dnd-kit/sortable` (accessible, actively maintained, works with React 19; the HTML5-DnD hand-rolled in `calendar.tsx` should migrate to it too). Failed states (`publish_failed`, `rejected`) render as a red strip inside their column rather than a column of their own.

## 4. Density fixes for long pages

Mockup: `04-density-before-after.svg`.

1. **Never render full text / full-size images in lists.** Clamp text to 2–3 lines (`line-clamp-3`), thumbnails at fixed 56–64px, full content only in the detail drawer (`vaul` is already installed) or an expand-in-place chevron.
2. **Default to compact rows; offer a density toggle** (`Comfortable | Compact`) and standardize the table↔card toggle that Content Library already has across Campaigns, Newsletters, Briefs.
3. **Virtualize long lists** (`@tanstack/react-virtual`, same family as the react-query dependency already in use) so Published archives with hundreds of items stay fast.
4. **Sticky page header with filters/status tabs** so users never scroll back up to refine.

## 5. Phased delivery

**Phase 1 — relieve the pain (no nav changes, low risk)**
1. Compact cards + detail drawer on campaign detail, newsletters, briefs (§4.1–4.2)
2. Content Pipeline board for generated posts inside campaign detail, behind a `Board|List` toggle (`@dnd-kit`)
3. Virtualization on the longest lists

**Phase 2 — hubs**
4. Build the four Hub Home pages (Marketing first; its `index.tsx` is the seed)
5. Merge tab-able siblings: Strategy tabs, Libraries tabs, Signals tabs, Data Health
6. Promote the pipeline board to a standalone `/app/marketing/pipeline` spanning posts + briefs + newsletters

**Phase 3 — the new shell**
7. Header area switcher + per-area short sidebars in `AppLayout.tsx`; old routes redirect
8. Move Connections (social accounts, credentials, extension, integrations) to Admin & Settings
9. Align the mobile bottom nav to the four areas; retire the 6-group accordion

Each phase ships independently; Phase 1 requires no IA agreement and can start immediately.

## 6. Risks & mitigations

- **Muscle memory of existing users** → keep all routes via redirects, announce in changelog, command palette unchanged.
- **Status semantics differ per content type** → the board maps statuses (§3 table) rather than forcing a shared enum migration; schema untouched in Phases 1–2.
- **Enterprise/feature gating** → gates move with their items; an area whose items are all gated hides its switcher tab (mirrors current group behavior).
