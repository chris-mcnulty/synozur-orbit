import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { db } from "./db";
import { oauthAccessTokens } from "@shared/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

async function ensureDefaultMarket(tenantId: string, userId: string) {
  let defaultMarket = await storage.getDefaultMarket(tenantId);
  if (!defaultMarket) {
    const tenant = await storage.getTenant(tenantId);
    defaultMarket = await storage.createMarket({
      tenantId,
      name: "Default",
      description: `Default market for ${tenant?.name || "organization"}`,
      isDefault: true,
      status: "active",
      createdBy: userId,
    });
  }
  return defaultMarket;
}

export interface RequestContext {
  userId: string;
  tenantId: string;
  marketId: string;
  userRole: string;
  tenantDomain: string;
  isDefaultMarket: boolean;
  // Set when the request is authenticated via an OAuth bearer token (partner API)
  tokenScopes?: string[];
  tokenId?: string;
  oauthClientId?: string;
  isPartnerApi?: boolean;
}

export class ContextError extends Error {
  status: number;
  constructor(message: string, status: number = 403) {
    super(message);
    this.status = status;
    this.name = "ContextError";
  }
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Read the active tenant id from the per-tab header (X-Active-Tenant-Id) if
 * present, falling back to the session-stored value. Use this in any context
 * helper / bootstrap endpoint that previously read req.session.activeTenantId
 * directly so all routes agree on this tab's active tenant. The full
 * authorization check still happens in getRequestContext — this helper is for
 * places that need the id before going through that flow (e.g. /api/markets
 * returning the activeMarketId, /api/context, etc).
 */
export function getActiveTenantId(req: Request): string | undefined {
  const h = req.headers["x-active-tenant-id"];
  const headerVal = Array.isArray(h) ? h[0] : h;
  return headerVal || req.session?.activeTenantId;
}

export function getActiveMarketId(req: Request): string | undefined {
  const h = req.headers["x-active-market-id"];
  const headerVal = Array.isArray(h) ? h[0] : h;
  return headerVal || req.session?.activeMarketId;
}

/** True when the request explicitly carries per-tab context headers. */
export function hasTabContextHeaders(req: Request): boolean {
  return !!(req.headers["x-active-tenant-id"] || req.headers["x-active-market-id"]);
}

function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

async function buildContextFromBearer(req: Request): Promise<RequestContext | null> {
  const token = extractBearerToken(req);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const [row] = await db
    .select()
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.tokenHash, tokenHash));
  if (!row) {
    throw new ContextError("Invalid bearer token", 401);
  }
  if (row.revokedAt) {
    throw new ContextError("Token revoked", 401);
  }
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) {
    throw new ContextError("Token expired", 401);
  }

  const user = await storage.getUser(row.userId);
  if (!user) throw new ContextError("Token user not found", 401);

  const tenant = await storage.getTenantByDomain(row.tenantDomain);
  if (!tenant) throw new ContextError("Tenant not found", 403);

  // Resolve the market the consent was granted against. Fall back to the
  // tenant's default market only when the token has no stored market_id
  // (legacy tokens issued before the column existed).
  let marketId = row.marketId || "";
  let isDefaultMarket = false;
  const defaultMarket = await storage.getDefaultMarket(tenant.id);

  if (marketId) {
    const valid = await storage.validateMarketBelongsToTenant(marketId, tenant.id);
    if (!valid) {
      // Market was deleted or no longer belongs to the tenant → fail closed.
      throw new ContextError("Token market no longer accessible", 403);
    }
    isDefaultMarket = defaultMarket?.id === marketId;
  } else {
    const fallback = defaultMarket || (await ensureDefaultMarket(tenant.id, row.userId));
    marketId = fallback.id;
    isDefaultMarket = true;
  }

  // Update last_used_at non-blocking
  db.update(oauthAccessTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(oauthAccessTokens.id, row.id))
    .catch(() => {});

  return {
    userId: row.userId,
    tenantId: tenant.id,
    marketId,
    userRole: user.role,
    tenantDomain: tenant.domain || row.tenantDomain,
    isDefaultMarket,
    tokenScopes: row.scopes || [],
    tokenId: row.id,
    oauthClientId: row.clientId,
    isPartnerApi: true,
  };
}

export async function getRequestContext(req: Request): Promise<RequestContext> {
  // Bearer token authentication (partner API). When an Authorization: Bearer
  // header is present we honor it regardless of any session cookie that may
  // also be attached, so partner clients always get a partner-API context.
  if ((req.headers.authorization || "").toLowerCase().startsWith("bearer ")) {
    const ctx = await buildContextFromBearer(req);
    if (ctx) return ctx;
  }

  const userId = req.session?.userId;
  if (!userId) {
    throw new ContextError("Not authenticated", 401);
  }

  const user = await storage.getUser(userId);
  if (!user) {
    throw new ContextError("User not found", 401);
  }

  const userDomain = user.email.split("@")[1];
  const userTenant = await storage.getTenantByDomain(userDomain);

  if (!userTenant) {
    throw new ContextError("User tenant not found", 403);
  }

  // Per-tab context: prefer headers sent by the client (sessionStorage-backed,
  // so each browser tab carries its own active tenant/market). Fall back to the
  // session-stored values only when no headers are sent. CRITICAL: when headers
  // ARE provided, never write back to req.session — that would let one tab's
  // active context leak into other tabs of the same browser.
  const headerTenantRaw = req.headers["x-active-tenant-id"];
  const headerMarketRaw = req.headers["x-active-market-id"];
  const headerTenantId = Array.isArray(headerTenantRaw) ? headerTenantRaw[0] : headerTenantRaw;
  const headerMarketId = Array.isArray(headerMarketRaw) ? headerMarketRaw[0] : headerMarketRaw;
  const usingHeaderContext = !!(headerTenantId || headerMarketId);

  let activeTenantId = headerTenantId || req.session.activeTenantId;
  let activeMarketId = headerMarketId || req.session.activeMarketId;

  if (!activeTenantId) {
    activeTenantId = userTenant.id;
    if (!usingHeaderContext) req.session.activeTenantId = activeTenantId;
  }

  const activeTenant = await storage.getTenant(activeTenantId);
  if (!activeTenant) {
    if (usingHeaderContext) {
      throw new ContextError("Requested tenant not found", 403);
    }
    activeTenantId = userTenant.id;
    req.session.activeTenantId = activeTenantId;
  }

  const hasAccess = await validateTenantAccess(userId, user.role, userTenant.id, activeTenantId);
  if (!hasAccess) {
    if (usingHeaderContext) {
      // Fail closed — do not silently fall back to a different tenant when the
      // client explicitly asked for one it can't access.
      throw new ContextError("Access denied for requested tenant", 403);
    }
    activeTenantId = userTenant.id;
    req.session.activeTenantId = activeTenantId;
    req.session.activeMarketId = undefined;
    activeMarketId = undefined;
  }

  if (!activeMarketId) {
    const defaultMarket = await ensureDefaultMarket(activeTenantId, userId);
    activeMarketId = defaultMarket.id;
    if (!usingHeaderContext) req.session.activeMarketId = activeMarketId;
  } else {
    const marketValid = await storage.validateMarketBelongsToTenant(activeMarketId, activeTenantId);
    if (!marketValid) {
      if (usingHeaderContext) {
        throw new ContextError("Requested market does not belong to tenant", 403);
      }
      const defaultMarket = await ensureDefaultMarket(activeTenantId, userId);
      activeMarketId = defaultMarket.id;
      req.session.activeMarketId = activeMarketId;
    }
  }

  const finalTenant = await storage.getTenant(activeTenantId);

  const defaultMarket = await storage.getDefaultMarket(activeTenantId);
  const isDefaultMarket = defaultMarket?.id === activeMarketId;

  return {
    userId,
    tenantId: activeTenantId,
    marketId: activeMarketId || "",
    userRole: user.role,
    tenantDomain: finalTenant?.domain || userDomain,
    isDefaultMarket,
  };
}

async function validateTenantAccess(
  userId: string,
  userRole: string,
  userTenantId: string,
  targetTenantId: string
): Promise<boolean> {
  if (userTenantId === targetTenantId) {
    return true;
  }

  if (userRole === "Global Admin") {
    return true;
  }

  if (userRole === "Consultant") {
    const access = await storage.getActiveConsultantAccess(userId, targetTenantId);
    return !!access;
  }

  return false;
}

export async function requireContext(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const context = await getRequestContext(req);
    (req as any).context = context;
    next();
  } catch (error) {
    if (error instanceof ContextError) {
      res.status(error.status).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

export function getContext(req: Request): RequestContext {
  const context = (req as any).context as RequestContext;
  if (!context) {
    throw new ContextError("Context not initialized");
  }
  return context;
}

export async function validateResourceAccess(
  context: RequestContext,
  resourceTenantId: string | null,
  resourceMarketId: string | null
): Promise<boolean> {
  if (!resourceTenantId) {
    return true;
  }

  if (resourceTenantId !== context.tenantId) {
    return false;
  }

  if (resourceMarketId && resourceMarketId !== context.marketId) {
    return false;
  }

  return true;
}
