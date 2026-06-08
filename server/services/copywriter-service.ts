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
} from "./strategic-context";
import { completeForFeature } from "./ai-provider";
import {
  FORMAT_GUIDANCE,
  parseDraftResponse,
  coerceFormat,
  type ParsedDraft,
} from "./editorial-calendar-core";

const SYSTEM_PROMPT =
  "You are an expert B2B copywriter. You write in the brand's established voice and positioning, " +
  "never contradicting the messaging framework provided. You write for one specific reader, lead with " +
  "their problem, and earn the call to action. You never fabricate statistics, customer names, or quotes. " +
  "Respond using ONLY the requested ===TITLE===/===BODY===/===META=== format.";

export interface DraftFromBriefResult extends ParsedDraft {
  format: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export async function draftFromBrief(
  brief: ContentBrief,
  opts: { isDefaultMarket?: boolean; instructions?: string } = {},
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

  const prompt = [
    `Draft this piece of content.`,
    strategicBlock,
    personaBlock,
    briefBlock,
    `## Format guidance\n${FORMAT_GUIDANCE[format]}`,
    opts.instructions?.trim() ? `## Additional instructions\n${opts.instructions.trim()}` : "",
    `## Response format
Respond with exactly these three sections and nothing else:
===TITLE===
<the final, polished title/headline>
===BODY===
<the full draft in Markdown>
===META===
<a one-sentence summary / meta description, max 155 characters>`,
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
