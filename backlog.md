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

### 2.2 Dark/Light Mode Toggle
**Status**: Dark mode default, no toggle
**Spec Requirement**: "Dark Mode and Light Mode toggle"
- [x] User preference toggle in settings
- [x] Persist preference in user record or localStorage
- [x] CSS variable switching for theme
**Effort**: Low

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

### 3.1 Orbit Promotional Landing Page
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

### 3.8 UX Optimization: Refresh/Rebuild Discoverability & Flow 📋
**Status**: Proposal created - NOT IMPLEMENTED
**Problem**: Users must navigate 8+ different pages to trigger rebuild/refresh/recrawl actions, creating poor discoverability and fragmented workflow
**Documentation**: See `docs/ux-optimization-proposal.md` and `docs/ux-optimization-summary.md`

**Current State**: Refresh actions scattered across:
- Data Sources (news refresh, 3 buttons)
- Company Baseline (website + social refresh)
- Competitor Detail (crawl, monitor, regenerate)
- Analysis (3 modes + full regeneration)
- Battlecards (regenerate per competitor)
- Baseline Summary (generate/regenerate)
- Competitors (analyze dropdown)
- Admin Panel (job management)

**Proposed Quick Wins (Phase 1: 1-2 weeks)**:
- [x] Global Refresh Status Indicator (header notification with progress)
- [x] Data Staleness Indicators (🟢🟡🔴 dots throughout UI)
- [x] Consolidate Duplicate Buttons (single dropdown per page)
- [x] Contextual Tooltips (explain what each action does, time/cost estimates)

**Proposed Core Improvements (Phase 2: 2-3 weeks)**:
- [x] Command Palette (Cmd+K fuzzy search for all actions)
- [x] Unified Refresh Strategy Dialog (intelligent guidance)
- [x] Batch Operations (select multiple, refresh all)
- [x] Improved Job Status (make admin panel available to all)

**Proposed Advanced Features (Phase 3: 3-4 weeks)**:
- [ ] Refresh Center Dashboard (dedicated page for all data ops)
- [ ] Smart Suggestions (proactive prompts when data stale)
- [ ] Keyboard Shortcuts (power user accelerators)
- [ ] Onboarding Tutorial (interactive guide)

**Expected Impact**:
- 70% reduction in time to find refresh actions
- 50% decrease in support tickets about data freshness
- 3x faster workflow with batch operations
- 40% improvement in new user onboarding

**Effort**: Low (Phase 1) to High (full implementation)
**Priority**: High (major UX friction point)

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

#### Service Plan Feature Gating
**Status**: Designed, deferred until all features verified working
Implement tiered access control with blurred overlays and upgrade prompts:
- [ ] Free tier: 1 company, 1-2 competitors, no projects/GTM/messaging rewrites
- [ ] Trial (60 days): full Pro features
- [ ] Pro: 7 competitors, projects, GTM, messaging
- [ ] Enterprise: unlimited + markets
- [ ] Each tier has RW/RO user limits (adminUserLimit, readWriteUserLimit, readOnlyUserLimit)
- [ ] Show locked features with diamond icon and blur effect
**Effort**: High

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

#### Product Competitive Position Summaries
**Status**: Backlogged
When products are attached to a baseline company, generate and display 2-3 sentence competitive position summaries:
- [ ] Add `competitivePositionSummary` field to products schema
- [ ] Generate summary during full regeneration (rebuild all) process
- [ ] Display product summaries on Overview page (not just product names)
- [ ] Include summaries in Capstone PDF reports (listing just product names isn't helpful)
- [ ] Allow manual editing of summaries if needed
- [ ] AI generates summary based on product features, competitor analysis, and market positioning
**Effort**: Medium

#### Editable GTM Plan
**Status**: Not implemented
The draft GTM plan is the primary strategic input for Marketing Planner task generation. Users should be able to edit it directly:
- [ ] View GTM plan in editable markdown/rich text editor
- [ ] Add, edit, and delete strategic elements (goals, initiatives, messaging pillars)
- [ ] Track version history of GTM plan changes
- [ ] Manual save vs auto-save options
- [ ] Indicate which elements are AI-generated vs user-edited
- [ ] Re-generate specific sections while preserving user edits
**Effort**: Medium

#### Microsoft Planner Integration
**Status**: Planned (not implemented)
Sync marketing plan tasks bidirectionally with Microsoft Planner for execution tracking in Teams.

**Architecture** (based on Constellation patterns):
1. **Authentication Layer** (`server/services/planner-graph-client.ts`)
   - Client credentials flow (app-only authentication)
   - Token caching with automatic refresh
   - Support system credentials (`PLANNER_TENANT_ID`, `PLANNER_CLIENT_ID`, `PLANNER_CLIENT_SECRET`)
   - Optional BYOA (Bring Your Own App) for tenant-specific credentials

2. **Planner Service** (`server/services/planner-service.ts`)
   - List Microsoft 365 groups (Teams) user belongs to
   - Create/list Planner plans within a group
   - Create buckets for task organization (by quarter or activity category)
   - CRUD operations on Planner tasks with assignments

3. **Data Model Updates**:
   - [ ] Add `microsoftTeamId` to marketing plans (target Team for sync)
   - [ ] Add `plannerPlanId` to marketing plans (linked Planner plan)
   - [ ] Add `plannerTaskId` to marketing tasks (already exists, needs implementation)
   - [ ] Add `plannerBucketId` for bucket mapping

4. **UI Components**:
   - [ ] "Connect to Planner" button on marketing plan detail page
   - [ ] Team/Group selector dropdown (paginated with search)
   - [ ] Channel selector for where to pin the Planner tab
   - [ ] Sync status indicator (last synced, sync errors)
   - [ ] Manual "Sync Now" button

5. **Sync Logic**:
   - [ ] One-way push: Orbit → Planner (initial implementation)
   - [ ] Map task status: `accepted`/`in_progress` → 50%, `completed` → 100%
   - [ ] Map priority: High/Medium/Low
   - [ ] Sync due dates and descriptions
   - [ ] Create buckets by quarter (Steady State, Q1, Q2, Q3, Q4, Future)
   - [ ] Handle task deletions (mark removed vs delete in Planner)

6. **Future: Bidirectional Sync**:
   - [ ] Webhook or polling for Planner changes
   - [ ] Update Orbit task status when completed in Planner
   - [ ] Conflict resolution strategy (last-write-wins or prompt user)

**Azure AD Permissions Required**:
- `Group.Read.All` - List groups/teams
- `Tasks.ReadWrite` - Create/update Planner tasks
- `TeamsTab.Create` - Pin Planner tab to Teams channel
- `Channel.ReadBasic.All` - List channels in a Team

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
Replace HTTP-based crawling with Puppeteer headless browser:
- [x] Bypass bot detection (stealth mode with anti-fingerprinting)
- [x] Handle JavaScript-rendered content (waits for networkidle2)
- [x] Improve crawl success rate for protected sites
- [x] Automatic fallback to HTTP fetch when headless fails
- [x] Browser instance pooling for efficiency
**Effort**: Medium - COMPLETED

#### Consolidated Action Items
**Status**: Not implemented
Dashboard view showing all action items across baseline and projects for a tenant:
- [ ] Aggregate view of all recommendations and action items
- [ ] Ability to assign to users
- [ ] Close, dismiss, or add comments
**Effort**: Medium

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

#### Active Social/Blog Monitoring
**Status**: Substantially implemented
Scheduled monitoring of competitor social media accounts and blog posts:
- [x] Manual blog URL input for competitors and baseline company
- [x] Blog/RSS feed parsing (RSS, Atom, HTML scraping)
- [x] New post detection with activity log entries
- [x] Web crawler auto-discovery of blog/insights/news pages
- [x] SSRF protection on all URL inputs
- [ ] Configurable check intervals (uses tenant-level frequency settings)
- [x] Change detection for website content
- [x] AI-summarized diffs highlighting what changed
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
**Status**: Backlogged (Reported January 2026)
**Priority**: Medium
Several issues identified in the Full Analysis Report PDF generation:
- [ ] **Key Themes Section**: Currently displays "Based on profile" placeholder repeatedly instead of actual extracted themes from analysis data
- [ ] **Messaging Comparison**: Shows generic "Competitor" text instead of actual competitor names - needs to pull competitor name from the data
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
