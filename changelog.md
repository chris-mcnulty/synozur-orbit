# Orbit Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **Product → Collateral page** (`/app/products/collateral`): a tenant-wide view of every product's generated artifacts, grouped Strategy (gap analysis, strategic recs, competitive summary) and Go-to-market (GTM plan, messaging, one-sheet), each chip deep-linking to that product tab with generated / stale (>60d) / generating / missing state. Gives the Product area a real second nav surface so collateral is reachable without drilling into each product. Reuses `/api/projects/artifact-summary`.

- **Hub data visualizations**: the area hubs now carry the graphical depth from the design mockups, reusing the dashboard's chart configs via a shared `client/src/components/hub/hub-charts.tsx` (Orbit Score trend area chart, market-positioning scatter, and a segmented "at a glance" stage bar). **Home** gains an Orbit Score trend and a clickable market-positioning scatter (points route to the company profile / competitor detail). **Marketing hub** renders a "Pipeline at a glance" stage bar (Draft / Approved / Scheduled / Published) from live post counts. **Sales hub** shows a deliverables-on-hand mix bar. Each chart renders only when it has real data, so empty tenants still see clean launchpad hubs.

- **Global Home page** (`/app`): a pure company-at-a-glance landing page — live signals first (high-impact prioritized), the baseline executive summary digest, the Orbit Score with trend, and one glance-card per area (Research / Product / Marketing / Sales) showing a headline stat and its most pressing action. The research workspace dashboard keeps its existing URLs at `/app/dashboard` and `/app/overview` under the Research area. New file: `client/src/pages/app/home.tsx`.
- **Content Pipeline board** (`/app/marketing/pipeline`, Marketing area): one kanban board for every in-flight content item across the previously separate pipelines — campaign/social posts, saved emails, and content briefs — with Board/List view toggle (persisted per user), source/campaign/search filters, and drag-between-columns status changes (`@dnd-kit`). Stages are canonical (Draft → In Review → Approved → Scheduled → Published/Sent) and mapped per source by adapters in `client/src/lib/pipeline.ts` — no schema changes. Dropping a post on Scheduled opens a date picker; illegal moves (e.g. anything out of Published) are rejected with a toast; publish failures surface in Scheduled with an alert; the Published/Sent archive loads collapsed. Cards are compact (2-line clamp, small thumbnail) and click through to the item's full editor.

- **Product portfolio collateral strip**: each product card on `/app/products` now shows a per-artifact freshness strip — Gaps, Recs, Summary, GTM, Messaging, One-sheet — with ✓ generated (amber when over 60 days old), generating, or not-yet states; each chip deep-links to that artifact's tab on the product workspace. Backed by new `GET /api/projects/artifact-summary` (one query over `long_form_recommendations`, no per-product requests).
- **Sales hub** (`/app/sales`): the Sales area now lands on a hub showing live counts and last-updated times for Battle Cards, Reports, Relationship Plans, and Assessments — with a staleness warning when battle cards were built on data over 60 days old.

### Changed

- **Research sidebar grouped into sections**: the area's 16 items now render under scannable headings (Workspace / Analysis / Signals / Insights / Sources) instead of a flat list, directly addressing the "hard to scan" length without removing or merging any pages.
- **Campaign detail — compact post cards**: generated posts now render collapsed by default (56px thumbnail, 2-line clamped copy, status/schedule/hashtag chips) so a generation batch fits on one screen instead of one post per screen. Click a card (or its chevron) to expand to the full text, full-size image, and the inline copy/hashtag editors — editing auto-expands; an Expand all / Collapse all toggle sits next to the post filter.
- **Marketing hub — pipeline pulse**: the Marketing landing page now opens with live counts (in pipeline, awaiting approval, scheduled next 7 days) and a needs-your-attention list (drafts awaiting approval, approved-but-unscheduled, failed publishes) linking into the Content Pipeline board; the directory card for Social Accounts (now under Admin & Settings → Connections) is replaced by a Content Pipeline card.
- **Area-based navigation (UX restructuring, phase 1 of the shell)**: the sidebar's 6-group, ~44-item accordion is replaced by a value-chain header — **Research → Product → Marketing → Sales** tabs (desktop), with **Home** on the sidebar logo and **Admin & Settings** behind the header gear. The sidebar now shows only the active area's items with light section headings; the mobile drawer lists all areas and the mobile bottom nav maps to Home/Research/Marketing. One-time setup pages (Social Accounts, Platform Credentials, Browser Extension) moved out of the Marketing menu into Admin & Settings → Connections — their URLs are unchanged. All existing routes keep working; area definitions live in `client/src/lib/areaNavigation.ts`. (See `docs/ux-restructuring-plan.md` and `docs/ux-mockups/`.)

- **Distribution planner — timezone-aware scheduling**: the planner now places best-posting hours in the user's local timezone. The client sends `tzOffsetMinutes` (`Date.getTimezoneOffset()`) and the scheduled UTC instant is computed as `localWallClock + offset` (matching the conference-promotion scheduler); the fiscal quarter is taken from the local posting date. Defaults to UTC when no offset is provided.
- **Long-form AI rewrite in the draft viewer**: a drafted brief's content can now be revised in place from the Editorial Calendar — enter an instruction (e.g. "make it punchier, add a stat-led intro") and `POST /api/content-assets/:id/rewrite` returns a brand-voice-grounded revision and persists it back to the content asset. New service `rewriteLongFormContent` (copywriter-service); the viewer swaps in the revised body.

### Changed

- **Migrations renumbered `0030`–`0032`** (were `0029`–`0031`) to sit after main's `0029_fix_feature_rec_assigned_to`; only the latest drizzle snapshot is retained (intermediate snapshots are unused by the custom runner and by `db:generate`).

### Added

- **Marketing performance report (closed loop)**: New `POST /api/marketing/performance-report` (+ `GET /api/marketing/performance-reports`) computes a conversion-first content report for a period (default last 30 days). It joins first-party tracked-link clicks (`marketing_links`/`marketing_link_clicks`) and GA4 conversions (`analytics_daily`) to content **through campaigns** (the lowest granularity the data supports — surfaced honestly), benchmarks clicks/conversions against the prior equal-length period, and asks the analyst model for a summary + specific recommendations. Results persist to a new `marketing_performance_reports` table (migration `0031`). **The loop closes two ways:** emitted recommendations are written as `recommendations` rows (area "Marketing"), and editorial-calendar generation now folds recent open marketing recommendations into its grounding so the next calendar responds to what's working. New feature key `marketingPerformance` (Enterprise/Unlimited). New Marketing → **Performance** page (summary, benchmark indices, totals, by-campaign and by-content tables, emitted recommendations). New files: `server/routes/marketing-performance.ts`, `server/services/performance-service.ts`, `server/services/performance-core.ts` (unit-tested), `client/src/pages/app/marketing/performance.tsx`.
- **Distribution/editorial planner**: New `POST /api/editorial-calendars/:id/distribution-plan` recommends a posting schedule for a calendar's schedulable briefs — assigning each a **channel** (from the brief's channels or its format) and a **posting window**, spread deterministically across a date range on weekdays at channel-appropriate hours, and mapped to a fiscal quarter. When a `planId` is supplied it **materializes the schedule into the marketing planner** as `marketing_tasks` (activity group "Digital", `dueDate` = posting window, timeframe = quarter), which then rides the existing **Microsoft Planner sync** — no new sync path. Scheduling is pure/deterministic and unit-tested (`distribution-planner-core`). New feature key `distributionPlanner` (Enterprise/Unlimited). Surfaced as **Plan distribution** in the Editorial Calendar UI (date range, skip-weekends, optional target plan, schedule preview). New files: `server/routes/distribution-planner.ts`, `server/services/distribution-planner-service.ts`, `server/services/distribution-planner-core.ts`.
- **SEO/AEO optimizer**: New `POST /api/content/optimize` (accepts a `contentAssetId` or raw `{ title, content }`) produces search metadata (SEO title ≤60c, meta description ≤155c, slug, target keyword, keywords), answer-engine blocks + FAQ pairs (AEO, for featured snippets / AI answer engines), internal-link suggestions, and content-gap notes. Internal links are **validated against the tenant's real `content_assets` inventory** — hallucinated or self-referential links are dropped and titles are replaced with the canonical inventory title. Results persist to a new `content_optimizations` table (migration `0030`). New feature key `seoAeoOptimizer` (Enterprise/Unlimited). New files: `server/routes/content-production.ts`, `server/services/seo-aeo-service.ts`, `server/services/seo-aeo-core.ts` (unit-tested).
- **Content repurposing engine**: New `POST /api/content-assets/:id/repurpose` turns a content asset into a batch of 3–12 brand-aligned social variants across platforms (default LinkedIn + X/Twitter), each taking a distinct angle, grounded in the StrategicContext voice/brand. Variants are written into the existing `generated_posts` pipeline as standalone drafts (`sourceAssetId` + shared `variantGroup`), with per-platform length guardrails (X/Twitter ≤280c clamped at a word boundary). New feature key `contentRepurposing` (Enterprise/Unlimited). New files: `server/services/repurpose-service.ts`, `server/services/repurpose-core.ts` (unit-tested).
- **Editorial Calendar UI — repurpose & optimize actions**: drafted briefs now expose **Repurpose** and **SEO/AEO** actions that run the new engines and show results (social variants with copy; SEO metadata, answer blocks, FAQ, validated internal links, and content gaps) in dialogs — completing the in-product flow from brief → draft → repurpose/optimize.
- **Editorial Calendar UI** (`/app/marketing/editorial-calendar`, Marketing → Execute): generate a demand-scored calendar (with optional focus + brief count), browse calendars, and review each brief as a card showing its funnel stage, format, target keyword, effort estimate, demand signal, differentiation angle, target reader, and CTA — plus a funnel-mix summary against the 40/35/25 target. Per brief you can change status or click **Draft** to run the copywriter and view/copy the generated draft (saved to the content library). Enterprise-gated via `FeatureGate`. New file: `client/src/pages/app/marketing/editorial-calendar.tsx`; wired into `App.tsx` routing and the `AppLayout` nav.
- **Multi-format copywriter (draft from brief)**: New `POST /api/content-briefs/:id/draft` turns an accepted content brief into a publishable first draft in the brief's format — blog post, landing page, LinkedIn/X post, newsletter, video script, case study, or whitepaper — each with format-specific structure/length guidance. Voice and positioning are bound from the StrategicContext (messaging framework + brand identity); when the brief names a target persona, that audience grounding is added. The draft is persisted as a `content_assets` row (body in `content`, format mapped to `assetType`, meta as `description`) and linked back to the brief (`contentAssetId`, status → `drafted`). Delimiter-based parsing (`===TITLE===/===BODY===/===META===`) keeps long Markdown bodies robust. New files: `server/services/copywriter-service.ts`; new tested helpers in `editorial-calendar-core.ts` (`FORMAT_GUIDANCE`, `briefFormatToAssetType`, `parseDraftResponse`).
- **Editorial Calendar (AI content briefs)**: New `POST /api/editorial-calendars/generate` produces a demand-scored set of content briefs grounded in intrinsic data — the messaging framework (voice/positioning), competitive gaps, personas, brand identity, and tracked SEO keywords (the demand pool). Each brief carries a target keyword, demand signal, funnel stage, differentiation angle, a specific target reader, CTA, channels, and an effort estimate; the generator balances the funnel (40/35/25) and surfaces non-blocking quality warnings (too few briefs, stage over-concentration, missing demand signal/angle/reader). Briefs are structured, status-tracked rows that will flow into the copywriter and scheduler — the messaging framework stays the canonical positioning source (no separate positioning dossier). New tables `editorial_calendars`, `content_briefs` (migration `0029`); new feature key `editorialCalendar` (Enterprise/Unlimited). New files: `server/routes/editorial-calendar.ts`, `server/services/editorial-calendar-service.ts`, `server/services/editorial-calendar-core.ts` (unit-tested), `server/services/__tests__/editorial-calendar-core.test.ts`.
- **Brand identity in AI grounding**: `StrategicContext` now assembles a Brand Identity section from intrinsic tenant data — brand colors (`tenants.primaryColor/secondaryColor/accentColor/neutralColor` + logo URL), available logo variants (`brand_assets`), and custom brand fonts by usage (`tenant_fonts`) — and injects it into content-generation prompts so copy and proposed graphics stay on-brand. Verbal tone continues to come from the messaging framework. Extended: `server/services/strategic-context.ts`.
- **Marketing context readiness**: New `GET /api/marketing/context-readiness` reports how complete a tenant's intrinsic marketing data is — the Orbit equivalent of an onboarding `variables.md`. Scores company profile, ICP personas, messaging framework (MPF), GTM plan, products, competitors (3–5 recommended), and brand kit (colors/logo/fonts) as ready/thin/missing with per-field fix hints and a 0–100 readiness score. Pure scoring core is unit-tested. New files: `server/services/marketing-context-readiness.ts`, `server/services/marketing-context-readiness-core.ts`, `server/routes/marketing-context.ts`, `server/services/__tests__/marketing-context-readiness.test.ts`.
- **Conference Social Promotion**: Drive coordinated social promotion for a single conference. Define the event plus a detailed promotion window and cadence (promotion start/end, posts per day, weekend toggles, number of anchor posts, and copy variations per post). Add the sessions you're delivering one at a time or via bulk paste/CSV import. The generator produces 1-2 anchor posts for overall presence plus one post per session — each with 2-3 distinct copy variations and a matched 1:1 graphic — scheduled across the promotion window into the shared posts/calendar/publishing flow. Session graphics support three modes: AI-generated (gpt-image-1), session text composited onto an uploaded brand template (sharp), or your own uploaded image. Conference images live in their own dedicated, archivable space (kept out of the brand library so it stays uncluttered); a one-click "Archive conference" hides the event and all its images after it's over, restorable later. New tables `conferences`, `conference_sessions`, `conference_images` (migration `0025`); new feature key `conferencePromotion`. New files: `server/routes/conference-promotion.ts`, `server/services/conference-promotion-service.ts`, `client/src/pages/app/marketing/conference-promotion.tsx`, `client/src/pages/app/marketing/conference-detail.tsx`.
- **Microsoft Planner integration (Marketing Planner, phase 1)**: One-way push from Orbit marketing plans to a Microsoft Planner plan. Per-plan picker for Microsoft 365 group → Planner plan → bucket, with the option to select an existing bucket or create a dedicated "Orbit" bucket. Delegated OAuth with `Tasks.ReadWrite Group.Read.All offline_access`; refresh tokens stored per user. Sync creates new Planner tasks and updates previously synced tasks (title, priority, due date, % complete) using `If-Match` etags. Status banner on the plan detail surfaces last sync time and any errors. New files: `server/services/planner-graph-client.ts`, `server/services/planner-service.ts`, `server/routes/planner.ts`, `client/src/components/PlannerSyncDialog.tsx`.
- **Support ticket attachments**: Attach screenshots and documents (PDF, DOCX, TXT, images up to 10 MB) to a new ticket or to any reply, on both the user and admin views. Backed by object storage with per-ticket access control; attachments tied to internal-only replies are hidden from non-admins.
- **Support ticket reply notifications**: Email and in-app notifications now fire on non-internal replies — admin replies notify the ticket owner; owner replies notify the assignee (or all admins if unassigned). New `support_reply` notification type.
- **Admin support triage UX**: Admin Support card now has search across ticket #/subject/submitter/tenant; filters for status (defaulting to "Active"), priority, category, assignee, and tenant; an Age column with staleness colouring (>7d orange, >14d red); CSV export; and bulk status / priority / assignee updates via row checkboxes.
- **Account / Billing / Other ticket categories**: New Ticket form now exposes the `account`, `billing`, and `other` categories that were already in the schema.
- **Persona text ingestion**: Paste text from CRM records, research reports, strategy documents, meeting notes, or any source — AI extracts a structured persona with name, role, industry, pain points, goals, objections, and preferred channels. Available via "Import from Text" button on the Personas page.
- **Email newsletter product filter**: Content asset picker now includes a Product filter dropdown alongside the existing Category filter, with product badges on each asset row.

### Fixed

- **HubSpot email formatting**: Changed inner table width from 600px to 560px to fit within HubSpot's editor frame without overflow. Stripped `<style>` blocks, `<!DOCTYPE>`, `<html>`, `<head>`, and `<body>` tags that HubSpot doesn't support. Removed default "Hi there" greeting since HubSpot provides its own greeting section.

### Changed

- **GTM Plan generation**: Now automatically pulls buyer personas to tailor market targeting, distribution channels, and buyer segment strategies.
- **Messaging Framework generation**: Now automatically pulls buyer personas to tailor audience segments, messaging pillars, and tone guidance.
- **Product One Sheet generation**: Now automatically pulls buyer personas to tailor challenge/solution framing, benefits, and audience targeting.

### Fixed

- **Artifact Freshness accuracy**: Previously, artifacts that were months old would show "Current" as long as source data was equally stale. Now applies absolute age thresholds — artifacts older than 14 days show "Aging" and older than 30 days show "Stale" regardless of source data age.
- **Intelligence Briefings in Artifact Freshness**: Added Intelligence Report to the Artifact Freshness card so all generated intelligence artifacts are tracked.

---

## [2.0.0] - 2026-03-25

### Added

- **Marketing Content Library** (Enterprise)
  - Central repository for marketing content assets (articles, blogs, whitepapers, case studies)
  - URL auto-extraction with AI-generated summaries and lead image capture
  - Customizable categories, product tagging, season tagging, and topic tagging
  - Bulk AI summarization for grounding future content generation
  - CSV import/export for bulk asset management
  - Archive workflow for retired content

- **Marketing Brand Library** (Enterprise)
  - Curated library for approved brand visuals, logos, icons, and marketing images
  - Direct file upload to object storage
  - Product cross-linking and customizable categories
  - Lead images from Content Library can be saved directly to Brand Library

- **Social Campaigns** (Enterprise)
  - Campaign wizard: Details → Assets → Accounts → Schedule
  - AI-powered social post generation across LinkedIn, X/Twitter, Facebook, and Instagram
  - Intelligence-enriched generation using GTM Plan, Messaging Framework, and competitive insights
  - Per-asset post generation with correct source URL and lead image resolution
  - Intelligent scheduling with configurable campaign dates, posting days, and weekend preferences
  - Post review, edit, approve/reject workflow
  - CSV export with SocialPilot-compatible format and schedule guard warning for unscheduled posts
  - Automatic hashtag merging from multiple content sources
  - Scaling: 3 variants per combo (1 asset), 2 (2-3 assets), 1 (4+ assets)

- **Email Newsletters** (Enterprise)
  - AI-powered email generation from Content Library assets
  - Platform-specific formatting: Outlook, HubSpot Marketing, HubSpot 1:1, Dynamics 365
  - Tone customization (Professional, Friendly, Urgent) and CTA configuration
  - Subject line coaching and AI-generated suggestions
  - Strategic context grounding from GTM Plan and Messaging Framework
  - Save and label generated email drafts

- **Social Accounts Management**
  - Link social media profiles (LinkedIn, X, Facebook, Instagram) with account names
  - Platform-specific targeting for AI content generation

- **Saturn Capture Browser Extension**
  - Chromium-based extension for capturing web content directly into Content Library
  - Full page and asset capture using existing Orbit session authentication
  - Download and install from in-app instructions page
  - Captured assets flagged with `captured_via_extension` source

- **Intelligence Briefing Podcasts** (Pro/Enterprise/Unlimited)
  - AI-generated podcast-style audio summaries of intelligence briefings
  - Two-host conversational format using OpenAI TTS (echo and nova voices)
  - In-browser playback and MP3 download
  - Audio stored in Replit Object Storage

- **Intelligence Briefing Subscriptions** (Enterprise/Unlimited)
  - Per-user email subscription management for weekly briefings
  - Domain Admin configuration for organization-wide scheduled briefing generation
  - Automated weekly digest job generates briefings and emails subscribers via SendGrid
  - Branded email templates with executive summary and key themes

- **Intelligence Freshness UX**
  - Intelligence Health dashboard replacing Refresh Center (moved from System to Insights nav group)
  - Health percentage score computed from source/artifact freshness
  - "Needs Attention" card surfacing stale sources and outdated artifacts with contextual refresh actions
  - "Built from data as of" banners on Analysis, Battlecards, GTM Plan, and Messaging Framework pages with inline rebuild buttons
  - Data Currency badges on Reports list
  - Staleness utilities: `checkArtifactFreshness`, `computeIntelligenceHealth`, `formatShortDate`

- **Action Item Lifecycle Management**
  - Dismiss with reason dialog (Not relevant, Already addressed, Duplicate, Other)
  - Bulk accept and bulk dismiss via multi-select toolbar
  - Status tabs: Active, Accepted, Dismissed
  - Dismissed items tracked with reason and timestamp for audit
  - Gap analysis deduplication prevents dismissed items from reappearing

- **SEO Optimization**
  - Semantic HTML improvements (headings, landmarks, ARIA labels)
  - Open Graph and Twitter Card meta tag updates
  - Structured page titles and descriptions

- **CSV Export Schedule Guard**
  - Warning dialog before exporting campaign posts that have no scheduled dates
  - Prevents exporting unscheduled posts to social media scheduling tools

- **News Monitoring Integration**
  - GNews API integration for competitor and baseline company news
  - News items included in intelligence briefings
  - Enhanced change detection with structured AI analysis categorizing changes by type and significance

- **Canonical Organization Layer**
  - Centralizes public company data in the `organizations` table
  - URL normalization and ref-counted lifecycle

- **Centralized Job Queue**
  - Priority-based, concurrency-limited queue for heavy background tasks
  - PDF generation, crawls, monitors, and analysis all routed through unified queue

- **PDF Browser Pool**
  - Singleton Chromium instance for efficient PDF generation
  - Shared across report generation and battlecard PDF exports

### Changed
- Refresh Center renamed to "Intelligence Health" and relocated from System nav group to Insights group
- Action Items page replaces "Recommendations" in sidebar navigation
- Post image resolution now matches by `sourceUrl` to correct content asset `leadImageUrl`
- Backend CSV export uses `contentAssetByUrl` map for accurate image URLs
- `CURRENT_APP_VERSION` bumped to `"2.0.0"`

### Fixed
- Post generation: `getPostImage()` now matches by `sourceUrl` instead of always returning first asset's image
- CSV export: `getPostImageUrl` fixed with `contentAssetByUrl` map for correct per-post images
- HubSpot email width rendering issues resolved
- PDF Report: Theme cards no longer show "Based on profile" placeholder text
- PDF Report: Messaging comparison shows "Market Positioning" header when competitor names unavailable
- PDF Report: Numbered lists properly wrapped in ordered list tags
- PDF Report: Added h4 heading support in markdown-to-HTML conversion
- PDF Report: Resolved LSP type errors for faviconUrl, talkingPoints, and companyProfile fields

---

## [1.5.0] - 2026-03-01

### Added
- Support Ticket System with user submission, admin management, and email notifications
- What's New notification modal with version tracking
- Standalone Changelog and Roadmap pages
- Consolidated Action Items Dashboard (`/app/action-items`) aggregating recommendations, product features, and gap analysis
- Action Items: filter by source, impact, status; search, accept/dismiss/star; CSV export
- Service Plan Feature Gating with centralized plan policy service
- Editable GTM Plan & Messaging Framework with version history
- Product Competitive Position Summaries with AI generation and manual editing
- GTM Plan & Messaging Framework toggle in standard PDF reports

### Fixed
- UX Optimization Phases 1-3: Refresh Center, Command Palette, staleness indicators, batch operations, keyboard shortcuts
- Company Profile fields for competitors with AI auto-extraction
- Enhanced scheduled job tracking with entity-level run details

---

## [1.0.0-beta.1] - 2026-01-26

### Added
- Marketing Planner (Enterprise-only) - AI-powered marketing planning module
  - Create quarterly, half-year, or annual marketing plans
  - Organize activities across 19 marketing categories (Events, Digital Marketing, Outbound, etc.)
  - Track tasks with priority levels and status workflow
  - Enterprise feature with Diamond (Gem) icon in navigation
  - Defense-in-depth security with market context filtering on all operations
- Redesigned Homepage - New "Go-to-Market Intelligence Platform" positioning
  - New tagline: "From insight to action in one platform"
  - Three Pillars section: Competitive Intelligence, Marketing Planner, Product Management
  - "How It Works" flow diagram: Monitor → Analyze → Plan → Execute
  - Updated capabilities tabs with Marketing Planner and Product Roadmap
  - New "Who It's For" section targeting four audience types
  - Updated pricing preview with 60-day trial messaging
  - Added GTM Maturity Assessment link (https://orion.synozur.com/gtm)
- Organization Filter for User Management - Global Admins can now filter users by organization
- Auto-Promotion for First Domain User to Domain Admin role
- One-Click Full Report Generation for projects
- Battlecard Export Options (clipboard, PDF, text file)
- 60-Day Trial System with automated reminder emails
- AI Usage Tracker - Global Admin dashboard
- Blog/RSS Feed Monitoring for competitors and baseline company
- Enhanced Blog Discovery in Web Crawler (insights/insights pages)
- Backlog.md file with comprehensive MVP feature tracking

### Fixed
- "Regenerate All" now preserves manual research for competitors with manually entered data

### Changed
- Separated Company Baseline and Competitors screens into distinct pages
- Unified Overview page consolidated from Command Center and Overview
- Overview is now the home page hero when logging in
- Added "Rebuild All" button to Overview for admins
- Enhanced AI Insights section with action item assignment

---

## [0.1.0] - 2026-01-17

### Added

#### Authentication & Security
- Microsoft Entra ID SSO integration using @azure/msal-node with OAuth 2.0 flow
- SSO users linked via `entraId` field with `authProvider: "entra"`
- Password login blocked for SSO-authenticated users
- Session-based authentication with express-session
- Role-based access control (Global Admin, Domain Admin, Standard User)
- First registered user becomes Global Admin
- First user per email domain becomes Domain Admin

#### Multi-Tenant Architecture
- Tenant isolation by email domain
- Tenants table with plan, status, and usage limits
- Role hierarchy enforcement across tenants

#### Data Inputs
- Competitor URL entry and management
- Grounding document upload (PDF, DOCX) with text extraction using mammoth and pdf-parse
- Company profile baselining for self-analysis
- Tenant demographics collection (company, jobTitle, industry, companySize, country)

#### Core AI Analysis
- Competitive website analysis with Claude Sonnet via Anthropic SDK
- AI-guided recommendations with RAG-style architecture
- Gap analysis between company positioning and competitors
- Provider abstraction supporting MockAIProvider for development

#### User Interface
- Combined signin/signup auth page with tabs (Vega-style)
- Dark mode default with light/dark mode toggle using next-themes
- Synozur brand colors (#810FFB purple, #E60CB3 pink)
- Satellite dish hero background on landing page
- Synozur mark favicon and brand logo
- Dashboard, Competitors, Analysis, Recommendations pages
- Activity log for tracking changes
- Assessments with proxy capability for admins
- Global Admin tenant dashboard
- shadcn/ui component library with Radix UI primitives

#### Branding & Meta
- Page title: "Orbit Competitive Market Analysis | The Synozur Alliance"
- Open Graph and Twitter Card meta tags for social sharing
- Synozur Alliance horizontal logo for social previews

#### Technical Infrastructure
- React with TypeScript using Vite
- Express.js backend with TypeScript
- PostgreSQL database with Drizzle ORM
- Wouter for client-side routing
- TanStack React Query for server state
- Tailwind CSS v4 with CSS variables for theming

---

## Changelog & Backlog Guidelines

### Updating the Changelog
1. Add entries under `[Unreleased]` as features are completed
2. Group changes by category: Added, Changed, Deprecated, Removed, Fixed, Security
3. When releasing, move unreleased items to a new version section with date
4. Write entries from user perspective, not technical implementation details
5. Include ticket/issue references when applicable

### Updating the Backlog
1. Mark items complete with `[x]` when fully implemented and tested
2. Add new items under appropriate priority level
3. Move items between priority levels as requirements evolve
4. Add effort estimates for new items
5. Update status descriptions when partial progress is made
6. Archive completed sections to a separate "Completed" file quarterly
