# Orbit - Go-to-Market Intelligence Platform

Orbit is an AI-driven platform that centralizes and enhances go-to-market strategies by unifying Competitive Intelligence, Marketing Planning, and Product Management.

## Run & Operate

- **Run Dev Server**: `npm run dev`
- **Build**: `npm run build`
- **Typecheck**: `npm run typecheck`
- **Generate Drizzle Migrations**: `npm run db:generate`
- **Apply DB Migrations**: Migrations are applied automatically on application boot by `server/db-migrate.ts`.
- **Environment Variables**:
    - `SERP_API_KEY`: Required for SEO tracking.
    - `SESSION_SECRET`: Used for session management and HMAC unsubscribe tokens.

## Stack

- **Frameworks**: React (frontend), Express.js (backend)
- **Runtime**: Node.js (with TypeScript)
- **ORM**: Drizzle ORM (for PostgreSQL)
- **Validation**: Zod
- **Build Tool**: Vite (frontend), esbuild (backend)
- **UI Components**: shadcn/ui (Radix UI)
- **Styling**: Tailwind CSS v4
- **State Management**: TanStack React Query

## Where things live

- `client/`: Frontend source code.
- `server/`: Backend source code.
- `shared/`: Shared types and utilities.
- `shared/schema.ts`: Database schema definition (source-of-truth).
- `migrations/`: Drizzle migration files.
- `server/routes/`: API route definitions, organized by domain.
- `server/services/`: Backend services (e.g., AI, PDF generation, social publishers).
- `client/src/lib/tabContext.ts`: Client-side tab context management.
- `server/context.ts`: Server-side request context helpers.
- `server/routes/helpers.ts`: Server-side route helpers including feature guarding.
- `client/src/main.tsx`: Client-side entry point, includes `window.fetch` monkey-patch.
- `client/src/lib/queryClient.ts`: Client-side query client with stale tab context recovery.
- `server/plan-policy.ts`: Feature registry for plan enforcement.

## Architecture decisions

- **Multi-Tenant Data Boundary Protection**: All data access and manipulation are strictly scoped to the active tenant. Cross-tenant access is restricted to Consultant and Global Admin roles, with explicit validation.
- **Per-tab Active Context**: The active tenant/market context is managed per browser tab using `sessionStorage` and custom HTTP headers, preventing context leakage between tabs.
- **Service Plan Enforcement**: Feature gating is database-driven, enforced server-side via `guardFeature()` and `FEATURE_REGISTRY`, with automatic frontend upgrade prompts.
- **Canonical Organization Layer**: Public company data is centralized in the `organizations` table with URL normalization to avoid duplication.
- **Centralized Job Queue**: A priority-based, concurrency-limited job queue handles heavy background tasks like PDF generation, web crawling, and AI analysis.

## Product

- **Go-to-Market Intelligence**: Centralized competitive intelligence, marketing planning, and product management.
- **AI-powered Insights**: Competitive website analysis, AI-guided recommendations, gap analysis, AI-synthesized briefings.
- **Content & Campaign Management**: Marketing content library, brand library, UTM builder, social campaigns, email newsletters, conference social promotion (anchor + per-session posts with matched 1:1 graphics and an archivable conference image space).
- **Advanced Reporting**: Branded PDF reports, CSV exports, intelligence briefings, relationship reports.
- **User & Access Management**: Role-based access control, multi-tenant architecture, Microsoft Entra ID integration.
- **Product Management Tools**: Feature catalog, roadmap view, AI-powered roadmap recommendations, customer feedback and voting.
- **SEO & Share-of-Voice Tracking**: Keyword tracking, SERP analysis, and visibility reporting for baseline and competitors.

## Content Export Strategy (Interim)

Interim decision for how each generated content type goes outbound, until the new website API opens up for direct posting. Revisit when the website ships.

| Content type | Interim outbound format | Notes |
| :--- | :--- | :--- |
| Social posts | SocialPilot CSV | At least the next month, then revisit direct posting. |
| Blog posts | **Direct draft to Synozur website** (per-tenant MCP `create_draft_post`); Word doc fallback | The website API is now available — see "Synozur Website (www) MCP Integration" below. |
| Whitepapers | Branded Word doc | — |
| Case studies | Branded Word doc | — |
| Landing page copy | Branded Word doc | Handoff for page build; direct via website API later. |
| Email newsletters | Email campaign engine | Generation, formatting, and tracking only — the engine does **not** send automatically. |
| Video scripts | Branded Word doc | — |
| Podcasts | Branded Word doc outline | Podcasts ("Polaris") are recorded **live** — no AI-generated MP3 audio needed. Outline follows Synozur's standard format: see `docs/polaris-podcast-outline-format.md` (example: `docs/polaris-outline-example.docx`). |

## Synozur Website (www) MCP Integration

Orbit publishes to the Synozur Insights website (the "www" server) through its
MCP server, configured **per tenant**. This is the "direct website API" the
interim Word-doc export was waiting for. **v1 scope: direct-post blog drafts**
(`create_draft_post`); the rest of the catalogue is documented for follow-on work.

- **Per-tenant connection** — `website_connections` table: endpoint + an
  encrypted `mcp.write` key (`encryptSecret`/`decryptSecret`), optional default
  author. One row per tenant, configured in Settings → Integrations.
- **Client** — `server/services/website-mcp-client.ts` calls the remote MCP
  server over Streamable HTTP (JSON-RPC 2.0 `tools/call`).
- **Routes** — `server/routes/integrations.ts` → `/api/integrations/website/*`
  (status, connect, disconnect, authors/categories/tags proxies, push-draft).
- **Push flow** — an Orbit blog content asset → `create_draft_post`; the
  returned `{ id, slug }` is recorded on the asset (`websitePostId` /
  `websitePostSlug`) to mark it published-as-draft and to enable future
  `get_post_performance` traffic pulls.

### Connection & auth
- Endpoint (per tenant; stored, not hardcoded): e.g. `https://synozur-baseline.replit.app/api/mcp`
- Transport: Streamable HTTP, stateless — one POST per call, `Content-Type: application/json`
- Auth: `Authorization: Bearer syn_<key>`. `mcp.read` unlocks read tools; `mcp.write` adds `create_draft_post`, `update_draft_post`, `schedule_post`, `upload_image`.

### Tool catalogue (reference; `*` = needs `mcp.write`)
- **Posts**: `search_posts`, `get_post`, `get_post_performance`, `create_draft_post`*, `update_draft_post`*, `schedule_post`*
- **Taxonomy**: `list_categories`, `list_tags`, `list_authors`
- **Media**: `list_media`, `upload_image`*
- **Events**: `list_events`, `list_past_events`, `get_event`
- **Episodes**: `list_episodes`, `get_episode`
- **Landing pages**: `list_landing_pages`

`create_draft_post` requires `title`, `bodyMarkdown`, `authorId` (from
`list_authors`); optional `categoryIds`, `tagIds`, `excerpt`, `heroImageId`,
`seoTitle`, `seoDescription`. Returns `{ id, slug, status: 'draft', title }`.

### v2 (implemented)
- **Create-or-update**: re-pushing an asset updates the existing draft via
  `update_draft_post` (tracked by `website_post_id`) instead of duplicating.
- **Scheduling**: `schedule_post` from the publish dialog; `website_post_status`
  / `website_scheduled_for` mirror the site's lifecycle on the asset.
- **Hero images**: the asset's lead image is uploaded via `upload_image` and
  set as `heroImageId` (best-effort — a failed upload never blocks the post).
- **Performance**: `get_post_performance` surfaced in the publish dialog
  (views, sessions, 30-day trend, top referrers) via
  `GET /api/integrations/website/performance`.
- **Full publish dialog**: author / category / tag / excerpt / hero / schedule.

### Roadmap (beyond v2)
- Feed `get_post_performance` into the Orbit Score funnel component (needs a
  scoring-weight decision); inbound library sync via `search_posts` /
  `get_post`; events (`list_events`) into conference promotion; episodes
  (`list_episodes`) into Polaris. (No social-post or landing-page *create*
  tools exist — social stays SocialPilot CSV; landing pages stay read-only.)

## User preferences

Preferred communication style: Simple, everyday language.

## Gotchas

- **Adding a new table or column**: Modify `shared/schema.ts`, then run `npm run db:generate`, and commit the generated migration file.
- **Migration Immutability**: Never modify a migration file after it has been applied; the system uses checksums to detect changes and will refuse to start.
- **Migration Runner Behavior**: The `server/db-migrate.ts` applies migrations lexicographically in transactions. For existing databases, it backfills `_migrations` table entries without re-running SQL if `users` table exists.
- **Relationship Report Generation**: AI generation is asynchronous. `POST /generate` endpoints return `202` immediately, and the UI polls for status updates. Concurrent requests against a generating report return `409`.

## Pointers

- **Drizzle ORM Documentation**: _Populate as you build_
- **TanStack Query Documentation**: _Populate as you build_
- **shadcn/ui Documentation**: _Populate as you build_
- **Tailwind CSS Documentation**: _Populate as you build_
- **Express.js Documentation**: _Populate as you build_
- **Microsoft Entra ID (OAuth 2.0) Docs**: _Populate as you build_