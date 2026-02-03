import { storage } from "../storage";
import Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";

interface SummaryData {
  companySnapshot: string;
  marketPosition: string;
  competitiveLandscape: string;
  opportunities: string;
}

interface CompetitorInfo {
  name: string;
  score: number;
  keyStrength?: string;
}

export async function generateExecutiveSummary(
  tenantDomain: string,
  marketId?: string,
  companyProfileId?: string,
  lockedSections: string[] = []
): Promise<SummaryData> {
  const tenant = await storage.getTenantByDomain(tenantDomain);
  if (!tenant) throw new Error("Tenant not found");

  const contextFilter = { tenantId: tenant.id, tenantDomain, marketId: marketId || "" };
  
  const companyProfile = companyProfileId 
    ? await storage.getCompanyProfile(companyProfileId)
    : await storage.getCompanyProfileByContext(contextFilter);
  
  const competitors = await storage.getCompetitorsByContext(contextFilter);
  const analysis = await storage.getLatestAnalysisByContext(contextFilter);
  const recommendations = await storage.getRecommendationsByContext(contextFilter);
  
  const existingSummary = await storage.getExecutiveSummaryByContext(contextFilter);
  
  const competitorScores: CompetitorInfo[] = [];
  for (const comp of competitors) {
    const scores = await storage.getCompetitorScore(comp.id);
    if (scores) {
      competitorScores.push({
        name: comp.name,
        score: scores.overallScore || 0,
        keyStrength: undefined
      });
    }
  }
  competitorScores.sort((a, b) => b.score - a.score);

  const dataHash = generateDataHash(companyProfile, competitors, analysis, recommendations);

  const anthropic = new Anthropic({
    apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  });

  const companyContext = companyProfile ? `
Company: ${companyProfile.companyName}
Description: ${companyProfile.description || "N/A"}
Website: ${companyProfile.websiteUrl || "N/A"}
` : "No baseline company profile configured.";

  const competitorContext = competitorScores.length > 0 
    ? competitorScores.slice(0, 5).map((c, i) => `${i + 1}. ${c.name} (Score: ${c.score}/100)`).join("\n")
    : "No competitors analyzed yet.";

  const analysisContext = analysis ? `
Key Themes: ${Array.isArray(analysis.themes) ? (analysis.themes as any[]).map((t: any) => t.theme || t).slice(0, 5).join(", ") : "None identified"}
Messaging Patterns: ${Array.isArray(analysis.messaging) ? (analysis.messaging as any[]).map((m: any) => m.pattern || m).slice(0, 3).join("; ") : "None identified"}
Gaps: ${Array.isArray(analysis.gaps) ? (analysis.gaps as any[]).slice(0, 5).map((g: any) => g.gap || g).join("; ") : "None identified"}
` : "No competitive analysis available yet.";

  const topRecs = recommendations.filter(r => r.impact === "High").slice(0, 5);
  const recsContext = topRecs.length > 0 
    ? topRecs.map(r => `- ${r.title} (${r.area})`).join("\n")
    : "No high-impact recommendations yet.";

  const summaryData: SummaryData = {
    companySnapshot: existingSummary?.companySnapshot || "",
    marketPosition: existingSummary?.marketPosition || "",
    competitiveLandscape: existingSummary?.competitiveLandscape || "",
    opportunities: existingSummary?.opportunities || ""
  };

  const sectionsToGenerate = ["companySnapshot", "marketPosition", "competitiveLandscape", "opportunities"]
    .filter(s => !lockedSections.includes(s));

  if (sectionsToGenerate.length === 0) {
    return summaryData;
  }

  const prompt = `You are an executive briefing specialist creating a concise market intelligence summary. Based on the following data, generate the requested sections.

## Baseline Company
${companyContext}

## Top Competitors (by score)
${competitorContext}

## Competitive Analysis Summary
${analysisContext}

## High-Impact Recommendations
${recsContext}

Generate the following sections in JSON format. Each section should be 2-4 sentences, crisp and actionable. Focus on strategic insights an executive needs to make decisions.

Sections needed: ${sectionsToGenerate.join(", ")}

Response format (JSON only, no markdown):
{
  ${sectionsToGenerate.includes("companySnapshot") ? '"companySnapshot": "Brief company overview with key facts",' : ""}
  ${sectionsToGenerate.includes("marketPosition") ? '"marketPosition": "Current competitive standing, score context, key differentiators",' : ""}
  ${sectionsToGenerate.includes("competitiveLandscape") ? '"competitiveLandscape": "Top competitors, main competitive themes, notable gaps",' : ""}
  ${sectionsToGenerate.includes("opportunities") ? '"opportunities": "Top 2-3 strategic opportunities with recommended actions"' : ""}
}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }]
    });

    const content = response.content[0];
    if (content.type === "text") {
      const cleanJson = content.text.replace(/```json\n?|\n?```/g, "").trim();
      const generated = JSON.parse(cleanJson);
      
      if (generated.companySnapshot && !lockedSections.includes("companySnapshot")) {
        summaryData.companySnapshot = generated.companySnapshot;
      }
      if (generated.marketPosition && !lockedSections.includes("marketPosition")) {
        summaryData.marketPosition = generated.marketPosition;
      }
      if (generated.competitiveLandscape && !lockedSections.includes("competitiveLandscape")) {
        summaryData.competitiveLandscape = generated.competitiveLandscape;
      }
      if (generated.opportunities && !lockedSections.includes("opportunities")) {
        summaryData.opportunities = generated.opportunities;
      }
    }
  } catch (error) {
    console.error("[ExecutiveSummary] AI generation failed:", error);
    if (!summaryData.companySnapshot && companyProfile) {
      summaryData.companySnapshot = `${companyProfile.companyName} is a company with active competitive intelligence tracking.`;
    }
    if (!summaryData.marketPosition && competitorScores.length > 0) {
      summaryData.marketPosition = `Tracking ${competitorScores.length} competitor${competitorScores.length > 1 ? "s" : ""} in the market.`;
    }
    if (!summaryData.competitiveLandscape && competitorScores.length > 0) {
      summaryData.competitiveLandscape = `Top competitors include ${competitorScores.slice(0, 3).map(c => c.name).join(", ")}.`;
    }
    if (!summaryData.opportunities && topRecs.length > 0) {
      summaryData.opportunities = `Key opportunities: ${topRecs.slice(0, 2).map(r => r.title).join("; ")}.`;
    }
  }

  await saveExecutiveSummary(tenantDomain, marketId, companyProfileId, summaryData, lockedSections, dataHash);

  return summaryData;
}

async function saveExecutiveSummary(
  tenantDomain: string,
  marketId: string | undefined,
  companyProfileId: string | undefined,
  data: SummaryData,
  lockedSections: string[],
  dataHash: string
): Promise<void> {
  await storage.upsertExecutiveSummary({
    tenantDomain,
    marketId: marketId || null,
    companyProfileId: companyProfileId || null,
    scope: "baseline",
    companySnapshot: data.companySnapshot,
    marketPosition: data.marketPosition,
    competitiveLandscape: data.competitiveLandscape,
    opportunities: data.opportunities,
    lockedSections,
    dataHash,
    summaryData: {}
  });
}

function generateDataHash(
  companyProfile: any,
  competitors: any[],
  analysis: any,
  recommendations: any[]
): string {
  const dataString = JSON.stringify({
    company: companyProfile?.id,
    competitors: competitors.map(c => c.id).sort(),
    analysisId: analysis?.id,
    recsCount: recommendations.length,
    topRecs: recommendations.slice(0, 5).map(r => r.id)
  });
  return crypto.createHash("md5").update(dataString).digest("hex").slice(0, 16);
}

export async function getExecutiveSummary(
  tenantDomain: string,
  marketId?: string
): Promise<{ data: SummaryData; lockedSections: string[]; lastGeneratedAt: Date | null } | null> {
  const tenant = await storage.getTenantByDomain(tenantDomain);
  if (!tenant) return null;

  const contextFilter = { tenantId: tenant.id, tenantDomain, marketId: marketId || "" };
  const summary = await storage.getExecutiveSummaryByContext(contextFilter);
  
  if (!summary) return null;

  return {
    data: {
      companySnapshot: summary.companySnapshot || "",
      marketPosition: summary.marketPosition || "",
      competitiveLandscape: summary.competitiveLandscape || "",
      opportunities: summary.opportunities || ""
    },
    lockedSections: (summary.lockedSections as string[]) || [],
    lastGeneratedAt: summary.lastGeneratedAt
  };
}

export async function updateExecutiveSummarySection(
  tenantDomain: string,
  marketId: string | undefined,
  section: keyof SummaryData,
  content: string,
  lock: boolean
): Promise<void> {
  const tenant = await storage.getTenantByDomain(tenantDomain);
  if (!tenant) throw new Error("Tenant not found");

  const contextFilter = { tenantId: tenant.id, tenantDomain, marketId: marketId || "" };
  const existing = await storage.getExecutiveSummaryByContext(contextFilter);

  if (!existing) {
    throw new Error("No executive summary exists. Generate one first.");
  }

  const lockedSections = (existing.lockedSections as string[]) || [];
  let updatedLocked = lockedSections;

  if (lock && !lockedSections.includes(section)) {
    updatedLocked = [...lockedSections, section];
  } else if (!lock && lockedSections.includes(section)) {
    updatedLocked = lockedSections.filter(s => s !== section);
  }

  await storage.upsertExecutiveSummary({
    tenantDomain: existing.tenantDomain,
    marketId: existing.marketId,
    projectId: existing.projectId,
    companyProfileId: existing.companyProfileId,
    scope: existing.scope,
    companySnapshot: section === "companySnapshot" ? content : (existing.companySnapshot || undefined),
    marketPosition: section === "marketPosition" ? content : (existing.marketPosition || undefined),
    competitiveLandscape: section === "competitiveLandscape" ? content : (existing.competitiveLandscape || undefined),
    opportunities: section === "opportunities" ? content : (existing.opportunities || undefined),
    lockedSections: updatedLocked,
    dataHash: existing.dataHash || undefined,
    summaryData: (existing.summaryData as Record<string, unknown>) || {}
  });
}
