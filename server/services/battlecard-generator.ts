import Anthropic from "@anthropic-ai/sdk";
import { storage } from "../storage";
import type { Competitor } from "@shared/schema";
import { logAiUsage } from "./ai-usage-logger";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

export interface BattlecardGenerationInput {
  competitor: Competitor;
  ourCompanyName: string;
  ourPositioning: string;
  tenantDomain: string;
  marketId: string | null;
  userId: string;
  sourceDataAsOf?: Date | null;
}

export interface BattlecardGenerationResult {
  competitorId: string;
  status: "created" | "updated" | "failed";
  error?: string;
}

/**
 * Generate (or refresh) a competitive battlecard for a single competitor. Used by both
 * full-regeneration and auto-build so the AI prompt and persistence path stay in sync.
 *
 * Mirrors the persistence logic that previously lived inline in
 * `full-regeneration-service.ts:442-534`. Callers are responsible for any concurrency
 * limiting (e.g. `runWithConcurrency` / `aiLimiter`).
 */
export async function generateBattlecardForCompetitor(
  input: BattlecardGenerationInput,
): Promise<BattlecardGenerationResult> {
  const { competitor, ourCompanyName, ourPositioning, tenantDomain, marketId, userId, sourceDataAsOf } = input;
  try {
    const competitorAnalysis = competitor.analysisData as any;
    const prompt = `You are a competitive intelligence analyst. Generate a comprehensive sales battlecard for competing against "${competitor.name}".

Our Company: ${ourCompanyName}
Our Positioning: ${ourPositioning.slice(0, 2000)}

Competitor: ${competitor.name}
Competitor URL: ${competitor.url}
${competitorAnalysis ? `Competitor Analysis: ${JSON.stringify(competitorAnalysis).slice(0, 2000)}` : ""}

Generate a battlecard with the following sections in valid JSON format:
{
  "strengths": ["Their strength 1", "Their strength 2", "Their strength 3"],
  "weaknesses": ["Their weakness 1", "Their weakness 2", "Their weakness 3"],
  "ourAdvantages": ["Our advantage 1", "Our advantage 2", "Our advantage 3"],
  "objections": [
    {"objection": "Common objection the prospect raises", "response": "How to respond and reframe"}
  ],
  "talkTracks": [
    {"scenario": "Prospect is currently evaluating this competitor", "script": "Full multi-sentence sales script a rep can use verbatim in this situation"},
    {"scenario": "Prospect mentions a specific competitor strength", "script": "Full multi-sentence script addressing that strength and pivoting to our advantages"}
  ],
  "quickStats": {
    "pricing": "Summary of their pricing model and typical price points",
    "marketPosition": "How they position themselves in the market",
    "targetAudience": "The customer segments and buyer personas they target",
    "keyProducts": "Their main products or product lines"
  }
}

Be specific and substantive — use real details from the competitor analysis where available. Each talk track script should be 2-4 sentences a salesperson can say directly. Return ONLY valid JSON.`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });
    void logAiUsage({ tenantDomain, marketId, userId }, "generate_battlecard", "anthropic", "claude-sonnet-4-5", message.usage);

    const content = message.content[0];
    if (content.type !== "text") {
      return { competitorId: competitor.id, status: "failed", error: "AI returned non-text response" };
    }

    let text = content.text.trim();
    if (text.startsWith("```json")) text = text.slice(7);
    else if (text.startsWith("```")) text = text.slice(3);
    if (text.endsWith("```")) text = text.slice(0, -3);

    const battlecardContent = JSON.parse(text.trim());
    const dataAsOf = sourceDataAsOf || null;

    const existing = await storage.getBattlecardByCompetitor(competitor.id);
    if (existing) {
      await storage.updateBattlecard(existing.id, {
        strengths: battlecardContent.strengths,
        weaknesses: battlecardContent.weaknesses,
        ourAdvantages: battlecardContent.ourAdvantages,
        objections: battlecardContent.objections,
        talkTracks: battlecardContent.talkTracks,
        quickStats: battlecardContent.quickStats,
        lastGeneratedAt: new Date(),
        generatedFromDataAsOf: dataAsOf,
      });
      return { competitorId: competitor.id, status: "updated" };
    }

    await storage.createBattlecard({
      competitorId: competitor.id,
      tenantDomain,
      marketId: marketId || null,
      createdBy: userId,
      strengths: battlecardContent.strengths,
      weaknesses: battlecardContent.weaknesses,
      ourAdvantages: battlecardContent.ourAdvantages,
      objections: battlecardContent.objections,
      talkTracks: battlecardContent.talkTracks,
      quickStats: battlecardContent.quickStats,
      generatedFromDataAsOf: dataAsOf,
    });
    return { competitorId: competitor.id, status: "created" };
  } catch (e: any) {
    return { competitorId: competitor.id, status: "failed", error: e?.message || String(e) };
  }
}
