/**
 * Versioned Partner API (`/api/v1/...`) — Task #96.
 *
 * All routes require:
 *   - `Authorization: Bearer <access_token>` (partner-API context)
 *   - The token must hold the route's `requireScope`
 *   - The tenant's plan must include the `partnerApi` feature
 *
 * Tenant isolation is preserved by reusing the same context-scoped storage
 * methods the web app uses.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { getRequestContext, ContextError, type RequestContext } from "../context";
import { db } from "../db";
import {
  contentAssets,
  brandAssets,
  campaigns,
  generatedPosts,
  PARTNER_API_SCOPES,
  PARTNER_API_SCOPE_LABELS,
} from "@shared/schema";
import { eq, and, ne, desc } from "drizzle-orm";
import { checkFeatureAccessAsync } from "../services/plan-policy";
import { checkRateLimit, logApiAccess, hashToken } from "../services/oauth-service";
import { oauthAccessTokens } from "@shared/schema";
import { toContextFilter } from "./helpers";
import {
  parsePaginationParams,
  buildPaginatedEnvelope,
  type PaginatedEnvelope,
} from "../utils/pagination";

// ─── Pagination + search helpers ──────────────────────────────────────────
//
// The partner API reuses the shared envelope shipped in Task #64
// (`server/utils/pagination.ts`) so the response shape and query params
// (`page`, `pageSize`, `q`) match the rest of Orbit's REST surface. When the
// caller does not supply `?page=`, the legacy bare-array shape is returned,
// matching existing web-route behavior.

function paginate<T>(
  rows: T[],
  req: Request,
  searchFields: string[] = []
): PaginatedEnvelope<T> | T[] {
  const params = parsePaginationParams(req);
  let filtered = rows;
  if (params.q && searchFields.length) {
    const needle = params.q.toLowerCase();
    filtered = rows.filter((r) => {
      const obj = r as Record<string, unknown>;
      return searchFields.some((f) => String(obj[f] ?? "").toLowerCase().includes(needle));
    });
  }
  if (!params.isPaginated) {
    return filtered;
  }
  const total = filtered.length;
  const items = filtered.slice(params.offset, params.offset + params.limit);
  return buildPaginatedEnvelope(items, total, params);
}

// ─── Auth + scope guard middleware ─────────────────────────────────────────

interface PartnerRequest extends Request {
  ctx?: RequestContext;
}

/**
 * Best-effort lookup of the bearer token row from the Authorization header so
 * we can audit failures (invalid/expired/revoked tokens, plan rejections,
 * 429s) with as much identity context as possible.
 */
async function lookupTokenForAudit(req: Request) {
  const auth = req.headers.authorization || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  try {
    const [row] = await db
      .select()
      .from(oauthAccessTokens)
      .where(eq(oauthAccessTokens.tokenHash, hashToken(token)));
    return row || null;
  } catch {
    return null;
  }
}

/**
 * Attach an audit listener to `res.on("finish")` BEFORE auth runs so that
 * every outcome — including 401 (invalid token), 403 (insufficient scope or
 * plan), and 429 (rate-limited) — is recorded.
 */
function attachAuditListener(req: PartnerRequest, res: Response, scope: string) {
  let logged = false;
  const log = async () => {
    if (logged) return;
    logged = true;
    const ctx = req.ctx;
    let tokenId = ctx?.tokenId;
    let clientId = ctx?.oauthClientId;
    let userId = ctx?.userId;
    let tenantDomain = ctx?.tenantDomain;
    if (!tokenId) {
      const fallback = await lookupTokenForAudit(req);
      if (fallback) {
        tokenId = fallback.id;
        clientId = fallback.clientId;
        userId = fallback.userId;
        tenantDomain = fallback.tenantDomain;
      }
    }
    await logApiAccess({
      tokenId,
      clientId,
      userId,
      tenantDomain,
      route: req.path,
      method: req.method,
      status: res.statusCode,
      scope,
    });
  };
  res.on("finish", () => {
    log().catch(() => {});
  });
  res.on("close", () => {
    log().catch(() => {});
  });
}

async function partnerAuth(
  req: PartnerRequest,
  res: Response,
  scope: string
): Promise<RequestContext | null> {
  let ctx: RequestContext;
  try {
    ctx = await getRequestContext(req);
  } catch (err: any) {
    const status = err instanceof ContextError ? err.status : 401;
    res.setHeader("WWW-Authenticate", `Bearer error="invalid_token"`);
    res.status(status).json({ error: "invalid_token", error_description: err.message });
    return null;
  }
  if (!ctx.isPartnerApi) {
    res.setHeader("WWW-Authenticate", `Bearer realm="Orbit Partner API"`);
    res.status(401).json({ error: "invalid_token", error_description: "Bearer token required" });
    return null;
  }
  // Plan gate
  const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
  const plan = tenant?.plan ?? "free";
  const gate = await checkFeatureAccessAsync(plan, "partnerApi");
  if (!gate.allowed) {
    res.status(403).json({
      error: "plan_upgrade_required",
      error_description: gate.reason,
      required_plan: gate.requiredPlan,
    });
    return null;
  }
  // Rate limit per token
  if (ctx.tokenId) {
    const rl = checkRateLimit(ctx.tokenId);
    res.setHeader("X-RateLimit-Limit", "120");
    res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.floor(rl.resetAt / 1000)));
    if (!rl.allowed) {
      res.status(429).json({ error: "rate_limit_exceeded", retry_after_ms: rl.resetAt - Date.now() });
      return null;
    }
  }
  // Scope check (after auth so audit can attribute the failure to a token)
  if (!(ctx.tokenScopes || []).includes(scope)) {
    res.setHeader(
      "WWW-Authenticate",
      `Bearer error="insufficient_scope", scope="${scope}"`
    );
    res.status(403).json({ error: "insufficient_scope", required_scope: scope });
    return null;
  }
  return ctx;
}

function requireScope(scope: string) {
  return async (req: PartnerRequest, res: Response, next: NextFunction) => {
    // Attach audit FIRST so 401/403/429 are all logged on response finish.
    attachAuditListener(req, res, scope);
    const ctx = await partnerAuth(req, res, scope);
    if (!ctx) return;
    req.ctx = ctx;
    next();
  };
}

// ─── OpenAPI spec ──────────────────────────────────────────────────────────

function buildOpenApiSpec(origin: string) {
  const scopeNames = PARTNER_API_SCOPES;
  const securitySchemes = {
    OAuth2: {
      type: "oauth2",
      flows: {
        authorizationCode: {
          authorizationUrl: `${origin}/oauth/authorize`,
          tokenUrl: `${origin}/oauth/token`,
          refreshUrl: `${origin}/oauth/token`,
          scopes: Object.fromEntries(
            scopeNames.map((s) => [s, (PARTNER_API_SCOPE_LABELS as Record<string, string>)[s] || s])
          ),
        },
      },
    },
  };

  const paths: Record<string, any> = {};
  const endpoints: { path: string; scope: string; summary: string }[] = [
    { path: "/api/v1/battlecards", scope: "read:battlecards", summary: "List battlecards visible to the user" },
    { path: "/api/v1/briefings", scope: "read:briefings", summary: "List intelligence briefings" },
    { path: "/api/v1/personas", scope: "read:personas", summary: "List buyer personas" },
    { path: "/api/v1/roadmap", scope: "read:roadmap", summary: "List roadmap items" },
    { path: "/api/v1/content-library", scope: "read:content-library", summary: "List content library entries" },
    { path: "/api/v1/brand-library", scope: "read:brand-library", summary: "List brand library assets" },
    { path: "/api/v1/campaigns", scope: "read:campaigns", summary: "List campaigns" },
    { path: "/api/v1/reports", scope: "read:reports", summary: "List generated reports" },
    { path: "/api/v1/posts", scope: "read:posts", summary: "List AI-generated social posts" },
  ];
  const paginationParameters = [
    {
      name: "page",
      in: "query",
      required: false,
      description:
        "1-based page number. When omitted the response is a bare array (legacy compatibility); when supplied the response is a `{ items, total, hasMore, page, pageSize }` envelope (matches the rest of Orbit's REST surface).",
      schema: { type: "integer", minimum: 1 },
    },
    {
      name: "pageSize",
      in: "query",
      required: false,
      description: "Items per page. Defaults to 25, capped at 100.",
      schema: { type: "integer", minimum: 1, maximum: 100 },
    },
    {
      name: "q",
      in: "query",
      required: false,
      description: "Optional case-insensitive substring search across the resource's text fields.",
      schema: { type: "string", maxLength: 200 },
    },
  ];
  for (const ep of endpoints) {
    paths[ep.path] = {
      get: {
        summary: ep.summary,
        parameters: paginationParameters,
        security: [{ OAuth2: [ep.scope] }],
        responses: {
          "200": { description: "OK" },
          "401": { description: "Missing or invalid token" },
          "403": { description: "Insufficient scope or plan" },
          "429": { description: "Rate limit exceeded" },
        },
      },
    };
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "Orbit Partner API",
      version: "1.0.0",
      description:
        "Read-only partner API for third-party portals (Galaxy and others). Tokens are obtained via the Authorization Code + PKCE flow on Orbit's OAuth 2.0 endpoints.",
    },
    servers: [{ url: origin }],
    components: { securitySchemes },
    security: [{ OAuth2: [] }],
    paths,
  };
}

// ─── Register routes ──────────────────────────────────────────────────────

/**
 * CORS for `/api/v1/*`. The partner API authenticates via bearer tokens
 * (no cookies are read), so a permissive same-origin-reflecting CORS policy
 * is safe and is required for browser-based public-client / PKCE usage.
 */
function applyPartnerCors(req: Request, res: Response): boolean {
  const origin = req.headers.origin as string | undefined;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  else res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

export function registerPartnerApiRoutes(app: Express) {
  app.use("/api/v1", (req, res, next) => {
    if (applyPartnerCors(req, res)) return;
    next();
  });

  // OpenAPI spec is served anonymously so partner developers can discover
  // the API without first obtaining a token. The spec only describes the
  // public contract (paths, scopes, OAuth endpoints) — no tenant data.
  app.get("/api/v1/openapi.json", async (req, res) => {
    const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
    const host = req.headers.host || "localhost";
    res.json(buildOpenApiSpec(`${proto}://${host}`));
  });

  // Battlecards
  app.get("/api/v1/battlecards", requireScope("read:battlecards"), async (req: PartnerRequest, res) => {
    const rows = await storage.getBattlecardsByContext(toContextFilter(req.ctx!));
    res.json(paginate(rows, req, ["title", "name"]));
  });

  // Intelligence briefings — pull the full tenant/market dataset (no implicit
  // 200-row pre-cap) so partner pagination operates on the complete set.
  app.get("/api/v1/briefings", requireScope("read:briefings"), async (req: PartnerRequest, res) => {
    const rows = await storage.getIntelligenceBriefingsByTenant(
      req.ctx!.tenantDomain,
      Number.MAX_SAFE_INTEGER,
      req.ctx!.marketId,
    );
    res.json(paginate(rows, req, ["title", "summary"]));
  });

  // Personas
  app.get("/api/v1/personas", requireScope("read:personas"), async (req: PartnerRequest, res) => {
    const rows = await storage.getPersonasByContext(toContextFilter(req.ctx!));
    res.json(paginate(rows, req, ["name", "title", "industry"]));
  });

  // Roadmap
  app.get("/api/v1/roadmap", requireScope("read:roadmap"), async (req: PartnerRequest, res) => {
    const rows = await storage.getRoadmapItemsByContext(toContextFilter(req.ctx!));
    res.json(paginate(rows, req, ["title", "description", "status"]));
  });

  // Content library — mirrors the web route's default visibility filter:
  // archived assets are excluded (the web UI hides them by default).
  app.get("/api/v1/content-library", requireScope("read:content-library"), async (req: PartnerRequest, res) => {
    const ctx = req.ctx!;
    const rows = await db
      .select()
      .from(contentAssets)
      .where(
        and(
          eq(contentAssets.tenantDomain, ctx.tenantDomain),
          eq(contentAssets.marketId, ctx.marketId),
          ne(contentAssets.status, "archived"),
        ),
      )
      .orderBy(desc(contentAssets.createdAt));
    res.json(paginate(rows, req, ["title", "description"]));
  });

  // Brand library — same archived-exclusion semantics as the web route.
  app.get("/api/v1/brand-library", requireScope("read:brand-library"), async (req: PartnerRequest, res) => {
    const ctx = req.ctx!;
    const rows = await db
      .select()
      .from(brandAssets)
      .where(
        and(
          eq(brandAssets.tenantDomain, ctx.tenantDomain),
          eq(brandAssets.marketId, ctx.marketId),
          ne(brandAssets.status, "archived"),
        ),
      )
      .orderBy(desc(brandAssets.createdAt));
    res.json(paginate(rows, req, ["name", "description"]));
  });

  // Campaigns — mirrors the web route, which excludes soft-deleted records.
  app.get("/api/v1/campaigns", requireScope("read:campaigns"), async (req: PartnerRequest, res) => {
    const ctx = req.ctx!;
    const rows = await db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.tenantDomain, ctx.tenantDomain),
          eq(campaigns.marketId, ctx.marketId),
          ne(campaigns.status, "deleted"),
        ),
      )
      .orderBy(desc(campaigns.createdAt));
    res.json(paginate(rows, req, ["name", "description", "status"]));
  });

  // Reports
  app.get("/api/v1/reports", requireScope("read:reports"), async (req: PartnerRequest, res) => {
    const rows = await storage.getReportsByContext(toContextFilter(req.ctx!));
    res.json(paginate(rows, req, ["title", "summary"]));
  });

  // Generated posts — joined through campaigns so we can scope by marketId
  // (generated_posts has tenantDomain but no marketId of its own).
  app.get("/api/v1/posts", requireScope("read:posts"), async (req: PartnerRequest, res) => {
    const ctx = req.ctx!;
    const joined = await db
      .select({ post: generatedPosts })
      .from(generatedPosts)
      .innerJoin(campaigns, eq(generatedPosts.campaignId, campaigns.id))
      .where(
        and(
          eq(generatedPosts.tenantDomain, ctx.tenantDomain),
          eq(campaigns.tenantDomain, ctx.tenantDomain),
          eq(campaigns.marketId, ctx.marketId),
          ne(campaigns.status, "deleted"),
        ),
      )
      .orderBy(desc(generatedPosts.createdAt));
    const rows = joined.map((j) => j.post);
    res.json(paginate(rows, req, ["content", "platform"]));
  });
}
