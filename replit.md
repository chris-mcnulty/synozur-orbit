# Orbit - Marketing Intelligence Platform

## Overview

Orbit is an AI-driven marketing intelligence platform built for The Synozur Alliance LLC. It analyzes a customer's website and positioning documents against competitors, identifies messaging gaps, and generates AI-driven recommendations. The platform is a multi-tenant SaaS application with role-based access control (RBAC), competitive analysis tools, and branded PDF reporting capabilities.

Key features include:
- Competitive website and positioning document analysis
- AI-guided recommendations using RAG-style architecture
- Competitor change monitoring with diff summaries
- Branded PDF report generation
- Multi-tenant architecture with Global Admin, Domain Admin, and Standard User roles
- Dark mode default with Synozur brand colors (#810FFB purple, #E60CB3 pink)
- Grounding documents module for tenant-specific positioning documents
- Tenant demographics collection during signup (company, jobTitle, industry, companySize, country)
- Company profile baselining - analyze your own website against competitors

## Synozur Ecosystem - Sibling Applications

Reference these codebases for patterns and features:

### Vega (Company Operating System)
- **URL**: https://github.com/chris-mcnulty/synozur-vega (private)
- **Purpose**: Strategy/OKR platform, serves as identity provider for Synozur ecosystem
- **Key Patterns**: Login page structure, OAuth 2.1 provider

### Orion (Maturity Model Platform)
- **URL**: https://github.com/chris-mcnulty/synozur-maturitymodeler
- **Purpose**: Multi-model maturity assessments with AI recommendations
- **Key Patterns to Borrow**:
  - **Tenant Demographics**: Users have company, companySize, jobTitle, industry, country fields with standardized dropdowns
  - **Proxy Assessments**: Admins can create assessments on behalf of prospects (isProxy, proxyName, proxyCompany, proxyJobTitle, proxyIndustry, proxyCompanySize, proxyCountry)
  - **Auth Page Structure**: Tabbed login/register with Synozur logo, comprehensive registration fields
  - **Knowledge Base**: User-uploadable documents (PDF, DOCX, TXT, MD) for AI grounding
  - **Company Size Values**: sole_proprietor, very_small, small, lower_mid, upper_mid, mid_enterprise, large_enterprise

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **Routing**: Wouter for client-side routing
- **State Management**: TanStack React Query for server state, React Context for user authentication state
- **UI Components**: shadcn/ui component library with Radix UI primitives
- **Styling**: Tailwind CSS v4 with CSS variables for theming
- **Font**: Avenir Next LT Pro (custom font faces defined in index.css with fallback support)

The frontend follows a page-based structure under `client/src/pages/` with:
- Public pages (landing, auth)
- App pages (dashboard, competitors, analysis, recommendations, activity, reports, settings, users)

Layout components separate public-facing pages (`PublicLayout`) from authenticated app pages (`AppLayout` with sidebar navigation).

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **API Design**: RESTful JSON API endpoints under `/api/` prefix
- **Session Management**: Express-session with cookie-based authentication
- **Password Hashing**: bcrypt for secure password storage
- **Build System**: Custom build script using esbuild for server bundling and Vite for client

The server uses a storage abstraction layer (`server/storage.ts`) that interfaces with the database through Drizzle ORM, making it straightforward to swap storage implementations.

### Database Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: `shared/schema.ts` (shared between client and server)
- **Migrations**: Drizzle Kit with migrations output to `/migrations`
- **Schema Validation**: Zod schemas generated from Drizzle schemas using drizzle-zod

Database tables include:
- `users` - User accounts with role-based access (Global Admin, Domain Admin, Standard User), includes tenant demographics (company, companySize, jobTitle, industry, country)
- `competitors` - Tracked competitor websites
- `activity` - Competitor change events and updates
- `recommendations` - AI-generated recommendations
- `reports` - Generated PDF reports
- `analysis` - Competitive analysis results
- `groundingDocuments` - Tenant-scoped positioning documents for AI grounding
- `companyProfiles` - Your company profile for baseline analysis (one per tenant)
- `assessments` - Saved snapshots of competitive analysis for comparison over time (supports proxy assessments for admins)

### Authentication & Authorization
- Session-based authentication with express-session
- **Microsoft Entra ID SSO**: OAuth 2.0 integration using @azure/msal-node
  - Routes: `/api/auth/entra` (initiate), `/api/auth/entra/callback` (handle token)
  - Configuration: `server/auth/msal-config.ts`
  - SSO users have `authProvider: "entra"` and cannot use password login
  - Requires: `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_TENANT_ID` env vars
- Password fallback: Traditional email/password login for non-SSO users
- Role hierarchy: Global Admin > Domain Admin > Standard User
- First registered user becomes Global Admin (both password and SSO)
- First user per email domain becomes Domain Admin for that domain
- User context provided via React Context on the frontend

### Build & Development
- Development: `npm run dev` runs the Express server with Vite middleware for HMR
- Production build: `npm run build` bundles both client (Vite) and server (esbuild)
- Database push: `npm run db:push` applies schema changes via Drizzle Kit

## External Dependencies

### Database
- **PostgreSQL**: Primary database, connection via `DATABASE_URL` environment variable
- **Drizzle ORM**: Database query builder and schema management

### AI Services (Abstraction Layer)
- Provider abstraction supporting:
  - MockAIProvider (works without API keys for development)
  - OpenAI/Azure OpenAI Provider (enabled via environment variables)

### UI Libraries
- **Radix UI**: Headless component primitives for accessibility
- **shadcn/ui**: Pre-styled component library (new-york style variant)
- **Lucide React**: Icon library
- **TanStack React Query**: Server state management

### Development Tools
- **Vite**: Frontend build tool with HMR
- **esbuild**: Server bundling for production
- **TypeScript**: Type safety across the stack

### Environment Variables Required
- `DATABASE_URL`: PostgreSQL connection string
- `SESSION_SECRET`: Secret key for session encryption (defaults to development value)
- AI provider keys (optional): For production AI features
- **Entra SSO (optional)**:
  - `ENTRA_CLIENT_ID`: Azure app registration client ID
  - `ENTRA_CLIENT_SECRET`: Azure app registration client secret
  - `ENTRA_TENANT_ID`: Azure tenant ID (use "common" for multi-tenant)

## MVP Feature Backlog

Based on the Orbit MVP Specification, the following features are required for launch. Items are categorized by implementation status.

### Already Implemented ✅

1. **Multi-Tenant Architecture**
   - Tenant isolation by email domain
   - Role hierarchy: Global Admin > Domain Admin > Standard User
   - Tenants table with plan, status, and usage limits

2. **Data Inputs**
   - Competitor URL entry and management
   - Grounding document upload (PDF, DOCX) with text extraction
   - Company profile baselining

3. **Core AI Analysis**
   - Competitive website analysis with Claude Sonnet
   - AI-guided recommendations with RAG architecture
   - Gap analysis between company and competitors

4. **Basic Application Structure**
   - Dashboard, Competitors, Analysis, Recommendations pages
   - Activity log for changes
   - Assessments with proxy capability
   - Global Admin tenant dashboard

---

### Missing for MVP 🚧

#### Priority 1: Critical (Must Have for Launch)

##### 1.1 SSO Authentication (Microsoft Entra ID + Google)
**Status**: Microsoft Entra ID implemented ✅, Google pending
**Spec Requirement**: "SSO integration with Microsoft Entra ID (Azure AD) and Google"
- ✅ Microsoft Entra ID OAuth 2.0 flow with @azure/msal-node
- ✅ SSO users linked via `entraId` field, `authProvider: "entra"`
- ✅ Password login blocked for SSO users
- ⏳ Google SSO (optional, not critical for enterprise)
**Effort**: Remaining: Low (Google SSO only)

##### 1.2 Trial & Feature Gating System
**Status**: Schema exists, no enforcement
**Spec Requirement**: "14-day free trial, then Free tier with limited functionality"
- Add `trialStartDate` and `trialEndsAt` to tenants
- Implement trial countdown and expiration logic
- Feature gating middleware on API routes
- UI upgrade prompts when hitting limits (3 competitors, 5 analyses)
- Free tier: basic analysis only, no AI recommendations
**Effort**: Medium

##### 1.3 PDF Report Generation & Export
**Status**: Reports table exists, no generation
**Spec Requirement**: "Download a PDF report...formatted with Synozur's branding"
- Server-side PDF generation (puppeteer or pdfkit)
- Branded template with company logo
- Include analysis findings, recommendations, competitor comparison
- Download endpoint for generated reports
**Effort**: Medium

##### 1.4 Web Crawling Service
**Status**: Basic URL fetch exists, no robust crawling
**Spec Requirement**: "Crawl and scrape competitor websites...homepage, about page, product/service pages"
- Background job for website content extraction
- Target key pages: homepage, about, services/products
- Extract text content for AI analysis
- Store crawled content with timestamps
**Effort**: Medium

##### 1.5 Competitor Change Monitoring
**Status**: Activity table exists, no automated detection
**Spec Requirement**: "Daily or weekly schedule...detect significant updates"
- Scheduled job (cron) for periodic crawling
- Diff detection between crawl snapshots
- AI summarization of changes
- Store changes in activity log
**Effort**: Medium

---

#### Priority 2: Important (Required for Launch)

##### 2.1 Email Notification Service
**Status**: Not implemented
**Spec Requirement**: "Notification service for email alerts (trial onboarding, competitor updates)"
- Email service integration (SendGrid/Resend)
- Trial welcome and expiration emails
- Weekly competitor update digest
- Alert emails for significant changes
**Effort**: Medium

##### 2.2 Dark/Light Mode Toggle
**Status**: Dark mode default, no toggle
**Spec Requirement**: "Dark Mode and Light Mode toggle"
- User preference toggle in settings
- Persist preference in user record or localStorage
- CSS variable switching for theme
**Effort**: Low

##### 2.3 Tenant Admin Features
**Status**: Domain Admin exists, limited capabilities
**Spec Requirement**: "Tenant Admin manages organization's account – inviting team members"
- Team invite flow (email invitations)
- User management within tenant (view/remove team members)
- Tenant settings page (branding, integrations)
**Effort**: Medium

##### 2.4 Side-by-Side Messaging Comparison
**Status**: Analysis exists, not side-by-side format
**Spec Requirement**: "Side-by-side analysis of client's website vs each competitor"
- Visual comparison table in UI
- Highlight differences in messaging
- Key themes and positioning extraction
**Effort**: Low-Medium

---

#### Priority 3: Nice to Have (Can Ship Without)

##### 3.1 Marketing Site Enhancements
**Status**: Landing page exists
**Spec Requirement**: "Promotional homepage with screenshots, 'Start Free Trial' CTA"
- Add product screenshots
- Trust badges and testimonials
- Video walkthrough
- Clear 14-day trial messaging

##### 3.2 Expert Review Upsell
**Status**: Not implemented
**Spec Requirement**: "Expert Review CTA for Synozur consultant review"
- In-app CTA to request consultant review
- Contact form or scheduling link
- Messaging about Synozur services

##### 3.3 Recommendation Feedback Loop
**Status**: Not implemented
**Spec Requirement**: "Users can mark recommendations as 'not relevant'"
- Thumbs up/down on recommendations
- AI learning from feedback

---

## Post-MVP Roadmap (Year One)

### Competitive Battlecards (Q1 Post-Launch)
Generate competitive battlecards for sales enablement:
- Critical Capabilities Matrix with Harvey Ball scoring (●○◐◑)
- Qualitative comparison narrative
- Sales challenge questions with responses
- Exportable PDF battlecard

### Real-Time Competitor Alerts (Q1)
- Real-time notifications for competitor changes
- Social media monitoring (LinkedIn)
- Customizable alert preferences
- Weekly digest emails

### CRM Integration - HubSpot (Q2)
- Competitor sync from HubSpot
- Push Orbit insights back to CRM
- Lead generation insights

### Advanced AI Features (Q2-Q3)
- Sentiment and tone analysis
- Multi-language support
- Custom AI tuning with user goals

### Collaboration Features (Q3)
- Shared annotations/comments
- Vega integration (recommendations → tasks)
- Team usage analytics

### Outcome Metrics & ROI Dashboard (Q4)
- Google Analytics integration
- Orbit Score / Index
- Industry benchmarks

### Billing Integration
- Stripe integration for payment processing
- Plan upgrade/downgrade flows
- Usage-based billing