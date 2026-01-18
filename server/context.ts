import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";

export interface RequestContext {
  userId: string;
  tenantId: string;
  marketId: string;
  userRole: string;
  tenantDomain: string;
}

export class ContextError extends Error {
  status: number;
  constructor(message: string, status: number = 403) {
    super(message);
    this.status = status;
    this.name = "ContextError";
  }
}

export async function getRequestContext(req: Request): Promise<RequestContext> {
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

  let activeTenantId = req.session.activeTenantId;
  let activeMarketId = req.session.activeMarketId;

  if (!activeTenantId) {
    activeTenantId = userTenant.id;
    req.session.activeTenantId = activeTenantId;
  }

  const activeTenant = await storage.getTenant(activeTenantId);
  if (!activeTenant) {
    activeTenantId = userTenant.id;
    req.session.activeTenantId = activeTenantId;
  }

  const hasAccess = await validateTenantAccess(userId, user.role, userTenant.id, activeTenantId);
  if (!hasAccess) {
    activeTenantId = userTenant.id;
    req.session.activeTenantId = activeTenantId;
    req.session.activeMarketId = undefined;
  }

  if (!activeMarketId) {
    const defaultMarket = await storage.getDefaultMarket(activeTenantId);
    if (defaultMarket) {
      activeMarketId = defaultMarket.id;
      req.session.activeMarketId = activeMarketId;
    }
  } else {
    const marketValid = await storage.validateMarketBelongsToTenant(activeMarketId, activeTenantId);
    if (!marketValid) {
      const defaultMarket = await storage.getDefaultMarket(activeTenantId);
      activeMarketId = defaultMarket?.id || "";
      req.session.activeMarketId = activeMarketId;
    }
  }

  const finalTenant = await storage.getTenant(activeTenantId);
  
  return {
    userId,
    tenantId: activeTenantId,
    marketId: activeMarketId || "",
    userRole: user.role,
    tenantDomain: finalTenant?.domain || userDomain,
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
