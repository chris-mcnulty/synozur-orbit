# Orbit MVP Feature Backlog

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

---

## Proposals — Pending Approval

> The following twelve items were proposed on 2026-03-26 based on a full review of the application's current state. **None of these items have been built.** They are awaiting approval before any implementation begins.

---

### Performance & Stability

#### PS-1 — Persistent, Distributed Job Queue
**Status**: Not started  
**Problem**: The current job queue (`server/services/job-queue.ts`) is entirely in-memory. Any server restart, crash, or deployment discards every queued or in-progress job (crawls, PDF generation, AI analysis). Users see silent failures with no way to recover their request.  
**Proposal**: Replace the in-memory queue with a durable, database-backed queue (e.g., a `jobs` table in PostgreSQL managed by a library such as `pg-boss` or `graphile-worker`). Jobs survive restarts, have explicit retry policies, and can be distributed across multiple server replicas safely — eliminating duplicate execution that would otherwise occur in a scaled deployment.  
**Acceptance criteria**:  
- [ ] All existing job types (crawl, PDF, analysis, monitoring) routed through the persistent queue  
- [ ] Jobs survive a server restart and resume automatically on next startup  
- [ ] Duplicate execution prevented when running ≥2 server replicas  
- [ ] Admin dashboard shows queue depth, job status, and recent failures  
**Effort**: High

#### PS-2 — Redis-Backed Session Store with Sliding Expiry
**Status**: Not started  
**Problem**: Sessions are persisted directly to PostgreSQL via `connect-pg-simple`. Every authenticated HTTP request reads or writes a session row, adding unnecessary database load. At scale (hundreds of concurrent users) this competes with application queries for connection pool slots.  
**Proposal**: Introduce a Redis session store (`connect-redis`) as the primary session layer. Configure a sliding 30-minute TTL so active users are not interrupted, and fall back gracefully to database session re-creation on Redis unavailability. Cookie settings (SameSite, Secure, HttpOnly) should be audited and hardened at the same time.  
**Acceptance criteria**:  
- [ ] Session reads/writes served from Redis; PostgreSQL no longer receives session traffic  
- [ ] Existing login flows (local, Entra ID) continue to work without modification  
- [ ] Session survives across a single Redis restart via persistent RDB snapshot  
- [ ] Secure cookie attributes enforced in production  
**Effort**: Medium

#### PS-3 — API Rate Limiting with Tenant-Aware Bucketing
**Status**: Not started  
**Problem**: No rate-limiting middleware exists on any API route. Authentication endpoints, AI-triggering endpoints (crawl, analysis, PDF generation), and file-upload endpoints are all callable at arbitrary frequency by any authenticated or unauthenticated client. This exposes the platform to abuse, runaway AI costs, and potential DDoS amplification through expensive Puppeteer or AI calls.  
**Proposal**: Add `express-rate-limit` middleware with two tiers: (1) a strict global limit on unauthenticated routes (login, signup, password reset) — e.g. 10 requests/minute per IP; (2) per-tenant limits on authenticated AI/crawl endpoints — e.g. 60 requests/minute, with higher ceilings for Enterprise/Unlimited plan holders. Limits should be configurable via environment variables.  
**Acceptance criteria**:  
- [ ] Login/signup/password-reset endpoints return `429` after exceeding threshold  
- [ ] AI and crawl endpoints rate-limited per tenant, not per IP  
- [ ] Plan-based ceiling differences applied automatically from service plan record  
- [ ] 429 responses include a `Retry-After` header  
- [ ] No existing passing tests broken  
**Effort**: Low–Medium

---

### User Experience Enhancements

#### UX-1 — Inline Refresh Cost & Time Estimate Tooltips
**Status**: Not started  
**Problem**: Users who click "Refresh" or "Rebuild" have no visibility into what will happen: how long it will take, how many AI tokens it will consume, or which downstream artifacts will be affected. This creates anxiety and accidental over-triggering of expensive operations — particularly for batch refreshes across many competitors.  
**Proposal**: Wherever a refresh, rebuild, or crawl action button appears, show a hover tooltip (and confirm dialog for batch actions) that states: the estimated run time (derived from average durations stored in the job history), the number of competitors/pages affected, and whether the action will consume AI credits. A "dismiss and don't show again" option keeps power users unimpeded.  
**Acceptance criteria**:  
- [ ] Tooltip visible on all refresh/rebuild/crawl action buttons  
- [ ] Batch confirmation dialog shows count of items and estimated total duration  
- [ ] AI-credit-consuming actions marked with a distinct icon  
- [ ] "Don't show again" preference persisted per user  
**Effort**: Low–Medium

#### UX-2 — Global Notification Centre with Read/Unread State
**Status**: Not started  
**Problem**: Important system events — crawl completions, significant competitor changes, stale-data warnings, trial expiry reminders — surface only as ephemeral toast notifications or buried in the Activity Log. Users who are away from the app when a toast fires miss the event entirely. There is no persistent inbox.  
**Proposal**: Add a bell-icon Notification Centre in the top navigation bar. Notifications are written server-side (same triggers as toasts and emails) and fetched via a polling or WebSocket endpoint. Unread count badge drives urgency. Clicking a notification deep-links to the relevant page. Users can mark all as read or clear history. Mobile-responsive drawer on small viewports.  
**Acceptance criteria**:  
- [ ] Bell icon with unread badge visible in top nav for all authenticated users  
- [ ] Server writes a notification record for: crawl complete, AI analysis complete, significant competitor change detected, data freshness warning, trial milestone  
- [ ] Notifications persist across sessions and devices  
- [ ] Deep-link navigation from each notification type  
- [ ] Mark-as-read and clear-all actions available  
**Effort**: Medium

#### UX-3 — Guided Onboarding Wizard for New Tenants
**Status**: Not started  
**Problem**: When a new organisation completes sign-up, they land on an empty dashboard with no guided path to their first insight. First-time activation requires users to independently discover: adding a company profile, adding competitors, uploading grounding documents, and triggering an initial crawl — tasks scattered across five different pages. Incomplete setups produce empty or low-quality AI analysis, leading to early churn.  
**Proposal**: Implement a multi-step onboarding wizard (modal or dedicated `/onboarding` route) that surfaces automatically to the Domain Admin on first login. Steps: (1) Confirm company domain & website, (2) Add 1–5 competitor URLs, (3) Optionally upload a grounding document, (4) Trigger the first automated crawl, (5) "Your first analysis will be ready in ~X minutes" — then redirect to the dashboard with a progress indicator. Progress is persisted so the wizard resumes if closed mid-flow.  
**Acceptance criteria**:  
- [ ] Wizard shown automatically to Domain Admin on first post-signup login  
- [ ] All five steps completable without leaving the wizard  
- [ ] Wizard skippable at any step with a clear "I'll set this up later" option  
- [ ] Completed state stored so the wizard never re-appears after dismissal  
- [ ] Works for both local-auth and Entra ID SSO tenants  
**Effort**: Medium

---

### New Features

#### NF-1 — Competitor Alerts: Real-Time Significant-Change Notifications
**Status**: Not started  
**Problem**: Change detection runs on a schedule and results appear in the Activity Log, but users are not proactively alerted when a competitor makes a high-significance change (pricing page update, new product launch, major messaging shift). The current weekly digest email is too infrequent for fast-moving markets.  
**Proposal**: Add an "Alert" tier to the change-detection pipeline. When the AI-assessed significance of a detected change exceeds a configurable threshold, immediately dispatch an in-app notification (see UX-2) and optionally an email alert to opted-in users. Significance threshold (High / Medium / All) and notification channel (in-app only, email, both) configurable per user in Settings. Available to Pro and above plans.  
**Acceptance criteria**:  
- [ ] Significance threshold evaluated by AI during change summarisation  
- [ ] In-app notification dispatched within 5 minutes of detection for High-significance changes  
- [ ] Email alert uses existing email service with a new "Competitor Alert" template  
- [ ] Per-user opt-in/out and threshold selection in Settings → Notifications  
- [ ] Feature gated to Pro / Enterprise / Unlimited plans  
**Effort**: Medium

#### NF-2 — Win/Loss Analysis Module
**Status**: Not started  
**Problem**: Orbit captures rich competitive intelligence about competitors' positioning and products, but has no mechanism for sales teams to feed back what is actually winning and losing deals. Without this signal, AI recommendations are based purely on external observation rather than internal commercial reality.  
**Proposal**: Add a Win/Loss module (under the Competitive Intelligence pillar) where users can log deal outcomes: won/lost, primary competitor(s) involved, deal size range, reason category (price, features, relationship, speed, compliance, other), and free-text notes. The module generates AI-synthesised Win/Loss reports: win rate by competitor, most-cited loss reasons, feature gaps correlated with losses, and recommended battlecard updates. Data exportable as CSV and PDF.  
**Acceptance criteria**:  
- [ ] Deal outcome entry form with required fields: outcome, competitor(s), reason category  
- [ ] Deal history list view with filtering by competitor, date range, outcome  
- [ ] AI-generated Win/Loss report refreshable on demand  
- [ ] Report highlights correlation between loss reasons and battlecard gaps  
- [ ] PDF and CSV export of raw deal log and summary report  
- [ ] Available to Enterprise and Unlimited plans  
**Effort**: High

#### NF-3 — Automated Competitive Intelligence Digest Slack / Teams Integration
**Status**: Not started  
**Problem**: The weekly email digest requires users to check their inbox and navigate to Orbit for details. GTM teams increasingly operate out of Slack or Microsoft Teams; intelligence that lives only in email or a web app is frequently missed.  
**Proposal**: Add webhook-based integrations for Slack and Microsoft Teams. Domain Admins can configure one or both integrations in Settings → Integrations by providing an incoming webhook URL. Orbit will post a formatted weekly digest (competitor changes, top recommendations, data freshness summary) to the configured channel. Individual significant-change alerts (see NF-1) can also be routed to the channel. A test-post button verifies the webhook before saving.  
**Acceptance criteria**:  
- [ ] Slack and Teams webhook URL fields in Settings → Integrations (Domain Admin only)  
- [ ] Webhook URL validated with a test POST on save  
- [ ] Weekly digest message formatted with rich blocks / Adaptive Cards  
- [ ] Significant-change alerts optionally routed to the same channel  
- [ ] Webhook failure logged and surfaced as an admin alert; does not affect email delivery  
- [ ] Available to Enterprise and Unlimited plans  
**Effort**: Medium

#### NF-4 — Persona & ICP Intelligence Builder
**Status**: Not started  
**Problem**: Orbit helps users understand competitors' positioning but provides no structured way to define or maintain their own Ideal Customer Profile (ICP) or buyer personas. Marketing campaigns, battlecards, and AI recommendations are generated without explicit knowledge of who the user is selling to, limiting personalisation and relevance of AI outputs.  
**Proposal**: Add a Persona & ICP section (under the Marketing pillar) where users can define target personas: name, job title, seniority, industry, company size, primary pain points, goals, objections, and preferred channels. Orbit will use these definitions as additional context in all AI generation flows (campaign copy, battlecard tone, recommendation framing). An AI-assisted persona drafting wizard can bootstrap personas from the company profile and competitor analysis.  
**Acceptance criteria**:  
- [ ] Persona creation and editing form with all defined fields  
- [ ] Up to 10 personas per tenant (configurable per plan)  
- [ ] Persona context injected into AI prompts for campaigns, battlecards, and recommendations  
- [ ] AI-assisted persona draft wizard available from the creation flow  
- [ ] Personas listed and manageable in a dedicated page  
- [ ] Available to Pro and above plans  
**Effort**: Medium–High

#### NF-5 — Competitor Pricing Intelligence Tracker
**Status**: Not started  
**Problem**: Pricing pages are among the highest-value pages to monitor for competitive changes, yet the current crawl pipeline treats them the same as any other page — returning undifferentiated diff summaries. Sales teams need structured, historical pricing data to support deal conversations and battlecard pricing sections.  
**Proposal**: Add a Pricing Intelligence feature within each competitor profile. During crawls, Orbit attempts to auto-detect pricing pages and extract structured data: plan names, price points, billing frequency, and feature inclusions. Extracted data is stored historically so users can see when and how pricing changed. A pricing comparison table across all competitors is available on the Competitors dashboard. AI generates a "Pricing Narrative" summarising the competitive pricing landscape and positioning recommendations for the user's own pricing.  
**Acceptance criteria**:  
- [ ] Pricing page auto-detected from crawled URLs (heuristic: `/pricing`, `/plans`, `/packages`)  
- [ ] Structured pricing data extracted and stored per crawl cycle  
- [ ] Historical pricing change log visible per competitor  
- [ ] Cross-competitor pricing comparison table on the Competitors dashboard  
- [ ] AI-generated Pricing Narrative refreshable on demand  
- [ ] Feature gated to Enterprise and Unlimited plans  
**Effort**: High

#### NF-6 — Embeddable Competitive Intelligence Widget
**Status**: Not started  
**Problem**: GTM Consultants and Enterprise accounts often need to surface competitive insights inside other tools — CRM opportunity records, sales enablement platforms, or internal intranet portals — without requiring every sales rep to log into Orbit. Currently, the only sharing mechanism is PDF export or manual copy-paste.  
**Proposal**: Provide an embeddable JavaScript widget that renders a configurable, read-only view of Orbit data (e.g., latest competitor snapshot, top battlecard for a specified competitor, or current intelligence briefing summary). Domain Admins generate a signed embed token scoped to specific competitors and data types. The widget is embeddable via a single `<script>` tag and renders in an iframe with Synozur branding. Token expiry (7/30/90 days) and revocation managed from Settings → Integrations.  
**Acceptance criteria**:  
- [ ] Embed token generation UI in Settings → Integrations (Domain Admin only)  
- [ ] Token scoped to: specific competitor(s), data type (snapshot / battlecard / briefing summary)  
- [ ] Widget renders read-only, correctly themed, with Synozur branding watermark  
- [ ] Token expiry enforced server-side; expired tokens return a friendly expired-state widget  
- [ ] Token revocation takes effect immediately (< 60 seconds)  
- [ ] Available to Enterprise and Unlimited plans  
**Effort**: High

---
