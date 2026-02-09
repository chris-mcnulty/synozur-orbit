# Orbit - Go-to-Market Intelligence Platform

## Overview

Orbit is an AI-driven go-to-market intelligence platform developed for The Synozur Alliance LLC. Its primary purpose is to centralize and enhance go-to-market strategies by unifying Competitive Intelligence, Marketing Planning, and Product Management. The platform is designed as a multi-tenant SaaS application with robust features like role-based access control (RBAC), advanced competitive analysis, AI-powered insights, and branded PDF reporting. Key capabilities include competitor change monitoring, grounding document management, and company profile baselining for self-analysis against competitors. Orbit aims to transition users "from insight to action in one platform."

## User Preferences

Preferred communication style: Simple, everyday language.

### Testing
- **Test Login**: Auth page is at `/auth` (not `/login`). Test credentials: email=`test@synozur.com`, password=`TestPass123!`
- **Auth Form Test IDs**: `input-signin-email`, `input-signin-password`, `button-signin`
- After login, user is redirected to `/app`.

## System Architecture

### Frontend
- **Framework**: React with TypeScript (Vite)
- **Routing**: Wouter
- **State Management**: TanStack React Query (server state), React Context (authentication)
- **UI Components**: shadcn/ui (Radix UI primitives)
- **Styling**: Tailwind CSS v4 with CSS variables
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
- **Key Tables**: Focus on `users`, `tenants`, `competitors`, `products`, `activity`, `analysis`, `recommendations`, `battlecards`, `roadmapItems`, and `aiUsage`.

### Authentication & Authorization
- **Authentication**: Session-based with `express-session`.
- **SSO**: Microsoft Entra ID (OAuth 2.0 via `@azure/msal-node`) and planned Google SSO. Traditional email/password login as fallback.
- **Authorization**: Role hierarchy (Global Admin > Domain Admin > Standard User > Consultant).
- **Provisioning**: First user from a new domain becomes Domain Admin; subsequent users are Standard Users. Global Admin and Consultant roles are manually assigned. Consultant role provides cross-tenant read access for Synozur staff. Entra ID user provisioning via Microsoft Graph API is supported.

### Core Features
- **Multi-Tenant Architecture**: Tenant isolation, RBAC, tenant-specific plan/usage limits.
- **Service Plans**: Database-driven plans (Trial, Free, Pro, Enterprise, Unlimited) with flexible feature gating via a JSONB `features` column and a central Feature Registry (`server/services/plan-policy.ts`). Includes a 60-day trial system with automated email reminders.
- **Data Inputs**: Competitor URL management, grounding document upload (PDF, DOCX), company profile baselining.
- **AI Analysis**: Competitive website analysis, AI-guided recommendations (RAG), gap analysis.
- **Web Crawling Service**: Multi-page crawling, social media link discovery, blog post detection, scheduled background jobs.
- **Competitor Intelligence Dashboard**: Provides insights from AI-summarized website changes, social signals, blog activity, and a raw activity log.
- **Assessments**: Competitive analysis snapshots with proxy assessment capabilities.
- **Client Projects**: Facilitate product-level competitive analysis against competitor products, supporting proxy analysis for consulting firms.
- **Product Management MVP**: Feature catalog, quarterly roadmap view with effort sizing, AI-powered roadmap recommendations based on competitive intelligence.
- **Report Generation**: Branded PDF reports scoped to baseline or specific products.
- **CSV Exports**: Export various lists (Gap Analysis, Recommendations, Product Features, Roadmap Items, AI Recommendations) to CSV.
- **Multi-Market Support**: Enterprise feature allowing tenants to manage multiple client contexts (markets) with separate baselines, competitors, and projects.
- **Cross-Tenant Access**: Global Admins can access all tenants; Consultants can access assigned tenants.

## External Dependencies

### Database
- **PostgreSQL**
- **Drizzle ORM**

### AI Services
- **OpenAI/Azure OpenAI** (via provider abstraction)

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

### Environment Variables
- `DATABASE_URL`
- `SESSION_SECRET`
- AI provider keys
- Microsoft Entra ID specific: `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_TENANT_ID`