/**
 * Content Interview Service — turn interview answers into 5-10 format-agnostic
 * concept briefs, each with an honest voice/topic fit assessment so curation
 * can reject off-voice or off-topic ideas before any content is produced.
 *
 * Grounded in the same strategic context (MPF, personas, brand identity) as
 * the editorial-calendar generator; the interview block replaces the generic
 * demand-pool framing with the user's stated themes, windows, and news items.
 */

import { loadStrategicContext, formatStrategicContextForPrompt, formatPersonaContextForPrompt } from "./strategic-context";
import { completeForFeature } from "./ai-provider";
import { CONTENT_BRIEF_FORMATS, CONTENT_FORM_CATEGORIES } from "@shared/schema";
import {
  clampBriefCount,
  formatInterviewForPrompt,
  normalizeInterviewBrief,
  type BriefInterviewInput,
  type InterviewDraftBrief,
} from "./brief-interview-core";
import {
  SYNOZUR_VOICE_RULES,
  applySynozurVoice,
  clampForPlatform,
  coercePlatform,
} from "./repurpose-core";

const SYSTEM_PROMPT =
  "You are a B2B content strategist and an honest critic. You turn a short campaign interview into a " +
  "small set of sharp, format-agnostic content concepts. You judge each concept's fit against the " +
  "brand's voice and the campaign's topic strictly — recommending rejection of a weak idea is a " +
  "feature, not a failure. You never invent metrics. " +
  "You always respond with valid JSON only — no prose, no markdown fences.";

export interface GenerateInterviewBriefsParams {
  tenantDomain: string;
  marketId?: string;
  isDefaultMarket?: boolean;
  interview: BriefInterviewInput;
  /** Pre-formatted personas block from explicitly selected personas, if any. */
  explicitPersonasBlock?: string;
}

export interface GenerateInterviewBriefsResult {
  briefs: InterviewDraftBrief[];
  model: string;
}

function extractJsonArray(text: string): any[] {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.briefs)) return parsed.briefs;
  } catch {
    /* fall through to regex extraction */
  }
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const arr = JSON.parse(arrMatch[0]);
      if (Array.isArray(arr)) return arr;
    } catch {
      /* give up */
    }
  }
  return [];
}

export async function generateInterviewBriefs(
  params: GenerateInterviewBriefsParams,
): Promise<GenerateInterviewBriefsResult> {
  const { tenantDomain, marketId, interview, explicitPersonasBlock } = params;
  const count = clampBriefCount(interview.briefCount);

  const strategicCtx = await loadStrategicContext(tenantDomain, marketId, params.isDefaultMarket);
  const strategicBlock = formatStrategicContextForPrompt(strategicCtx);
  const interviewBlock = formatInterviewForPrompt(interview);

  const releaseRules =
    interview.campaignType === "product_release"
      ? `- This is a product release: spread concepts across the arc — anticipation ideas for ramp-up, announcement ideas for launch (the release news itself), and depth/proof ideas for amplification. The stated news items are the raw material; every news item should be covered by at least one concept.\n`
      : "";

  const prompt = [
    `Produce exactly ${count} content CONCEPTS as JSON. A concept is a core idea that can be produced in several forms — it is NOT tied to one output type. Each concept will later be expanded into short form (social, email), mid form (press release, blog post), long form (whitepaper, ebook), and/or digital interactive (webinar, video, podcast) pieces. Short-form social is multi-channel and LinkedIn-led: a strong social concept should work as a LinkedIn post first, then carry over to X and other networks, so favor ideas that translate across channels rather than ones that only land on a single network.`,
    strategicBlock,
    explicitPersonasBlock || null,
    interviewBlock,
    `## Rules
- Every concept must trace directly to the interview answers above (themes, news items, product). No generic filler.
${releaseRules}- "formCategories" lists which form lengths the concept genuinely suits: ${CONTENT_FORM_CATEGORIES.join(" | ")}. Most concepts suit 2-3 categories; only tag a category the idea would be strong in.
- "format" is the single anchor format the concept is strongest as, one of: ${CONTENT_BRIEF_FORMATS.join(" | ")}.
- Every concept needs a concrete demand signal (recurring buyer question, news moment, competitive gap, or trend) — never fabricate numbers.
- Each concept needs a sharp differentiation angle and ONE specific target reader.
- "channels" lists the social channels this concept should be promoted on, chosen to match where its target reader actually pays attention — not LinkedIn by reflex. Pick from: linkedin | twitter | facebook | instagram. Most concepts suit 1-3 channels. Favour a sensible mix across the set when the audience warrants it (e.g. a visual or culture-led idea may belong on instagram/facebook; an executive thought-leadership idea on linkedin; a fast-reaction take on twitter). Only include linkedin alone when the idea is genuinely LinkedIn-only.
- "fitAssessment" is your honest verdict per concept: judge voiceFit (does this sound like something this brand would say, per the Messaging & Positioning Framework above) and topicFit (is it squarely on this campaign's topic) as strong | moderate | weak. Set "recommendation" to "reject" when either is weak or the idea is mediocre — the user curates these and SHOULD reject some. Do not grade on a curve; at least be skeptical of your weakest one or two concepts.

## Output format
Respond with a JSON object: { "briefs": [ ... ] }. Each brief object has:
- "title": string (the concept, stated sharply)
- "summary": string (2-3 sentences: the core idea and why it works across forms)
- "formCategories": string[] — subset of ${CONTENT_FORM_CATEGORIES.join(", ")}
- "format": string (the anchor format)
- "channels": string[] — subset of linkedin, twitter, facebook, instagram (the social channels to promote this concept on)
- "targetKeyword": string
- "demandSignal": string (the evidence people care)
- "funnelStage": one of awareness | consideration | decision
- "differentiationAngle": string
- "targetReader": string (one specific person)
- "cta": string
- "fitAssessment": { "voiceFit": "strong"|"moderate"|"weak", "topicFit": "strong"|"moderate"|"weak", "recommendation": "keep"|"reject", "rationale": string (one sentence) }`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await completeForFeature("marketing_tasks", prompt, {
    tenantDomain,
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: 8192,
  });

  const briefs = extractJsonArray(result.text)
    .map(normalizeInterviewBrief)
    .filter((b): b is InterviewDraftBrief => b !== null);

  return { briefs, model: result.model };
}

// ── Concept → schedulable social posts ──────────────────────────────────────
// The Plan step lets the user spread a concept across real social channels
// (LinkedIn / X / Facebook / Instagram). Unlike document drafts, these land
// directly in the generated_posts pipeline as schedulable copy, so we generate
// platform-tailored variants here rather than producing a document to repurpose.

const SOCIAL_SYSTEM_PROMPT =
  "You are a senior B2B social copywriter. You write platform-native posts that sound human and earn attention without hype. " +
  "You always respond with valid JSON only — no prose, no markdown fences.\n- " +
  SYNOZUR_VOICE_RULES;

const PLATFORM_GUIDANCE: Record<string, string> = {
  linkedin:
    "LinkedIn: a confident professional hook, 2-4 short paragraphs, one clear idea, a soft CTA. 80-180 words. No hashtags.",
  twitter:
    "X (Twitter): one punchy post under 280 characters. Lead with the sharpest line. No hashtags, no thread.",
  facebook:
    "Facebook: warm and conversational, 2-3 sentences, a relatable framing, a light CTA. No hashtags.",
  instagram:
    "Instagram: a vivid, visual-first caption, 1-2 sentences plus a short follow-on line. Evocative but concrete. No hashtags.",
};

export interface InterviewSocialConcept {
  title: string;
  summary?: string | null;
  differentiationAngle?: string | null;
  targetReader?: string | null;
  cta?: string | null;
  demandSignal?: string | null;
}

export interface GeneratedSocialPostCopy {
  platform: string;
  content: string;
}

/**
 * Generate platform-tailored social copy for a single concept across the
 * requested channels. One AI call per concept; `countPerChannel` distinct posts
 * are produced for each channel so a multi-post window doesn't ship duplicates.
 * Platforms are normalised (x → twitter) and copy is voice-cleaned + clamped to
 * each platform's hard limit before returning.
 */
export async function generateInterviewSocialPosts(params: {
  tenantDomain: string;
  concept: InterviewSocialConcept;
  channels: string[];
  countPerChannel: number;
}): Promise<GeneratedSocialPostCopy[]> {
  const platforms = Array.from(
    new Set(params.channels.map((c) => coercePlatform(c))),
  );
  if (platforms.length === 0) return [];
  const perChannel = Math.min(Math.max(Math.round(params.countPerChannel) || 1, 1), 10);

  const conceptBlock = [
    `Concept: ${params.concept.title}`,
    params.concept.summary ? `Summary: ${params.concept.summary}` : null,
    params.concept.differentiationAngle ? `Differentiation: ${params.concept.differentiationAngle}` : null,
    params.concept.targetReader ? `Target reader: ${params.concept.targetReader}` : null,
    params.concept.demandSignal ? `Why it matters now: ${params.concept.demandSignal}` : null,
    params.concept.cta ? `Call to action: ${params.concept.cta}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const channelRules = platforms.map((p) => `- ${PLATFORM_GUIDANCE[p] ?? p}`).join("\n");

  const prompt = [
    `Write ready-to-publish social posts for the concept below. For EACH channel, write ${perChannel} distinct post(s) — different angles or hooks, never reworded duplicates.`,
    conceptBlock,
    `## Channel rules\n${channelRules}`,
    `## Output format\nRespond with JSON: { "posts": [ { "platform": one of ${platforms.join(" | ")}, "content": string } ] }. Produce exactly ${perChannel} post(s) per channel.`,
  ].join("\n\n");

  const result = await completeForFeature("marketing_tasks", prompt, {
    tenantDomain: params.tenantDomain,
    systemPrompt: SOCIAL_SYSTEM_PROMPT,
    maxTokens: 4096,
  });

  const raw = extractJsonArray(
    (() => {
      const cleaned = result.text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      try {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed?.posts)) return JSON.stringify(parsed.posts);
      } catch {
        /* fall through */
      }
      return cleaned;
    })(),
  );

  const wanted = new Set(platforms);
  return raw
    .map((item): GeneratedSocialPostCopy | null => {
      const platform = coercePlatform(item?.platform);
      if (!wanted.has(platform)) return null;
      const content = clampForPlatform(applySynozurVoice(String(item?.content ?? "").trim()), platform);
      if (!content) return null;
      return { platform, content };
    })
    .filter((p): p is GeneratedSocialPostCopy => p !== null);
}
