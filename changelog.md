# Orbit Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Service Plan Feature Gating
  - Centralized plan policy service defining feature access for Free, Trial, Pro, and Enterprise tiers
  - Backend enforcement of competitor count limits and monthly analysis generation quotas
  - Feature-level gating on battlecards, PDF reports, GTM plans, messaging frameworks, and client projects
  - Enhanced tenant info API returning plan features, current usage, and remaining quotas
  - Frontend upgrade prompts with contact-to-upgrade flow for locked features
  - Competitor and analysis limit badges showing remaining quota
  - Sidebar lock indicators for features unavailable on current plan
- Editable GTM Plan & Messaging Framework
  - Inline edit mode with markdown editor for both GTM Plan and Messaging Framework tabs
  - Edit/Cancel/Save controls with immediate content updates
  - Automatic version history tracking (up to 10 previous versions retained)
  - Version history dialog with timestamps and content previews
  - Restore any previous version directly into the editor
  - Last manual edit timestamp displayed when content has been user-edited
- Product Competitive Position Summaries
  - AI-generated 2-3 sentence competitive position analysis for each product
  - Integrated into full regeneration as step 8 (auto-generates for all baseline products)
  - Single-product and batch generation endpoints
  - Manual edit capability with direct save
  - Summaries displayed on product detail page and dashboard overview
  - Included in branded PDF reports
- GTM Plan & Messaging Framework toggle in standard PDF reports
  - Reports page now has a checkbox to include strategic plans in any baseline report
  - Previously only available via the Full Analysis Report endpoint
- Consolidated Action Items Dashboard (`/app/action-items`)
  - Unified view aggregating recommendations, product feature suggestions, and gap analysis items
  - Filter by source (Competitive Intel, Product Roadmap, Gap Analysis), impact level, and status
  - Search across all action items with real-time filtering
  - Accept/dismiss/star actions with expandable detail cards
  - CSV export for digital visioning tools (Mural, Miro)
  - Summary statistics cards showing totals, high impact items, priorities, and source breakdown
  - Replaced "Recommendations" in sidebar navigation with "Action Items"

### Fixed
- PDF Report: Theme cards no longer show "Based on profile" placeholder text
- PDF Report: Messaging comparison shows "Market Positioning" header instead of overly long audience text when competitor names unavailable
- PDF Report: Numbered lists now properly wrapped in ordered list tags
- PDF Report: Added h4 heading support in markdown-to-HTML conversion
- PDF Report: Resolved LSP type errors for faviconUrl, talkingPoints, and companyProfile fields

- UX Optimization Phase 3: Refresh Center & Smart Suggestions
  - Dedicated Refresh Center page (`/app/refresh-center`) for managing all data refresh operations
  - Quick action cards: Refresh Baseline, Refresh All Websites, Refresh All Social, View Job Queue
  - Three tabs: Active Jobs (live status), Job History (past refreshes), Scheduled (monitoring schedule)
  - Smart Suggestions with proactive toast notifications when data becomes stale (>7 days old)
  - Dismissals stored in localStorage for 1 hour to prevent notification fatigue
  - Keyboard shortcuts: Ctrl+Shift+R (Refresh Center), Ctrl+Shift+A (Analysis), Cmd/Ctrl+K (Command Palette)
- UX Optimization Phase 2: Batch Operations & Command Palette
  - Command Palette (Cmd/Ctrl+K) for quick navigation across the application
  - Batch operations on Competitors page: select multiple competitors for bulk refresh
  - Recent Jobs Panel showing latest crawl activity with status indicators
  - Refresh Strategy Dialog for advanced scheduling options
- UX Optimization Phase 1: Staleness Indicators & Refresh Controls
  - Global refresh status indicator in header showing overall data freshness
  - Data staleness dots throughout the UI (🟢 fresh <2 days, 🟡 aging 2-7 days, 🔴 stale >7 days)
  - Consolidated refresh dropdown in header for quick access to common refresh actions
  - Contextual tooltips explaining refresh options and data age
- Company Profile fields for competitors (headquarters, founded year, revenue, funding raised)
  - View and edit company profile data on the Competitor Detail page (Overview tab)
  - Manual AI Research prompt now requests company profile information
  - Company profile fields auto-extracted when pasting AI research results
  - "Company Snapshot" section in battlecard PDFs displays profile data when available
- Enhanced scheduled job tracking with individual entity-level run details
  - Job history "Details" column shows results summary (pages crawled, word count, social platforms)
  - Each competitor/baseline/product crawl creates individual job run record with results

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
  - Filter dropdown appears in Team Members section when logged in as Global Admin
  - Filter by any accessible tenant organization
  - User count updates dynamically based on selected filter
- Auto-Promotion for First Domain User - Self-service account creation now automatically promotes the first user from a new email domain to Domain Admin role
  - Enables immediate configuration of organization settings without waiting for manual role assignment
  - Subsequent users from the same domain receive Standard User role
- One-Click Full Report Generation - Generate all project content with a single click
  - "Generate Full Report" button in project header orchestrates all 5 AI content sections in parallel
  - Creates Gap Analysis, Strategic Recommendations, Competitive Summary, GTM Plan, and Messaging Framework
  - Also calculates competitor scores automatically
  - Progress indicator shows during generation (~1 minute)
  - Results card displays success/failure count for each section
  - Auto-downloads comprehensive markdown export when all sections complete successfully
  - All project tabs refresh automatically after generation
- Battlecard Export Options - Share and use battle cards outside of Orbit
  - Copy to clipboard with formatted text (emojis, sections, ready to paste)
  - Download as PDF with Synozur branding (purple gradients, professional layout)
  - Download as text file for use in Word, PowerPoint, or any document
  - Works for both company-level battlecards and product-level (project) battlecards
- 60-Day Trial System with automated reminder emails
  - New tenants automatically start with a 60-day trial period
  - Reminder emails at key milestones: day 7, 30, 46 (14 left), 53 (7 left), 57 (3 left), 59 (1 left), and day 60 (expired)
  - Final 14 days emails include contact information (contactus@synozur.com) for establishing a client relationship
  - Automatic plan reversion to Free tier when trial expires (1 competitor, 1 analysis limit)
  - Scheduled job runs every 6 hours to check and send trial reminders
- AI Usage Tracker - Global Admin dashboard to monitor AI API usage across all tenants
  - Statistics cards showing total requests, estimated costs, average daily usage, and most-used operations
  - Daily usage bar chart (last 14 days) and pie chart showing usage by operation type
  - Recent activity table with operation details, model names, and tenant attribution
  - Database table for tracking all AI API calls (provider, model, tokens, costs)
- Blog/RSS Feed Monitoring for Manual Competitors - Add direct links to competitor blogs or RSS feeds
  - New "Add Blog/RSS Feed" option in competitor dropdown menu
  - Test blog URLs before saving to verify they can be parsed
  - Supports RSS feeds, Atom feeds, and direct blog page HTML parsing
  - Detects new blog posts and creates activity entries when competitors publish
  - Useful for companies that block web crawlers but have accessible blogs
- Blog URL Field for Baseline Company - Track your own company's blog activity
  - New blog URL input field in Company Baseline settings with RSS icon
  - SSRF protection validates blog URLs before saving (blocks private IPs, internal domains)
  - Blog monitoring function updates baseline Orbit Score (blog activity = 20% of Innovation Score)
  - Activity feed tracks new blog posts from baseline company
- Enhanced Blog Discovery in Web Crawler
  - Now detects `/insight` and `/insights` pages as blog content (common for B2B companies)
  - Prioritizes blog → insights → news → articles (fallback order)
  - Improves content discovery for professional services and consulting firms
- Backlog.md file with comprehensive MVP feature tracking

### Fixed
- "Regenerate All" now preserves manual research - competitors with manually entered research (source === "manual") are no longer overwritten during full regeneration, protecting hand-entered data for companies that block web crawlers

### Changed
- Separated Company Baseline and Competitors screens into distinct pages
  - Company Baseline page now focused on your company profile, analysis, and grounding documents
  - Competitors page now focused on competitor tracking with minimal baseline reference
  - Clear visual distinction with different layouts and purposes
- Unified Overview page - consolidated Command Center and Overview into a single, visually rich dashboard at `/app`
- Overview is now the home page hero when logging in
- Added "Rebuild All" button to Overview for admins to refresh all competitive intelligence
- Enhanced AI Insights section with action item assignment, accept, and dismiss controls

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
