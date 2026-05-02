# Orbit - Go-to-Market Intelligence Platform

## Overview
Orbit is an AI-driven go-to-market intelligence platform designed to centralize and enhance go-to-market strategies by unifying Competitive Intelligence, Marketing Planning, and Product Management. It functions as a multi-tenant SaaS application with features like role-based access control, advanced competitive analysis, AI-powered insights, and branded PDF reporting. Orbit aims to facilitate a seamless transition "from insight to action in one platform."

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
- **Multi-Tenant Architecture**: Tenant isolation, RBAC, tenant-specific plan/usage limits.
- **CRITICAL — Tenant Data Boundary Protection**: Every API route, database query, and background job MUST enforce tenant isolation by filtering on `tenantDomain`. Never allow data from one tenant to leak to another. All new endpoints must include `tenantDomain` checks (via `getRequestContext` or equivalent). All storage queries must scope to the requesting tenant. Cross-tenant access is only permitted for the Consultant role (read-only) and Global Admin. This is a non-negotiable security requirement — violations can expose customer data.
- **Service Plans**: Database-driven plans with flexible feature gating. All premium API routes enforced server-side via `guardFeature()` helper in `server/routes/helpers.ts`, using `plan-policy.ts` FEATURE_REGISTRY as single source of truth. Returns 403 with `upgradeRequired: true` when blocked. Frontend auto-intercepts upgrade-required errors via `UpgradeModalProvider` (global query/mutation error interception).
- **Authorization**: Role hierarchy (Global Admin > Domain Admin > Standard User > Consultant).
- **Canonical Organization Layer**: Centralizes public company data in the `organizations` table with URL normalization.
- **Centralized Job Queue**: Priority-based, concurrency-limited for heavy background tasks (PDF generation, crawls, monitors, analysis).

### Frontend
- **Framework**: React with TypeScript (Vite)
- **State Management**: TanStack React Query (server state), React Context (authentication)
- **UI Components**: shadcn/ui (Radix UI primitives)
- **Styling**: Tailwind CSS v4 with CSS variables
- **Theme**: Aurora theme (purple-tinted, Synozur brand colors, 1.3rem radius, full shadow scale).
- **Font**: Avenir Next LT Pro

### Backend
- **Framework**: Express.js with TypeScript
- **API Design**: RESTful JSON API (`/api/` prefix)
- **Session Management**: Express-session (cookie-based)
- **Storage Abstraction**: Drizzle ORM for PostgreSQL.
- **Route Organization**: Domain-focused modules under `server/routes/`.

### Database
- **ORM**: Drizzle ORM (PostgreSQL dialect)
- **Schema**: `shared/schema.ts`
- **Migrations**: Drizzle Kit
- **Validation**: Zod schemas.

### Authentication & Authorization
- **Authentication**: Session-based with `express-session`, supporting Microsoft Entra ID (OAuth 2.0) and email/password fallback.
- **Provisioning**: First user from a new domain auto-promoted to Domain Admin.
- **Consultant Role**: Privileged cross-tenant read role for Synozur platform staff.

### Key Features
- **Data Inputs**: Competitor URL management, grounding document upload (PDF, DOCX) with AI context scoping, company profile baselining.
- **AI Analysis**: Competitive website analysis, AI-guided recommendations (RAG), gap analysis.
- **Web Crawling Service**: Multi-page crawling, social media discovery, blog post detection, scheduled background jobs.
- **Competitor Intelligence Dashboard**: Insights from AI-summarized website changes, social signals, and activity logs.
- **Intelligence Briefings**: AI-synthesized periodic market intelligence reports with configurable periods, executive summaries, action items, branded PDF export, email sharing, and podcast-style audio summaries.
- **Intelligence Health UX**: Dashboard card for source/artifact freshness, "Needs Attention" for stale sources, "Built from data as of" banners with inline rebuild buttons.
- **News Monitoring**: Integration with GNews API for competitor and baseline company news.
- **Enhanced Change Detection**: Website monitoring with structured AI analysis.
- **Campaigns (Social)**: Containers for content assets, social accounts, and generated social posts, with manual post creation and scheduling.
- **Email Newsletters**: Standalone tool for generating emails from content assets.
- **Marketing Content Library**: Enterprise-gated asset management with AI summarization, categories, tagging, and crawl-based asset suggestions (pages discovered during baseline web crawl are flagged as candidates).
- **Marketing Brand Library**: Enterprise-gated brand asset management with product cross-linking, categories, and tagging.
- **UTM Builder & Link Tracking**: Tenant-scoped tracked short links with UTM parameters. `/r/:slug` redirects record clicks (bot-filtered, daily-rotating IP hash). Link Builder UI on campaigns; Performance tab on Marketing index with sparklines and CSV export. Optional opt-in to wrap outbound URLs in generated social posts and emails.
- **Persona & ICP Builder**: Pro/Enterprise/Unlimited-gated buyer persona management with AI-assisted generation.
- **Assessments**: Competitive analysis snapshots with proxy assessment capabilities.
- **Client Projects**: Facilitate product-level competitive analysis for consulting firms.
- **Product Management MVP**: Feature catalog, quarterly roadmap view, AI-powered roadmap recommendations.
- **Customer Feedback & Voting** (Pro/Enterprise/Unlimited): Per-product feedback intake with internal upvoting, status workflow (New / Planned / Shipped / Declined), admin promotion of popular ideas to product features, AI-powered "group similar items" duplicate detection, and an optional tokenized public feedback URL (`/feedback/:token`) protected by math captcha + honeypot + IP rate limiting.
- **Report Generation**: Branded PDF reports and CSV exports.
- **Multi-Market Support**: Enterprise feature for managing multiple client contexts. Markets support B2B (default) or B2C business type, which adjusts Orbit Score weighting — B2C prioritizes social engagement (Instagram) over innovation/content depth.
- **PDF Browser Pool**: Singleton Chromium instance for efficient PDF generation.
- **SharePoint Embedded (SPE) Storage**: Tenant-isolated document storage with admin UI.

## External Dependencies

### Database
- **PostgreSQL**
- **Drizzle ORM**

### AI Services
- **Multi-Provider AI Abstraction**: Supports Replit AI (Anthropic), Replit AI (OpenAI), and Azure AI Foundry.
- **AI Features Registry**: 12 defined AI functions.

### UI Libraries
- **Radix UI**
- **shadcn/ui**
- **Lucide React**
- **TanStack React Query**

### Development Tools
- **Vite**
- **esbuild**
- **TypeScript**

### Authentication
- **@azure/msal-node** (Microsoft Entra ID)

### Security Utilities
- **URL Validation**: SSRF protection, private IP blocking, protocol validation.
- **File Validation**: Magic bytes verification, dangerous content pattern scanning, size limits.

### Third-Party APIs
- **GNews API**: For news monitoring.
- **Microsoft Graph API**: For Entra ID user provisioning and SPE file storage.
- **SendGrid**: For email sharing of intelligence briefings.