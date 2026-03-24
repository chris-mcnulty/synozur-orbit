# Orbit - Go-to-Market Intelligence Platform

## Overview
Orbit is an AI-driven go-to-market intelligence platform designed to centralize and enhance go-to-market strategies by unifying Competitive Intelligence, Marketing Planning, and Product Management. It functions as a multi-tenant SaaS application with features like role-based access control, advanced competitive analysis, AI-powered insights, and branded PDF reporting. Key capabilities include competitor change monitoring, grounding document management, and company profile baselining. Orbit aims to facilitate a seamless transition "from insight to action in one platform."

## User Preferences
Preferred communication style: Simple, everyday language.

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
- **Build System**: Custom esbuild script.
- **Storage Abstraction**: Drizzle ORM for PostgreSQL.

### Database
- **ORM**: Drizzle ORM (PostgreSQL dialect)
- **Schema**: `shared/schema.ts`
- **Migrations**: Drizzle Kit
- **Validation**: Zod schemas.
- **Key Tables**: `users`, `tenants`, `competitors`, `products`, `activity`, `analysis`, `recommendations`, `battlecards`, `roadmapItems`, `aiUsage`, `intelligenceBriefings`, `organizations`, `supportTickets`, `supportTicketReplies`.

### Authentication & Authorization
- **Authentication**: Session-based with `express-session`, supporting Microsoft Entra ID (OAuth 2.0) and planned Google SSO, with email/password as a fallback.
- **Authorization**: Role hierarchy (Global Admin > Domain Admin > Standard User > Consultant).
- **Provisioning**: Automatic domain-based role assignment for new users; manual assignment for Global Admin and Consultant roles. Consultant role provides cross-tenant read access.

### Core Features
- **Multi-Tenant Architecture**: Tenant isolation, RBAC, tenant-specific plan/usage limits.
- **Service Plans**: Database-driven plans with flexible feature gating.
- **Data Inputs**: Competitor URL management, grounding document upload (PDF, DOCX) with AI context scoping, company profile baselining.
- **AI Analysis**: Competitive website analysis, AI-guided recommendations (RAG), gap analysis.
- **Web Crawling Service**: Multi-page crawling, social media discovery, blog post detection, scheduled background jobs.
- **Competitor Intelligence Dashboard**: Provides insights from AI-summarized website changes, social signals, and activity logs.
- **Intelligence Briefings**: AI-synthesized periodic market intelligence reports, with configurable periods, executive summaries, and action items. Supports branded PDF export and email sharing. Includes data source freshness checks.
- **News Monitoring**: Integration with GNews API for competitor and baseline company news, included in intelligence briefings.
- **Enhanced Change Detection**: Website monitoring with structured AI analysis categorizing changes by type and significance.
- **Campaigns (Social)**: Containers for content assets, social accounts, and generated social posts, with automatic hashtag merging.
- **Email Newsletters**: Standalone tool for generating emails from content assets, with platform, tone, and CTA configuration.
- **Marketing Content Library**: Enterprise-gated content asset management with URL auto-extraction, AI summarization, customizable categories, and flexible tagging.
- **Marketing Brand Library**: Enterprise-gated brand asset management, supporting product cross-linking, customizable categories, and flexible tagging.
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

### Third-Party APIs
- **GNews API**: For news monitoring.
- **Microsoft Graph API**: For Entra ID user provisioning.
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