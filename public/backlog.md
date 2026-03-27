# Orbit MVP Feature Backlog

---

## 🔍 Proposed Improvements — Pending Approval

> The following items are **proposals only** — none have been built. They cover three areas: performance & stability, user experience, and brand-new features. All are subject to product review and prioritisation before any work begins.

---

### ⚡ Performance & Stability

#### P1 — AI Response Caching Layer
**Problem**: Every analysis, battlecard, recommendation, and intelligence briefing triggers a live call to the AI provider (Anthropic / Azure AI Foundry). For tenants with many competitors this produces slow page loads, high API costs, and risk of provider rate-limiting.
**Proposed Solution**: Introduce a server-side cache (keyed by tenant + entity + content hash) that stores AI-generated artefacts with a configurable TTL (e.g. 24 hours for analysis, 1 hour for briefings). Cache invalidation is triggered on demand (manual rebuild) or when the underlying source data changes (new crawl result, document upload). This reduces redundant AI calls, cuts costs, and makes the UI feel significantly faster.
**Scope**: `server/ai-service.ts`, `server/routes/reports-analysis.ts`, `server/routes/intelligence.ts`, Redis or in-DB cache table.
**Effort**: Medium

#### P2 — Database Query Batching & N+1 Elimination
**Problem**: Several pages (Dashboard, Competitors list, Activity log) independently fetch related data in serial loops — e.g. loading every competitor then querying their latest crawl result one by one. Under moderate load this produces dozens of small round-trips per page render.
**Proposed Solution**: Audit `server/storage.ts` for N+1 patterns and replace serial `.map(async)` loops with batched `WHERE id IN (...)` queries or Drizzle ORM `leftJoin`s. Add a simple query timer middleware that logs any DB call exceeding 200 ms, to surface future regressions early.
**Scope**: `server/storage.ts`, `server/routes/*.ts`.
**Effort**: Medium

#### P3 — Background Job Dead-Letter Queue & Retry Logic
**Problem**: The centralised job queue (web crawls, PDF generation, monitoring jobs) has no structured retry or dead-letter mechanism. A transient network failure or third-party timeout silently fails and the tenant never knows their data is stale.
**Proposed Solution**: Add a `job_failures` table (or a dedicated `status` column on the existing jobs table) that captures failed attempts with error messages and retry counts. Jobs retry up to 3 times with exponential back-off. After all retries are exhausted the job lands in a dead-letter state, surfaced as an alert in the Intelligence Health dashboard card and Admin panel. Adds a manual "Retry" button on failed jobs in the Refresh Center / Intelligence Health view.
**Scope**: `server/services/` (job queue module), `shared/schema.ts`, Admin UI.
**Effort**: Medium–High

---

### 🎨 User Experience Enhancements

#### UX1 — Persistent Sidebar Navigation State
**Problem**: Collapsible sidebar groups (Insights, Marketing, Product, System, etc.) reset to their default expanded/collapsed state on every page navigation or refresh, forcing users to re-open the sections they care about each session.
**Proposed Solution**: Persist the open/closed state of each sidebar group in `localStorage` under a user-specific key. Restore it on mount. Also persist the user's last-visited page so returning users land where they left off rather than always hitting the Dashboard.
**Scope**: `client/src/` sidebar/navigation component(s), `localStorage` utility.
**Effort**: Low

#### UX2 — Keyboard-First Command Palette (Cmd/Ctrl + K)
**Problem**: With 45+ app pages and dozens of actions, power users must navigate through the sidebar or breadcrumbs to reach less-frequently visited pages (e.g. Personas, Assessments, Client Projects). There is no fast-access shortcut.
**Proposed Solution**: Implement a Cmdk-powered command palette (the `cmdk` package is already installed) that opens on `Cmd+K` / `Ctrl+K`. It should support fuzzy search across: page navigation, competitor names, recent activity items, and quick actions (New Competitor, Generate Briefing, Download Report). Results are grouped by category with icons.
**Scope**: `client/src/` — new `CommandPalette` component wired into the root layout; data sourced from React Query caches already in memory.
**Effort**: Low–Medium

#### UX3 — Inline Diff View When Regenerating AI Artefacts
**Problem**: When a user triggers a rebuild of a competitor analysis, battlecard, or intelligence briefing, the entire page simply re-renders with new content. There is no way to see what actually changed, making it hard to evaluate whether the rebuild added value.
**Proposed Solution**: After a regeneration completes, show a toggleable "What changed?" diff panel that highlights additions (green) and removals (red) between the previous and new version. Store the previous version snapshot server-side (or in the existing `activity` table) before overwriting. Include a "Keep previous" rollback button.
**Scope**: `server/routes/reports-analysis.ts`, `server/routes/intelligence.ts`, `client/src/pages/app/analysis.tsx`, battlecards, briefing pages. Diff rendering via a lightweight diff library (e.g. `diff`).
**Effort**: Medium

---

### 🚀 Brand-New Features

#### F1 — "Ask Orbit" Conversational AI Assistant
**Description**: A persistent chat interface (slide-out drawer or dedicated page) where users can ask natural-language questions about their competitive landscape. Example queries: *"Which competitors have changed their pricing recently?"*, *"What messaging gaps do we have vs Competitor X?"*, *"Summarise all activity from last week."* The assistant has full RAG access to the tenant's competitors, analysis artefacts, grounding documents, activity log, and briefings. Supports follow-up questions and cites its sources.
**Why Now**: All the underlying data and AI infrastructure already exists. The missing piece is a conversational front-end and a retrieval-augmented prompt chain.
**Scope**: New route `GET/POST /api/chat`, new `ChatDrawer` component, vector-similarity or keyword retrieval over existing data.
**Effort**: High

#### F2 — Competitive Positioning Map (2×2 / Bubble Chart)
**Description**: An interactive visual that places the baseline company and all tracked competitors on a configurable 2-axis chart (e.g. Price vs Feature Breadth, Market Presence vs Innovation, etc.). Users can drag competitors to reposition them manually or let AI suggest positions based on analysis data. Exportable as PNG/SVG for use in presentations.
**Why Now**: Orbit already synthesises positioning data from analysis; a visual layer dramatically increases strategic communication value, especially for consultants sharing outputs with clients.
**Scope**: New page `client/src/pages/app/positioning-map.tsx`, D3.js or Recharts-based chart, positions stored per-tenant in DB.
**Effort**: Medium

#### F3 — Win/Loss Analysis Module
**Description**: A structured module for capturing win/loss data from sales deals — competitor involved, deal size, outcome, key reason, sales rep notes. AI correlates win/loss patterns with competitive intel to surface insights like *"We lose 70% of deals where Competitor Y is involved when they lead on price"*. Integrates with the existing HubSpot connector to pull deal data automatically.
**Why Now**: The platform already has strong competitive intelligence; closing the loop with sales outcomes turns insight into measurable business impact and is a frequent enterprise request.
**Scope**: New `winLoss` DB table, `server/routes/win-loss.ts`, `client/src/pages/app/win-loss.tsx`, HubSpot deal sync.
**Effort**: High

#### F4 — Shareable Intelligence Portals (External Read-Only Links)
**Description**: Allow users to generate a time-limited, token-authenticated shareable link for a specific Intelligence Briefing, Competitor Profile, or Battlecard. The recipient (e.g. a board member or client) can view the content in a clean, branded, read-only portal without needing an Orbit account. The portal respects the tenant's branding colours and logo. Links expire after a configurable period (7 / 30 / 90 days) and can be revoked at any time.
**Why Now**: Teams frequently export PDFs and email them. A live portal link is more useful — recipients always see the latest version — and is a clear upgrade/retention driver for Enterprise tiers.
**Scope**: New `sharedLinks` DB table, `GET /api/share/:token` public route, new `SharedPortal` React page outside the authenticated layout.
**Effort**: Medium

#### F5 — Slack & Microsoft Teams Notification Integration
**Description**: Allow tenants to connect an incoming webhook for Slack and/or Microsoft Teams channels. Orbit posts real-time notifications when: a competitor changes their website significantly, a new intelligence briefing is generated, an action item is assigned, or a monitoring job detects a social media update. Users configure which event types to send to which channel from the Settings page.
**Why Now**: The email notification system is already mature. A chat-channel integration dramatically increases the surface area of Orbit's value in day-to-day workflows, reduces the need to log in to check for updates, and is a top-requested enterprise integration.
**Scope**: New `webhookIntegrations` DB table, `server/services/webhook-notifier.ts`, Settings UI panel.
**Effort**: Medium

#### F6 — Google SSO & Broader IdP Support
**Description**: Add Google OAuth 2.0 as a second SSO provider alongside the existing Microsoft Entra ID integration. Include a tenant-level IdP configuration page where Domain Admins can enforce SSO-only login (disabling email/password), set the allowed email domain for auto-provisioning, and view a log of SSO login events. Lay the groundwork for SAML 2.0 / generic OIDC in a future phase.
**Why Now**: Google SSO is already listed as pending in the backlog and is a frequent ask from SMB and startup customers who do not use Microsoft 365. Completing it removes a signup friction point and broadens the addressable market.
**Scope**: `server/auth/google-routes.ts`, `google-auth-library` (already installed), Settings → Security page, `users` table (`googleId` field).
**Effort**: Low–Medium

---

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
- [ ] Alert emails for significant changes (backlogged for future)
**Effort**: Medium - CORE FUNCTIONALITY COMPLETED

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

### 3.4 Trial & Feature Gating System ✅
**Status**: Trial system implemented (60-day trial with email reminders)
**Spec Requirement**: "60-day trial, then Free tier with limited functionality"
- [x] Add `trialStartDate` and `trialEndsAt` to tenants (60-day trial period)
- [x] Implement trial countdown and expiration logic
- [x] Automatic plan reversion to Free tier when trial expires
- [x] Trial reminder emails (day 7, 30, 46, 53, 57, 59, 60) with contact CTA in final 14 days
- [x] Scheduled job to check trial status and send reminders every 6 hours
- [ ] Feature gating middleware on API routes (backlogged)
- [ ] UI upgrade prompts when hitting limits (backlogged)
**Effort**: Medium - CORE FUNCTIONALITY COMPLETED

### 3.5 Global Company Directory
**Status**: Not implemented
**Spec Requirement**: Build a shared company database for competitor suggestions
- [ ] Create global `companyDirectory` table (not tenant-scoped)
- [ ] Capture: name, company, category, SIC code (if available), brief description
- [ ] Auto-populate when users add competitors (extract via AI during profiling)
- [ ] Use directory for typeahead suggestions when adding new competitors
- [ ] Deduplicate entries by domain/company name
**Effort**: Medium

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

### 3.9 Marketing Content Library ✅
**Status**: Implemented (March 2026)
**Spec Requirement**: Enterprise-gated content asset management
- [x] Content asset CRUD with title, URL, description, and metadata
- [x] URL auto-extraction with AI-generated summaries
- [x] Lead image capture from source URLs
- [x] Customizable categories, product tagging, season tagging, topic tagging
- [x] Bulk AI summarization
- [x] CSV import/export
- [x] Archive workflow
**Effort**: High - COMPLETED

### 3.10 Marketing Brand Library ✅
**Status**: Implemented (March 2026)
**Spec Requirement**: Enterprise-gated brand asset management
- [x] Brand asset CRUD with file upload to object storage
- [x] Product cross-linking and customizable categories
- [x] Save lead images from Content Library to Brand Library
**Effort**: Medium - COMPLETED

### 3.11 Social Campaigns ✅
**Status**: Implemented (March 2026)
**Spec Requirement**: Social-only campaigns for content distribution
- [x] Campaign wizard (Details → Assets → Accounts → Schedule)
- [x] AI-powered post generation across multiple platforms
- [x] Per-asset post generation with correct image resolution
- [x] Intelligent scheduling with weekend preferences
- [x] Post review, approve/reject workflow
- [x] CSV export with SocialPilot format and schedule guard
- [x] Automatic hashtag merging
**Effort**: High - COMPLETED

### 3.12 Email Newsletters ✅
**Status**: Implemented (March 2026)
**Spec Requirement**: AI-powered email generation from content assets
- [x] Platform-specific formatting (Outlook, HubSpot, Dynamics 365)
- [x] Tone and CTA customization
- [x] Subject line coaching and AI suggestions
- [x] Save/label generated email drafts
- [x] Strategic context grounding
**Effort**: Medium - COMPLETED

### 3.13 Intelligence Briefing Podcasts ✅
**Status**: Implemented (March 2026)
- [x] Two-host conversational audio summaries using OpenAI TTS
- [x] In-browser playback and MP3 download
- [x] Audio stored in object storage
**Effort**: Medium - COMPLETED

### 3.14 Intelligence Briefing Subscriptions ✅
**Status**: Implemented (March 2026)
- [x] Per-user email subscription management
- [x] Admin-configurable scheduled weekly briefing generation
- [x] Automated weekly digest job with SendGrid email delivery
**Effort**: Medium - COMPLETED

### 3.15 Intelligence Freshness UX ✅
**Status**: Implemented (March 2026)
- [x] Intelligence Health dashboard with health percentage score
- [x] "Needs Attention" card for stale sources and artifacts
- [x] "Built from data as of" banners with inline rebuild buttons
- [x] Data Currency badges on Reports list
- [x] Refresh Center renamed to Intelligence Health, relocated to Insights
**Effort**: Medium - COMPLETED

### 3.16 Action Item Lifecycle Management ✅
**Status**: Implemented (March 2026)
- [x] Dismiss with reason dialog
- [x] Bulk accept and bulk dismiss via multi-select toolbar
- [x] Status tabs (Active, Accepted, Dismissed)
- [x] Gap analysis deduplication for dismissed items
**Effort**: Medium - COMPLETED

### 3.17 Support Ticket System ✅
**Status**: Implemented (March 2026)
- [x] User ticket submission with category and priority
- [x] Threaded discussion with support staff
- [x] Admin management with internal notes and assignment
- [x] Email notifications for new tickets and updates
**Effort**: Medium - COMPLETED

### 3.18 SEO Optimization ✅
**Status**: Implemented (March 2026)
- [x] Semantic HTML improvements
- [x] Open Graph and Twitter Card meta tags
- [x] Structured page titles and descriptions
**Effort**: Low - COMPLETED

---

## Post-MVP Roadmap (Year One)

### Competitive Battlecards (Q1 Post-Launch) ✅
Generate competitive battlecards for sales enablement:
- [x] Critical Capabilities Matrix with Harvey Ball scoring (●○◐◑)
- [x] Qualitative comparison narrative
- [x] Sales challenge questions with responses
- [x] Exportable PDF battlecard
- [x] Company Profile fields (headquarters, founded, revenue, funding) with UI editing
- [x] Company Snapshot section in PDF exports

### Marketing Section Landing Page (Backlog)
**Status**: Not implemented
**Description**: Central landing page at `/app/marketing` that ties together all marketing sub-features (GTM Plan, Messaging Framework, Marketing Planner, Social Posts, Email Newsletters). Shows at-a-glance content status cards with quick-action buttons for generating missing content.
- [ ] Create page component at `client/src/pages/app/marketing/index.tsx`
- [ ] Summary cards for each marketing sub-feature with generated/not-generated status
- [ ] Quick-action buttons for generating missing content
- [ ] Register route in `App.tsx` and add as Marketing nav group entry point
- [ ] Style with Aurora theme, page-header-gradient-bar, consistent with app patterns
**Effort**: Low-Medium

### Real-Time Competitor Alerts (Q1)
- [ ] Real-time notifications for competitor changes
- [ ] Social media monitoring (LinkedIn)
- [ ] Customizable alert preferences
- [ ] Weekly digest emails

### CRM Integration - HubSpot (Q2)
- [ ] Competitor sync from HubSpot
- [ ] Push Orbit insights back to CRM
- [ ] Lead generation insights

### Advanced AI Features (Q2-Q3)
- [ ] Sentiment and tone analysis
- [ ] Multi-language support
- [ ] Custom AI tuning with user goals

### Collaboration Features (Q3)
- [ ] Shared annotations/comments
- [ ] Vega integration (recommendations → tasks)
- [ ] Team usage analytics

### Outcome Metrics & ROI Dashboard (Q4)
- [ ] Google Analytics integration
- [ ] Orbit Score / Index
- [ ] Industry benchmarks

### Billing Integration
- [ ] Stripe integration for payment processing
- [ ] Plan upgrade/downgrade flows
- [ ] Usage-based billing

---

## Strategic Backlog (From replit.md)

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
- [ ] Microsoft Planner integration via Graph API - create plan in target team/channel, sync tasks
- [ ] Vega Launchpad export - generate document optimized for Vega to create Big Rocks (Projects) and OKRs
- [x] Uses comprehensive marketing activities document as grounding (19 categories stored)
**Reference**: Constellation project (https://github.com/chris-mcnulty/synozur-scdp) for Planner sync patterns
**Effort**: High (Phase 1 complete, remaining phases in progress)

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

#### Microsoft Planner Integration
**Status**: Planned (not implemented)
Sync marketing plan tasks bidirectionally with Microsoft Planner for execution tracking in Teams.
**Reference**: Constellation (`server/services/planner-service.ts`, `planner-graph-client.ts`)
**Effort**: High
**Dependencies**: Tenant must have Microsoft Entra ID configured with admin consent

#### Competitor Document Uploads
**Status**: Not implemented
Allow users to upload documents about competitors (whitepapers, case studies, sales collateral, product sheets) to enrich competitive intelligence:
- [ ] Document upload UI similar to company grounding documents
- [ ] Text extraction and indexing
- [ ] Include in AI analysis context
**Effort**: Medium

#### Headless Browser Crawling ✅
**Status**: Implemented (January 2026)
- [x] Bypass bot detection (stealth mode with anti-fingerprinting)
- [x] Handle JavaScript-rendered content (waits for networkidle2)
- [x] Improve crawl success rate for protected sites
- [x] Automatic fallback to HTTP fetch when headless fails
- [x] Browser instance pooling for efficiency
**Effort**: Medium - COMPLETED

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

#### Wire AI Usage Logging
**Status**: Not implemented
Connect logAiUsage() calls to all AI service entry points:
- [ ] Competitor analysis
- [ ] Battlecard generation
- [ ] Executive summaries
- [ ] All other AI operations
**Effort**: Low

#### reCAPTCHA for Signups
**Status**: Not implemented
- [ ] Add Google reCAPTCHA to new account signup form to prevent bot registrations
**Effort**: Low

#### Google SSO
**Status**: Not implemented
- [ ] Add Google OAuth as alternative to Microsoft Entra ID
**Effort**: Medium

#### Per-Tenant Branding
**Status**: Not implemented
- [ ] Custom logos per tenant
- [ ] Custom colors per tenant
**Effort**: Medium

#### Active Social/Blog Monitoring ✅
**Status**: Substantially implemented
Scheduled monitoring of competitor social media accounts and blog posts:
- [x] Manual blog URL input for competitors and baseline company
- [x] Blog/RSS feed parsing (RSS, Atom, HTML scraping)
- [x] New post detection with activity log entries
- [x] Web crawler auto-discovery of blog/insights/news pages
- [x] SSRF protection on all URL inputs
- [x] Change detection for website content
- [x] AI-summarized diffs highlighting what changed
- [ ] Configurable check intervals (uses tenant-level frequency settings)
**Effort**: Medium - CORE FUNCTIONALITY COMPLETED

#### Domain Blocklist
**Status**: Not implemented
- [ ] Prevent signups from specific email domains
**Effort**: Low

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
- [ ] **Feature Ingestion - Paste Text Parsing**: AI extraction of features from pasted text
- [ ] **Feature Ingestion - Web Scraping**: Extract features from product pages
- [ ] **Draft Product One-Sheets**: AI-generated product marketing one-pagers summarizing key features, benefits, and differentiators
- [ ] **Draft PowerPoint Slides**: Auto-generate product overview presentation slides
- [ ] **Draft Product Roadmap**: Visual roadmap generation with timeline, milestones, and feature releases
- [ ] **Vega Launchpad Export**: Generate document optimized for Vega to create Big Rocks (Projects) and OKRs based on product roadmap
**Effort**: MVP Complete, additional features ongoing
