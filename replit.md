# Orbit - Go-to-Market Intelligence Platform

## Overview
Orbit is an AI-driven go-to-market intelligence platform designed to centralize and enhance go-to-market strategies by unifying Competitive Intelligence, Marketing Planning, and Product Management. It functions as a multi-tenant SaaS application with features like role-based access control, advanced competitive analysis, AI-powered insights, and branded PDF reporting. Orbit aims to facilitate a seamless transition "from insight to action in one platform."

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
- **Multi-Tenant Architecture**: Tenant isolation, RBAC, tenant-specific plan/usage limits.
- **CRITICAL — Tenant Data Boundary Protection**: Every API route, database query, and background job MUST enforce tenant isolation by filtering on `tenantDomain`. Never allow data from one tenant to leak to another. All new endpoints must include `tenantDomain` checks (via `getRequestContext` or equivalent). All storage queries must scope to the requesting tenant. Cross-tenant access is only permitted for the Consultant role (read-only) and Global Admin. This is a non-negotiable security requirement — violations can expose customer data.
- **CRITICAL — Per-tab Active Context (Task #119)**: The active tenant/market is **per-browser-tab**, not per-session. Each tab stores its `activeTenantId` / `activeMarketId` in `sessionStorage` (`client/src/lib/tabContext.ts`) and sends them as `X-Active-Tenant-Id` / `X-Active-Market-Id` headers via a `window.fetch` monkey-patch installed in `main.tsx`. Server: `getRequestContext` (and helpers `getActiveTenantId` / `getActiveMarketId` in `server/context.ts`) prefer headers over `req.session`, validate access (Consultant/Global Admin checks via `validateTenantAccess`), and **fail closed (403)** when headers reference a tenant/market the user can't access. When headers are present, the server NEVER writes back to `req.session` — that would let one tab's switch leak into another tab. Switch endpoints (`POST /api/context/{tenant,market}`) still write session as the default for new tabs, and the client pins sessionStorage from the response. The client auto-recovers from stale tab context (e.g. a market deleted in another tab) via `maybeRecoverFromStaleTabContext` in `queryClient.ts`. Any new endpoint that reads `req.session.activeTenantId/activeMarketId` directly is a regression — use `getActiveTenantId(req)` / `getActiveMarketId(req)` for reads and validate against `getAccessibleTenants` before trusting the value.
- **Service Plans**: Database-driven plans with flexible feature gating. All premium API routes enforced server-side via `guardFeature()` helper in `server/routes/helpers.ts`, using `plan-policy.ts` FEATURE_REGISTRY as single source of truth. Returns 403 with `upgradeRequired: true` when blocked. Frontend auto-intercepts upgrade-required errors via `UpgradeModalProvider` (global query/mutation error interception).
- **Authorization**: Role hierarchy (Global Admin > Domain Admin > Standard User > Consultant).
- **Canonical Organization Layer**: Centralizes public company data in the `organizations` table with URL normalization.
- **Centralized Job Queue**: Priority-based, concurrency-limited for heavy background tasks (PDF generation, crawls, monitors, analysis).

### Frontend
- **Framework**: React with TypeScript (Vite)
- **State Management**: TanStack React Query (server state), React Context (authentication)
- **UI Components**: shadcn/ui (Radix UI primitives)
- **Styling**: Tailwind CSS v4 with CSS variables
- **Theme**: Aurora theme (purple-tinted, Synozur brand colors, 1.3rem radius, full shadow scale).
- **Font**: Avenir Next LT Pro

### Backend
- **Framework**: Express.js with TypeScript
- **API Design**: RESTful JSON API (`/api/` prefix)
- **Session Management**: Express-session (cookie-based)
- **Storage Abstraction**: Drizzle ORM for PostgreSQL.
- **Route Organization**: Domain-focused modules under `server/routes/`.

### Database
- **ORM**: Drizzle ORM (PostgreSQL dialect)
- **Schema**: `shared/schema.ts`
- **Migrations**: Drizzle Kit
- **Validation**: Zod schemas.

### Authentication & Authorization
- **Authentication**: Session-based with `express-session`, supporting Microsoft Entra ID (OAuth 2.0) and email/password fallback.
- **Provisioning**: First user from a new domain auto-promoted to Domain Admin.
- **Consultant Role**: Privileged cross-tenant read role for Synozur platform staff.

### Key Features
- **Data Inputs**: Competitor URL management, grounding document upload (PDF, DOCX) with AI context scoping, company profile baselining.
- **AI Analysis**: Competitive website analysis, AI-guided recommendations (RAG), gap analysis.
- **Web Crawling Service**: Multi-page crawling, social media discovery, blog post detection, scheduled background jobs.
- **Competitor Intelligence Dashboard**: Insights from AI-summarized website changes, social signals, and activity logs.
- **Intelligence Briefings**: AI-synthesized periodic market intelligence reports with configurable periods, executive summaries, action items, branded PDF export, email sharing, and podcast-style audio summaries.
- **Intelligence Health UX**: Dashboard card for source/artifact freshness, "Needs Attention" for stale sources, "Built from data as of" banners with inline rebuild buttons.
- **News Monitoring**: Integration with GNews API for competitor and baseline company news.
- **Enhanced Change Detection**: Website monitoring with structured AI analysis.
- **Campaigns (Social)**: Containers for content assets, social accounts, and generated social posts, with manual post creation and scheduling.
- **Email Newsletters**: Standalone tool for generating emails from content assets.
- **Marketing Content Library**: Enterprise-gated asset management with AI summarization, categories, tagging, and crawl-based asset suggestions (pages discovered during baseline web crawl are flagged as candidates).
- **Marketing Brand Library**: Enterprise-gated brand asset management with product cross-linking, categories, and tagging.
- **UTM Builder & Link Tracking**: Tenant-scoped tracked short links with UTM parameters. `/r/:slug` redirects record clicks (bot-filtered, daily-rotating IP hash). Link Builder UI on campaigns; Performance tab on Marketing index with sparklines and CSV export. Optional opt-in to wrap outbound URLs in generated social posts and emails.
- **Persona & ICP Builder**: Pro/Enterprise/Unlimited-gated buyer persona management with AI-assisted generation.
- **Assessments**: Competitive analysis snapshots with proxy assessment capabilities.
- **Client Projects**: Facilitate product-level competitive analysis for consulting firms.
- **Product Management MVP**: Feature catalog, quarterly roadmap view, AI-powered roadmap recommendations.
- **Customer Feedback & Voting** (Pro/Enterprise/Unlimited): Per-product feedback intake with internal upvoting, status workflow (New / Planned / Shipped / Declined), admin promotion of popular ideas to product features, AI-powered "group similar items" duplicate detection, and an optional tokenized public feedback URL (`/feedback/:token`) protected by math captcha + honeypot + IP rate limiting.
- **Report Generation**: Branded PDF reports and CSV exports.
- **Multi-Market Support**: Enterprise feature for managing multiple client contexts. Markets support B2B (default) or B2C business type, which adjusts Orbit Score weighting — B2C prioritizes social engagement (Instagram) over innovation/content depth.
- **PDF Browser Pool**: Singleton Chromium instance for efficient PDF generation.
- **SharePoint Embedded (SPE) Storage**: Tenant-isolated document storage with admin UI.
- **SEO & Share-of-Voice Tracking**: Pro/Enterprise/Unlimited-gated (`seoTracking` feature key). Tenant/market-scoped `tracked_keywords` + `seo_metrics` tables. SERP provider abstracted in `server/services/seo-provider.ts` with `SerpApiProvider` (uses `SERP_API_KEY` secret) and a deterministic `MockSerpProvider` fallback for dev. Captures rank, estimated traffic, and share-of-voice (basis points) for the baseline company plus all competitors per keyword. Weekly scheduled refresh job (`SEO refresh` in scheduled-jobs). CRUD + dashboard endpoints under `/api/seo/*` and `/api/competitors/:id/seo`, with CSV export at `/api/seo/share-of-voice.csv`. UI: `/app/seo-dashboard` (full dashboard with bar chart, leaderboard, CSV export) and a "SEO & Visibility" tab on competitor detail pages.

## External Dependencies

### Database
- **PostgreSQL**
- **Drizzle ORM**

### AI Services
- **Multi-Provider AI Abstraction**: Supports Replit AI (Anthropic), Replit AI (OpenAI), and Azure AI Foundry.
- **AI Features Registry**: 12 defined AI functions.

### UI Libraries
- **Radix UI**
- **shadcn/ui**
- **Lucide React**
- **TanStack React Query**

### Development Tools
- **Vite**
- **esbuild**
- **TypeScript**

### Authentication
- **@azure/msal-node** (Microsoft Entra ID)

### Security Utilities
- **URL Validation**: SSRF protection, private IP blocking, protocol validation.
- **File Validation**: Magic bytes verification, dangerous content pattern scanning, size limits.

### Third-Party APIs
- **GNews API**: For news monitoring.
- **Microsoft Graph API**: For Entra ID user provisioning and SPE file storage.
- **SendGrid**: For email sharing of intelligence briefings, and for direct campaign delivery (Enterprise) with bounce/unsubscribe webhook + suppression management.
- **LinkedIn OAuth (`r_liteprofile w_member_social`)**: For direct social publishing (Enterprise). Tokens are encrypted at rest with `encryptSecret`/`decryptSecret`.

### E2E Testing Notes (Task #81)
- The Playwright-based testing helper hits the public dev URL. With `externalPort = 5000` in `.replit`, that URL returned a "Running" placeholder and tests were unreachable. Fix: map `localPort = 5000` → `externalPort = 80` in `.replit` so the dev URL routes to the app.
- Test login uses the seeded local-auth user `e2e-test@synozur.com` (Domain Admin on `synozur.com`). Password is reset deterministically when running tests; tenant `synozur.com` has `billing_managed_manually = true` so enterprise feature flags (campaigns, personaBuilder) resolve correctly without an active Stripe subscription.
- Inline-validation coverage: competitor social-link editor (eager onChange errors), campaign wizard step 0 (badge-click reveals `error-campaign-name`) and step 3 (Create button stays clickable while invalid; clicking it sets `stepAttempted[3]=true` so `error-start-date` / `error-number-of-days` render — both are asserted by the spec), persona TagInput empty/duplicate animated errors.

### Marketing Delivery (Task #97)
- **Direct social publishing**: `SocialPublisher` interface in `server/services/social-publishers/`; LinkedIn implemented, Twitter/Instagram/Facebook/Bluesky stubbed. Worker (`marketing-publish-worker.ts`) ticks every 2 minutes processing approved scheduled posts on accounts with `auto_publish=true`. Manual publish-now endpoint `POST /api/generated-posts/:id/publish`.
- **Direct email delivery**: `email-campaign-sender.ts` honors per-tenant suppressions, generates HMAC unsubscribe tokens (signed with `SESSION_SECRET`) and renders a `List-Unsubscribe` header. Public routes `GET/POST /u/:token` and `POST /api/webhooks/sendgrid` registered BEFORE auth.
- **Plan policy**: `directPublishing` and `directEmailDelivery` feature keys gate UI and routes. UI surfaces: `social-accounts.tsx` (Connect/Reconnect/Disconnect), `campaign-detail.tsx` (per-account auto-publish toggle, Publish-now button, published/error badges), `email-newsletters.tsx` (Send dialog), `sends.tsx` (Sends/Lists/Suppressions tabs at `/app/marketing/sends`).
- **Audit + rate limits**: All sends/publishes write to `marketing_audit_log`. In-memory per-tenant rate caps in worker + sender (single-instance v1).