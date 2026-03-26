import type { Request } from "express";
import { storage, type ContextFilter } from "../storage";
import { type RequestContext } from "../context";
import { calculateEstimatedCost } from "../services/ai-pricing";
import { z } from "zod";

export async function logAiUsage(
  ctx: { tenantDomain: string; marketId: string; userId: string },
  operation: string,
  provider: string,
  model: string,
  usage: { input_tokens?: number; output_tokens?: number } | undefined,
  durationMs?: number
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
    });
  } catch (error) {
    console.error("Failed to log AI usage:", error);
  }
}

export function hasCrossTenantReadAccess(role: string): boolean {
  return role === "Global Admin" || role === "Consultant";
}

export function hasAdminAccess(role: string): boolean {
  return role === "Global Admin" || role === "Domain Admin";
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
  if (companyProfile?.lastCrawledAt) dates.push(new Date(companyProfile.lastCrawledAt).getTime());
  for (const c of competitors) {
    if (c.lastCrawledAt) dates.push(new Date(c.lastCrawledAt).getTime());
    if ((c as any).socialLastFetchedAt) dates.push(new Date((c as any).socialLastFetchedAt).getTime());
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
});

export const grantConsultantAccessSchema = z.object({
  consultantUserId: z.string().uuid("Invalid user ID format"),
});
