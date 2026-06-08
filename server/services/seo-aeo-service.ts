/**
 * SEO/AEO Optimizer Service
 *
 * Generates search metadata (SEO), answer-engine blocks + FAQ (AEO), internal
 * links validated against the tenant's real content inventory, and content-gap
 * notes for a piece of content. Synchronous, matching the other generators.
 */

import { db } from "../db";
import { contentAssets } from "@shared/schema";
import { and, eq, ne } from "drizzle-orm";
import { loadStrategicContext, formatStrategicContextForPrompt } from "./strategic-context";
import { completeForFeature } from "./ai-provider";
import {
  parseOptimizationResponse,
  SEO_TITLE_MAX,
  META_DESC_MAX,
  type ParsedOptimization,
  type InventoryItem,
} from "./seo-aeo-core";

const SYSTEM_PROMPT =
  "You are an SEO and answer-engine-optimization (AEO) specialist. You optimize for both " +
  "traditional search and AI answer engines. You ONLY suggest internal links to pages that " +
  "appear in the provided inventory — never invent URLs or asset IDs. Respond with valid JSON only.";

export interface OptimizeParams {
  tenantDomain: string;
  marketId?: string;
  isDefaultMarket?: boolean;
  title: string;
  content: string;
  contentAssetId?: string;
}

export interface OptimizeResult extends ParsedOptimization {
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export async function optimizeContent(params: OptimizeParams): Promise<OptimizeResult> {
  const { tenantDomain, marketId, title, content, contentAssetId } = params;

  const strategicCtx = await loadStrategicContext(tenantDomain, marketId, params.isDefaultMarket);
  const strategicBlock = formatStrategicContextForPrompt(strategicCtx);

  // Internal-link inventory: the tenant's existing content assets (excluding
  // the one being optimized). Validation against this list happens in the core.
  const inventoryRows = await db
    .select({ id: contentAssets.id, title: contentAssets.title })
    .from(contentAssets)
    .where(
      contentAssetId
        ? and(eq(contentAssets.tenantDomain, tenantDomain), ne(contentAssets.id, contentAssetId))
        : eq(contentAssets.tenantDomain, tenantDomain),
    )
    .limit(200);
  const inventory: InventoryItem[] = inventoryRows.map((r) => ({ id: r.id, title: r.title }));

  const inventoryBlock = inventory.length
    ? `## Internal-link inventory (ONLY link to these; use the exact id)\n${inventory
        .map((i) => `- id=${i.id} :: ${i.title}`)
        .join("\n")}`
    : "## Internal-link inventory\n(No other content assets exist — return an empty internalLinks array.)";

  const prompt = [
    "Optimize the following content for search engines and AI answer engines.",
    strategicBlock,
    inventoryBlock,
    `## Content\nTitle: ${title}\n\n${content.slice(0, 12000)}`,
    `## Rules
- seoTitle: ≤${SEO_TITLE_MAX} characters, compelling, includes the primary keyword.
- metaDescription: ≤${META_DESC_MAX} characters, action-oriented.
- answerBlocks: 3-5 likely user questions, each answered in 2-3 plain sentences (optimized for AI answer engines / featured snippets).
- faq: 3-6 FAQ pairs suitable for FAQ schema.
- internalLinks: suggest links ONLY to assets in the inventory above, referencing their exact id. If none fit, return [].
- contentGaps: 2-5 specific topics/sections missing that would strengthen this piece.

## Output JSON shape
{
  "seoTitle": string,
  "metaDescription": string,
  "slug": string,
  "targetKeyword": string,
  "keywords": string[],
  "answerBlocks": [{ "question": string, "answer": string }],
  "faq": [{ "question": string, "answer": string }],
  "internalLinks": [{ "anchorText": string, "targetAssetId": string, "reason": string }],
  "contentGaps": string[]
}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await completeForFeature("marketing_tasks", prompt, {
    tenantDomain,
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: 6000,
  });

  const parsed = parseOptimizationResponse(result.text, inventory, contentAssetId);
  return {
    ...parsed,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    model: result.model,
  };
}
