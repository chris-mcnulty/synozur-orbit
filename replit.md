# Orbit - Go-to-Market Intelligence Platform

## Overview
Orbit is an AI-driven go-to-market intelligence platform designed to centralize and enhance go-to-market strategies by unifying Competitive Intelligence, Marketing Planning, and Product Management. It functions as a multi-tenant SaaS application with features like role-based access control, advanced competitive analysis, AI-powered insights, and branded PDF reporting. Key capabilities include competitor change monitoring, grounding document management, and company profile baselining. Orbit aims to facilitate a seamless transition "from insight to action in one platform."

## User Preferences
Preferred communication style: Simple, everyday language.

## Reference Projects

### Constellation - Synozur Compliance & Document Platform
- **Repository**: `chris-mcnulty/synozur-scdp` (GitHub — accessible via installed GitHub integration)
- **Purpose**: Synozur's compliance/document management platform with working SPE integration
- **Use As Reference For**: SharePoint Embedded file operations, Graph API patterns, Azure AD integration
- **Key file**: `server/services/graph-client.ts` — the working SPE implementation

### Orion - Synozur Maturity Model Platform
- **Repository**: https://github.com/chris-mcnulty/synozur-maturitymodeler
- **Purpose**: Digital maturity modeling AI platform by Synozur
- **Use As Reference For**: UI/UX patterns, feature implementations, admin dashboards, AI usage tracking
- **Note**: When building new features, check Orion for existing patterns to maintain consistency across Synozur platforms.
- **Public GTM Assessment**: https://orion.synozur.com/gtm - Open Go-to-Market Maturity Assessment available for use in outbound emails, page footers, and marketing materials as a lead generation resource.

## System Architecture

### Frontend
- **Framework**: React with TypeScript (Vite)
- **Routing**: Wouter
- **State Management**: TanStack React Query (server state), React Context (authentication)
- **UI Components**: shadcn/ui (Radix UI primitives)
- **Styling**: Tailwind CSS v4 with CSS variables
- **Theme**: Aurora theme from Constellation, characterized by purple-tinted surfaces, Synozur brand colors, 1.3rem radius, and full shadow scale. Includes specific utility classes for navigation and page headers.
- **Font**: Avenir Next LT Pro
- **Structure**: Page-based with distinct public and authenticated layouts.

### Backend
- **Framework**: Express.js with TypeScript
- **API Design**: RESTful JSON API (`/api/` prefix)
- **Session Management**: Express-session (cookie-based)
- **Password Hashing**: bcrypt
- **Build System**: Custom esbuild script for server, Vite for client.
- **Storage Abstraction**: Drizzle ORM for PostgreSQL.

### Database
- **ORM**: Drizzle ORM (PostgreSQL dialect)
- **Schema**: `shared/schema.ts`
- **Migrations**: Drizzle Kit
- **Validation**: Zod schemas.
- **Key Tables**: `users`, `tenants`, `competitors`, `products`, `activity`, `analysis`, `recommendations`, `battlecards`, `roadmapItems`, `aiUsage`, `intelligenceBriefings`, `briefingSubscriptions`, `organizations`, `supportTickets`, `supportTicketReplies`, `personas`.

### Authentication & Authorization
- **Authentication**: Session-based with `express-session`, supporting Microsoft Entra ID (OAuth 2.0) and planned Google SSO, with email/password as a fallback.
- **Authorization**: Role hierarchy (Global Admin > Domain Admin > Standard User > Consultant).
- **Provisioning**: First user from a new domain auto-promoted to Domain Admin. Subsequent users get Standard User. Global Admin and Consultant are privileged roles requiring manual assignment.
- **Consultant Role**: Privileged cross-tenant read role for Synozur platform staff. Can only be assigned by Global Admin, never auto-provisioned during signup.
- **SSO Enhancement**: Azure Tenant ID auto-populated from `tid` token claim on first SSO login.

### Core Features
- **Multi-Tenant Architecture**: Tenant isolation, RBAC, tenant-specific plan/usage limits.
- **Service Plans**: Database-driven plans with flexible feature gating.
- **Data Inputs**: Competitor URL management, grounding document upload (PDF, DOCX) with AI context scoping, company profile baselining.
- **AI Analysis**: Competitive website analysis, AI-guided recommendations (RAG), gap analysis.
- **Web Crawling Service**: Multi-page crawling, social media discovery, blog post detection, scheduled background jobs.
- **Competitor Intelligence Dashboard**: Provides insights from AI-summarized website changes, social signals, and activity logs.
- **Intelligence Briefings**: AI-synthesized periodic market intelligence reports, with configurable periods, executive summaries, and action items. Supports branded PDF export and email sharing. Includes data source freshness checks. Features podcast-style audio summaries (two-host conversational format using OpenAI TTS with echo/nova voices), scheduled weekly auto-generation for enterprise/unlimited tenants, and per-user email subscription management. Plan gating: podcast generation for pro/enterprise/unlimited; scheduled updates and email subscriptions for enterprise/unlimited only.
- **Intelligence Health UX**: Dashboard card showing source/artifact freshness health percentage, "Needs Attention" card surfacing stale sources and outdated artifacts with contextual refresh actions. "Built from data as of" banners on Analysis, Battlecards, GTM Plan, and Messaging Framework pages with inline rebuild buttons. Data Currency badges on Reports list. Refresh Center renamed to "Intelligence Health" and relocated from System nav to Insights group. Utilities in `client/src/lib/staleness.ts` (`checkArtifactFreshness`, `computeIntelligenceHealth`, `formatShortDate`).
- **News Monitoring**: Integration with GNews API for competitor and baseline company news, included in intelligence briefings.
- **Enhanced Change Detection**: Website monitoring with structured AI analysis categorizing changes by type and significance.
- **Campaigns (Social)**: Containers for content assets, social accounts, and generated social posts, with automatic hashtag merging.
- **Email Newsletters**: Standalone tool for generating emails from content assets, with platform, tone, and CTA configuration.
- **Marketing Content Library**: Enterprise-gated content asset management with URL auto-extraction, AI summarization, customizable categories, and flexible tagging.
- **Marketing Brand Library**: Enterprise-gated brand asset management, supporting product cross-linking, customizable categories, and flexible tagging.
- **Persona & ICP Builder**: Pro/Enterprise/Unlimited-gated buyer persona management. AI-assisted persona generation, CSV export, ICP designation. Personas inject audience context into AI-generated emails, social posts, battlecards, and recommendations via `formatPersonaContextForPrompt()`. Routes in `marketing-saturn.ts`, feature key `personaBuilder`.
- **Assessments**: Competitive analysis snapshots with proxy assessment capabilities.
- **Client Projects**: Facilitate product-level competitive analysis for consulting firms.
- **Product Management MVP**: Feature catalog, quarterly roadmap view, AI-powered roadmap recommendations.
- **Report Generation**: Branded PDF reports.
- **CSV Exports**: Export of various data lists.
- **Multi-Market Support**: Enterprise feature for managing multiple client contexts.
- **Cross-Tenant Access**: Global Admins can access all tenants; Consultants can access assigned tenants.
- **Canonical Organization Layer**: Centralizes public company data in the `organizations` table, with URL normalization and a ref-counted lifecycle.
- **Centralized Job Queue**: Priority-based, concurrency-limited job queue for heavy background tasks (PDF generation, crawls, monitors, analysis).
- **PDF Browser Pool**: Singleton Chromium instance for efficient PDF generation.
- **SharePoint Embedded (SPE) Storage**: Tenant-isolated document storage, with admin UI for container management.

## External Dependencies

### Database
- **PostgreSQL**
- **Drizzle ORM**

### AI Services
- **Multi-Provider AI Abstraction**: Supports Replit AI (Anthropic), Replit AI (OpenAI), and Azure AI Foundry via a common interface. Features can be assigned specific models, with fallback mechanisms.
- **AI Features Registry**: 12 defined AI functions (e.g., competitor_analysis, recommendations, intelligence_briefing).

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

### SharePoint Embedded (SPE) Architecture
- **Reference codebase**: `chris-mcnulty/synozur-scdp` (Constellation) on GitHub — accessible via installed GitHub integration.
- **Key file**: `server/services/graph-client.ts` in Constellation contains the working SPE implementation.
- **URL pattern**: File operations MUST resolve the container's drive ID first (`GET /v1.0/storage/fileStorage/containers/{id}/drive`), then use `/drives/{driveId}/...` for ALL file ops. Do NOT use `/storage/fileStorage/containers/{id}/drive/root:...` — that pattern returns 400 errors.
- **API version**: Use `v1.0` for file operations, `beta` only for container type registration.
- **Drive ID caching**: Cached for 5 minutes to avoid repeated resolution calls.

### Third-Party APIs
- **GNews API**: For news monitoring. Do NOT use Bing News Search API.
- **Microsoft Graph API**: For Entra ID user provisioning and SPE file storage.
- **SendGrid**: For email sharing of intelligence briefings.

### Environment Variables
- `DATABASE_URL`
- `SESSION_SECRET`
- AI provider keys
- Microsoft Entra ID specific: `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_TENANT_ID`
- `GNEWS_API_KEY`
- `AZURE_FOUNDRY_OPENAI_ENDPOINT`
- `AZURE_FOUNDRY_API_KEY`
- `ORBIT_SPE_CONTAINER_TYPE_ID`

## Standing Orders

### Changelog & Backlog Maintenance
After completing significant features or bug fixes, update the following files:

1. **changelog.md** - Add entries under `[Unreleased]` section:
   - Group by: Added, Changed, Fixed, Security, Deprecated, Removed
   - Write from user perspective, not technical details
   - Include date when releasing versions

2. **backlog.md** - Update feature status:
   - Mark completed items with `[x]`
   - Update status descriptions for partial progress
   - Add new items under appropriate priority level
   - Move items between priorities as needed

3. **Sync to public folder** - After updates, copy files:
   ```bash
   cp changelog.md public/changelog.md && cp backlog.md public/backlog.md
   ```
   This ensures the About page viewers show current content.

## Backlog

### High Priority
- **Input safety validation**: Pre-validate all user-entered URLs and uploaded data before crawling or processing. Check for malicious URLs, SSRF attempts, private IP ranges, and unsafe file content to protect the platform from security threats.

### Standard Priority
- **Competitor document uploads**: Allow users to upload documents about competitors (whitepapers, case studies, sales collateral, product sheets) to enrich competitive intelligence, similar to company grounding documents
- **Protect manual research in Regenerate All**: Add source === "manual" check to full regeneration service to prevent overwriting manually entered competitor research
- **Headless browser crawling**: Replace HTTP-based crawling with Puppeteer headless browser to bypass bot detection, handle JavaScript-rendered content, and improve crawl success rate for protected sites
- **Consolidated action items**: Dashboard view showing all action items across baseline and projects for a tenant, with ability to assign to users, close, dismiss, or add comments
- **Wire AI usage logging**: Connect logAiUsage() calls to all AI service entry points (competitor analysis, battlecard generation, executive summaries, etc.) to populate the usage tracking dashboard
- **reCAPTCHA for signups**: Add Google reCAPTCHA to new account signup form to prevent bot registrations
- **Google SSO**: Add Google OAuth as alternative to Microsoft Entra ID
- **Per-tenant branding**: Custom logos and colors per tenant
- **Active social/blog monitoring**: Scheduled monitoring of competitor social media accounts and blog posts with configurable check intervals, change detection, and AI-summarized diffs highlighting what changed
- **Visual competitor assets**: Screenshot capture and visual analysis
- **Domain blocklist**: Prevent signups from specific email domains
