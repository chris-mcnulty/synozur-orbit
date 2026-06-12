/**
 * Content Interview Service — turn interview answers into 5-10 format-agnostic
 * concept briefs, each with an honest voice/topic fit assessment so curation
 * can reject off-voice or off-topic ideas before any content is produced.
 *
 * Grounded in the same strategic context (MPF, personas, brand identity) as
 * the editorial-calendar generator; the interview block replaces the generic
 * demand-pool framing with the user's stated themes, windows, and news items.
 */

import { loadStrategicContext, formatStrategicContextForPrompt } from "./strategic-context";
import { completeForFeature } from "./ai-provider";
import { CONTENT_BRIEF_FORMATS, CONTENT_FORM_CATEGORIES } from "@shared/schema";
import {
  clampBriefCount,
  formatInterviewForPrompt,
  normalizeInterviewBrief,
  type BriefInterviewInput,
  type InterviewDraftBrief,
} from "./brief-interview-core";

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
  const { tenantDomain, marketId, interview } = params;
  const count = clampBriefCount(interview.briefCount);

  const strategicCtx = await loadStrategicContext(tenantDomain, marketId, params.isDefaultMarket);
  const strategicBlock = formatStrategicContextForPrompt(strategicCtx);
  const interviewBlock = formatInterviewForPrompt(interview);

  const releaseRules =
    interview.campaignType === "product_release"
      ? `- This is a product release: spread concepts across the arc — anticipation ideas for ramp-up, announcement ideas for launch (the release news itself), and depth/proof ideas for amplification. The stated news items are the raw material; every news item should be covered by at least one concept.\n`
      : "";

  const prompt = [
    `Produce exactly ${count} content CONCEPTS as JSON. A concept is a core idea that can be produced in several forms — it is NOT tied to one output type. Each concept will later be expanded into short form (social, email), mid form (press release, blog post), long form (whitepaper, ebook), and/or digital interactive (webinar, video, podcast) pieces.`,
    strategicBlock,
    interviewBlock,
    `## Rules
- Every concept must trace directly to the interview answers above (themes, news items, product). No generic filler.
${releaseRules}- "formCategories" lists which form lengths the concept genuinely suits: ${CONTENT_FORM_CATEGORIES.join(" | ")}. Most concepts suit 2-3 categories; only tag a category the idea would be strong in.
- "format" is the single anchor format the concept is strongest as, one of: ${CONTENT_BRIEF_FORMATS.join(" | ")}.
- Every concept needs a concrete demand signal (recurring buyer question, news moment, competitive gap, or trend) — never fabricate numbers.
- Each concept needs a sharp differentiation angle and ONE specific target reader.
- "fitAssessment" is your honest verdict per concept: judge voiceFit (does this sound like something this brand would say, per the Messaging & Positioning Framework above) and topicFit (is it squarely on this campaign's topic) as strong | moderate | weak. Set "recommendation" to "reject" when either is weak or the idea is mediocre — the user curates these and SHOULD reject some. Do not grade on a curve; at least be skeptical of your weakest one or two concepts.

## Output format
Respond with a JSON object: { "briefs": [ ... ] }. Each brief object has:
- "title": string (the concept, stated sharply)
- "summary": string (2-3 sentences: the core idea and why it works across forms)
- "formCategories": string[] — subset of ${CONTENT_FORM_CATEGORIES.join(", ")}
- "format": string (the anchor format)
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
