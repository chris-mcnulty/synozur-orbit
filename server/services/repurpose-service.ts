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
  LONGFORM_REPURPOSE_GUIDANCE,
  type RepurposeVariant,
  type RepurposePlatform,
  type LongformRepurposeFormat,
} from "./repurpose-core";
import { parseDraftResponse } from "./editorial-calendar-core";

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
- For each variant, also propose an "imagePrompt": a concise, concrete visual concept for the paired graphic (subject, mood, and any on-image text), aligned to the brand. The post and its visual must work together.

## Output JSON shape (array)
[{ "platform": "${SUPPORTED_PLATFORMS.join('" | "')}", "content": string, "hashtags": string[], "angle": string, "imagePrompt": string }]`,
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

const LONGFORM_SYSTEM_PROMPT =
  "You are an expert B2B content creator. You repurpose an existing asset into a NEW format, re-angling " +
  "for that format's reader rather than copying. You stay in the brand's established voice and positioning " +
  "and never fabricate statistics, customer names, or quotes. " +
  "Respond using ONLY the requested ===TITLE===/===BODY===/===META=== format.";

export interface LongformRepurposeParams {
  asset: ContentAsset;
  format: LongformRepurposeFormat;
  isDefaultMarket?: boolean;
}

export interface LongformRepurposeResult {
  title: string;
  body: string;
  meta: string | null;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

/**
 * Repurpose a source asset into a single long-form/derivative format
 * (blog, newsletter, video script, podcast outline, whitepaper, carousel).
 * The route persists the result as a new content asset.
 */
export async function repurposeToLongForm(
  params: LongformRepurposeParams,
): Promise<LongformRepurposeResult> {
  const { asset, format } = params;

  const strategicCtx = await loadStrategicContext(
    asset.tenantDomain,
    asset.marketId || undefined,
    params.isDefaultMarket,
  );
  const strategicBlock = formatStrategicContextForPrompt(strategicCtx);
  const sourceBody = (asset.content || asset.aiSummary || asset.description || "").slice(0, 12000);

  const prompt = [
    `Repurpose the source asset below into a "${format}".`,
    strategicBlock,
    `## Source asset\nTitle: ${asset.title}\n\n${sourceBody}`,
    `## Format guidance\n${LONGFORM_REPURPOSE_GUIDANCE[format]}`,
    `## Response format
Respond with exactly these three sections and nothing else:
===TITLE===
<the final title/headline for the repurposed piece>
===BODY===
<the full piece in Markdown>
===META===
<a one-sentence summary, max 155 characters>`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await completeForFeature("marketing_tasks", prompt, {
    tenantDomain: asset.tenantDomain,
    systemPrompt: LONGFORM_SYSTEM_PROMPT,
    maxTokens: 8192,
  });

  const parsed = parseDraftResponse(result.text);
  return {
    title: parsed.title || `${asset.title} (${format})`,
    body: parsed.body,
    meta: parsed.meta,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    model: result.model,
  };
}
