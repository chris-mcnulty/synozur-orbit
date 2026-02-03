import { storage } from "../storage";
import Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";
import { calculateScores } from "./scoring-service";

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
  console.log("[ExecutiveSummary] Starting generation for tenant:", tenantDomain, "market:", marketId);
  
  const tenant = await storage.getTenantByDomain(tenantDomain);
  if (!tenant) throw new Error("Tenant not found");

  const contextFilter = { tenantId: tenant.id, tenantDomain, marketId: marketId || "" };
  
  const companyProfile = companyProfileId 
    ? await storage.getCompanyProfile(companyProfileId)
    : await storage.getCompanyProfileByContext(contextFilter);
  
  const competitors = await storage.getCompetitorsByContext(contextFilter);
  const analysis = await storage.getLatestAnalysisByContext(contextFilter);
  const recommendations = await storage.getRecommendationsByContext(contextFilter);
  const groundingDocs = await storage.getGroundingDocumentsByContext(contextFilter);
  
  console.log("[ExecutiveSummary] Data loaded - Competitors:", competitors.length, "Docs:", groundingDocs.length, "Recs:", recommendations.length);
  
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

  const profile = companyProfile as any;
  const companyContext = companyProfile ? `
Company: ${profile.companyName}
Description: ${profile.description || "N/A"}
Website: ${profile.websiteUrl || "N/A"}
Value Proposition: ${profile.valueProposition || "Not defined"}
Target Audience: ${profile.targetAudience || "Not defined"}
Industry: ${profile.industry || "Not specified"}
Headquarters: ${profile.headquarters || "Not specified"}
Founded: ${profile.founded || "Not specified"}
Employee Count: ${profile.employeeCount || "Not specified"}
Revenue Range: ${profile.revenue || "Not specified"}
` : "No baseline company profile configured.";

  const competitorDetails = await Promise.all(competitors.slice(0, 8).map(async (c) => {
    const comp = c as any;
    
    // Try stored scores first, then calculate on-the-fly if not found
    let storedScores = await storage.getCompetitorScore(c.id) as any;
    let overallScore = storedScores?.overallScore || 0;
    let contentScore = storedScores?.contentActivityScore || 0;
    let marketPresence = storedScores?.marketPresenceScore || 0;
    
    // If no stored scores, calculate from competitor data
    if (!storedScores || overallScore === 0) {
      const calculatedScores = calculateScores(
        comp.analysisData,
        comp.linkedInEngagement,
        comp.instagramEngagement,
        comp.crawlData,
        comp.blogSnapshot,
        comp.lastCrawl || comp.lastAnalysis
      );
      overallScore = Math.round(calculatedScores.overallScore * 100) / 100;
      contentScore = Math.round(calculatedScores.contentActivityScore * 100) / 100;
      marketPresence = Math.round(calculatedScores.marketPresenceScore * 100) / 100;
    }
    
    console.log(`[ExecutiveSummary] Competitor ${comp.name} scores:`, { overall: overallScore, content: contentScore, marketPresence });
    return {
      name: comp.name,
      url: comp.url,
      description: comp.analysisData?.summary || "",
      score: overallScore,
      contentScore: contentScore,
      marketPresenceScore: marketPresence,
      linkedInUrl: comp.linkedInUrl,
      blogPostCount: comp.blogSnapshot?.postCount || 0,
      headquarters: comp.headquarters,
      employeeCount: comp.employeeCount
    };
  }));
  
  const competitorContext = competitorDetails.length > 0 
    ? competitorDetails.map((c, i) => 
        `${i + 1}. ${c.name} (Overall: ${c.score}/100, Content: ${c.contentScore}/100, Market Presence: ${c.marketPresenceScore}/100)${c.description ? ` - ${c.description.substring(0, 150)}` : ""}${c.employeeCount ? ` | Employees: ${c.employeeCount}` : ""}${c.blogPostCount > 0 ? ` | ${c.blogPostCount} blog posts` : ""}`
      ).join("\n")
    : "No competitors analyzed yet.";

  // Blog activity comparison across market players
  const baselineBlogCount = (profile?.blogSnapshot as any)?.postCount || 0;
  const blogComparison = competitorDetails.filter(c => c.blogPostCount > 0);
  const avgBlogPosts = blogComparison.length > 0 
    ? Math.round(blogComparison.reduce((sum, c) => sum + c.blogPostCount, 0) / blogComparison.length) 
    : 0;
  const maxBlogPosts = blogComparison.length > 0 ? Math.max(...blogComparison.map(c => c.blogPostCount)) : 0;
  const blogLeader = blogComparison.find(c => c.blogPostCount === maxBlogPosts);
  
  const blogContext = `
## Content Marketing Comparison
Baseline (${profile?.companyName || "Your Company"}): ${baselineBlogCount} blog posts
Competitor Average: ${avgBlogPosts} blog posts
Most Active: ${blogLeader ? `${blogLeader.name} with ${blogLeader.blogPostCount} posts` : "None tracked"}
${baselineBlogCount > avgBlogPosts ? "Your content output is above market average." : baselineBlogCount < avgBlogPosts ? "Your content output is below market average - consider increasing blog frequency." : "Your content output matches market average."}`;

  const analysisContext = analysis ? `
Key Themes: ${Array.isArray(analysis.themes) ? (analysis.themes as any[]).map((t: any) => {
    if (typeof t === 'object') return `${t.theme || t.name || t}${t.description ? `: ${t.description}` : ""}`;
    return t;
  }).slice(0, 6).join("; ") : "None identified"}

Messaging Patterns: ${Array.isArray(analysis.messaging) ? (analysis.messaging as any[]).map((m: any) => {
    if (typeof m === 'object') return `${m.pattern || m.name || m}${m.description ? `: ${m.description}` : ""}`;
    return m;
  }).slice(0, 4).join("; ") : "None identified"}

Competitive Gaps: ${Array.isArray(analysis.gaps) ? (analysis.gaps as any[]).slice(0, 6).map((g: any) => {
    if (typeof g === 'object') return `${g.gap || g.name || g}${g.description ? `: ${g.description}` : ""}`;
    return g;
  }).join("; ") : "None identified"}

Differentiators: ${Array.isArray((analysis as any).differentiators) ? ((analysis as any).differentiators as any[]).slice(0, 4).map((d: any) => {
    if (typeof d === 'object') return d.differentiator || d.name || d;
    return d;
  }).join("; ") : "None identified"}
` : "No competitive analysis available yet.";

  const topRecs = recommendations.filter(r => r.impact === "High").slice(0, 8);
  const allRecs = recommendations.slice(0, 12);
  const recsContext = topRecs.length > 0 
    ? topRecs.map(r => `- ${r.title} (${r.area})${r.description ? `: ${r.description.substring(0, 100)}` : ""}`).join("\n")
    : allRecs.length > 0 
      ? allRecs.slice(0, 5).map(r => `- ${r.title} (${r.area})`).join("\n")
      : "No recommendations yet.";

  const docsContext = groundingDocs.length > 0
    ? groundingDocs.slice(0, 15).map((d: any) => {
        const content = d.extractedContent || d.content || "";
        return `### ${d.name} (${d.documentType || "document"})\n${content.substring(0, 3000)}`;
      }).join("\n\n")
    : "No grounding documents uploaded.";

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

  const prompt = `You are an executive briefing specialist creating a comprehensive market intelligence summary for a C-level audience. Based on the following data, generate detailed, actionable executive summaries.

## Baseline Company
${companyContext}

## Competitor Intelligence (${competitorDetails.length} tracked)
${competitorContext}
${blogContext}

## Competitive Analysis Insights
${analysisContext}

## Strategic Recommendations
${recsContext}

## Grounding Documents (${groundingDocs.length} uploaded)
${docsContext}

Generate the following sections in JSON format. Each section should be substantive (4-6 sentences), data-driven, and focused on actionable strategic insights. Include specific metrics, competitor names, and concrete recommendations where available.

CRITICAL FORMATTING RULES:
1. Output ONLY valid JSON - no markdown, no code blocks, no asterisks, no bullet points
2. Use plain text sentences only - no formatting characters like *, **, -, or bullet symbols  
3. Structure each section with 2-3 logical paragraphs separated by double newlines (\\n\\n)
4. First paragraph: overview/context. Second paragraph: specific details/metrics. Third paragraph: implications/actions
5. Each paragraph should be 2-3 sentences for readability

Sections needed: ${sectionsToGenerate.join(", ")}

Guidelines for each section:
- companySnapshot: Include company fundamentals (industry, size, location if known), core value proposition, target market, and competitive positioning summary. Reference specific data points from the grounding documents and analysis. Use the data provided - don't say information is "unspecified" if data exists above.
- marketPosition: Describe current competitive standing with actual score context from the competitor data above. If competitors have calculated scores (Overall, Content, Market Presence), reference those specific numbers. Highlight key differentiators and relative strengths/weaknesses.
- competitiveLandscape: Name the top 3-5 competitors with their actual calculated scores from the data above. Use the specific Overall/Content/Market Presence scores provided. Identify dominant themes and highlight competitive gaps.
- opportunities: List 3-5 concrete, prioritized strategic opportunities as flowing sentences. Each should include the opportunity, why it matters, and a specific recommended action. Reference competitor weaknesses or market gaps from the analysis data.

Response format (raw JSON only, absolutely no markdown):
{
  ${sectionsToGenerate.includes("companySnapshot") ? '"companySnapshot": "Plain text company overview with specifics",' : ""}
  ${sectionsToGenerate.includes("marketPosition") ? '"marketPosition": "Plain text competitive standing analysis with real metrics",' : ""}
  ${sectionsToGenerate.includes("competitiveLandscape") ? '"competitiveLandscape": "Plain text competitor breakdown with real scores and gaps",' : ""}
  ${sectionsToGenerate.includes("opportunities") ? '"opportunities": "Plain text strategic opportunities with actions"' : ""}
}`;

  console.log("[ExecutiveSummary] Calling Anthropic API with prompt length:", prompt.length, "chars, sections:", sectionsToGenerate);
  
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }]
    });
    
    console.log("[ExecutiveSummary] API response received, usage:", response.usage);

    const content = response.content[0];
    if (content.type === "text") {
      console.log("[ExecutiveSummary] Response text length:", content.text.length);
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
  } catch (error: any) {
    console.error("[ExecutiveSummary] AI generation failed:", error?.message || error);
    console.error("[ExecutiveSummary] Full error:", JSON.stringify(error, null, 2));
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
