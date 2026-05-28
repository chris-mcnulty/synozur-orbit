import Anthropic from "@anthropic-ai/sdk";
import { storage } from "../storage";
import { crawlPricingPage } from "./web-crawler";
import { notifications } from "./notifications";
import {
  pricingTierSchema,
  pricingChangeAnalysisSchema,
  type PricingTier,
  type PricingChangeAnalysis,
  type CompetitorPricingSnapshot,
} from "@shared/schema";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const MODEL = "claude-sonnet-4-5";

export interface PricingMonitoringResult {
  competitorId: string;
  competitorName: string;
  status: "success" | "no_url" | "no_content" | "error";
  hasChanges: boolean;
  changeScore: number;
  message?: string;
  snapshot?: CompetitorPricingSnapshot;
  summary?: string;
  changeAnalysis?: PricingChangeAnalysis;
}

interface ExtractionResult {
  tiers: PricingTier[];
  pricingModel: string | null;
  currency: string | null;
  hasFreeTier: boolean;
}

function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/©\s*\d{4}/g, "")
    .replace(/\b(updated|effective|as of)[^.]*?\d{4}\b/gi, "")
    .trim();
}

function calculateChangeScore(prev: string, next: string): number {
  if (!prev || !next) return 100;
  const a = normalizeContent(prev);
  const b = normalizeContent(next);
  if (a === b) return 0;
  const aWords = a.split(/\s+/).filter(w => w.length > 2);
  const bWords = b.split(/\s+/).filter(w => w.length > 2);
  const wordsA = new Set(aWords);
  const wordsB = new Set(bWords);
  const intersection = Array.from(wordsA).filter(w => wordsB.has(w)).length;
  const union = new Set(aWords.concat(bWords)).size;
  if (union === 0) return 0;
  const similarity = intersection / union;
  return Math.round((1 - similarity) * 100);
}

function stripJsonFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

export async function extractPricingTiers(
  competitorName: string,
  rawContent: string,
): Promise<ExtractionResult> {
  const fallback: ExtractionResult = {
    tiers: [],
    pricingModel: null,
    currency: null,
    hasFreeTier: false,
  };

  if (!rawContent || rawContent.length < 100) return fallback;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: `Extract pricing tiers from ${competitorName}'s pricing page text.

PRICING PAGE CONTENT (excerpt):
${rawContent.substring(0, 8000)}

Return ONLY a JSON object (no markdown, no code fences) with this structure:
{
  "pricingModel": "subscription" | "usage-based" | "perpetual" | "freemium" | "tiered" | "custom" | null,
  "currency": "USD" | "EUR" | "GBP" | etc. (ISO 4217) | null,
  "hasFreeTier": boolean,
  "tiers": [
    {
      "name": "Starter",
      "price": "$49/month",
      "priceAmount": 49,
      "billingPeriod": "monthly" | "annual" | "quarterly" | "one-time" | "usage-based" | "custom" | null,
      "currency": "USD" | null,
      "features": ["Feature A", "Feature B"],
      "cta": "Start free trial" | "Contact sales" | null,
      "isHighlighted": false,
      "audience": "For startups" | null
    }
  ]
}

Rules:
- If a tier shows "Custom" / "Contact us" pricing, set price to that string and priceAmount to null.
- Strip leading currency symbols when computing priceAmount (e.g., "$49" -> 49).
- Capture only the headline features (max 8 per tier).
- If no pricing tiers are detectable, return {"tiers": [], "pricingModel": null, "currency": null, "hasFreeTier": false}.

JSON:`,
        },
      ],
    });

    const textBlock = response.content.find(block => block.type === "text");
    const rawText = stripJsonFences(textBlock?.text || "");
    const parsed = JSON.parse(rawText);

    const tiers: PricingTier[] = Array.isArray(parsed.tiers)
      ? parsed.tiers
          .map((t: any) => {
            const result = pricingTierSchema.safeParse(t);
            return result.success ? result.data : null;
          })
          .filter((t: PricingTier | null): t is PricingTier => t !== null)
      : [];

    return {
      tiers,
      pricingModel: typeof parsed.pricingModel === "string" ? parsed.pricingModel : null,
      currency: typeof parsed.currency === "string" ? parsed.currency : null,
      hasFreeTier: Boolean(parsed.hasFreeTier),
    };
  } catch (error) {
    console.error("[PricingIntelligence] Tier extraction failed:", error);
    return fallback;
  }
}

export async function analyzePricingChanges(
  competitorName: string,
  previousTiers: PricingTier[],
  currentTiers: PricingTier[],
  changeScore: number,
): Promise<{ summary: string; analysis: PricingChangeAnalysis | null }> {
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      messages: [
        {
          role: "user",
          content: `Compare ${competitorName}'s pricing tiers between two snapshots.

Change magnitude on the raw page: ${changeScore}%

PREVIOUS TIERS:
${JSON.stringify(previousTiers, null, 2)}

CURRENT TIERS:
${JSON.stringify(currentTiers, null, 2)}

Return ONLY a JSON object (no markdown, no code fences):
{
  "noSignificantChanges": false,
  "categories": ["tier_added" | "tier_removed" | "price_changed" | "features_changed" | "model_changed"],
  "changes": [
    {
      "kind": "tier_added" | "tier_removed" | "price_changed" | "features_changed" | "model_changed" | "other",
      "description": "Brief description (e.g. 'Pro tier price increased from $49 to $59/mo')",
      "significance": "high" | "medium" | "low"
    }
  ],
  "narrative": "2-3 sentence summary of pricing changes and likely strategic implications"
}

Significance guidance:
- price_changed ≥10% or any tier addition/removal: high
- price_changed <10% or feature additions: medium
- Cosmetic copy/feature wording shifts: low

If only the raw page text shifted but actual tier/price structure is identical, return:
{"noSignificantChanges": true, "categories": [], "changes": [], "narrative": "No significant pricing changes detected."}

JSON:`,
        },
      ],
    });

    const textBlock = response.content.find(block => block.type === "text");
    const rawText = stripJsonFences(textBlock?.text || "");
    const parsed = JSON.parse(rawText);

    if (parsed.noSignificantChanges) {
      return {
        summary: "No significant pricing changes detected.",
        analysis: null,
      };
    }

    const analysisResult = pricingChangeAnalysisSchema.safeParse({
      changes: parsed.changes || [],
      categories: parsed.categories || [],
      narrative: parsed.narrative || "",
    });
    if (!analysisResult.success) {
      return {
        summary: parsed.narrative || "Pricing changes detected.",
        analysis: null,
      };
    }
    return {
      summary: analysisResult.data.narrative,
      analysis: analysisResult.data,
    };
  } catch (error) {
    console.error("[PricingIntelligence] Change analysis failed:", error);
    return {
      summary: "Pricing changes detected but analysis unavailable.",
      analysis: null,
    };
  }
}

const MIN_CHANGE_THRESHOLD = 5;

export async function monitorCompetitorPricing(
  competitorId: string,
  options: { userId?: string; tenantDomain?: string; signal?: AbortSignal } = {},
): Promise<PricingMonitoringResult> {
  const competitor = await storage.getCompetitor(competitorId);
  if (!competitor) {
    throw new Error("Competitor not found");
  }

  const pricingUrl = competitor.pricingPageUrl?.trim();
  if (!pricingUrl) {
    return {
      competitorId: competitor.id,
      competitorName: competitor.name,
      status: "no_url",
      hasChanges: false,
      changeScore: 0,
      message: "Competitor has no pricing page URL configured",
    };
  }

  const now = new Date();
  let fetched;
  try {
    fetched = await crawlPricingPage(pricingUrl, { signal: options.signal });
  } catch (err: any) {
    console.error(`[PricingIntelligence] Fetch failed for ${competitor.name}:`, err);
    return {
      competitorId: competitor.id,
      competitorName: competitor.name,
      status: "error",
      hasChanges: false,
      changeScore: 0,
      message: err?.message || "Pricing page fetch failed",
    };
  }

  if (!fetched) {
    return {
      competitorId: competitor.id,
      competitorName: competitor.name,
      status: "no_content",
      hasChanges: false,
      changeScore: 0,
      message: "Pricing page returned no content",
    };
  }

  const extraction = await extractPricingTiers(competitor.name, fetched.content);
  const previousSnapshot = await storage.getLatestPricingSnapshotForCompetitor(competitor.id);
  const previousRaw = previousSnapshot?.rawContent || "";
  const changeScore = calculateChangeScore(previousRaw, fetched.content);

  let summary: string | undefined;
  let changeAnalysis: PricingChangeAnalysis | null = null;
  const hasPrior = Boolean(previousSnapshot);
  const isSignificant = hasPrior && changeScore >= MIN_CHANGE_THRESHOLD;

  if (isSignificant) {
    const result = await analyzePricingChanges(
      competitor.name,
      (previousSnapshot?.tiers as PricingTier[] | null) || [],
      extraction.tiers,
      changeScore,
    );
    summary = result.summary;
    changeAnalysis = result.analysis;
  }

  const tenantDomain = options.tenantDomain || competitor.tenantDomain || undefined;
  if (!tenantDomain) {
    return {
      competitorId: competitor.id,
      competitorName: competitor.name,
      status: "error",
      hasChanges: false,
      changeScore,
      message: "Tenant context missing for pricing snapshot",
    };
  }

  const snapshot = await storage.createPricingSnapshot({
    tenantDomain,
    marketId: competitor.marketId || null,
    competitorId: competitor.id,
    pricingUrl: fetched.finalUrl,
    tiers: extraction.tiers,
    pricingModel: extraction.pricingModel,
    currency: extraction.currency,
    hasFreeTier: extraction.hasFreeTier,
    rawContent: fetched.content.substring(0, 100000),
    changeScore,
    changeSummary: summary || null,
    changeAnalysis: changeAnalysis || null,
    crawlMethod: fetched.crawlMethod,
    capturedAt: now,
  });

  // Stamp the competitor with the capture time so the scheduled pricing monitor
  // can interval-gate without scanning the snapshots table.
  await storage.updateCompetitor(competitor.id, { lastPricingCheck: now })
    .catch(err => console.error(`[PricingIntelligence] lastPricingCheck update failed for ${competitor.id}:`, err));

  const realChange = isSignificant && changeAnalysis !== null && changeAnalysis.changes.length > 0;
  if (realChange && changeAnalysis && options.userId) {
    const analysis = changeAnalysis;
    const impact = (() => {
      if (analysis.changes.some(c => c.significance === "high")) return "High";
      if (analysis.changes.some(c => c.significance === "medium")) return "Medium";
      return "Low";
    })();

    await storage.createActivity({
      type: "pricing_update",
      sourceType: "competitor",
      competitorId: competitor.id,
      competitorName: competitor.name,
      description: `Pricing page changed (${changeScore}% diff)`,
      summary: summary || null,
      details: {
        pricingUrl: fetched.finalUrl,
        changeScore,
        snapshotId: snapshot.id,
        changeAnalysis: analysis,
        previousTierCount: (previousSnapshot?.tiers as PricingTier[] | null)?.length || 0,
        currentTierCount: extraction.tiers.length,
      },
      date: now.toISOString().split("T")[0],
      impact,
      userId: options.userId,
      tenantDomain,
      marketId: competitor.marketId || null,
    });

    const significance = analysis.changes.some(c => c.significance === "high")
      ? ("high" as const)
      : analysis.changes.some(c => c.significance === "medium")
      ? ("medium" as const)
      : ("low" as const);

    notifications
      .dispatch(tenantDomain, "competitor_change", {
        competitorId: competitor.id,
        competitorName: competitor.name,
        summary: summary || `Pricing page changed (${changeScore}% diff)`,
        significance,
      })
      .catch(err => console.error("[PricingIntelligence] Notification dispatch failed:", err));
  }

  return {
    competitorId: competitor.id,
    competitorName: competitor.name,
    status: "success",
    hasChanges: realChange,
    changeScore,
    snapshot,
    summary,
    changeAnalysis: changeAnalysis || undefined,
  };
}
