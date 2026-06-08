/**
 * Repurposing Service
 *
 * Turns a long-form content asset into a batch of brand-aligned social
 * variants across platforms, grounded in the StrategicContext (voice + brand).
 * The route writes the variants into the generated_posts pipeline.
 */

import { type ContentAsset } from "@shared/schema";
import { loadStrategicContext, formatStrategicContextForPrompt } from "./strategic-context";
import { completeForFeature } from "./ai-provider";
import {
  parseVariants,
  coercePlatform,
  SUPPORTED_PLATFORMS,
  type RepurposeVariant,
  type RepurposePlatform,
} from "./repurpose-core";

const SYSTEM_PROMPT =
  "You are a social media copywriter. You repurpose long-form content into punchy, native-feeling " +
  "social posts that match the brand's voice and never contradict its positioning. Each variant takes " +
  "a distinct angle — no near-duplicates. Respond with valid JSON only.";

export interface RepurposeParams {
  asset: ContentAsset;
  isDefaultMarket?: boolean;
  platforms?: string[];
  count?: number;
}

export interface RepurposeResult {
  variants: RepurposeVariant[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export async function repurposeAsset(params: RepurposeParams): Promise<RepurposeResult> {
  const { asset } = params;
  const count = Math.min(Math.max(params.count ?? 8, 3), 12);
  const requested: RepurposePlatform[] = params.platforms?.length
    ? params.platforms.map(coercePlatform)
    : (["linkedin", "twitter"] as RepurposePlatform[]);
  const platforms = requested.filter((p, i, a) => a.indexOf(p) === i);

  const strategicCtx = await loadStrategicContext(
    asset.tenantDomain,
    asset.marketId || undefined,
    params.isDefaultMarket,
  );
  const strategicBlock = formatStrategicContextForPrompt(strategicCtx);

  const sourceBody = (asset.content || asset.aiSummary || asset.description || "").slice(0, 8000);

  const prompt = [
    `Repurpose the content below into ${count} social variants spread across these platforms: ${platforms.join(", ")}.`,
    strategicBlock,
    `## Source content\nTitle: ${asset.title}\n\n${sourceBody}`,
    `## Rules
- Each variant must take a DISTINCT angle (a different hook, stat, question, or takeaway). No near-duplicates.
- Match the platform's native style and length (LinkedIn: 150-300 words; Twitter/X: under 280 characters).
- Stay in the brand voice and positioning above. Do not fabricate stats or quotes.
- Provide 3-5 hashtags per variant where appropriate (no leading #).

## Output JSON shape (array)
[{ "platform": "${SUPPORTED_PLATFORMS.join('" | "')}", "content": string, "hashtags": string[], "angle": string }]`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await completeForFeature("marketing_tasks", prompt, {
    tenantDomain: asset.tenantDomain,
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: 6000,
  });

  return {
    variants: parseVariants(result.text),
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    model: result.model,
  };
}
