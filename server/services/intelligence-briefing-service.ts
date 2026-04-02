import { storage, type ContextFilter } from "../storage";
import Anthropic from "@anthropic-ai/sdk";
import type { Activity, Competitor, CompanyProfile, IntelligenceBriefing } from "@shared/schema";
import { fetchCompetitorNews, buildNewsSummary, type NewsArticle } from "./news-service";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

export interface BriefingTheme {
  title: string;
  description: string;
  competitors: string[];
  significance: "high" | "medium" | "low";
}

export interface CompetitorMovement {
  name: string;
  signals: string[];
  interpretation: string;
  threatLevel: "high" | "medium" | "low" | "none";
}

export interface ActionItem {
  title: string;
  description: string;
  urgency: "immediate" | "this_week" | "this_month" | "watch";
  category: "messaging" | "product" | "marketing" | "pricing" | "strategy" | "content";
  relatedCompetitors: string[];
}

export interface RiskAlert {
  title: string;
  description: string;
  severity: "critical" | "warning" | "watch";
  source: string;
}

export interface NewsArticleBrief {
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string;
  matchedEntity: string;
}

export interface BriefingData {
  executiveSummary: string;
  keyThemes: BriefingTheme[];
  competitorMovements: CompetitorMovement[];
  actionItems: ActionItem[];
  riskAlerts: RiskAlert[];
  signalDigest: {
    totalSignals: number;
    byType: Record<string, number>;
    byImpact: Record<string, number>;
    highlights: string[];
  };
  newsArticles: NewsArticleBrief[];
  periodLabel: string;
  generatedAt: string;
}

function stripBaselineFromBriefing(parsed: any, baselineName?: string): { movements: any[]; themes: any[] } {
  let movements = Array.isArray(parsed.competitorMovements) ? parsed.competitorMovements : [];
  let themes = Array.isArray(parsed.keyThemes) ? parsed.keyThemes : [];
  if (baselineName) {
    const baselineLower = baselineName.toLowerCase();
    movements = movements.filter(
      (m: any) => m.name?.toLowerCase() !== baselineLower
    );
    themes = themes.map((t: any) => ({
      ...t,
      competitors: Array.isArray(t.competitors)
        ? t.competitors.filter((c: string) => c.toLowerCase() !== baselineLower)
        : t.competitors,
    }));
  }
  return { movements, themes };
}

function buildSignalSummary(activities: Activity[]): string {
  if (activities.length === 0) return "No signals detected during this period.";

  const byCompetitor: Record<string, Activity[]> = {};
  for (const act of activities) {
    const name = act.competitorName || "Unknown";
    if (!byCompetitor[name]) byCompetitor[name] = [];
    byCompetitor[name].push(act);
  }

  const lines: string[] = [];
  for (const [name, acts] of Object.entries(byCompetitor)) {
    lines.push(`\n### ${name} (${acts.length} signal${acts.length > 1 ? "s" : ""})`);
    for (const act of acts) {
      const details = act.details as any;
      const changeAnalysis = details?.changeAnalysis;
      
      lines.push(`- **${act.type}** [Impact: ${act.impact}]: ${act.description}`);
      if (act.summary) {
        lines.push(`  Summary: ${act.summary}`);
      }
      if (changeAnalysis?.changes?.length > 0) {
        for (const change of changeAnalysis.changes.slice(0, 3)) {
          lines.push(`  - [${change.category}/${change.significance}] ${change.description}`);
        }
      }
    }
  }

  return lines.join("\n");
}

function buildCompetitorContext(competitors: Competitor[], baseline?: CompanyProfile): string {
  const lines: string[] = [];

  if (baseline) {
    lines.push(`\n## YOUR COMPANY: ${baseline.companyName}`);
    lines.push(`Website: ${baseline.websiteUrl}`);
    if (baseline.industry) lines.push(`Industry: ${baseline.industry}`);
  }

  lines.push(`\n## TRACKED COMPETITORS (${competitors.length}):`);
  for (const comp of competitors) {
    lines.push(`- **${comp.name}** (${comp.url})`);
    if (comp.industry) lines.push(`  Industry: ${comp.industry}`);
    if (comp.employeeCount) lines.push(`  Size: ~${comp.employeeCount} employees`);
  }

  return lines.join("\n");
}

export async function generateBriefing(
  tenantDomain: string,
  periodDays: number = 7,
  marketId?: string,
  ctx?: ContextFilter
): Promise<IntelligenceBriefing> {
  const now = new Date();
  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - periodDays);

  let activities: Activity[];
  let competitors: Competitor[];
  let baseline: CompanyProfile | undefined;

  if (ctx) {
    [activities, competitors, baseline] = await Promise.all([
      storage.getActivityByTenantForPeriod(tenantDomain, periodDays, marketId),
      storage.getCompetitorsByContext(ctx),
      storage.getCompanyProfileByContext(ctx).then(p => p || undefined),
    ]);
  } else {
    [activities, competitors, baseline] = await Promise.all([
      storage.getActivityByTenantForPeriod(tenantDomain, periodDays, marketId),
      storage.getCompetitorsByTenantDomain(tenantDomain),
      storage.getCompanyProfileByTenant(tenantDomain),
    ]);
  }

  let newsArticles: NewsArticle[] = [];
  try {
    newsArticles = await fetchCompetitorNews(competitors, baseline || undefined, periodDays);
    console.log(`[Intelligence Briefing] Fetched ${newsArticles.length} news articles for ${competitors.length} competitors`);
  } catch (error: any) {
    console.error("[Intelligence Briefing] News fetch failed, continuing without news:", error.message);
  }

  const uniqueCompetitorIds = new Set(
    activities.filter(a => a.competitorId).map(a => a.competitorId)
  );

  const signalSummary = buildSignalSummary(activities);
  const newsSummary = buildNewsSummary(newsArticles);
  const competitorContext = buildCompetitorContext(competitors, baseline || undefined);
  const noCompetitorsTracked = competitors.length === 0;

  const periodLabel = periodDays === 7 
    ? "Weekly" 
    : periodDays === 14 
      ? "Bi-Weekly" 
      : `${periodDays}-Day`;

  const prompt = `You are a senior competitive intelligence analyst producing a ${periodLabel} Market Intelligence Briefing for ${baseline?.companyName || tenantDomain}.

${competitorContext}

## SIGNALS DETECTED (${activities.length} total over the past ${periodDays} days):
${signalSummary}
${newsSummary}

${activities.length === 0 && newsArticles.length === 0 ? `
Note: No signals or news were detected this period. This could mean competitors are stable, or monitoring coverage needs expansion. Provide a briefing that acknowledges the quiet period and suggests what to watch for based on the competitive landscape.
` : ""}

${noCompetitorsTracked ? `
CRITICAL INSTRUCTION — ZERO COMPETITORS TRACKED:
There are NO tracked competitors for this company. This is a BASELINE-ONLY assessment.
- Do NOT invent, fabricate, or reference any competitor companies by name.
- Do NOT hallucinate competitor movements, scores, or activities.
- The "competitorMovements" array MUST be empty [].
- The "keyThemes" competitors arrays MUST be empty [].
- The "relatedCompetitors" arrays in actionItems MUST be empty [].
- Focus the briefing entirely on the baseline company's own positioning and market observations.
- Clearly state in the executiveSummary that no competitors are currently tracked and this is a baseline-only report.
- Recommend adding competitors as a key action item.
` : ""}

Produce a comprehensive intelligence briefing as JSON with this exact structure:
{
  "executiveSummary": "2-3 paragraphs: What happened this period, what it means strategically, and the overall market direction. Be specific — reference competitor names and concrete changes. End with the single most important takeaway.",
  "keyThemes": [
    {
      "title": "Short theme name (e.g., 'Enterprise Pivot', 'Price Compression')",
      "description": "2-3 sentences explaining this theme and why it matters",
      "competitors": ["Names of competitors exhibiting this theme"],
      "significance": "high|medium|low"
    }
  ],
  "competitorMovements": [
    {
      "name": "Competitor Name",
      "signals": ["List of specific changes observed"],
      "interpretation": "What these moves signal about their strategy — be analytical, not just descriptive",
      "threatLevel": "high|medium|low|none"
    }
  ],
  "actionItems": [
    {
      "title": "Specific action to take",
      "description": "Why this action matters and how to execute it",
      "urgency": "immediate|this_week|this_month|watch",
      "category": "messaging|product|marketing|pricing|strategy|content",
      "relatedCompetitors": ["Which competitor movements triggered this"]
    }
  ],
  "riskAlerts": [
    {
      "title": "Risk title",
      "description": "What the risk is and potential impact",
      "severity": "critical|warning|watch",
      "source": "What signal or pattern triggered this alert"
    }
  ],
  "signalDigest": {
    "totalSignals": ${activities.length},
    "byType": {},
    "byImpact": {},
    "highlights": ["Top 3-5 most noteworthy individual signals as brief descriptions"]
  }
}

Rules:
- Be strategic and analytical, not just descriptive. "So what?" matters more than "what."
- Action items must be specific enough to act on — not vague advice like "monitor closely."
- If there are no signals, still produce themes based on the competitive landscape and suggest proactive actions.
- Provide 3-5 key themes, movements for each active competitor, 3-5 action items, and risk alerts only when warranted.
- CRITICAL: "${baseline?.companyName || tenantDomain}" is YOUR company / the baseline — the company receiving this briefing. NEVER list it as a competitor. Do NOT include "${baseline?.companyName || tenantDomain}" in the "competitors" arrays in keyThemes, do NOT create a competitorMovement entry for it, and do NOT reference it as a competitor anywhere. It should only appear as "your company" or "your organization" when discussing your own positioning. The competitorMovements array must ONLY contain entries for actual tracked competitors, never the baseline company.
- CRITICAL: You may ONLY reference the following competitor names in the briefing. Do NOT invent, fabricate, or reference any company not in this list: [${competitors.map(c => `"${c.name}"`).join(", ")}]. Every name in competitorMovements, keyThemes.competitors, and actionItems.relatedCompetitors MUST come from this exact list.
- Return ONLY valid JSON, no markdown code fences.`;

  const allowedCompetitorNames = new Set(competitors.map(c => c.name.toLowerCase()));

  let briefingData: BriefingData;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find(block => block.type === "text");
    let raw = textBlock?.text || "";

    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    const parsed = JSON.parse(raw);

    const byType: Record<string, number> = {};
    const byImpact: Record<string, number> = {};
    for (const act of activities) {
      byType[act.type] = (byType[act.type] || 0) + 1;
      byImpact[act.impact || "Low"] = (byImpact[act.impact || "Low"] || 0) + 1;
    }

    const newsForStorage: NewsArticleBrief[] = newsArticles.map(a => ({
      title: a.title,
      description: a.description,
      url: a.url,
      source: a.source,
      publishedAt: a.publishedAt,
      matchedEntity: a.matchedEntity,
    }));

    const { movements, themes } = stripBaselineFromBriefing(parsed, baseline?.companyName);

    const filteredMovements = movements.filter(
      (m: any) => m.name && typeof m.name === "string" && allowedCompetitorNames.has(m.name.toLowerCase())
    );
    const filteredThemes = themes.map((t: any) => ({
      ...t,
      competitors: Array.isArray(t.competitors)
        ? t.competitors.filter((c: any) => typeof c === "string" && allowedCompetitorNames.has(c.toLowerCase()))
        : t.competitors,
    }));
    const filteredActionItems = (Array.isArray(parsed.actionItems) ? parsed.actionItems : []).map((item: any) => ({
      ...item,
      relatedCompetitors: Array.isArray(item.relatedCompetitors)
        ? item.relatedCompetitors.filter((c: any) => typeof c === "string" && allowedCompetitorNames.has(c.toLowerCase()))
        : item.relatedCompetitors,
    }));

    briefingData = {
      executiveSummary: parsed.executiveSummary || "Briefing generation completed but summary was empty.",
      keyThemes: filteredThemes,
      competitorMovements: filteredMovements,
      actionItems: filteredActionItems,
      riskAlerts: Array.isArray(parsed.riskAlerts) ? parsed.riskAlerts : [],
      signalDigest: {
        totalSignals: activities.length,
        byType,
        byImpact,
        highlights: parsed.signalDigest?.highlights || [],
      },
      newsArticles: newsForStorage,
      periodLabel,
      generatedAt: now.toISOString(),
    };
  } catch (error: any) {
    console.error("Error generating intelligence briefing:", error);

    const byType: Record<string, number> = {};
    const byImpact: Record<string, number> = {};
    for (const act of activities) {
      byType[act.type] = (byType[act.type] || 0) + 1;
      byImpact[act.impact || "Low"] = (byImpact[act.impact || "Low"] || 0) + 1;
    }

    briefingData = {
      executiveSummary: `Intelligence briefing generation encountered an error. ${activities.length} signals were collected over the past ${periodDays} days across ${uniqueCompetitorIds.size} competitors but could not be synthesized. Please try generating again.`,
      keyThemes: [],
      competitorMovements: [],
      actionItems: [{
        title: "Retry briefing generation",
        description: "The AI analysis failed. Try generating a new briefing or review the raw activity log for recent signals.",
        urgency: "this_week" as const,
        category: "strategy" as const,
        relatedCompetitors: [],
      }],
      riskAlerts: [],
      signalDigest: {
        totalSignals: activities.length,
        byType,
        byImpact,
        highlights: [],
      },
      newsArticles: newsArticles.map(a => ({
        title: a.title,
        description: a.description,
        url: a.url,
        source: a.source,
        publishedAt: a.publishedAt,
        matchedEntity: a.matchedEntity,
      })),
      periodLabel,
      generatedAt: now.toISOString(),
    };
  }

  const briefing = await storage.createIntelligenceBriefing({
    tenantDomain,
    marketId: marketId || null,
    periodStart,
    periodEnd: now,
    status: "published",
    briefingData,
    signalCount: activities.length,
    competitorCount: uniqueCompetitorIds.size,
  });

  return briefing;
}

export async function generateBriefingData(
  tenantDomain: string,
  periodDays: number = 7,
  marketId?: string,
  ctx?: ContextFilter
): Promise<{ briefingData: BriefingData; signalCount: number; competitorCount: number }> {
  const now = new Date();
  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - periodDays);

  let activities: Activity[];
  let competitors: Competitor[];
  let baseline: CompanyProfile | undefined;

  if (ctx) {
    [activities, competitors, baseline] = await Promise.all([
      storage.getActivityByTenantForPeriod(tenantDomain, periodDays, marketId),
      storage.getCompetitorsByContext(ctx),
      storage.getCompanyProfileByContext(ctx).then(p => p || undefined),
    ]);
  } else {
    [activities, competitors, baseline] = await Promise.all([
      storage.getActivityByTenantForPeriod(tenantDomain, periodDays, marketId),
      storage.getCompetitorsByTenantDomain(tenantDomain),
      storage.getCompanyProfileByTenant(tenantDomain),
    ]);
  }

  let newsArticles: NewsArticle[] = [];
  try {
    newsArticles = await fetchCompetitorNews(competitors, baseline || undefined, periodDays);
    console.log(`[Intelligence Briefing] Fetched ${newsArticles.length} news articles for ${competitors.length} competitors`);
  } catch (error: any) {
    console.error("[Intelligence Briefing] News fetch failed, continuing without news:", error.message);
  }

  const uniqueCompetitorIds = new Set(
    activities.filter(a => a.competitorId).map(a => a.competitorId)
  );

  const signalSummary = buildSignalSummary(activities);
  const newsSummary = buildNewsSummary(newsArticles);
  const competitorContext = buildCompetitorContext(competitors, baseline || undefined);
  const noCompetitorsTracked = competitors.length === 0;

  const periodLabel = periodDays === 7 
    ? "Weekly" 
    : periodDays === 14 
      ? "Bi-Weekly" 
      : `${periodDays}-Day`;

  const prompt = `You are a senior competitive intelligence analyst producing a ${periodLabel} Market Intelligence Briefing for ${baseline?.companyName || tenantDomain}.

${competitorContext}

## SIGNALS DETECTED (${activities.length} total over the past ${periodDays} days):
${signalSummary}
${newsSummary}

${activities.length === 0 && newsArticles.length === 0 ? `
Note: No signals or news were detected this period. This could mean competitors are stable, or monitoring coverage needs expansion. Provide a briefing that acknowledges the quiet period and suggests what to watch for based on the competitive landscape.
` : ""}

${noCompetitorsTracked ? `
CRITICAL INSTRUCTION — ZERO COMPETITORS TRACKED:
There are NO tracked competitors for this company. This is a BASELINE-ONLY assessment.
- Do NOT invent, fabricate, or reference any competitor companies by name.
- Do NOT hallucinate competitor movements, scores, or activities.
- The "competitorMovements" array MUST be empty [].
- The "keyThemes" competitors arrays MUST be empty [].
- The "relatedCompetitors" arrays in actionItems MUST be empty [].
- Focus the briefing entirely on the baseline company's own positioning and market observations.
- Clearly state in the executiveSummary that no competitors are currently tracked and this is a baseline-only report.
- Recommend adding competitors as a key action item.
` : ""}

Produce a comprehensive intelligence briefing as JSON with this exact structure:
{
  "executiveSummary": "2-3 paragraphs: What happened this period, what it means strategically, and the overall market direction. Be specific — reference competitor names and concrete changes. End with the single most important takeaway.",
  "keyThemes": [
    {
      "title": "Short theme name (e.g., 'Enterprise Pivot', 'Price Compression')",
      "description": "2-3 sentences explaining this theme and why it matters",
      "competitors": ["Names of competitors exhibiting this theme"],
      "significance": "high|medium|low"
    }
  ],
  "competitorMovements": [
    {
      "name": "Competitor Name",
      "signals": ["List of specific changes observed"],
      "interpretation": "What these moves signal about their strategy — be analytical, not just descriptive",
      "threatLevel": "high|medium|low|none"
    }
  ],
  "actionItems": [
    {
      "title": "Specific action to take",
      "description": "Why this action matters and how to execute it",
      "urgency": "immediate|this_week|this_month|watch",
      "category": "messaging|product|marketing|pricing|strategy|content",
      "relatedCompetitors": ["Which competitor movements triggered this"]
    }
  ],
  "riskAlerts": [
    {
      "title": "Risk title",
      "description": "What the risk is and potential impact",
      "severity": "critical|warning|watch",
      "source": "What signal or pattern triggered this alert"
    }
  ],
  "signalDigest": {
    "totalSignals": ${activities.length},
    "byType": {},
    "byImpact": {},
    "highlights": ["Top 3-5 most noteworthy individual signals as brief descriptions"]
  }
}

Rules:
- Be strategic and analytical, not just descriptive. "So what?" matters more than "what."
- Action items must be specific enough to act on — not vague advice like "monitor closely."
- If there are no signals, still produce themes based on the competitive landscape and suggest proactive actions.
- Provide 3-5 key themes, movements for each active competitor, 3-5 action items, and risk alerts only when warranted.
- CRITICAL: "${baseline?.companyName || tenantDomain}" is YOUR company / the baseline — the company receiving this briefing. NEVER list it as a competitor. Do NOT include "${baseline?.companyName || tenantDomain}" in the "competitors" arrays in keyThemes, do NOT create a competitorMovement entry for it, and do NOT reference it as a competitor anywhere. It should only appear as "your company" or "your organization" when discussing your own positioning. The competitorMovements array must ONLY contain entries for actual tracked competitors, never the baseline company.
- CRITICAL: You may ONLY reference the following competitor names in the briefing. Do NOT invent, fabricate, or reference any company not in this list: [${competitors.map(c => `"${c.name}"`).join(", ")}]. Every name in competitorMovements, keyThemes.competitors, and actionItems.relatedCompetitors MUST come from this exact list.
- Return ONLY valid JSON, no markdown code fences.`;

  const allowedNames = new Set(competitors.map(c => c.name.toLowerCase()));

  let briefingData: BriefingData;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find(block => block.type === "text");
    let raw = textBlock?.text || "";

    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    const parsed = JSON.parse(raw);

    const byType: Record<string, number> = {};
    const byImpact: Record<string, number> = {};
    for (const act of activities) {
      byType[act.type] = (byType[act.type] || 0) + 1;
      byImpact[act.impact || "Low"] = (byImpact[act.impact || "Low"] || 0) + 1;
    }

    const newsForStorage: NewsArticleBrief[] = newsArticles.map(a => ({
      title: a.title,
      description: a.description,
      url: a.url,
      source: a.source,
      publishedAt: a.publishedAt,
      matchedEntity: a.matchedEntity,
    }));

    const rawMovements = Array.isArray(parsed.competitorMovements) ? parsed.competitorMovements : [];
    const rawThemes = Array.isArray(parsed.keyThemes) ? parsed.keyThemes : [];
    const rawActionItems = Array.isArray(parsed.actionItems) ? parsed.actionItems : [];

    briefingData = {
      executiveSummary: parsed.executiveSummary || "Briefing generation completed but summary was empty.",
      keyThemes: rawThemes.map((t: any) => ({
        ...t,
        competitors: Array.isArray(t.competitors)
          ? t.competitors.filter((c: any) => typeof c === "string" && allowedNames.has(c.toLowerCase()))
          : t.competitors,
      })),
      competitorMovements: rawMovements.filter((m: any) => m.name && typeof m.name === "string" && allowedNames.has(m.name.toLowerCase())),
      actionItems: rawActionItems.map((item: any) => ({
        ...item,
        relatedCompetitors: Array.isArray(item.relatedCompetitors)
          ? item.relatedCompetitors.filter((c: any) => typeof c === "string" && allowedNames.has(c.toLowerCase()))
          : item.relatedCompetitors,
      })),
      riskAlerts: Array.isArray(parsed.riskAlerts) ? parsed.riskAlerts : [],
      signalDigest: {
        totalSignals: activities.length,
        byType,
        byImpact,
        highlights: parsed.signalDigest?.highlights || [],
      },
      newsArticles: newsForStorage,
      periodLabel,
      generatedAt: now.toISOString(),
    };
  } catch (error: any) {
    console.error("Error generating intelligence briefing data:", error);
    throw error;
  }

  return {
    briefingData,
    signalCount: activities.length,
    competitorCount: uniqueCompetitorIds.size,
  };
}
