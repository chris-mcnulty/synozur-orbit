# Orbit Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.1.0] - 2026-08-16

### Added

- **Strategic Intelligence Stack — Market Segments** (`/app/marketing/market-segments`): Define and rank the market segments that matter for your go-to-market. AI proposes segments from your strategic context, sizes each one (TAM / SAM / SOM ranges with confidence levels, grounded in US Census County Business Patterns data plus live web research), builds a needs map per segment, and scores segment priority. Every AI figure is user-overridable, and personas can be backfilled onto segments in one click.

- **Strategic Intelligence Stack — Opportunity Matrix** (`/app/marketing/opportunity-matrix`): A segment × need × channel GTM heatmap. The scoring engine rates expected ROI for each cell, flags top-ROI cells (highest ROI percentile — a whitespace proxy, not yet a competition measure), and surfaces the top opportunities as a ranked list. Individual cells accept manual overrides that survive regeneration.

- **Strategic Intelligence Stack — Market Study Wizard** (`/app/marketing/market-studies`): Run an end-to-end market study from a single URL or written brief. Choose a depth (Explore / Focus / Dominate) and the staged pipeline runs in the background — input analysis → autonomous competitor discovery → segment modeling → sizing → opportunity matrix → executive summary — with live per-stage progress. Discovered competitors are created as real competitor records in your market. Completed studies can be refreshed (re-run, linked to the original) and exported as a Synozur/Orbit-branded PDF with the executive summary, ranked segments, and top GTM opportunities.

- **Master Marketing Calendar** (`/app/marketing/marketing-calendar`): One unified calendar across social posts, scheduled emails, and content briefs, with lifecycle-stage coloring, campaign/type filters, and a backlog rail for undated items. The built-in Content Advisor recommends what to schedule next — including time-of-day suggestions — scoped to your active filters.

- **Campaign & Theme Planning Hub**: A per-campaign / per-theme view aggregating every associated social post, email, and content brief, so a campaign's full content footprint is visible in one place. Manually created content participates in the same calendar and pipeline flows.

- **Section-based email newsletters**: Compose newsletters from structured sections — curated content assets, case studies, upcoming events, and a General Information section (sign-off + About block) — rendered server-side with fluid-hybrid responsive HTML that holds up in Outlook. A 16-px minimum font floor is enforced, images are auto-published and absolutized at send time, and sections carry forward when re-editing a saved email.

- **Email A/B testing**: Send subject-line or content variants to test cohorts with a holdback, then see open/click results per variant. Cohorts are immutable once drawn; recipient eligibility (opt-outs, suppression) is re-checked at delivery time.

- **List & segment email sends with compliance guardrails**: Send to mirrored HubSpot lists or Orbit-built segments through SendGrid. CAN-SPAM enforcement blocks any list/segment send until a tenant mailing address is configured (checked at dispatch and again at delivery), and SendGrid unsubscribe/spam webhooks now stamp opt-outs automatically.

- **HubSpot per-category subscription mapping & paste-safe export**: Map each Orbit subscription type to a HubSpot subscription ID for consent-accurate syncing, and copy generated emails as paste-safe HTML fragments that survive the HubSpot editor (with explicit case-study CTA links).

- **Direct social publishing — X (Twitter) with media**: Publish posts with images straight to X via the v2 media pipeline, with hardened token rotation (single-use refresh tokens are persisted immediately and publishes are serialized per account) and typed, actionable error messages when a publish fails.

- **One-click social connections (global OAuth apps)**: X, Facebook, Instagram, and LinkedIn now use a single Synozur-managed OAuth app each — tenants connect an account in one click with no per-tenant developer-app setup. Global Admins manage platform credentials centrally.

- **Unified Social Post Editor**: The same full-featured editor (copy, hashtags, image, link preview with server-validated URL/label) now opens from the queue, the calendar, the Content Pipeline board, and campaign detail — replacing four divergent edit dialogs.

- **Content-to-post multi-channel fan-out**: Convert a LinkedIn/X content draft into scheduled posts for multiple platforms at once — the native channel keeps the copy verbatim while additional channels get AI-tailored variants.

- **Website content import**: Import blog posts, events, and case studies from your live website (via the website MCP connection) directly into the Content Library — with automatic lead-image capture, category assignment, async AI summaries, and an upcoming-only/all-events toggle for events.

- **Multi-format content repurposer**: Turn one content asset into a batch of formats in a single run — LinkedIn posts and carousels flow into the social pipeline with auto-rendered branded graphics (one per carousel slide), while long-form outputs (blog post, newsletter, whitepaper, podcast outline, video script) land as drafted content briefs.

- **One-click Finalize**: Approve a content brief and activate its linked draft in one atomic action.

- **Blog post drafts — subtitle, overview & tags**: Blog-format drafts now generate a subtitle, an overview/abstract, and suggested tags alongside the body.

- **Competitor News Mentions via GNews**: The News Mentions tab now scans all competitors through the GNews API (relevance-ranked, phrase-matched) instead of fragile web scraping.

- **Marketing deep links**: Notifications and cross-page links now land on the exact item — briefs, emails, and posts auto-scroll, highlight, and open on arrival, including undated posts in the calendar backlog.

### Changed

- **Content Library ordering**: Assets now sort by content date (publish date or event start date) with stable pagination, and the library list shows how many emails each asset has appeared in.
- **Home page performance**: Tenant-scoped indexes and parallelized queries cut multi-second page loads (10+ s worst case) down to sub-second across Home, markets, and admin endpoints.
- **Feature gating consistency**: All gated widgets are loading-aware, eliminating the flash of premium UI before a disabled feature check resolves.

### Fixed

- **X (Twitter) account disconnections**: Concurrent token refreshes were revoking the grant (X refresh tokens are single-use). Rotated tokens are now persisted immediately, refreshes start 60 s early, and per-account serialization prevents the race.
- **Email image rendering**: Images in generated emails are published to tenant-owned storage and absolutized at send; tracking-wrapper rewrites of `img src` (which broke images in some clients) are excluded.
- **Website import events**: Events from the website MCP were returning empty and blog retrieval could hang forever — both fixed, with MCP errors now surfaced as a banner in Settings and the import dialog.
- **Category filter in the email generator**: The dropdown was querying the wrong endpoint and always came back empty.

---

## [3.0.0] - 2026-06-13

### Added

- **Area-based navigation (UX restructuring)**: The sidebar's 44-item accordion is replaced by a value-chain header — **Research → Product → Marketing → Sales** tabs (desktop), with **Home** on the sidebar logo and **Admin & Settings** behind the header gear. The sidebar now shows only the active area's items with light section headings. One-time setup pages (Social Accounts, Platform Credentials, Browser Extension) moved to Admin & Settings → Connections — their URLs are unchanged. All existing routes keep working.

- **Global Home page** (`/app`): A company-at-a-glance landing page — live signals (high-impact, prioritized), the baseline executive summary digest, the Orbit Score with trend, and one glance-card per area (Research / Product / Marketing / Sales) showing a headline stat and its most pressing action. The research workspace dashboard keeps its existing URLs at `/app/dashboard` and `/app/overview` under the Research area.

- **Sales hub** (`/app/sales`): The Sales area now lands on a hub showing live counts and last-updated times for Battle Cards, Reports, Relationship Plans, and Assessments — with a staleness warning when battle cards were built on data over 60 days old.

- **Content Pipeline board** (`/app/marketing/pipeline`): One kanban board for every in-flight content item across social posts, saved emails, and content briefs — with Board/List view toggle (persisted per user), source/campaign/search filters, and drag-between-columns status changes. Stages are canonical (Draft → In Review → Approved → Scheduled → Published/Sent). Dropping a post on Scheduled opens a date picker; illegal moves are rejected with a toast; publish failures surface in Scheduled with an alert; the Published/Sent archive loads collapsed.

- **Campaign filter in Content Pipeline**: The pipeline's campaign dropdown now works correctly following the fix to the campaigns list endpoint. Posts and briefs both carry their `campaignId` through to the board.

- **Conference Social Promotion** (`/app/marketing/conferences`): Drive coordinated social promotion for a single conference. Define the event and a detailed promotion window (start/end, posts per day, weekend toggles, copy variations per post). Add sessions one at a time or via bulk paste/CSV import. The generator produces 1-2 anchor posts for overall presence plus one post per session — each with 2-3 distinct copy variations and a matched 1:1 graphic composited from your brand template — scheduled across the promotion window into the shared posts/calendar/publishing flow. Conference images live in their own dedicated, archivable space. One-click "Archive conference" hides the event and all its images after it's over, restorable later.

- **Editorial Calendar** (`/app/marketing/editorial-calendar`): Generate a demand-scored content calendar (with optional focus and brief count), browse calendars, and review each brief as a card showing funnel stage, format, target keyword, effort estimate, demand signal, differentiation angle, target reader, and CTA — plus a funnel-mix summary against the 40/35/25 target.

- **Multi-format copywriter (Draft from brief)**: Turn an accepted content brief into a publishable first draft in the brief's format — blog post, landing page, LinkedIn/X post, newsletter, video script, case study, or whitepaper — each with format-specific structure and length guidance. Voice and positioning bound from the StrategicContext. The draft is persisted as a content asset row and linked back to the brief.

- **Content repurposing engine**: Turn a content asset into a batch of brand-aligned social variants across platforms (LinkedIn + X/Twitter), each taking a distinct angle. Variants are written into the existing generated posts pipeline as standalone drafts.

- **SEO/AEO optimizer**: Produces search metadata (SEO title ≤60c, meta description ≤155c, slug, target keyword), answer-engine blocks + FAQ pairs, internal-link suggestions validated against real content library inventory, and content-gap notes. Results persist to the `content_optimizations` table.

- **Editorial Calendar — repurpose & optimize actions**: Drafted briefs now expose **Repurpose** and **SEO/AEO** actions that run the new engines and show results in dialogs — completing the in-product flow from brief → draft → repurpose/optimize.

- **Distribution planner**: Recommends a posting schedule for a calendar's schedulable briefs — assigning each a channel (from the brief's channels or its format) and a posting window, spread deterministically across a date range on weekdays at channel-appropriate hours, mapped to a fiscal quarter. When a plan ID is supplied it materializes the schedule into the marketing planner as `marketing_tasks`, which then rides the existing Microsoft Planner sync.

- **Distribution planner — timezone-aware scheduling**: The planner places best-posting hours in the user's local timezone. The client sends `tzOffsetMinutes` and the scheduled UTC instant is computed from the local wall clock.

- **Long-form AI rewrite in the draft viewer**: A drafted brief's content can be revised in place from the Editorial Calendar — enter an instruction and `POST /api/content-assets/:id/rewrite` returns a brand-voice-grounded revision and persists it back to the content asset.

- **Marketing performance report (closed loop)**: `POST /api/marketing/performance-report` computes a conversion-first content report for a period (default last 30 days). Joins first-party tracked-link clicks and GA4 conversions to content through campaigns, benchmarks clicks/conversions against the prior equal-length period, and asks the analyst model for a summary and specific recommendations. Emitted recommendations are written as `recommendations` rows (area "Marketing"), and editorial-calendar generation folds recent open marketing recommendations into its grounding so the next calendar responds to what's working.

- **Marketing context readiness**: `GET /api/marketing/context-readiness` reports how complete a tenant's intrinsic marketing data is — scores company profile, ICP personas, messaging framework, GTM plan, products, competitors, and brand kit as ready/thin/missing with per-field fix hints and a 0–100 readiness score.

- **Brand identity in AI grounding**: `StrategicContext` now assembles a Brand Identity section from intrinsic tenant data — brand colors, logo variants, and custom brand fonts — and injects it into content-generation prompts so copy and proposed graphics stay on-brand.

- **Product portfolio collateral strip**: Each product card on `/app/products` now shows a per-artifact freshness strip — Gaps, Recs, Summary, GTM, Messaging, One-sheet — with ✓ generated (amber when over 60 days old), generating, or not-yet states; each chip deep-links to that artifact's tab on the product workspace.

- **Campaign detail — compact post cards**: Generated posts now render collapsed by default (56px thumbnail, 2-line clamped copy, status/schedule/hashtag chips) so a generation batch fits on one screen. Click a card or its chevron to expand to full text and the inline copy/hashtag editors.

- **Marketing hub — pipeline pulse**: The Marketing landing page now opens with live counts (in pipeline, awaiting approval, scheduled next 7 days) and a needs-your-attention list (drafts awaiting approval, approved-but-unscheduled, failed publishes) linking into the Content Pipeline board.

- **Microsoft Planner integration (Marketing Planner)**: One-way push from Orbit marketing plans to a Microsoft Planner plan. Per-plan picker for Microsoft 365 group → Planner plan → bucket. Delegated OAuth with `Tasks.ReadWrite Group.Read.All offline_access`; refresh tokens stored per user. Sync creates new Planner tasks and updates previously synced tasks (title, priority, due date, % complete) using `If-Match` etags. Status banner on the plan detail surfaces last sync time and any errors.

- **Support ticket attachments**: Attach screenshots and documents (PDF, DOCX, TXT, images up to 10 MB) to a new ticket or to any reply, on both user and admin views. Backed by object storage with per-ticket access control.

- **Support ticket reply notifications**: Email and in-app notifications fire on non-internal replies — admin replies notify the ticket owner; owner replies notify the assignee (or all admins if unassigned).

- **Admin support triage UX**: Admin Support card now has search across ticket #/subject/submitter/tenant; filters for status, priority, category, assignee, and tenant; an Age column with staleness colouring (>7d orange, >14d red); CSV export; and bulk status/priority/assignee updates via row checkboxes.

- **Account / Billing / Other ticket categories**: New Ticket form now exposes the `account`, `billing`, and `other` categories.

- **Persona text ingestion**: Paste text from CRM records, research reports, or strategy documents — AI extracts a structured persona. Available via "Import from Text" on the Personas page.

- **Email newsletter product filter**: Content asset picker now includes a Product filter dropdown alongside the Category filter.

### Changed

- **Area navigation labels**: Marketing Calendar = `/marketing-calendar`, Content Briefs = `/editorial-calendar`, Social Posts = `/calendar`; labels renamed but routes and feature keys are unchanged.
- **GTM Plan generation**: Now automatically pulls buyer personas to tailor market targeting, distribution channels, and buyer segment strategies.
- **Messaging Framework generation**: Now automatically pulls buyer personas to tailor audience segments, messaging pillars, and tone guidance.
- **Product One Sheet generation**: Now automatically pulls buyer personas to tailor challenge/solution framing, benefits, and audience targeting.

### Fixed

- **Campaigns list 500 error**: `fetchCampaignCounts()` was querying `contentAssets.campaignId` (undefined column) — changed to `contentBriefs.campaignId`. Campaign filter in Content Pipeline now works.
- **HubSpot email formatting**: Changed inner table width from 600px to 560px. Stripped `<style>`, `<!DOCTYPE>`, `<html>`, `<head>`, and `<body>` tags that HubSpot doesn't support.
- **Artifact Freshness accuracy**: Now applies absolute age thresholds — artifacts older than 14 days show "Aging" and older than 30 days show "Stale" regardless of source data age.
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
  - Intelligent scheduling with configurable campaign dates, posting days, and weekend preferences
  - Post review, edit, approve/reject workflow
  - CSV export with SocialPilot-compatible format and schedule guard warning for unscheduled posts
  - Automatic hashtag merging from multiple content sources

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

- **Intelligence Briefing Subscriptions** (Enterprise/Unlimited)
  - Per-user email subscription management for weekly briefings
  - Domain Admin configuration for organization-wide scheduled briefing generation
  - Automated weekly digest job generates briefings and emails subscribers via SendGrid

- **Intelligence Freshness UX**
  - Intelligence Health dashboard replacing Refresh Center
  - Health percentage score computed from source/artifact freshness
  - "Needs Attention" card surfacing stale sources and outdated artifacts with contextual refresh actions
  - "Built from data as of" banners on Analysis, Battlecards, GTM Plan, and Messaging Framework pages with inline rebuild buttons
  - Data Currency badges on Reports list

- **Action Item Lifecycle Management**
  - Dismiss with reason dialog (Not relevant, Already addressed, Duplicate, Other)
  - Bulk accept and bulk dismiss via multi-select toolbar
  - Status tabs: Active, Accepted, Dismissed
  - Dismissed items tracked with reason and timestamp for audit
  - Gap analysis deduplication prevents dismissed items from reappearing

- **CSV Export Schedule Guard**
  - Warning dialog before exporting campaign posts that have no scheduled dates

- **News Monitoring Integration**
  - GNews API integration for competitor and baseline company news
  - News items included in intelligence briefings
  - Enhanced change detection with structured AI analysis

- **Canonical Organization Layer**
  - Centralizes public company data in the `organizations` table
  - URL normalization and ref-counted lifecycle

- **Centralized Job Queue**
  - Priority-based, concurrency-limited queue for heavy background tasks
  - PDF generation, crawls, monitors, and analysis all routed through unified queue

### Changed
- Refresh Center renamed to "Intelligence Health" and relocated from System nav group to Insights group
- Action Items page replaces "Recommendations" in sidebar navigation
- `CURRENT_APP_VERSION` bumped to `"2.0.0"`

### Fixed
- Post generation: `getPostImage()` now matches by `sourceUrl` instead of always returning first asset's image
- CSV export: `getPostImageUrl` fixed with `contentAssetByUrl` map for correct per-post images
- HubSpot email width rendering issues resolved
- PDF Report: Theme cards no longer show "Based on profile" placeholder text
- PDF Report: Messaging comparison shows "Market Positioning" header when competitor names unavailable
- PDF Report: Numbered lists properly wrapped in ordered list tags
- PDF Report: Added h4 heading support in markdown-to-HTML conversion

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
- Marketing Planner (Enterprise-only) — AI-powered marketing planning module
  - Create quarterly, half-year, or annual marketing plans
  - Organize activities across 19 marketing categories
  - Track tasks with priority levels and status workflow
- Redesigned Homepage — new "Go-to-Market Intelligence Platform" positioning
- Organization Filter for User Management
- Auto-Promotion for First Domain User to Domain Admin role
- One-Click Full Report Generation for projects
- Battlecard Export Options (clipboard, PDF, text file)
- 60-Day Trial System with automated reminder emails
- AI Usage Tracker — Global Admin dashboard
- Blog/RSS Feed Monitoring for competitors and baseline company

### Fixed
- "Regenerate All" now preserves manual research for competitors with manually entered data

### Changed
- Separated Company Baseline and Competitors screens into distinct pages
- Unified Overview page consolidated from Command Center and Overview

---

## [0.1.0] - 2026-01-17

### Added

#### Authentication & Security
- Microsoft Entra ID SSO integration using @azure/msal-node with OAuth 2.0 flow
- Session-based authentication with express-session
- Role-based access control (Global Admin, Domain Admin, Standard User)
- First registered user becomes Global Admin; first user per email domain becomes Domain Admin

#### Multi-Tenant Architecture
- Tenant isolation by email domain
- Tenants table with plan, status, and usage limits

#### Data Inputs
- Competitor URL entry and management
- Grounding document upload (PDF, DOCX) with text extraction
- Company profile baselining for self-analysis

#### Core AI Analysis
- Competitive website analysis with Claude Sonnet via Anthropic SDK
- AI-guided recommendations with RAG-style architecture
- Gap analysis between company positioning and competitors

#### User Interface
- Combined signin/signup auth page with tabs
- Dark mode default with light/dark mode toggle
- Synozur brand colors (#810FFB purple, #E60CB3 pink)
- Dashboard, Competitors, Analysis, Recommendations pages
- Activity log for tracking changes
- Assessments with proxy capability for admins
- Global Admin tenant dashboard
- shadcn/ui component library with Radix UI primitives

---

## Changelog Guidelines

1. Add entries under the current version section as features are completed
2. Group changes by category: Added, Changed, Deprecated, Removed, Fixed, Security
3. Write entries from the user perspective, not technical implementation details
4. When releasing, create a new version section with date
