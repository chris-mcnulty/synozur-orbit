/**
 * Quick Generate service — AI calls for the prompt-grounded Quick Generate
 * flow. Each generator treats the user's raw prompt as the sole factual
 * source: of the strategic context, only brand identity is included (as
 * style/character grounding); every prompt carries explicit
 * anti-fabrication rules.
 *
 * The optional angle step mirrors SignalAI's ideation engine: 6-8 candidate
 * angles as JSON, each a single take/hook string with prompt-sourced key
 * points and an honest fit assessment. The selected angle travels verbatim
 * into the drafting prompts ("- Angle: <angle>").
 */

import type { ContentBrief } from "@shared/schema";
import { completeForFeature } from "./ai-provider";
import { loadStrategicContext, formatStrategicContextForPrompt } from "./strategic-context";
import { draftFromBrief, type DraftFromBriefResult } from "./copywriter-service";
import { SYNOZUR_VOICE_RULES, type RepurposePlatform } from "./repurpose-core";
import {
  buildAngleBlock,
  buildQuickAnglesPrompt,
  buildQuickBlogInstructions,
  buildQuickNewsletterPrompt,
  buildQuickSocialPrompt,
  parseQuickAngles,
  parseQuickNewsletter,
  parseQuickSocialPosts,
  deriveCampaignNameFromPrompt,
  type QuickAngle,
  type QuickNewsletterDraft,
  type QuickSocialPost,
} from "./quick-generate-core";

interface QuickContext {
  tenantDomain: string;
  marketId?: string | null;
  isDefaultMarket?: boolean;
}

/**
 * Static voice rules (tone, formatting, banned patterns) — always included.
 */
const BRAND_VOICE_BLOCK =
  "## Brand voice (style only — this supplies NO facts)\n- " + SYNOZUR_VOICE_RULES;

/**
 * Brand grounding for Quick Generate prompts: static voice rules PLUS the
 * tenant's brand identity. Brand identity is deliberately included (user
 * decision, Aug 2026) so output stays on-brand in character and style. All
 * other strategic sections — messaging/positioning framework, GTM plan,
 * recommendations, personas, competitive intel, briefing action items —
 * remain excluded: they carry campaign strategy facts and claims that must
 * not leak into output grounded strictly in the user's prompt.
 */
async function loadQuickBrandBlock(ctx: QuickContext): Promise<string> {
  let brandIdentityBlock = "";
  try {
    const sc = await loadStrategicContext(
      ctx.tenantDomain,
      ctx.marketId || undefined,
      ctx.isDefaultMarket,
    );
    brandIdentityBlock = formatStrategicContextForPrompt({
      messagingFramework: "",
      competitiveIntelligence: "",
      gtmPlanSummary: "",
      briefingActionItems: "",
      recommendations: "",
      personas: "",
      brandIdentity: sc.brandIdentity,
    });
  } catch {
    // Brand identity is a style enhancer, never a hard dependency.
  }
  return [BRAND_VOICE_BLOCK, brandIdentityBlock].filter(Boolean).join("\n\n");
}

const ANGLES_SYSTEM_PROMPT =
  "You are a content ideation partner. You propose distinct angles on the user's announcement, " +
  "grounded ONLY in the facts they stated. You never invent facts, products, collections, or history. " +
  "You assess fit honestly, including recommending against weak angles. Respond with valid JSON only.";

const SOCIAL_SYSTEM_PROMPT =
  "You are a social media copywriter drafting posts for a simple announcement. You use ONLY the facts " +
  "in the user's prompt and never invent details.\n\nVoice rules:\n- " +
  SYNOZUR_VOICE_RULES +
  "\n\nRespond with valid JSON only.";

const NEWSLETTER_SYSTEM_PROMPT =
  "You are an email copywriter drafting a newsletter for a simple announcement. You use ONLY the facts " +
  "in the user's prompt and never invent details.\n\nVoice rules:\n- " +
  SYNOZUR_VOICE_RULES +
  "\n\nRespond using ONLY the delimiters specified in the Response format section.";

export interface QuickAnglesResult {
  angles: QuickAngle[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export async function generateQuickAngles(
  ctx: QuickContext & { prompt: string },
): Promise<QuickAnglesResult> {
  const prompt = buildQuickAnglesPrompt({
    prompt: ctx.prompt,
    voiceBlock: await loadQuickBrandBlock(ctx),
  });
  const result = await completeForFeature("marketing_tasks", prompt, {
    tenantDomain: ctx.tenantDomain,
    systemPrompt: ANGLES_SYSTEM_PROMPT,
    maxTokens: 4096,
  });
  return {
    angles: parseQuickAngles(result.text),
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    model: result.model,
  };
}

export interface QuickSocialResult {
  posts: QuickSocialPost[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export async function quickDraftSocialPosts(
  ctx: QuickContext & {
    prompt: string;
    platforms: RepurposePlatform[];
    count: number;
    angle?: QuickAngle | null;
  },
): Promise<QuickSocialResult> {
  const prompt = buildQuickSocialPrompt({
    prompt: ctx.prompt,
    platforms: ctx.platforms,
    count: ctx.count,
    angleBlock: buildAngleBlock(ctx.angle),
    brandBlock: await loadQuickBrandBlock(ctx),
  });
  const result = await completeForFeature("marketing_tasks", prompt, {
    tenantDomain: ctx.tenantDomain,
    systemPrompt: SOCIAL_SYSTEM_PROMPT,
    maxTokens: 4096,
  });
  const posts = parseQuickSocialPosts(result.text, ctx.platforms);
  if (posts.length === 0) {
    throw new Error("The AI did not return any usable social posts.");
  }
  return {
    posts,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    model: result.model,
  };
}

export interface QuickNewsletterResult extends QuickNewsletterDraft {
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export async function quickDraftNewsletter(
  ctx: QuickContext & { prompt: string; angle?: QuickAngle | null },
): Promise<QuickNewsletterResult> {
  const prompt = buildQuickNewsletterPrompt({
    prompt: ctx.prompt,
    angleBlock: buildAngleBlock(ctx.angle),
    brandBlock: await loadQuickBrandBlock(ctx),
  });
  const result = await completeForFeature("marketing_tasks", prompt, {
    tenantDomain: ctx.tenantDomain,
    systemPrompt: NEWSLETTER_SYSTEM_PROMPT,
    maxTokens: 4096,
  });
  const parsed = parseQuickNewsletter(result.text);
  if (!parsed.body.trim()) {
    throw new Error("The AI did not return a usable newsletter draft.");
  }
  return {
    ...parsed,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    model: result.model,
  };
}

/**
 * Draft the blog post through the existing copywriter path in its
 * prompt-grounded mode: sourceContext = the raw prompt is the sole factual
 * source and promptGrounded reduces the strategic context to brand identity
 * only (messaging framework, GTM plan, recommendations, and personas carry
 * tenant facts and stay excluded). A synthetic in-memory brief supplies only
 * the fields the copywriter reads (tenant, market, format, working title) —
 * no strategy fields, so none reach the prompt. The route persists the real
 * brief + asset afterwards.
 */
export async function quickDraftBlog(
  ctx: QuickContext & {
    prompt: string;
    angle?: QuickAngle | null;
  },
): Promise<DraftFromBriefResult> {
  const syntheticBrief = {
    tenantDomain: ctx.tenantDomain,
    marketId: ctx.marketId ?? null,
    campaignId: null,
    targetPersonaId: null,
    title: deriveCampaignNameFromPrompt(ctx.prompt),
    format: "blog_post",
    targetKeyword: null,
    funnelStage: null,
    demandSignal: null,
    differentiationAngle: null,
    targetReader: null,
    cta: null,
  } as unknown as ContentBrief;

  // Deliberately NO soundLikeMeInstructions: the personal outbound voice
  // profile is user-editable free text that can carry arbitrary facts and
  // claims, so it must never reach a prompt-grounded draft. Voice comes only
  // from the static, fact-free rules in the copywriter system prompt.
  const draft = await draftFromBrief(syntheticBrief, {
    isDefaultMarket: ctx.isDefaultMarket,
    promptGrounded: true,
    sourceContext: ctx.prompt,
    instructions: buildQuickBlogInstructions(ctx.angle),
  });
  if (!draft.body?.trim()) {
    throw new Error("The AI did not return a usable blog draft.");
  }
  return draft;
}
