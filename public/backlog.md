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

### 3.2 Expert Review Upsell
**Status**: Not implemented
**Spec Requirement**: "Expert Review CTA for Synozur consultant review"
- [ ] In-app CTA to request consultant review
- [ ] Contact form or scheduling link
- [ ] Messaging about Synozur services

### 3.3 Recommendation Feedback Loop
**Status**: Not implemented
**Spec Requirement**: "Users can mark recommendations as 'not relevant'"
- [ ] Thumbs up/down on recommendations
- [ ] AI learning from feedback

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

---

## Post-MVP Roadmap (Year One)

### Competitive Battlecards (Q1 Post-Launch)
Generate competitive battlecards for sales enablement:
- [ ] Critical Capabilities Matrix with Harvey Ball scoring (●○◐◑)
- [ ] Qualitative comparison narrative
- [ ] Sales challenge questions with responses
- [ ] Exportable PDF battlecard

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
- [ ] Matrix view showing categories as rows and time periods as columns (matches Synozur marketing plan format)
- [ ] Microsoft Planner integration via Graph API - create plan in target team/channel, sync tasks
- [ ] Vega Launchpad export - generate document optimized for Vega to create Big Rocks (Projects) and OKRs
- [x] Uses comprehensive marketing activities document as grounding (19 categories stored)
**Reference**: Constellation project (https://github.com/chris-mcnulty/synozur-scdp) for Planner sync patterns
**Effort**: High (Phase 1 complete, remaining phases in progress)

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

#### Headless Browser Crawling
**Status**: Not implemented
Replace HTTP-based crawling with Puppeteer headless browser:
- [ ] Bypass bot detection
- [ ] Handle JavaScript-rendered content
- [ ] Improve crawl success rate for protected sites
**Effort**: Medium

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
**Status**: Partially implemented (manual triggers exist)
Scheduled monitoring of competitor social media accounts and blog posts:
- [ ] Configurable check intervals
- [ ] Change detection
- [ ] AI-summarized diffs highlighting what changed
**Effort**: Medium

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

## Long-Range / Future (May Become Separate App)

### Product Management Module
**Status**: Future exploration
Comprehensive product planning and roadmap intelligence. May live in Orbit or become its own application.

Features:
- [ ] **Feature Ingestion**: Use projects/products object to ingest current feature set and proposed roadmap
- [ ] **Market Analysis Comparison**: Compare product features and roadmap against competitive market analysis data
- [ ] **AI Roadmap Recommendations**: Propose changes and additions to the roadmap based on market conditions, competitive gaps, and trends
- [ ] **Draft Product One-Sheets**: AI-generated product marketing one-pagers summarizing key features, benefits, and differentiators
- [ ] **Draft PowerPoint Slides**: Auto-generate product overview presentation slides
- [ ] **Draft Product Roadmap**: Visual roadmap generation with timeline, milestones, and feature releases
- [ ] **Vega Launchpad Export**: Generate document optimized for Vega to create Big Rocks (Projects) and OKRs based on product roadmap
**Effort**: Very High
