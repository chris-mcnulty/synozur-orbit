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
  REPURPOSE_FORMAT_DEFS,
  SYNOZUR_VOICE_RULES,
  parsePostItems,
  parseCarouselItems,
  parseAssetItems,
  type RepurposeVariant,
  type RepurposePlatform,
  type LongformRepurposeFormat,
  type RepurposeBatchFormat,
  type RepurposeFormatDef,
  type GeneratedRepurposeItem,
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

// ─── Multi-format batch repurposer ────────────────────────────────────────────

const MULTIFORMAT_SYSTEM_PROMPT =
  "You are Synozur's content strategist. You repurpose one source asset into a specific output format, " +
  "re-angling for that format's reader rather than copying. You always write in Synozur's voice and never " +
  "fabricate statistics, customer names, or quotes. Respond with valid JSON only, no prose around it.";

export interface RepurposeSelection {
  format: RepurposeBatchFormat;
  count: number;
}

export interface MultiFormatRepurposeParams {
  asset: ContentAsset;
  selections: RepurposeSelection[];
  isDefaultMarket?: boolean;
}

export interface FormatGenerationError {
  format: RepurposeBatchFormat;
  message: string;
}

export interface MultiFormatRepurposeResult {
  items: GeneratedRepurposeItem[];
  errors: FormatGenerationError[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

/** Cowork-style metadata each item must carry, expressed as a JSON field spec. */
const META_FIELDS = `"coreIdea": string (one sentence, the single idea this piece makes), "cta": string (the call to action), "bestPostingWindow": string (when to publish, e.g. "Tuesday morning")`;

function buildFormatPrompt(
  def: RepurposeFormatDef,
  count: number,
  strategicBlock: string,
  sourceTitle: string,
  sourceBody: string,
): string {
  let shape: string;
  if (def.postFormat === "carousel") {
    shape = `[{ "caption": string (short LinkedIn caption to accompany the carousel), "slides": [{ "role": "cover" | "body" | "close", "kicker": string (a short label, only on the cover), "headline": string, "supportingLines": string[] (0-2 short lines) }] (exactly 5 slides), ${META_FIELDS} }]`;
  } else if (def.destination === "posts") {
    shape = `[{ "content": string (the full post text), "imagePrompt": string (a concise visual concept for the paired graphic), ${META_FIELDS} }]`;
  } else {
    shape = `[{ "title": string, "body": string (the full piece in Markdown), ${META_FIELDS} }]`;
  }

  return [
    `Repurpose the source asset below into ${count} "${def.label}" item(s). Each item must take a DISTINCT angle. No near-duplicates.`,
    strategicBlock,
    `## Source asset\nTitle: ${sourceTitle}\n\n${sourceBody}`,
    `## Format guidance\n${def.guidance}`,
    `## Voice rules\n- ${SYNOZUR_VOICE_RULES}`,
    `## Output JSON shape (array of exactly ${count})\n${shape}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Generate every selected output format from one source asset in a single batch.
 * Each format is its own grounded AI call, run in parallel; one format failing
 * never sinks the rest. Returns normalized items ready for persistence plus the
 * list of any per-format failures.
 */
export async function repurposeMultiFormat(
  params: MultiFormatRepurposeParams,
): Promise<MultiFormatRepurposeResult> {
  const { asset } = params;

  const selections = params.selections
    .map((s) => {
      const def = REPURPOSE_FORMAT_DEFS[s.format];
      if (!def) return null;
      const count = Math.min(Math.max(Math.floor(s.count) || 1, 1), def.maxCount);
      return { def, count };
    })
    .filter((s): s is { def: RepurposeFormatDef; count: number } => s !== null);

  if (selections.length === 0) {
    return { items: [], errors: [], usage: { inputTokens: 0, outputTokens: 0 }, model: "" };
  }

  const strategicCtx = await loadStrategicContext(
    asset.tenantDomain,
    asset.marketId || undefined,
    params.isDefaultMarket,
  );
  const strategicBlock = formatStrategicContextForPrompt(strategicCtx);
  const sourceBody = (asset.content || asset.aiSummary || asset.description || "").slice(0, 10000);

  const settled = await Promise.allSettled(
    selections.map(async ({ def, count }) => {
      const prompt = buildFormatPrompt(def, count, strategicBlock, asset.title, sourceBody);
      const result = await completeForFeature("marketing_tasks", prompt, {
        tenantDomain: asset.tenantDomain,
        systemPrompt: MULTIFORMAT_SYSTEM_PROMPT,
        maxTokens: 8192,
      });
      let items: GeneratedRepurposeItem[];
      if (def.postFormat === "carousel") {
        items = parseCarouselItems(result.text, def);
      } else if (def.destination === "posts") {
        items = parsePostItems(result.text, def);
      } else {
        items = parseAssetItems(result.text, def);
      }
      if (items.length === 0) {
        throw new Error(`No usable ${def.label} items returned`);
      }
      return { def, items, usage: result.usage, model: result.model };
    }),
  );

  const items: GeneratedRepurposeItem[] = [];
  const errors: FormatGenerationError[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let model = "";

  settled.forEach((res, i) => {
    const def = selections[i].def;
    if (res.status === "fulfilled") {
      items.push(...res.value.items);
      inputTokens += res.value.usage.inputTokens;
      outputTokens += res.value.usage.outputTokens;
      model = res.value.model || model;
    } else {
      errors.push({
        format: def.key,
        message: res.reason instanceof Error ? res.reason.message : String(res.reason),
      });
    }
  });

  return { items, errors, usage: { inputTokens, outputTokens }, model };
}
