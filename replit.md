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
| Blog posts | Branded Word doc | Switch to direct website API once it's available. |
| Whitepapers | Branded Word doc | _Pending confirmation._ |
| Case studies | Branded Word doc | _Pending confirmation._ |
| Landing page copy | Branded Word doc | Handoff for page build; direct via website API later. _Pending confirmation._ |
| Email newsletters | Email campaign engine | Generated and sent in-engine. Review/approval export _pending confirmation._ |
| Video scripts | Branded Word doc | — |
| Podcasts | Branded Word doc outline | Podcasts ("Polaris") are recorded **live** — no AI-generated MP3 audio needed. Outline follows Synozur's standard format: see `docs/polaris-podcast-outline-format.md` (example: `docs/polaris-outline-example.docx`). |

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