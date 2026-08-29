# Orbit Roadmap & Backlog

> This is the canonical, publicly viewable planning document. The Roadmap contains work committed to a dated timeframe, usually a quarter. The Backlog contains undated ideas and work that has not been committed to a delivery date. Completed work dated before June 30, 2026 is recorded in the history section at the bottom.

## Priority 1: Critical (Must Have for Launch)

### 1.1 SSO Authentication (Microsoft Entra ID + Google)
**Status**: Microsoft Entra ID implemented, Google pending
**Spec Requirement**: "SSO integration with Microsoft Entra ID (Azure AD) and Google"
- [x] Microsoft Entra ID OAuth 2.0 flow with @azure/msal-node
- [x] SSO users linked via `entraId` field, `authProvider: "entra"`
- [x] Password login blocked for SSO users
- [ ] Google SSO (optional, not critical for enterprise)
**Effort**: Remaining: Low (Google SSO only)

### 1.2 PDF Report Generation & Export ✅
**Status**: Implemented
**Spec Requirement**: "Download a PDF report...formatted with Synozur's branding"
- [x] Server-side PDF generation using Puppeteer
- [x] Branded template with Synozur branding (dark mode, professional styling)
- [x] Include analysis findings, recommendations, competitor comparison
- [x] Download endpoint for generated reports (/api/reports/generate)
- [x] Frontend integration with generate dialog and download buttons
**Effort**: Medium - COMPLETED

### 1.3 Web Crawling Service ✅
**Status**: Implemented
**Spec Requirement**: "Crawl and scrape competitor websites...homepage, about page, product/service pages"
- [x] Multi-page crawling (homepage, about, services, products, blog)
- [x] Social media link auto-discovery
- [x] Blog post detection and counting
- [x] Scheduled background jobs (hourly with tenant frequency settings)
- [x] Admin API endpoints for job status and manual triggering
**Effort**: Medium - COMPLETED

### 1.4 Competitor Change Monitoring ✅
**Status**: Implemented
**Spec Requirement**: "Daily or weekly schedule...detect significant updates"
- [x] Social media monitoring (LinkedIn, Instagram) with AI summarization
- [x] Diff detection between crawl snapshots
- [x] AI summarization of changes using Claude
- [x] Store changes in activity log
- [x] Premium feature gating (free/trial tier blocked)
- [x] On-demand monitoring via UI button
- [x] Scheduled job for periodic crawling (via web crawler service)
- [x] Website content change monitoring with AI-summarized diffs
**Effort**: Medium - COMPLETED

---

## Priority 2: Important (Required for Launch)

### 2.1 Email Notification Service ✅
**Status**: Implemented
**Spec Requirement**: "Notification service for email alerts (trial onboarding, competitor updates)"
- [x] Email service integration (SendGrid via Replit integration)
- [x] Email verification emails
- [x] Welcome emails for new accounts
- [x] Team invitation emails
- [x] Password reset emails
- [x] Vega-inspired email styling (purple gradients, dark mode, Synozur branding)
- [x] Trial nudge cadence emails (60-day trial with reminders at days 7, 30, 46, 53, 57, 59, 60)
- [x] Centralized email text management system (`server/config/email-copy.ts` - all subjects, headings, body content)
- [x] Weekly competitor update digest (scheduled job runs Sundays, user opt-in/out in Settings)
- [x] Alert emails for significant changes (`server/services/alert-dispatch.ts` dispatches in-app notifications and `sendCompetitorAlertEmail` based on per-user threshold and the `competitorAlerts` plan feature)
**Effort**: Medium - COMPLETED

### 2.2 Dark/Light Mode Toggle ✅
**Status**: Implemented
**Spec Requirement**: "Dark Mode and Light Mode toggle"
- [x] User preference toggle in settings
- [x] Persist preference in user record or localStorage
- [x] CSS variable switching for theme
**Effort**: Low - COMPLETED

### 2.3 Tenant Admin Features ✅
**Status**: Implemented
**Spec Requirement**: "Tenant Admin manages organization's account – inviting team members"
- [x] Team invite flow with token-based acceptance
- [x] User management (view/update roles/remove members)
- [x] Tenant settings page (branding, monitoring frequency)
- [x] RBAC enforcement for Domain Admin and Global Admin
- [x] Organization filter for Global Admins in User Management
- [x] Auto-promotion of first domain user to Domain Admin role
**Effort**: Medium - COMPLETED

### 2.4 Side-by-Side Messaging Comparison ✅
**Status**: Implemented
**Spec Requirement**: "Side-by-side analysis of client's website vs each competitor"
- [x] Visual comparison table in UI
- [x] Highlight differences in messaging
- [x] Key themes and positioning extraction
**Effort**: Low-Medium - COMPLETED

---

## Priority 3: Nice to Have (Can Ship Without)

### 3.1 Orbit Promotional Landing Page ✅
**Status**: Redesigned with expanded platform positioning
**Spec Requirement**: "Promotional homepage with screenshots, 'Start Free Trial' CTA"
- [x] Three Pillars section (Competitive Intelligence, Marketing Planner, Product Management)
- [x] "How It Works" flow diagram (Monitor → Analyze → Plan → Execute)
- [x] Updated capabilities tabs with 7 capability areas
- [x] "Who It's For" section (Marketing Leaders, Sales Teams, Product Managers, GTM Consultants)
- [x] Enhanced 60-day trial messaging with contactus@synozur.com
- [x] GTM Maturity Assessment link (https://orion.synozur.com/gtm)
- [ ] Add product screenshots to capabilities section
- [ ] Customer testimonials (when available)
- [ ] Video walkthrough/demo

### 3.2 Recommendation Feedback Loop ✅
**Status**: Implemented
**Spec Requirement**: "Users can mark recommendations as 'not relevant'"
- [x] Thumbs up/down on recommendations (dashboard insight cards)
- [x] AI learning from feedback - highly-rated recommendations inform future generation style
- [x] Poorly-rated recommendations are avoided in future suggestions
**Effort**: Medium - COMPLETED

### 3.6 Visual Competitor Assets ✅
**Status**: Implemented
**Spec Requirement**: Capture visual assets for richer competitor profiles
- [x] Fetch favicon/logo from competitor website as thumbnail
- [x] Capture above-the-fold homepage screenshot during crawl (Puppeteer)
- [x] Store images in object storage
- [x] Display logo/favicon in competitor cards and lists
- [x] Show homepage screenshot in competitor detail view (collapsible)
**Effort**: Medium - COMPLETED

### 3.7 Interactive Data Visualization Dashboard
**Status**: Not implemented
**Spec Requirement**: Rich visual analytics for competitive intelligence
**Prerequisites**: Requires expanded social media data collection (sentiment, likes, posts, engagement metrics, follower counts, update frequency) to generate meaningful visualizations
- [ ] Expand social monitoring to capture quantitative metrics (likes, shares, comments, follower counts)
- [ ] Implement sentiment analysis on social posts and website content
- [ ] Track competitor posting frequency and engagement trends over time
- [ ] Build interactive charts (Recharts): competitor comparison, trend lines, sentiment gauges
- [ ] Dashboard widgets: competitive positioning map, share of voice, activity timeline
- [ ] Filterable date ranges and competitor selection
- [ ] Export chart data as CSV
**Effort**: High (data collection expansion required first)

### 3.8 UX Optimization: Refresh/Rebuild Discoverability & Flow ✅
**Status**: Phases 1-3 Implemented
**Problem**: Users must navigate 8+ different pages to trigger rebuild/refresh/recrawl actions, creating poor discoverability and fragmented workflow
**Documentation**: See `docs/ux-optimization-proposal.md` and `docs/ux-optimization-summary.md`

**Phase 1: Quick Wins (Completed)**:
- [x] Global Refresh Status Indicator (header notification with progress)
- [x] Data Staleness Indicators (🟢🟡🔴 dots throughout UI)
- [x] Consolidate Duplicate Buttons (single dropdown per page)
- [x] Contextual Tooltips (explain what each action does, time/cost estimates)

**Phase 2: Core Improvements (Completed)**:
- [x] Command Palette (Cmd+K fuzzy search for all actions)
- [x] Unified Refresh Strategy Dialog (intelligent guidance)
- [x] Batch Operations (select multiple, refresh all)
- [x] Improved Job Status (make admin panel available to all)

**Phase 3: Advanced Features (Completed)**:
- [x] Refresh Center Dashboard (dedicated page for all data ops at `/app/refresh-center`)
- [x] Smart Suggestions (proactive toast prompts when data stale >7 days)
- [x] Keyboard Shortcuts (Ctrl+Shift+R for Refresh Center, Ctrl+Shift+A for Analysis, Cmd/Ctrl+K for Command Palette)
- [ ] Onboarding Tutorial (interactive guide) - Deferred to post-MVP

**Effort**: Completed

---

## Committed Roadmap (time-bound commitments)

Items in this section have a committed timeframe, such as a quarter or named delivery period.

### Competitive Battlecards (Q1 Post-Launch) ✅
Generate competitive battlecards for sales enablement:
- [x] Critical Capabilities Matrix with Harvey Ball scoring (●○◐◑)
- [x] Qualitative comparison narrative
- [x] Sales challenge questions with responses
- [x] Exportable PDF battlecard
- [x] Company Profile fields (headquarters, founded, revenue, funding) with UI editing
- [x] Company Snapshot section in PDF exports

### Marketing Section Landing Page ✅
**Status**: Implemented
**Description**: Central landing page at `/app/marketing` ties together all marketing sub-features (GTM Plan, Messaging Framework, Marketing Planner, Social Campaigns, Email Newsletters, Digital/Web Assets, Visual/Brand Assets, Social Accounts) with at-a-glance status cards and quick-action buttons.
- [x] Page component at `client/src/pages/app/marketing/index.tsx`
- [x] Summary cards for each marketing sub-feature with generated/not-generated status (queries `/api/baseline/recommendations/gtm_plan`, `/api/baseline/recommendations/messaging_framework`, `/api/marketing-plans`)
- [x] Quick-action buttons for generating missing content (deep-links to each sub-feature)
- [x] Route registered in `App.tsx` (`/app/marketing`) with "Marketing Home" entry in `AppLayout.tsx` nav group
- [x] Styled with `page-header-gradient-bar`, Enterprise badges on gated cards, "Set up profile" prompt when company profile is missing
**Effort**: Low-Medium - COMPLETED

### Real-Time Competitor Alerts ✅
**Status**: Implemented
- [x] Real-time in-app notifications for competitor changes (`server/services/notification-service.ts`)
- [x] Social media monitoring (LinkedIn, Instagram, Twitter/X, Facebook) with AI summarization
- [x] Customizable alert preferences (per-user significance threshold: high / medium / all)
- [x] Email alerts via `sendCompetitorAlertEmail` and weekly competitor update digests
- [x] `competitorAlerts` plan feature gates Pro / Enterprise access

### Strategic Intelligence Stack ✅
**Status**: Implemented (August 2026)
- [x] Market Segments: AI-proposed segments with TAM/SAM/SOM sizing (Census CBP + web research), needs maps, priority ranking, persona backfill, and user overrides
- [x] Opportunity Matrix: segment × need × channel GTM heatmap with ROI scoring, top-ROI whitespace-proxy flags, top-opportunities ranking, and cell overrides
- [x] Market Study Wizard: staged background pipeline (input → competitor discovery → segments → sizing → matrix → executive summary) at Explore/Focus/Dominate depths with live progress
- [x] Autonomous competitor discovery — study-discovered competitors created as real competitor records
- [x] Branded PDF export of completed studies (cover, executive summary, ranked segments, top opportunities)
- [x] Study refresh (linked re-run)

### Master Marketing Calendar & Planning Hub ✅
**Status**: Implemented (July 2026)
- [x] Unified calendar across social posts, emails, and content briefs with lifecycle coloring and backlog rail
- [x] Content Advisor with time-of-day recommendations, scoped to active filters
- [x] Campaign & Theme Planning Hub aggregating each campaign's full content footprint
- [x] Deep links land on the exact item (scroll + highlight + auto-open), including undated backlog posts

### Email Newsletter Execution ✅
**Status**: Implemented (July-August 2026)
- [x] Section-based composition (content assets, case studies, events, General Information) with fluid-hybrid responsive rendering and 16px font floor
- [x] A/B testing with holdback cohorts and per-variant open/click results
- [x] List & segment sends via SendGrid with CAN-SPAM mailing-address enforcement and webhook-driven opt-out stamping
- [x] HubSpot per-category subscription mapping and paste-safe HTML export

### Direct Social Publishing ✅
**Status**: Implemented (July-August 2026)
- [x] Global shared OAuth apps for X/Facebook/Instagram/LinkedIn — one-click tenant connections
- [x] Direct X publishing with images (v2 media pipeline, hardened token rotation)
- [x] Unified Social Post Editor across queue, calendar, pipeline, and campaign detail (with link preview editing)
- [x] Content-to-post multi-channel fan-out (native verbatim + AI-tailored variants)

### Website Content Import & Repurposing ✅
**Status**: Implemented (July 2026)
- [x] Import blog posts, events, and case studies from the live website (MCP) with image/category/summary enrichment
- [x] Multi-format repurposer: one asset → social posts, carousels with rendered graphics, and long-form content briefs

### CRM Integration - HubSpot (Q2) ✅
**Status**: Implemented (two-way)
- [x] OAuth connection and status
- [x] Competitor sync and suggested competitors from HubSpot
- [x] Prospect imports and per-prospect sync
- [x] Push Orbit insights, notes, tasks, briefings, battlecards, and summaries back to CRM
- [x] HubSpot actions surfaced in the relevant Orbit interfaces

### Advanced AI Features (Q2-Q3)
- [ ] Sentiment and tone analysis
- [ ] Multi-language support
- [ ] Custom AI tuning with user goals

### Collaboration Features (Q3)
- [ ] Shared annotations/comments
- [ ] Vega integration (recommendations → tasks)
- [ ] Team usage analytics

### Outcome Metrics & ROI Dashboard (Q4) ✅
**Status**: Implemented
- [x] Google Analytics integration
- [x] Orbit Score / Index
- [x] Industry benchmarks
- [x] ROI dashboard linking marketing activity to GA4 conversions

---

## Undated Backlog (not committed to a date)

Items in this section are logged for consideration but do not have a committed delivery timeframe.

### High Priority

#### Service Plan Feature Gating ✅
**Status**: Implemented
Tiered access control with upgrade prompts and enforcement:
- [x] Centralized plan policy service (`server/services/plan-policy.ts`) with feature matrix for Free/Trial/Pro/Enterprise
- [x] Backend enforcement: competitor count limits, monthly analysis quotas, feature gating on battlecards/reports/GTM/messaging/projects
- [x] Enhanced `/api/tenant/info` returns plan features, usage counts, and limits
- [x] Frontend gating: competitor limit badge, analysis limit badge, upgrade prompts on locked features
- [x] Sidebar lock indicators for features not available on current plan
- [x] Free tier: 1 competitor, 1 analysis/month, no battlecards/recommendations/PDF reports/GTM/messaging
- [x] Trial (60 days): 3 competitors, 5 analyses/month, battlecards/recommendations/PDF reports/GTM/messaging
- [x] Pro: 10 competitors, unlimited analyses, social monitoring, client projects, SSO
- [x] Enterprise: unlimited everything including marketing planner, product management, multi-market
- [ ] User role limits enforcement (adminUserLimit, readWriteUserLimit, readOnlyUserLimit) - future
**Effort**: High - COMPLETED

#### Manual Action Rate Limits by Plan
**Status**: Backlogged
Plan-based limits on manual (user-initiated) actions to control costs for paid APIs:
- [ ] LinkedIn API calls - paid API, needs strict limits per plan tier
- [ ] Manual website crawls - limit frequency per plan
- [ ] Regenerate All analysis - limit how often users can trigger full re-analysis
- [ ] Product URL crawling - limit for lower tiers
- [ ] Track usage counts per tenant/user with monthly reset
- [ ] Show remaining quota in UI with upgrade prompts when limits reached
**Note**: Currently, service plan monitoring controls only affect automated scheduled jobs. Manual actions are unrestricted.
**Effort**: Medium

#### Input Safety Validation ✅
**Status**: Implemented
Pre-validate all user-entered URLs and uploaded data before crawling or processing:
- [x] Check for malicious URLs (protocol validation, domain validation)
- [x] SSRF attempt prevention (DNS resolution check for private IPs)
- [x] Block private IP ranges (RFC 1918, loopback, link-local)
- [x] Block internal network domains (.local, .internal, .lan)
- [x] Unsafe file content detection (magic bytes validation, dangerous pattern scanning)
- [x] File type and size validation for uploads
**Effort**: Medium - COMPLETED

### Standard Priority

#### Marketing Planner
**Status**: Phase 1 Complete (Enterprise-only)
Break down AI-generated GTM plan into actionable tasks that can be accepted/removed:
- [x] Marketing plan CRUD with multi-select quarter/period selection (Steady State, Q1-Q4, Future)
- [x] Task management with 19 activity categories (Events, Digital Marketing, Outbound, etc.)
- [x] Enterprise plan gating with upgrade prompt for non-Enterprise users
- [x] Navigation integration with Diamond (Gem) icon
- [x] Defense-in-depth security with market context filtering on all operations
- [x] AI-generated task suggestions informed by GTM Plan, Recommendations, and Competitor Insights
- [x] Matrix view showing categories as rows and time periods as columns (matches Synozur marketing plan format)
- [x] **Microsoft Planner integration via Graph API** - phase 1 (one-way push Orbit → Planner). Per-plan mapping of Microsoft 365 group → Planner plan → bucket; users can pick an existing bucket or create a dedicated "Orbit" bucket. Delegated OAuth with `Tasks.ReadWrite Group.Read.All offline_access`, refresh tokens stored on user. Push creates Planner tasks and stores `plannerTaskId` + `etag`; subsequent syncs PATCH with `If-Match`. Status banner shows last sync time and errors. See `server/services/planner-graph-client.ts`, `planner-service.ts`, `server/routes/planner.ts`, `client/src/components/PlannerSyncDialog.tsx`.
- [ ] Microsoft Planner integration phase 2: bidirectional sync (pull Planner edits/completions back into Orbit), webhook subscriptions, multiple buckets per category
- [ ] Vega Launchpad export - generate document optimized for Vega to create Big Rocks (Projects) and OKRs
- [x] Uses comprehensive marketing activities document as grounding (19 categories stored)
**Reference**: Constellation project (https://github.com/chris-mcnulty/synozur-scdp) for Planner sync patterns
**Effort**: High (Phase 1 + Planner phase 1 complete, Vega export and Planner phase 2 pending)

#### Product Competitive Position Summaries ✅
**Status**: Implemented
- [x] Add `competitivePositionSummary` field to products schema
- [x] Generate summary during full regeneration (rebuild all) process (step 8)
- [x] Display product summaries on Overview page (not just product names)
- [x] Include summaries in Capstone PDF reports
- [x] Allow manual editing of summaries if needed
- [x] AI generates summary based on product features, competitor analysis, and market positioning
**Effort**: Medium - COMPLETED

#### PDF Report Quality Fixes ✅
**Status**: Implemented
- [x] Filter "Based on profile" placeholder text from theme cards
- [x] Better competitor name fallback in messaging comparison (avoid generic "Competitor")
- [x] Include GTM Plan & Messaging Framework as toggleable option in standard reports
- [x] Fix numbered list formatting in markdownToHtml (wrap in `<ol>` tags)
- [x] Add h4 heading support in markdown-to-HTML conversion
- [x] Fix LSP type errors in PDF generator (faviconUrl, talkingPoints, companyProfile)
**Effort**: Low - COMPLETED

#### Editable GTM Plan ✅
**Status**: Implemented
- [x] View GTM plan in editable markdown editor (inline edit mode toggle)
- [x] Edit content directly with save/cancel controls
- [x] Track version history of GTM plan changes (up to 10 versions retained)
- [x] Manual save with version history auto-creation on edit
- [x] Same editing capability for Messaging Framework
- [x] Restore previous versions from version history dialog
- [ ] Re-generate specific sections while preserving user edits (future enhancement)
**Effort**: Medium - COMPLETED

#### Microsoft Planner Integration ✅ (Phase 1)
**Status**: Phase 1 implemented (May 2026) — one-way push from Orbit to Planner with bucket selection.
- [x] Per-marketing-plan mapping to a Microsoft 365 group, Planner plan, and **bucket** (existing or newly created from the dialog) — controls exactly where Orbit tasks land
- [x] Delegated OAuth with incremental consent (`Tasks.ReadWrite Group.Read.All offline_access`); refresh tokens stored per user
- [x] Push creates Planner tasks (with title, priority mapping High/Medium/Low → 3/5/9, due date, % complete from status) and tracks `plannerTaskId` + `@odata.etag`
- [x] Subsequent syncs PATCH using `If-Match`; deleted Planner tasks are recreated automatically
- [x] Status banner on plan detail surfaces last sync time, target group/plan/bucket, and per-sync error summary
- [x] Disconnect endpoint clears mapping; reconsent flow handles expired refresh tokens
- [ ] **Phase 2**: bidirectional sync (Planner → Orbit), Graph change-notification webhooks, multiple buckets per activity category, deep links from each Orbit task to its Planner card
**Files**: `server/services/planner-graph-client.ts`, `server/services/planner-service.ts`, `server/routes/planner.ts`, `client/src/components/PlannerSyncDialog.tsx`, `migrations/0006_support_attachments_and_planner.sql`
**Reference**: Constellation (`server/services/planner-service.ts`, `planner-graph-client.ts`)
**Effort**: High - Phase 1 COMPLETED

#### AI Recommendation Approval History
**Status**: Proposed
Make AI-generated action items auditable before and after they reach execution systems:
- [ ] Show the source report or recommendation that produced each task
- [ ] Record and display who approved, dismissed, or re-suggested it and when
- [ ] Show the current approval and Planner sync state, including blocked/unapproved status
- [ ] Preserve dismissal reasons and approval history for support and compliance investigations
**Effort**: Medium

#### Mandatory LinkedIn Page Selection
**Status**: Proposed
Prevent new social connections from silently selecting the wrong company page:
- [ ] Automatically select a page only when exactly one is authorized
- [ ] Require an explicit user choice when multiple pages are available
- [ ] Preserve the existing page selection during a verified reconnect
**Effort**: Low-Medium

#### Billing Integration
**Status**: Proposed
- [ ] Stripe integration for payment processing
- [ ] Plan upgrade/downgrade flows
- [ ] Usage-based billing
**Effort**: High

#### HubSpot Lead Generation Insights
**Status**: Proposed
- [ ] Add lead-generation insights from HubSpot deal and pipeline signals
**Effort**: Medium

#### Competitor Document Uploads
**Status**: Not implemented
Allow users to upload documents about competitors (whitepapers, case studies, sales collateral, product sheets) to enrich competitive intelligence:
- [ ] Document upload UI similar to company grounding documents
- [ ] Text extraction and indexing
- [ ] Include in AI analysis context
**Effort**: Medium

#### Vega Launchpad Export from Marketing Planner
**Status**: Not implemented
Export an Orbit marketing plan as a structured document optimised for Vega to ingest as Big Rocks (Projects) and OKRs. Pairs with the Microsoft Planner integration as the second "execution handoff" path — for customers who do not run Planner.
- [ ] Define Vega-friendly schema (project name, OKR statements, key results, owner, timeframe)
- [ ] Map Orbit `marketing_tasks` (with activity category and timeframe) into Vega projects
- [ ] Generate downloadable JSON or markdown bundle from the plan detail page
- [ ] Link to the Vega import flow once the API is published
**Files**: `client/src/pages/app/marketing-plan-detail.tsx`, new `server/services/vega-export.ts`
**Effort**: Medium

#### Support Knowledge Base / FAQ Deflection
**Status**: Not implemented
Reduce ticket volume by surfacing relevant help-content suggestions before a ticket is submitted.
- [ ] Inline content suggestions in the New Ticket form keyed off the subject/description (search the user guide and changelog)
- [ ] "Browse common questions" section on `/app/support` rendered from a curated FAQ collection (markdown source under `public/`)
- [ ] Track which suggestions were viewed before ticket submission to measure deflection
- [ ] Optional: AI-summarised user-guide answers for the top categories
**Effort**: Medium

#### Consolidated Action Items ✅
**Status**: Implemented (Phase 2 Complete)
Dashboard view showing all action items across baseline and projects for a tenant:
- [x] Aggregate view of all recommendations, feature recommendations, and gap analysis items
- [x] Filter by source (Competitive Intel, Product Roadmap, Gap Analysis), impact, and status
- [x] Search across all action items
- [x] Accept/dismiss actions with status mutation
- [x] Priority starring for recommendations
- [x] Expandable detail cards with opportunity info
- [x] Export to CSV
- [x] Summary stats (total, high impact, priorities, by source)
- [x] Dismiss with reason dialog
- [x] Bulk accept and bulk dismiss via multi-select toolbar
- [x] Gap analysis deduplication for dismissed items
- [ ] Ability to assign to users (future phase)
- [ ] Comments on action items (future phase)
**Effort**: High - Phase 2 COMPLETED

#### Wire AI Usage Logging ✅
**Status**: Implemented
`logAiUsage()` (in `server/routes/helpers.ts`) is invoked at all major AI entry points:
- [x] Battlecard generation (`server/routes/battlecards.ts`)
- [x] Gap analysis, messaging framework, GTM plan, executive summaries (`server/routes/intelligence.ts`)
- [x] Marketing task generation (`server/routes/analytics-data.ts`)
- [x] Product battlecards / one-sheets (`server/routes/products.ts`, `server/routes/intelligence.ts`)
- [x] Baseline messaging framework regeneration (`server/routes/executive-regen.ts`)
- [x] Briefings, podcast generation, persona extraction (`server/routes/platform.ts`, `marketing-saturn.ts`)
**Effort**: Low - COMPLETED

#### reCAPTCHA for Signups
**Status**: Not implemented
- [ ] Add Google reCAPTCHA to new account signup form to prevent bot registrations
**Effort**: Low

#### Google SSO
**Status**: Not implemented
- [ ] Add Google OAuth as alternative to Microsoft Entra ID
**Effort**: Medium

#### Per-Tenant Branding ✅
**Status**: Implemented
- [x] Custom logos per tenant (`tenants.logoUrl` with upload UI in Settings and Admin pages)
- [x] Custom primary color per tenant (`tenants.primaryColor`, used in PDF exports and battlecard branding)
**Effort**: Medium - COMPLETED

#### Active Social/Blog Monitoring ✅
**Status**: Implemented
Scheduled monitoring of competitor social media accounts and blog posts:
- [x] Manual blog URL input for competitors and baseline company
- [x] Blog/RSS feed parsing (RSS, Atom, HTML scraping)
- [x] New post detection with activity log entries
- [x] Web crawler auto-discovery of blog/insights/news pages
- [x] SSRF protection on all URL inputs
- [x] Change detection for website content
- [x] AI-summarized diffs highlighting what changed
- [x] Configurable check intervals (per-row `socialCheckFrequency` on competitors and company profile: hourly / daily / weekly; honored by `server/services/scheduled-jobs.ts`)
**Effort**: Medium - COMPLETED

#### Domain Blocklist ✅
**Status**: Implemented
- [x] `domain_blocklist` table with admin CRUD (`/api/admin/domain-blocklist` endpoints in `server/routes/consultant-plans.ts`)
- [x] Admin UI for managing blocked domains (`client/src/pages/app/admin.tsx`)
- [x] Enforced during Entra ID self-service signup (`server/auth/entra-routes.ts` calls `storage.isdomainBlocked` before provisioning)
**Effort**: Low - COMPLETED

### Deferred (Pending User Demand)

#### LinkedIn Content Integration
**Status**: Deferred
Deep LinkedIn post content tracking (beyond basic profile metrics):
- Requires LinkedIn Marketing API access ($69-159/mo third-party services or official API partnership)
- Current implementation captures profile URLs and engagement numbers only
**Effort**: High (cost + API complexity)

---

## Known Issues / Bug Fixes

### PDF Full Analysis Report Improvements
**Status**: Partially Fixed (March 2026)
**Priority**: Medium
Several issues identified in the Full Analysis Report PDF generation:
- [x] **Key Themes Section**: Fixed - no longer displays "Based on profile" placeholder
- [x] **Messaging Comparison**: Fixed - shows "Market Positioning" header instead of generic "Competitor" text
- [ ] **Active Products Section**: Needs more high-level findings content about product analysis results rather than minimal summary
- [ ] **Messaging Framework Formatting**: Should use proper markdown/HTML formatting instead of raw verbatim quotes - improve visual presentation
- [ ] **GTM Plan Missing**: The generated GTM Plan is not included in the full report - should be added as a section when available
- [ ] **Report Version Comparison**: Compare the current report with a previous generation and highlight changes in competitors, recommendations, messaging, and market signals
**Files**: `server/routes.ts` (PDF generation endpoint), `server/services/report-generator.ts` (if exists)
**Effort**: Medium

---

## Long-Range / Future (May Become Separate App)

### Product Management Module
**Status**: MVP Implemented (January 2026)
Comprehensive product planning and roadmap intelligence. Core MVP features are now available within Orbit.

Features:
- [x] **Feature Catalog**: Product feature management with manual entry, status tracking, categorization, and target quarters
- [x] **Quarterly Roadmap View**: Visual roadmap organized by quarter with effort estimation (XS/S/M/L/XL)
- [x] **AI Roadmap Recommendations**: AI-powered recommendations based on competitive intelligence (gap analysis, opportunities, priorities, risks)
- [x] **Recommendation Actions**: Accept/dismiss workflow for AI-generated recommendations
- [ ] **Feature Ingestion - CSV Upload**: Bulk import features from CSV files
- [x] **Feature Ingestion - Paste Text Parsing**: AI extraction of features from pasted text (`POST /api/products/:productId/features/import-text` via `extractFeaturesFromContent`)
- [x] **Feature Ingestion - Web Scraping**: Extract features from product pages (`POST /api/products/:productId/features/import-url` fetches and AI-extracts)
- [ ] **Draft Product One-Sheets**: AI-generated product marketing one-pagers summarizing key features, benefits, and differentiators
- [ ] **Draft PowerPoint Slides**: Auto-generate product overview presentation slides
- [ ] **Draft Product Roadmap**: Visual roadmap generation with timeline, milestones, and feature releases
- [ ] **Vega Launchpad Export**: Generate document optimized for Vega to create Big Rocks (Projects) and OKRs based on product roadmap
**Effort**: MVP Complete, additional features ongoing

---

## Undated Backlog Additions

These candidates are logged for consideration and are not committed to a quarter or delivery date.

### Chat & Collaboration Surfaces

#### Slack & Microsoft Teams Integration
**Status**: Proposed
**Why**: Customers live in chat. Pushing competitor alerts, briefing summaries, and action-item notifications into Slack/Teams channels turns Orbit from a destination into an always-on signal.
- [ ] OAuth app for Slack (bot token) and Teams (Graph + bot framework)
- [ ] Channel routing per tenant: competitor alerts, briefing digests, support replies, plan-limit warnings
- [ ] Slash commands: `/orbit competitor <name>`, `/orbit briefing latest`, `/orbit action items`
- [ ] Per-user mute / per-channel digest cadence settings
- [ ] Reuse `alert-dispatch` service as the delivery fan-out
**Effort**: High

#### AI Conversational Intelligence Assistant ("Ask Orbit")
**Status**: Proposed
**Why**: Natural-language Q&A over the tenant's competitive corpus is faster than navigating pages. Pairs well with the existing AI-usage logging and plan gating.
- [ ] Retrieval-augmented chat grounded in competitor profiles, activity log, briefings, marketing plan, and product roadmap
- [ ] Inline citations linking back to the underlying source (competitor card, change diff, briefing section)
- [ ] Saved conversations, sharable answer cards, "Pin to dashboard" widget
- [ ] Streaming responses with cost & token reporting via existing `logAiUsage`
- [ ] Enterprise-only gating with per-tenant monthly quota
**Effort**: High

### Reach & Mobility

#### Mobile-First Progressive Web App (PWA)
**Status**: Proposed
**Why**: Field-facing roles (sales, exec) consume briefings on phones. A PWA shell gives installable, offline-capable access without app-store overhead.
- [ ] Installable manifest + service worker with cached briefings and competitor cards
- [ ] Responsive redesign for the Briefings, Action Items, and Competitor Detail pages
- [ ] Push notification channel reusing the alert-dispatch threshold settings
- [ ] Touch-optimized command palette and refresh center
**Effort**: Medium-High

#### Calendar Sync for Marketing Plan & Briefings
**Status**: Proposed
**Why**: Marketing tasks and weekly briefings should live next to the user's other commitments. Mirrors the Planner integration pattern.
- [ ] One-way push of marketing tasks (with due dates) to Outlook / Google Calendar
- [ ] Briefing publish events appear as calendar entries with deep link
- [ ] Per-user toggle and reconnect flow; reuse Entra refresh-token pattern
- [ ] ICS feed fallback for tenants without delegated OAuth
**Effort**: Medium

### Analyst Workflows

#### Custom Dashboard Builder
**Status**: Proposed
**Why**: Different personas need different glances. A widget-based home page reduces dependency on hard-coded layouts and is a natural pair with interactive visualisations.
- [ ] Widget library: competitor activity feed, action-item queue, freshness gauges, SEO movers, plan-limit usage
- [ ] Drag-and-drop layout with persisted per-user configuration
- [ ] Shareable dashboard templates (tenant-level, with "Apply to my view" copy)
- [ ] Foundation for embedding interactive charts
**Effort**: High

#### Persona-Driven Workspace Modes
**Status**: Proposed
**Why**: Sales, Marketing, PM, and Exec each have a narrow happy-path through Orbit. Surfacing a "mode" selector tailors navigation, default filters, and home-page widgets.
- [ ] Mode selector on first login and in user menu (Sales / Marketing / Product / Executive)
- [ ] Per-mode default landing page, sidebar emphasis, and command-palette suggestions
- [ ] Per-mode briefing template (sales talk tracks vs. marketing themes vs. product gaps)
- [ ] Telemetry on mode usage to inform future packaging
**Effort**: Medium

### New Intelligence Domains

#### Competitor Pricing Intelligence Tracker
**Status**: Proposed
**Why**: Pricing changes are among the most actionable competitive signals but get lost in generic page diffs. A specialised extractor and change feed is high-leverage.
- [ ] Dedicated pricing-page URL on each competitor with structured-data extraction (plans, tiers, monthly/annual, features)
- [ ] Change history with side-by-side diff and AI-summarised "what changed and why it matters"
- [ ] Pricing-event alerts routed through existing alert thresholds
- [ ] Pricing snapshot section in battlecards and PDF reports
**Effort**: Medium-High

#### Win/Loss Analysis Module
**Status**: Proposed
**Why**: Closes the loop from competitive intel to revenue outcomes. Pairs with the planned HubSpot CRM integration.
- [ ] Deal-outcome log with competitor tagging, deal size, segment, and reason codes
- [ ] CRM sync (HubSpot first) to auto-import closed deals and competitor stamps
- [ ] AI-generated win/loss themes and trend reports per competitor
- [ ] Surface themes into the battlecard "Sales challenges" section
**Effort**: High

#### Industry Benchmarking (Anonymous Aggregates)
**Status**: Proposed
**Why**: Multi-tenant data is a moat. Opt-in, anonymised aggregates ("how often peers refresh", "share of competitors in your industry tracking pricing", "median action-item velocity") drive stickiness and inform plan upgrades.
- [ ] Tenant opt-in with clear data-use disclosure and per-metric toggles
- [ ] Aggregation job producing industry/segment baselines (k-anonymity threshold)
- [ ] Benchmark widgets on Intelligence Health and Insights pages
- [ ] Quarterly anonymised "State of Competitive Intelligence" report
**Effort**: High (privacy review required)

### Platform Extensibility & Trust

#### Public REST API + Webhooks
**Status**: Proposed
**Why**: Enterprise buyers ask for programmatic access. A versioned read API plus outbound webhooks unlocks Zapier/Make/Power Automate and customer-built workflows.
- [ ] OAuth-scoped API keys with per-tenant and per-user scopes
- [ ] Read endpoints for competitors, activity log, recommendations, action items, briefings
- [ ] Write endpoints for action-item status, support tickets, marketing tasks
- [ ] Outbound webhook subscriptions per event type (competitor change, briefing published, ticket reply)
- [ ] Rate-limit middleware and usage dashboard
- [ ] Public docs site (OpenAPI spec + examples)
**Effort**: High

#### Audit Log & Data Export Center
**Status**: Proposed
**Why**: Enterprise security reviews and GDPR/CCPA postures expect tenant-scoped audit trails and self-serve data export. Centralising these also helps Support resolve "who changed what" tickets.
- [ ] Append-only `audit_log` capturing principal, action, resource, before/after diff
- [ ] Filterable admin view (user, date range, resource, action type) with CSV export
- [ ] Full-tenant export bundle (JSON + assets) triggered from Settings, delivered via signed URL
- [ ] Right-to-erasure workflow for individual users with admin confirmation
**Effort**: Medium-High

### User Journey Enhancements

#### Guided First-Value Onboarding
**Status**: Proposed
**Why**: The onboarding checklist is passive. Activating the path shortens time-to-first-value, the main activation/retention lever.
- [ ] Detect step completion live and celebrate it
- [ ] Present the next step's CTA with context
- [ ] After the first analysis completes, surface the first concrete insight prominently
- [ ] Optional: collapse completed steps so the path always foregrounds "what's next"
**Effort**: Medium

#### Persistent & Saved Views
**Status**: Proposed
**Why**: Returning to a working filter and sort context is repeated friction.
- [ ] Persist last-used filters/sort per surface
- [ ] Let users name and save a segment
- [ ] Optional: pin saved views to the sidebar; shareable view links
**Effort**: Low to Medium

### Website Integration

#### Published-Content Round-Trip from Website MCP
**Status**: Proposed
**Why**: Published Orbit content should flow back into Orbit with its live URL and performance data, eliminating manual reconciliation.
- [ ] Write the canonical published URL back to the originating content asset
- [ ] Reconcile published status and publish date, including externally published edits
- [ ] Pull performance data as a time series
- [ ] Surface published URL and performance trend on assets and campaign rollups
- [ ] Link externally authored website posts by URL
- [ ] Backfill existing published posts into the content library
**Effort**: Medium-High

### Technical Debt

#### Unify the Three Post-Creation Backends
**Status**: Proposed
Unify manual composition, campaign generation, and brief repurposing behind one output contract while preserving asynchronous AI job behavior.
- [ ] Define one `createOutput` contract
- [ ] Fold the manual, repurpose, and campaign engines behind it
- [ ] Normalize the response shape
- [ ] Keep existing UI entry points as thin shortcuts
- [ ] Add regression coverage for each engine
**Effort**: High

#### Split the Overloaded Content Brief Status Model
**Status**: Proposed
Move authoritative output state to content assets and separate idea, production, scheduling, and archival lifecycle states.
- [ ] Migrate readers and gates off the legacy brief-side asset link
- [ ] Stop writing and then drop the legacy column in a migration
- [ ] Split idea status from draft/production state
- [ ] Update planning, export, conversion, calendar, and client status behavior
- [ ] Backfill existing rows and add regression coverage
**Effort**: High

---

## Completed History

Completed items dated before June 30, 2026 are kept here for reference rather than being presented as current roadmap commitments.

### January 2026

#### Headless Browser Crawling
- [x] JavaScript-rendered crawling, stealth protections, HTTP fallback, and browser pooling

### March 2026

#### Marketing Content Library
- [x] Content asset management, URL extraction, AI summaries, lead images, tagging, bulk summarization, CSV transfer, and archiving

#### Marketing Brand Library
- [x] Brand asset uploads, product/category links, and saving Content Library images

#### Social Campaigns
- [x] Campaign wizard, multi-platform generation, scheduling, review, SocialPilot export, and hashtag handling

#### Email Newsletters
- [x] Platform-specific generation, tone and CTA controls, subject coaching, saved drafts, and strategic grounding

#### Intelligence Briefing Podcasts
- [x] Two-host audio generation, playback, download, and object storage

#### Intelligence Briefing Subscriptions
- [x] User subscriptions, scheduled generation, and automated weekly delivery

#### Intelligence Freshness UX
- [x] Intelligence Health scoring, stale-source attention cards, freshness banners, currency badges, and navigation

#### Action Item Lifecycle Management
- [x] Dismissal reasons, bulk review, status views, and dismissed-item deduplication

#### Support Ticket System
- [x] Ticket submission, threaded support, assignment, email/in-app notifications, attachments, and admin triage

#### SEO Optimization
- [x] Semantic markup, social metadata, and structured titles and descriptions

### April 2026

#### Trial & Feature Gating System
- [x] Trial lifecycle, reminders, automatic plan reversion, server-side feature gates, quotas, and upgrade prompts

#### Global Company Directory
- [x] Shared company records, metadata extraction, competitor suggestions, typeahead, and domain deduplication

### May 2026

#### Area-Based Navigation & Home Page
- [x] Value-chain header: Research / Product / Marketing / Sales tabs
- [x] Area-specific sidebar, global home, Sales Hub, Admin & Settings, and mobile navigation

#### Content Pipeline Board
- [x] Unified kanban board across social posts, saved emails, and content briefs
- [x] Canonical lifecycle stages, drag-and-drop transitions, filters, search, scheduling, retry, and archive behavior

#### Editorial Calendar — Full Content Execution Stack
- [x] AI briefs, multi-format copywriter, content repurposing, SEO/AEO optimization, rewrite tools, distribution planning, and timezone-aware scheduling

#### Conference Social Promotion
- [x] Conference/session management, AI post generation, branded hero graphics, promotion controls, shared publishing pipeline, archiving, and restore

#### Marketing Performance Report
- [x] Closed-loop content reporting, benchmark comparisons, campaign/content breakdowns, AI recommendations, and Marketing → Performance page

#### Marketing Context Readiness
- [x] Readiness scoring across company profile, ICP, messaging, GTM plan, products, competitors, and brand kit
- [x] Per-field fix hints and readiness surfaces in the Marketing hub
