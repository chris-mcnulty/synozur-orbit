import type { Request, Response } from "express";
import { storage, type ContextFilter } from "../storage";
import { getRequestContext, ContextError } from "../context";
import { type RequestContext } from "../context";
import {
  checkFeatureAccessAsync,
  checkCompetitorLimitAsync,
  checkAnalysisLimitAsync,
  getTenantCompetitorCount,
  getMonthlyAnalysisCount,
  type ManualActionKey,
  resolveEffectivePlan,
} from "../services/plan-policy";
import { reserveManualAction } from "../services/manual-action-quota";
import { calculateEstimatedCost } from "../services/ai-pricing";
import { z } from "zod";

export async function logAiUsage(
  ctx: { tenantDomain: string; marketId: string; userId: string },
  operation: string,
  provider: string,
  model: string,
  usage: { input_tokens?: number; output_tokens?: number } | undefined,
  durationMs?: number,
  metadata?: Record<string, unknown>,
) {
  try {
    const inputTokens = usage?.input_tokens || 0;
    const outputTokens = usage?.output_tokens || 0;
    const estimatedCost = calculateEstimatedCost(model, inputTokens, outputTokens, provider);

    await storage.logAiUsage({
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      userId: ctx.userId,
      provider,
      model,
      operation,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCost,
      durationMs: durationMs || null,
      ...(metadata ? { metadata } : {}),
    });
  } catch (error) {
    console.error("Failed to log AI usage:", error);
  }
}

export function hasCrossTenantReadAccess(role: string): boolean {
  return role === "Global Admin" || role === "Consultant";
}

// Gates tenant-admin operations: user management, billing, SSO, tenant config, OAuth credentials.
// Only Domain Admin and Global Admin should reach these routes.
export function hasAdminAccess(role: string): boolean {
  return role === "Global Admin" || role === "Domain Admin";
}

// Gates content-authoring and intelligence-building operations: creating/editing markets,
// competitors, products, personas; running analyses; generating briefings; managing SEO keywords;
// triggering rebuilds; excluding flagged crawls; promoting product feedback.
// Analyst, Domain Admin, and Global Admin all pass this check.
export function hasContentAccess(role: string): boolean {
  return role === "Global Admin" || role === "Domain Admin" || role === "Analyst";
}

export function toContextFilter(ctx: RequestContext): ContextFilter {
  return {
    tenantId: ctx.tenantId,
    marketId: ctx.marketId,
    tenantDomain: ctx.tenantDomain,
    isDefaultMarket: ctx.isDefaultMarket,
  };
}

export async function computeLatestSourceDataTimestamp(ctx: RequestContext): Promise<Date | null> {
  const ctxFilter = toContextFilter(ctx);
  const companyProfile = await storage.getCompanyProfileByContext(ctxFilter);
  const competitors = await storage.getCompetitorsByContext(ctxFilter);
  const dates: number[] = [];
  if (companyProfile?.lastFullCrawl) dates.push(new Date(companyProfile.lastFullCrawl).getTime());
  for (const c of competitors) {
    if (c.lastFullCrawl) dates.push(new Date(c.lastFullCrawl).getTime());
    if (c.lastSocialCrawl) dates.push(new Date(c.lastSocialCrawl).getTime());
  }
  return dates.length > 0 ? new Date(Math.max(...dates)) : null;
}

export function validateResourceContext(
  resource: { tenantDomain?: string | null; marketId?: string | null },
  ctx: RequestContext
): boolean {
  if (resource.tenantDomain && resource.tenantDomain !== ctx.tenantDomain) {
    return false;
  }
  if (resource.marketId && resource.marketId !== ctx.marketId) {
    return false;
  }
  if (!resource.marketId && !ctx.isDefaultMarket) {
    return false;
  }
  return true;
}

export function parseManualResearch(content: string, entityName: string): any {
  const knownHeaders = [
    "Company Summary", "Summary", "Overview",
    "Company Profile",
    "Value Proposition", "Main Value Proposition",
    "Target Audience", "Target Market",
    "Key Messages", "Main Messages",
    "Keywords", "Themes", "Keywords/Themes",
    "Tone", "Brand Voice",
    "Strengths", "Weaknesses"
  ];
  
  const headerPattern = knownHeaders.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  
  const extractSection = (content: string, header: string): string => {
    const escapedHeader = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`\\*\\*${escapedHeader}[:\\s]*\\*\\*[:\\s]*([\\s\\S]*?)(?=\\*\\*(?:${headerPattern})[:\\s]*\\*\\*|$)`, 'i'),
      new RegExp(`^${escapedHeader}[:\\s]+([\\s\\S]*?)(?=\\n(?:${headerPattern})[:\\s]|$)`, 'im'),
      new RegExp(`##?\\s*${escapedHeader}[:\\s]*([\\s\\S]*?)(?=##?\\s*(?:${headerPattern})|$)`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1]?.trim()) {
        let result = match[1].trim();
        result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
        return result;
      }
    }
    return "";
  };

  const extractList = (content: string, header: string): string[] => {
    const section = extractSection(content, header);
    if (!section) return [];
    
    const items = section.split(/\n/).filter(line => {
      const trimmed = line.trim();
      return trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.match(/^\d+\./);
    }).map(line => line.replace(/^[-•\d.]+\s*/, '').trim()).filter(Boolean);
    
    return items.length > 0 ? items : section.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  };

  const summary = extractSection(content, "Company Summary") || 
                  extractSection(content, "Summary") ||
                  extractSection(content, "Overview") ||
                  `${entityName} - Intelligence gathered via manual AI research`;

  const valueProposition = extractSection(content, "Value Proposition") ||
                           extractSection(content, "Main Value Proposition");

  const targetAudience = extractSection(content, "Target Audience") ||
                         extractSection(content, "Target Market");

  const keyMessages = extractList(content, "Key Messages") ||
                      extractList(content, "Main Messages");

  const keywords = extractSection(content, "Keywords") ||
                   extractSection(content, "Themes");
  const keywordsList = keywords ? keywords.split(/[,\n]/).map(k => k.replace(/^[-•]\s*/, '').trim()).filter(Boolean) : [];

  const tone = extractSection(content, "Tone") ||
               extractSection(content, "Brand Voice");

  const strengths = extractList(content, "Strengths");
  const weaknesses = extractList(content, "Weaknesses");

  const companyProfileSection = extractSection(content, "Company Profile");
  const extractProfileField = (fieldName: string): string => {
    const patterns = [
      new RegExp(`[-•]\\s*${fieldName}[:\\s]+([^\\n]+)`, 'i'),
      new RegExp(`${fieldName}[:\\s]+([^\\n]+)`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = companyProfileSection.match(pattern);
      if (match && match[1]?.trim()) {
        return match[1].trim();
      }
    }
    return "";
  };

  const headquarters = extractProfileField("Headquarters");
  const founded = extractProfileField("Founded");
  const employeeCount = extractProfileField("Employee Count") || extractProfileField("Employees");
  const revenue = extractProfileField("Revenue");
  const fundingRaised = extractProfileField("Funding Raised") || extractProfileField("Funding");

  return {
    summary: summary.substring(0, 500),
    valueProposition: valueProposition.substring(0, 500),
    targetAudience: targetAudience.substring(0, 500),
    keyMessages: keyMessages.slice(0, 5),
    keywords: keywordsList.slice(0, 10),
    tone: tone.substring(0, 200),
    strengths: strengths.slice(0, 5),
    weaknesses: weaknesses.slice(0, 5),
    rawContent: content.substring(0, 5000),
    companyProfile: {
      headquarters,
      founded,
      employeeCount,
      revenue,
      fundingRaised,
    },
  };
}

export const switchTenantSchema = z.object({
  tenantId: z.string().uuid("Invalid tenant ID format"),
});

export const switchMarketSchema = z.object({
  marketId: z.string().uuid("Invalid market ID format"),
});

export const createMarketSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  description: z.string().max(500).optional(),
});

export const updateMarketSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
});

export const grantConsultantAccessSchema = z.object({
  consultantUserId: z.string().uuid("Invalid user ID format"),
});

export async function guardFeature(
  req: Request,
  res: Response,
  feature: string
): Promise<boolean> {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  try {
    const ctx = await getRequestContext(req);
    const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
    const plan = tenant ? resolveEffectivePlan(tenant) : "free";
    const gate = await checkFeatureAccessAsync(plan, feature);
    if (!gate.allowed) {
      res.status(403).json({
        error: gate.reason,
        upgradeRequired: gate.upgradeRequired,
        requiredPlan: gate.requiredPlan,
      });
      return false;
    }
    return true;
  } catch (err: any) {
    if (err instanceof ContextError) {
      res.status(err.status).json({ error: err.message });
    } else if (err && typeof err === "object" && "status" in err) {
      const status = (err as any).status as number;
      res.status(status).json({ error: status === 401 ? "Not authenticated" : status === 403 ? "Forbidden" : "Request failed" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
    return false;
  }
}

export async function guardCompetitorLimit(
  req: Request,
  res: Response,
  options: { skipForProject?: boolean } = {}
): Promise<boolean> {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  try {
    const ctx = await getRequestContext(req);
    if (options.skipForProject) return true;

    const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
    const plan = tenant ? resolveEffectivePlan(tenant) : "free";

    const currentCount = await getTenantCompetitorCount(ctx.tenantDomain);
    const gate = await checkCompetitorLimitAsync(plan, currentCount);
    if (!gate.allowed) {
      res.status(403).json({
        error: gate.reason,
        upgradeRequired: true,
        requiredPlan: gate.requiredPlan,
        currentUsage: gate.currentUsage,
        limit: gate.limit,
      });
      return false;
    }
    return true;
  } catch (err: any) {
    if (err instanceof ContextError) {
      res.status(err.status).json({ error: err.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
    return false;
  }
}

/**
 * Guard a cost-driving manual action against the tenant's monthly quota.
 *
 * Atomically reserves a slot (advisory-locked, transactional) before any work
 * runs and registers a `res` finish/close listener that commits the reservation
 * as succeeded only if the response status is 2xx/3xx. Failed/4xx/5xx
 * responses are recorded as `succeeded=false` so they neither count toward the
 * quota nor pollute audit data.
 *
 * Callers should still validate resource ownership before invoking this guard
 * where practical (it is cheap enough that ordering is not strictly required
 * for correctness, but earlier validation gives cleaner audit logs).
 */
export async function guardManualAction(
  req: Request,
  res: Response,
  action: ManualActionKey,
): Promise<boolean> {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  try {
    const ctx = await getRequestContext(req);
    const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
    const plan = tenant?.plan ?? "free";
    const result = await reserveManualAction(ctx.tenantDomain, plan, action, ctx.userId);
    if (!result.ok) {
      res.status(403).json({
        error: result.reason,
        upgradeRequired: result.upgradeRequired,
        requiredPlan: result.requiredPlan,
        currentUsage: result.used,
        limit: result.limit,
        manualAction: action,
      });
      return false;
    }

    // Auto-finalize when the response completes. We use both `finish` and
    // `close` to handle aborted connections, and a one-shot guard to avoid
    // double-commits.
    let finalized = false;
    const finalize = (ev: "finish" | "close") => {
      if (finalized) return;
      finalized = true;
      const status = res.statusCode || 0;
      // close fires before finish on aborted requests; treat aborts as failure
      const succeeded = ev === "finish" && status >= 200 && status < 400;
      void result.commit(succeeded);
    };
    res.once("finish", () => finalize("finish"));
    res.once("close", () => finalize("close"));
    return true;
  } catch (err: any) {
    if (err instanceof ContextError) {
      res.status(err.status).json({ error: err.message });
    } else {
      console.error(`[guardManualAction] Unexpected error for action=${action}:`, err);
      res.status(500).json({ error: "Internal server error" });
    }
    return false;
  }
}

export async function guardAnalysisLimit(req: Request, res: Response): Promise<boolean> {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  try {
    const ctx = await getRequestContext(req);
    const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
    const plan = tenant ? resolveEffectivePlan(tenant) : "free";

    const monthlyCount = await getMonthlyAnalysisCount(ctx.tenantDomain);
    const gate = await checkAnalysisLimitAsync(plan, monthlyCount);
    if (!gate.allowed) {
      res.status(403).json({
        error: gate.reason,
        upgradeRequired: true,
        requiredPlan: gate.requiredPlan,
        currentUsage: gate.currentUsage,
        limit: gate.limit,
      });
      return false;
    }
    return true;
  } catch (err: any) {
    if (err instanceof ContextError) {
      res.status(err.status).json({ error: err.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
    return false;
  }
}
