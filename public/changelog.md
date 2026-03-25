# Orbit Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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
