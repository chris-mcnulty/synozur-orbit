/**
 * Copywriter Service — draft content from an accepted content brief.
 *
 * Turns a structured brief (Phase 1, step 1) into a publishable first draft in
 * the brief's format. Voice/positioning come from the StrategicContext (the
 * MPF + brand identity from Phase 0); the persona, when set on the brief, adds
 * audience grounding. Synchronous, matching the email generator.
 */

import { type ContentBrief, personas } from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";
import {
  loadStrategicContext,
  formatStrategicContextForPrompt,
  formatPersonaContextForPrompt,
  loadCampaignFoundingSignals,
  formatFoundingSignalsForPrompt,
} from "./strategic-context";
import { completeForFeature } from "./ai-provider";
import {
  FORMAT_GUIDANCE,
  parseDraftResponse,
  coerceFormat,
  type ParsedDraft,
} from "./editorial-calendar-core";
import { polarisGuestBlock } from "./polaris-outline";

const VOICE_NON_NEGOTIABLES =
  "Voice non-negotiables:\n" +
  "- Sentence case in body copy. No title case beyond the main headline.\n" +
  "- No em dashes. Use commas, periods, or line breaks.\n" +
  "- No hashtags, on any platform.\n" +
  "- No corporate filler: synergy, leverage, unlock, empower, game-changer, deep dive, at the end of the day.\n" +
  "- No rhetorical questions as transitions (\"But here's the thing...\", \"Want to know what happened next?\").\n" +
  "- Every piece ends on a hard CTA or a punchline closer, never a soft landing.\n" +
  "- Anti-hype. Write like a practitioner sharing what they learned, not a brand broadcasting a message.\n" +
  "- Never fabricate statistics, customer names, or quotes.";

const SELF_CHECK =
  "Before finishing, self-check and fix any that fail: Does the hook earn the next line? " +
  "Could a competitor publish this word-for-word (if so, add specificity)? Is the CTA concrete and " +
  "tied to the content (not \"follow for more\")? Does it sound like a person, not a brand account? " +
  "Is it within the format's length?";

const SYSTEM_PROMPT =
  "You are a senior B2B copywriter. You write in the brand's established voice and positioning, " +
  "never contradicting the messaging framework provided. You write for one specific reader, lead with " +
  "their problem, and earn the call to action.\n\n" +
  VOICE_NON_NEGOTIABLES +
  "\n\n" +
  SELF_CHECK +
  "\n\nRespond using ONLY the sections specified in the Response format section of the prompt.";

const REWRITE_SYSTEM_PROMPT =
  "You are a senior B2B copy editor. You revise existing content per the user's instructions while " +
  "preserving the brand's voice and positioning and never fabricating facts, stats, or quotes.\n\n" +
  VOICE_NON_NEGOTIABLES +
  "\n\nReturn ONLY the revised content in Markdown. No preamble, no commentary, no code fences.";

export interface DraftFromBriefResult extends ParsedDraft {
  format: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export async function draftFromBrief(
  brief: ContentBrief,
  opts: { isDefaultMarket?: boolean; instructions?: string; guest?: string | null } = {},
): Promise<DraftFromBriefResult> {
  const format = coerceFormat(brief.format);

  const strategicCtx = await loadStrategicContext(
    brief.tenantDomain,
    brief.marketId || undefined,
    opts.isDefaultMarket,
  );
  const strategicBlock = formatStrategicContextForPrompt(strategicCtx);

  let personaBlock = "";
  if (brief.targetPersonaId) {
    const [persona] = await db
      .select()
      .from(personas)
      .where(eq(personas.id, brief.targetPersonaId));
    if (persona) personaBlock = formatPersonaContextForPrompt([persona as any]);
  }

  // Frozen founding signals from the brief's campaign (if any) — supporting
  // facts the copywriter may cite. Briefs not tied to a campaign skip this.
  let foundingSignalsBlock = "";
  if (brief.campaignId) {
    const fs = await loadCampaignFoundingSignals(brief.campaignId);
    foundingSignalsBlock = formatFoundingSignalsForPrompt(fs);
  }

  const briefBlock = [
    "## Content Brief",
    `Working title: ${brief.title}`,
    `Format: ${format}`,
    brief.targetKeyword ? `Target keyword: ${brief.targetKeyword}` : "",
    brief.funnelStage ? `Funnel stage: ${brief.funnelStage}` : "",
    brief.demandSignal ? `Demand signal (why this matters): ${brief.demandSignal}` : "",
    brief.differentiationAngle ? `Differentiation angle (our unique take): ${brief.differentiationAngle}` : "",
    brief.targetReader ? `Write for this specific reader: ${brief.targetReader}` : "",
    brief.cta ? `Call to action: ${brief.cta}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const responseFormat =
    format === "blog_post"
      ? `## Response format
Respond with exactly these six sections and nothing else:
===TITLE===
<the final, polished title/headline>
===SUBTITLE===
<a single-sentence subtitle that adds context or intrigue to the title>
===OVERVIEW===
<a compelling summary of the post's core argument, max 480 characters — this is used as a preview blurb>
===BODY===
<the full post — no Markdown heading syntax (#, ##, ###); use **Bold Section Header** for section titles>
===META===
<a one-sentence meta description, max 155 characters>
===TAGS===
<3-5 comma-delimited tags (topics, themes, keywords relevant to the post)>`
      : `## Response format
Respond with exactly these three sections and nothing else:
===TITLE===
<the final, polished title/headline>
===BODY===
<the full draft in Markdown>
===META===
<a one-sentence summary / meta description, max 155 characters>`;

  const prompt = [
    `Draft this piece of content.`,
    strategicBlock,
    foundingSignalsBlock,
    personaBlock,
    briefBlock,
    `## Format guidance\n${FORMAT_GUIDANCE[format]}`,
    format === "podcast_outline" ? polarisGuestBlock(opts.guest) : "",
    opts.instructions?.trim() ? `## Additional instructions\n${opts.instructions.trim()}` : "",
    responseFormat,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await completeForFeature("marketing_tasks", prompt, {
    tenantDomain: brief.tenantDomain,
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: 8192,
  });

  const parsed = parseDraftResponse(result.text);
  return {
    ...parsed,
    title: parsed.title || brief.title,
    format,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    model: result.model,
  };
}

export interface RewriteParams {
  tenantDomain: string;
  marketId?: string | null;
  isDefaultMarket?: boolean;
  title: string;
  body: string;
  format: string;
  instructions: string;
}

export interface RewriteResult {
  body: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

/** Revise an existing long-form draft per instructions, keeping brand voice. */
export async function rewriteLongFormContent(p: RewriteParams): Promise<RewriteResult> {
  const format = coerceFormat(p.format);
  const strategicCtx = await loadStrategicContext(p.tenantDomain, p.marketId || undefined, p.isDefaultMarket);
  const strategicBlock = formatStrategicContextForPrompt(strategicCtx);

  const prompt = [
    "Revise the content below according to the instructions.",
    strategicBlock,
    `## Format guidance\n${FORMAT_GUIDANCE[format]}`,
    `## Current content\nTitle: ${p.title}\n\n${p.body.slice(0, 12000)}`,
    `## Instructions\n${p.instructions.trim()}`,
    "## Response\nReturn ONLY the full revised content in Markdown.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await completeForFeature("marketing_tasks", prompt, {
    tenantDomain: p.tenantDomain,
    systemPrompt: REWRITE_SYSTEM_PROMPT,
    maxTokens: 8192,
  });

  return {
    body: parseDraftResponse(result.text).body,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    model: result.model,
  };
}
