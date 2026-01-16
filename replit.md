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

### Authentication & Authorization
- Session-based authentication with express-session
- Role hierarchy: Global Admin > Domain Admin > Standard User
- First registered user becomes Global Admin
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