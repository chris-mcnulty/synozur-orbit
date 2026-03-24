/**
 * Strategic Context Service
 *
 * Assembles cross-feature intelligence context for AI-powered content generation.
 * Used by social post generation, email generation, marketing task generation,
 * and other features that benefit from competitive intelligence grounding.
 *
 * Phases:
 *  1. Messaging framework → content generation prompts
 *  2. Competitive intelligence (battlecards, analysis) → content generation
 *  3. GTM plan → campaign & email generation
 *  4. Intelligence briefing action items → actionable context
 */

import { storage, type ContextFilter } from "../storage";

export interface StrategicContext {
  messagingFramework: string;
  competitiveIntelligence: string;
  gtmPlanSummary: string;
  briefingActionItems: string;
  recommendations: string;
}

/**
 * Loads the messaging framework for a tenant context.
 * Checks baseline company profile first (most common), falls back to project-level.
 */
async function loadMessagingFramework(ctx: ContextFilter): Promise<string> {
  const companyProfile = await storage.getCompanyProfileByContext(ctx);
  if (!companyProfile) return "";

  const rec = await storage.getLongFormRecommendationByType(
    "messaging_framework",
    undefined,
    companyProfile.id,
  );
  if (!rec || rec.status !== "generated" || !rec.content) return "";

  // Extract key sections: positioning statement, value prop, messaging pillars, tone
  const content = rec.content;
  const sections: string[] = [];

  const posMatch = content.match(/## Brand Positioning Statement\s*\n([\s\S]*?)(?=\n## |\n# |$)/i);
  if (posMatch) sections.push(`Positioning: ${posMatch[1].trim().substring(0, 500)}`);

  const valueMatch = content.match(/## Core Value Proposition\s*\n([\s\S]*?)(?=\n## |\n# |$)/i);
  if (valueMatch) sections.push(`Value Proposition: ${valueMatch[1].trim().substring(0, 400)}`);

  const pillarsMatch = content.match(/## Messaging Pillars\s*\n([\s\S]*?)(?=\n## |\n# |$)/i);
  if (pillarsMatch) sections.push(`Messaging Pillars: ${pillarsMatch[1].trim().substring(0, 600)}`);

  const toneMatch = content.match(/## Tone of Voice Guidelines\s*\n([\s\S]*?)(?=\n## |\n# |$)/i);
  if (toneMatch) sections.push(`Tone of Voice: ${toneMatch[1].trim().substring(0, 400)}`);

  const dosMatch = content.match(/## Messaging Do['']s and Don['']ts\s*\n([\s\S]*?)(?=\n## |\n# |$)/i);
  if (dosMatch) sections.push(`Messaging Guidelines: ${dosMatch[1].trim().substring(0, 400)}`);

  if (sections.length === 0) {
    // Fallback: use first 1500 chars of the full content
    return content.substring(0, 1500);
  }

  return sections.join("\n\n");
}

/**
 * Loads competitive intelligence from battlecards and competitor analysis.
 */
async function loadCompetitiveIntelligence(ctx: ContextFilter): Promise<string> {
  const parts: string[] = [];

  // Load battlecards
  const battlecards = await storage.getBattlecardsByContext(ctx);
  const publishedCards = battlecards.filter(b => b.status === "published");

  if (publishedCards.length > 0) {
    const cardSummaries = publishedCards.slice(0, 5).map(card => {
      const lines: string[] = [];
      const strengths = card.strengths as string[] | null;
      const weaknesses = card.weaknesses as string[] | null;
      const advantages = card.ourAdvantages as string[] | null;

      if (strengths?.length) lines.push(`  Strengths: ${strengths.slice(0, 3).join(", ")}`);
      if (weaknesses?.length) lines.push(`  Weaknesses: ${weaknesses.slice(0, 3).join(", ")}`);
      if (advantages?.length) lines.push(`  Our Advantages: ${advantages.slice(0, 3).join(", ")}`);

      return lines.length > 0 ? `- Competitor (battlecard):\n${lines.join("\n")}` : null;
    }).filter(Boolean);

    if (cardSummaries.length > 0) {
      parts.push(`Competitive Battlecards:\n${cardSummaries.join("\n")}`);
    }
  }

  // Load latest analysis themes/gaps
  const analysis = await storage.getLatestAnalysisByContext(ctx);
  if (analysis) {
    const themes = analysis.themes as any;
    const gaps = analysis.gaps as any;

    if (Array.isArray(themes) && themes.length > 0) {
      const themeText = themes.slice(0, 3).map((t: any) =>
        typeof t === "string" ? t : (t.title || t.name || JSON.stringify(t))
      ).join("; ");
      parts.push(`Market Themes: ${themeText}`);
    }

    if (Array.isArray(gaps) && gaps.length > 0) {
      const gapText = gaps.slice(0, 3).map((g: any) =>
        typeof g === "string" ? g : (g.title || g.name || JSON.stringify(g))
      ).join("; ");
      parts.push(`Competitive Gaps: ${gapText}`);
    }
  }

  return parts.join("\n\n");
}

/**
 * Loads the GTM plan summary for a tenant context.
 */
async function loadGtmPlanSummary(ctx: ContextFilter): Promise<string> {
  const companyProfile = await storage.getCompanyProfileByContext(ctx);
  if (!companyProfile) return "";

  const rec = await storage.getLongFormRecommendationByType(
    "gtm_plan",
    undefined,
    companyProfile.id,
  );
  if (!rec || rec.status !== "generated" || !rec.content) return "";

  // Extract key sections
  const content = rec.content;
  const sections: string[] = [];

  const execMatch = content.match(/## Executive Summary\s*\n([\s\S]*?)(?=\n## |\n# |$)/i);
  if (execMatch) sections.push(`Executive Summary: ${execMatch[1].trim().substring(0, 500)}`);

  const valueMatch = content.match(/## Value Proposition & Positioning\s*\n([\s\S]*?)(?=\n## |\n# |$)/i);
  if (valueMatch) sections.push(`Value Proposition: ${valueMatch[1].trim().substring(0, 400)}`);

  const tacticsMatch = content.match(/## Marketing Tactics\s*\n([\s\S]*?)(?=\n## |\n# |$)/i);
  if (tacticsMatch) sections.push(`Marketing Tactics: ${tacticsMatch[1].trim().substring(0, 500)}`);

  if (sections.length === 0) {
    return content.substring(0, 1500);
  }

  return sections.join("\n\n");
}

/**
 * Loads recent briefing action items.
 */
async function loadBriefingActionItems(
  tenantDomain: string,
  marketId?: string,
): Promise<string> {
  const briefing = await storage.getLatestBriefingForTenant(tenantDomain, marketId);
  if (!briefing || briefing.status !== "published") return "";

  const data = briefing.briefingData as any;
  if (!data?.actionItems || !Array.isArray(data.actionItems)) return "";

  const urgent = data.actionItems
    .filter((item: any) => item.urgency === "immediate" || item.urgency === "this_week")
    .slice(0, 5);

  if (urgent.length === 0) return "";

  return urgent
    .map((item: any) => `- [${item.urgency}] ${item.title}: ${item.description?.substring(0, 200) || ""}`)
    .join("\n");
}

/**
 * Loads active strategic recommendations.
 */
async function loadRecommendations(ctx: ContextFilter): Promise<string> {
  const recs = await storage.getRecommendationsByContext(ctx);
  const active = recs
    .filter((r: any) => r.status !== "dismissed")
    .sort((a: any, b: any) => (b.isPriority ? 1 : 0) - (a.isPriority ? 1 : 0))
    .slice(0, 8);

  if (active.length === 0) return "";

  return active
    .map((r: any) => `- [${r.area}${r.isPriority ? ", PRIORITY" : ""}] ${r.title}: ${r.description?.substring(0, 150) || ""}`)
    .join("\n");
}

/**
 * Main entry point: assemble the full strategic context for a tenant+market.
 * Each section is loaded independently; missing data is simply omitted.
 */
export async function loadStrategicContext(
  tenantDomain: string,
  marketId?: string,
  isDefaultMarket?: boolean,
): Promise<StrategicContext> {
  // Resolve tenantId from domain for ContextFilter compatibility
  const tenant = await storage.getTenantByDomain(tenantDomain);
  const tenantId = tenant?.id || "";
  const resolvedIsDefaultMarket =
    typeof isDefaultMarket === "boolean" ? isDefaultMarket : !marketId;
  const ctx: ContextFilter = {
    tenantId,
    tenantDomain,
    marketId: marketId || "",
    isDefaultMarket: resolvedIsDefaultMarket,
  };

  const results = await Promise.allSettled([
    loadMessagingFramework(ctx),
    loadCompetitiveIntelligence(ctx),
    loadGtmPlanSummary(ctx),
    loadBriefingActionItems(tenantDomain, marketId),
    loadRecommendations(ctx),
  ]);

  const messagingFramework =
    results[0].status === "fulfilled" ? results[0].value : "";
  const competitiveIntelligence =
    results[1].status === "fulfilled" ? results[1].value : "";
  const gtmPlanSummary =
    results[2].status === "fulfilled" ? results[2].value : "";
  const briefingActionItems =
    results[3].status === "fulfilled" ? results[3].value : "";
  const recommendations =
    results[4].status === "fulfilled" ? results[4].value : "";
  return { messagingFramework, competitiveIntelligence, gtmPlanSummary, briefingActionItems, recommendations };
}

/**
 * Formats the strategic context into prompt sections for AI content generation.
 * Only includes sections that have data.
 */
export function formatStrategicContextForPrompt(sc: StrategicContext): string {
  const sections: string[] = [];

  if (sc.messagingFramework) {
    sections.push(`## Messaging & Positioning Framework\nFollow these messaging guidelines when crafting content. Match the tone, vocabulary, and positioning described below:\n${sc.messagingFramework}`);
  }

  if (sc.competitiveIntelligence) {
    sections.push(`## Competitive Intelligence\nUse these competitive insights to differentiate and strengthen messaging:\n${sc.competitiveIntelligence}`);
  }

  if (sc.gtmPlanSummary) {
    sections.push(`## Go-To-Market Strategy\nAlign content with these strategic priorities:\n${sc.gtmPlanSummary}`);
  }

  if (sc.recommendations) {
    sections.push(`## Strategic Recommendations\nConsider these active recommendations when crafting content:\n${sc.recommendations}`);
  }

  if (sc.briefingActionItems) {
    sections.push(`## Recent Intelligence Action Items\nAddress these urgent competitive intelligence findings where relevant:\n${sc.briefingActionItems}`);
  }

  return sections.join("\n\n");
}
