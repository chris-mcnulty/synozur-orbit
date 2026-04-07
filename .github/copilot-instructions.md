# Copilot Cloud Agent Instructions — Orbit (Synozur)

> **Master source of truth**: `replit.md` in the repo root. Always read it first. This file supplements it with operational guidance for the agent.

---

## Project Overview

**Orbit** is a multi-tenant SaaS Go-to-Market intelligence platform built with a unified TypeScript monorepo (React frontend + Express backend). It provides Competitive Intelligence, Marketing Planning, Product Management, and AI-powered insights for B2B/B2C companies.

---

## Repository Layout

```
/
├── client/          # React + Vite frontend (TypeScript)
│   └── src/
│       ├── App.tsx          # Top-level router (wouter)
│       ├── pages/           # Route-level page components
│       │   └── app/         # Authenticated app pages
│       ├── components/      # Shared UI components (shadcn/ui + custom)
│       ├── hooks/           # Custom React hooks
│       ├── lib/             # Utilities, queryClient, userContext
│       └── index.css        # Tailwind v4 CSS-first theme tokens (@theme inline)
├── server/          # Express.js backend (TypeScript)
│   ├── index.ts             # Entry point, session setup, startup migrations
│   ├── routes.ts            # Registers all route modules
│   ├── routes/              # Domain-scoped route modules (one file per domain)
│   │   └── helpers.ts       # guardFeature(), toContextFilter(), hasAdminAccess()
│   ├── context.ts           # getRequestContext(), RequestContext interface
│   ├── storage.ts           # Data access layer (all DB queries via Drizzle ORM)
│   ├── db.ts                # Drizzle client + pg Pool
│   ├── ai-service.ts        # AI provider abstraction
│   └── services/            # Background services (job queue, crawlers, PDF, etc.)
│       └── plan-policy.ts   # FEATURE_REGISTRY + checkFeatureAccessAsync()
├── shared/
│   └── schema.ts            # Drizzle ORM schema (canonical DB source of truth)
├── migrations/              # Drizzle Kit migration files
├── scripts/                 # Build + utility scripts
├── docs/                    # Architecture & implementation docs
├── replit.md                # ⭐ Master project reference
├── backlog.md               # Feature backlog
├── changelog.md             # Version history
├── package.json             # Single package.json (monorepo — no workspaces)
├── tsconfig.json            # Unified TypeScript config
├── vite.config.ts           # Vite config (client build, path aliases)
└── drizzle.config.ts        # Drizzle Kit config (schema → migrations)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 19 + TypeScript (Vite 7) |
| Routing (client) | wouter |
| Server state | TanStack React Query v5 |
| UI components | shadcn/ui (Radix UI primitives) |
| Styling | Tailwind CSS v4 — **CSS-first config** via `@theme inline` in `client/src/index.css` (no `tailwind.config.*`) |
| Theme | Aurora (purple-tinted, Synozur brand, dark default) |
| Backend | Express.js + TypeScript |
| ORM | Drizzle ORM (PostgreSQL dialect) |
| Database | PostgreSQL 16 |
| Session store | express-session → Redis (if `REDIS_URL` set) or PostgreSQL (`user_sessions` table) |
| Authentication | Session-based; Microsoft Entra ID (MSAL) + email/password fallback |
| AI providers | Anthropic Claude, OpenAI, Azure AI Foundry (abstracted in `server/ai-service.ts`) |
| Job queue | Custom priority queue in `server/services/job-queue.ts` |
| PDF generation | Puppeteer (singleton Chromium pool in `server/services/pdf-browser-pool.ts`) |
| File storage | Object storage (GCS/S3) + SharePoint Embedded (SPE) |
| Email | SendGrid |
| News | GNews API |

---

## Development Commands

```bash
# Run full dev server (Express + Vite HMR) on port 5000
npm run dev

# Type-check only (no emit)
npm run check

# Production build (esbuild server + Vite client → dist/)
npm run build

# Start production build
npm start

# Apply schema changes to DB (Drizzle push — dev only)
npm run db:push
```

> **There are no automated tests in this repo.** Do not attempt to run a test suite. Validate changes manually or by running `npm run check` for type errors.

---

## Required Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required at startup) |
| `SESSION_SECRET` | Express session secret |
| `REDIS_URL` | Optional — enables Redis session store |
| `OPENAI_API_KEY` | OpenAI API access |
| `ANTHROPIC_API_KEY` | Anthropic Claude API access |
| `AZURE_AI_*` | Azure AI Foundry credentials |
| `SENDGRID_API_KEY` | Email delivery |
| `GNEWS_API_KEY` | News monitoring |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT_ID` | Entra ID SSO + SPE |

---

## Key Architectural Patterns

### Multi-Tenant Context
Every authenticated API request resolves a `RequestContext` (`server/context.ts`):
```ts
interface RequestContext {
  userId: string;
  tenantId: string;
  marketId: string;         // Active market UUID
  userRole: string;         // "Global Admin" | "Domain Admin" | "Standard User" | "Consultant"
  tenantDomain: string;
  isDefaultMarket: boolean; // true when activeMarket === tenant's default market
}
```
- Call `getRequestContext(req)` to obtain the context in route handlers.
- Use `toContextFilter(ctx)` (`server/routes/helpers.ts`) to create a `ContextFilter` for storage queries.
- **Critical**: `isDefaultMarket` is derived from `defaultMarket.id === activeMarketId`, **not** from whether `marketId` is present.

### Feature Gating
- All premium features are gated server-side via `guardFeature(req, res, featureKey)` in `server/routes/helpers.ts`.
- Feature keys are defined in `FEATURE_REGISTRY` in `server/services/plan-policy.ts`.
- Returns `403` with `{ upgradeRequired: true }` when blocked.
- Frontend intercepts upgrade errors globally via `UpgradeModalProvider`.
- Use `PageFeatureGate` component to gate entire pages on the client.

### Route Organisation
- Routes are split into domain-focused modules under `server/routes/`.
- All modules are registered via `registerRoutes()` in `server/routes.ts`.
- Every route module imports `getRequestContext` or `getContext` for auth/context.

### Database Access
- **All** DB queries go through `server/storage.ts` — never call `db` directly from routes.
- Schema lives in `shared/schema.ts` (Drizzle ORM table definitions + Zod types).
- Schema changes: edit `shared/schema.ts`, then run `npm run db:push` (or generate a migration with `drizzle-kit generate`).
- Startup migrations for additive column/table changes are in `server/index.ts` (inline `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` pattern — used for backward compatibility).

### Path Aliases (TypeScript)
```
@/*        → client/src/*
@shared/*  → shared/*
@assets/*  → attached_assets/*
```

### AI Service
- Use `server/ai-service.ts` for all AI calls — it provides a unified interface across Anthropic, OpenAI, and Azure AI Foundry.
- Log AI usage with `logAiUsage()` from `server/routes/helpers.ts` after every AI call.

### Role Hierarchy
`Global Admin` > `Domain Admin` > `Standard User` > `Consultant`
- `Consultant`: cross-tenant read-only access (Synozur staff).
- Use `hasAdminAccess(role)` and `hasCrossTenantReadAccess(role)` helpers.

---

## Plan Tiers
`free` → `pro` → `enterprise` → `unlimited`  
Feature access is database-driven per tenant plan. The `DEFAULT_PLAN_FEATURES` map in `server/services/plan-policy.ts` defines defaults; tenant-specific overrides are stored in the `service_plan_features` table.

---

## Styling Conventions
- Tailwind CSS v4 with **no** `tailwind.config.*` file — all theme customisation is in `client/src/index.css` under `@theme inline`.
- Use CSS custom properties (`--color-primary`, `--radius`, etc.) for brand tokens.
- shadcn/ui component variants use `class-variance-authority` (cva).
- Dark mode is the default (`defaultTheme="dark"` in `ThemeProvider`).

---

## Common Gotchas & Workarounds

1. **Puppeteer / Chromium**: The `.replit` config installs `chromium` via Nix. In non-Replit environments, ensure Chromium is available or set `PUPPETEER_EXECUTABLE_PATH`. The PDF browser pool (`server/services/pdf-browser-pool.ts`) manages a singleton instance.

2. **Session store fallback**: If `REDIS_URL` is absent, sessions fall back to PostgreSQL (`user_sessions` table, auto-created). This is expected in development.

3. **Startup migrations**: `server/index.ts` runs `ALTER TABLE … ADD COLUMN IF NOT EXISTS` on startup for schema additions that predate Drizzle migrations. These are safe to re-run.

4. **`DATABASE_URL` required at import time**: Both `server/db.ts` and `drizzle.config.ts` throw immediately if `DATABASE_URL` is unset. Always provision the database before running any server or migration command.

5. **No test suite**: `npm run check` (TypeScript) is the only automated validation. Always run it after changes.

6. **ESM-only package**: `"type": "module"` in `package.json` — use `.ts` extensions and ESM-style imports throughout.

7. **Market context for storage queries**: Pass `isDefaultMarket: true` only when the active market is actually the tenant's default market. Storage queries use this flag to include legacy rows with `NULL marketId`.

---

## Errors Encountered & Workarounds

_Document any errors found during agent sessions below (append, do not overwrite):_

<!-- Example format:
- **[Date] Error**: `Cannot find module '@shared/schema'` during `npm run check`
  **Cause**: TypeScript paths not resolved in certain editors.
  **Fix**: Run from repo root; ensure `tsconfig.json` `baseUrl` is `.`.
-->
