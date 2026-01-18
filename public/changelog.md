# Orbit Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
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
- Backlog.md file with comprehensive MVP feature tracking

### Changed
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
