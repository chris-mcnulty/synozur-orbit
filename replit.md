# Orbit - Marketing Intelligence Platform

## Overview

Orbit is an AI-driven marketing intelligence platform designed for The Synozur Alliance LLC. Its primary purpose is to analyze a customer's website and positioning documents against competitors, identify messaging gaps, and provide AI-generated recommendations. The platform is a multi-tenant SaaS application featuring role-based access control (RBAC), advanced competitive analysis tools, and branded PDF reporting capabilities. Orbit also offers competitor change monitoring with AI-summarized diffs, a dedicated module for grounding documents, and tenant demographics collection during signup. A key capability is company profile baselining, allowing users to analyze their own website against competitors. The platform emphasizes a dark mode default with Synozur's brand colors.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React with TypeScript (Vite build tool)
- **Routing**: Wouter
- **State Management**: TanStack React Query (server state), React Context (authentication)
- **UI Components**: shadcn/ui (Radix UI primitives)
- **Styling**: Tailwind CSS v4 with CSS variables
- **Font**: Avenir Next LT Pro
- **Structure**: Page-based (`client/src/pages/`) with distinct layouts for public and authenticated sections.

### Backend
- **Framework**: Express.js with TypeScript
- **API Design**: RESTful JSON API (`/api/` prefix)
- **Session Management**: Express-session (cookie-based)
- **Password Hashing**: bcrypt
- **Build System**: Custom esbuild script for server, Vite for client.
- **Storage Abstraction**: Drizzle ORM for PostgreSQL, allowing database interchangeability.

### Database
- **ORM**: Drizzle ORM (PostgreSQL dialect)
- **Schema**: `shared/schema.ts`
- **Migrations**: Drizzle Kit
- **Validation**: Zod schemas from Drizzle.
- **Key Tables**: `users` (RBAC, tenant demographics), `competitors`, `activity`, `recommendations`, `reports`, `analysis`, `groundingDocuments`, `companyProfiles`, `assessments`, `products`, `projectProducts`, `clientProjects`.

### Authentication & Authorization
- **Authentication**: Session-based with `express-session`.
- **SSO**: Microsoft Entra ID (OAuth 2.0 via `@azure/msal-node`) and planned Google SSO.
- **Fallback**: Traditional email/password login for non-SSO users.
- **Authorization**: Role hierarchy (Global Admin > Domain Admin > Standard User > Consultant).
- **Provisioning**: Self-service signup ONLY creates Standard User role. All privileged roles (Global Admin, Domain Admin, Consultant) must be manually assigned by existing Global Admins.
- **Consultant Role**: Privileged cross-tenant read role for Synozur platform staff. Can only be assigned by Global Admin, never auto-provisioned during signup.
- **SSO Enhancement**: Azure Tenant ID auto-populated from `tid` token claim on first SSO login.

### Core Features
- **Multi-Tenant Architecture**: Tenant isolation, role hierarchy, tenant-specific plan/usage limits.
- **Service Plans**: Trial (default for new accounts: 3 competitors, 5 analyses), Free (1 competitor, 1 analysis), Pro, Enterprise. Plans configurable per-tenant with user role limits (adminUserLimit, readWriteUserLimit, readOnlyUserLimit).
- **Data Inputs**: Competitor URL management, grounding document upload (PDF, DOCX), company profile baselining.
- **AI Analysis**: Competitive website analysis (Claude Sonnet), AI-guided recommendations (RAG), gap analysis.
- **Web Crawling Service**: Multi-page crawling (homepage, about, products/services, blog), social media link discovery, blog post detection, scheduled background jobs.
- **Assessments**: Snapshots of competitive analysis with proxy assessment capabilities.
- **Client Projects**: Proxy analysis for consulting firms with company vs company and product vs product analysis types.
- **Product Analysis**: Product-level competitive analysis with baseline product selection, AI-suggested competitor products, and manual competitor additions.
- **Report Generation**: Branded PDF reports that can be scoped to baseline (company profile + all competitors) or specific projects. Project-scoped reports require project owner or Global Admin permissions.

## External Dependencies

### Database
- **PostgreSQL**: Primary database.
- **Drizzle ORM**: Database query builder and schema management.

### AI Services
- **Provider Abstraction**: Supports `MockAIProvider` for development and OpenAI/Azure OpenAI.

### UI Libraries
- **Radix UI**: Headless component primitives.
- **shadcn/ui**: Pre-styled component library.
- **Lucide React**: Icon library.
- **TanStack React Query**: Server state management.

### Development Tools
- **Vite**: Frontend build tool.
- **esbuild**: Server bundling.
- **TypeScript**: Type safety.

### Authentication
- **@azure/msal-node**: Microsoft Entra ID integration.

### Environment Variables
- `DATABASE_URL`
- `SESSION_SECRET`
- AI provider keys (optional)
- Microsoft Entra ID specific: `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_TENANT_ID`

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
- **Consolidated action items**: Dashboard view showing all action items across baseline and projects for a tenant, with ability to assign to users, close, dismiss, or add comments
- **Battlecard PDF export**: Export battlecards as branded PDF documents
- **AI usage tracker**: System-level tracking of AI API usage (tokens, requests, costs) across all tenants with admin dashboard visibility
- **reCAPTCHA for signups**: Add Google reCAPTCHA to new account signup form to prevent bot registrations
- **Google SSO**: Add Google OAuth as alternative to Microsoft Entra ID
- **Per-tenant branding**: Custom logos and colors per tenant
- **Active social/blog monitoring**: Scheduled monitoring of competitor social media accounts and blog posts with configurable check intervals, change detection, and AI-summarized diffs highlighting what changed
- **Visual competitor assets**: Screenshot capture and visual analysis
- **Domain blocklist**: Prevent signups from specific email domains