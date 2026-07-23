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

export const BANNED_WORDS =
  "delve, foster, utilize, facilitate, streamline, robust, cutting-edge, paradigm shift, tapestry, beacon, " +
  "meticulous, intricate, paramount, transformative, elevate, embark, supercharge, harness, ever-evolving, " +
  "synergy, leverage, unlock, empower, game-changer, deep dive, seamless, scalable, actionable, holistic, " +
  "ecosystem, journey (metaphorical), innovative, disruptive, revolutionary, groundbreaking, landscape " +
  "(metaphorical), spearhead, reimagine, revolutionize, craft (as marketing verb), curated, authenticity " +
  "(as marketing claim), storytelling (as strategy noun), bandwidth (metaphorical), circle back, touch base, " +
  "move the needle, boil the ocean, at the end of the day";

export const STRUCTURAL_ANTI_PATTERNS =
  "Structural anti-patterns — never write these:\n" +
  "1. Throat-clearing openers: \"In today's [adj] world/landscape\", \"It's no secret that\", \"Now more than ever\", \"As we all know\", \"In an era of\".\n" +
  "2. Binary contrasts: \"While some X, others Y. The truth is Z.\"\n" +
  "3. Faux-insight setups: \"Here's the thing:\", \"What many don't realize is\", \"The real question is\", \"Here's what that means:\".\n" +
  "4. Colon-reveal drama: \"The answer:\" or \"[Noun]:\" as a standalone sentence opener used for dramatic effect.\n" +
  "5. Fake-profound kickers: \"At the end of the day\", \"When all is said and done\", \"Only time will tell\", \"The future belongs to\".\n" +
  "6. Summary-recap endings: \"In summary\", \"To sum up\", \"In conclusion\", \"Ultimately, what we've explored here\".\n" +
  "7. Importance puffery: \"This is critical/vital/essential/crucial to understand\", \"One of the most important things\".\n" +
  "8. Weasel attribution: \"Studies show\", \"Research suggests\", \"Experts say\" — without naming the source.\n" +
  "9. Superficial -ing clause openers: \"By leveraging X, companies can Y\", \"By harnessing Z, teams will...\".\n" +
  "10. Negative listing: \"not just X, but Y\" and \"not only X, but also Y\" constructions.\n" +
  "11. Formatting slop: emoji in bullet lists, mid-sentence **bold** for dramatic emphasis (bold is for headings and genuinely key terms only).";

const VOICE_NON_NEGOTIABLES =
  "Voice non-negotiables:\n" +
  "- Sentence case in body copy. No title case beyond the main headline.\n" +
  "- No em dashes. Use commas, periods, or line breaks.\n" +
  "- No hashtags, on any platform.\n" +
  "- No banned words or corporate filler: " + BANNED_WORDS + ".\n" +
  "- No rhetorical questions as transitions (\"But here's the thing...\", \"Want to know what happened next?\").\n" +
  "- Every piece ends on a hard CTA or a punchline closer, never a soft landing.\n" +
  "- Anti-hype. Write like a practitioner sharing what they learned, not a brand broadcasting a message.\n" +
  "- Never fabricate statistics, customer names, or quotes.\n" +
  STRUCTURAL_ANTI_PATTERNS;

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

const SHARPEN_SYSTEM_PROMPT =
  "You are a copy editor removing AI-writing patterns from a draft. Your job is the minimum effective edit: " +
  "change only sentences that have a problem, preserve everything else exactly. Keep all facts, specifics, " +
  "names, numbers, and the author's tone. Do not expand, pad, restructure, or add new content.\n\n" +
  VOICE_NON_NEGOTIABLES +
  "\n\n## Editing principles (apply all)\n" +
  "1. Preserve the author's point without adding claims, examples, stats, quotes, or opinions not in the original.\n" +
  "2. Preserve the writer's vocabulary, cadence, bluntness, humor, uncertainty, digressions, and level of polish.\n" +
  "3. Leave strong human sentences alone — do not rewrite them for consistency or make every paragraph equally tidy.\n" +
  "4. Cut only in proportion to actual slop — no aggressive compression that strips character.\n" +
  "5. Keep personal setup that adds context, tension, or character; front-load points only where it clearly improves clarity.\n" +
  "6. Keep concrete facts, protected details, and direct verbs where the draft already has them.\n" +
  "7. Prefer active voice with human subjects where the draft supports it.\n" +
  "8. Fix genuinely tangled sentences; preserve clear spoken cadence, fragments, and changes in pace.\n" +
  "9. Keep useful edge and structure unless the structure was hurting the piece.\n\n" +
  "## Patterns to cut (mechanically, not stylistically)\n" +
  "- Binary contrasts, negative listings, rhetorical setups, throat-clearing openers.\n" +
  "- Faux-insight setups and colon reveals (e.g. 'Here's what that means:', 'The result? X.').\n" +
  "- Fake-strong verbs, synonym cycling, robotic rhythm, dramatic one-line fragments used for effect.\n" +
  "- Importance puffery — replace with plain facts; flag claims with no named source instead of inventing one.\n" +
  "- Weasel attribution ('some experts say', 'many companies find') — use named sources or delete.\n" +
  "- Fake-profound kicker lines — delete them; do not rewrite into better metaphors.\n" +
  "- Summary-recap endings — end on a concrete point, takeaway, or next action instead.\n" +
  "- Formatting slop: emoji headings, decorative bold, bullets that should be prose, headers over tiny sections.\n" +
  "- Em dashes used decoratively — keep 0-1 in short copy, max 2 in longer drafts when they clearly help.\n\n" +
  "## Pass/fail self-check before returning\n" +
  "Run each check mentally. Fix any failure before returning the output.\n" +
  "- No banned words remain (unless quoted as examples).\n" +
  "- No throat-clearing openers, rhetorical setups, or binary contrasts.\n" +
  "- No faux-insight setups, fake-profound kickers, or summary-recap endings.\n" +
  "- No weasel attribution or importance puffery.\n" +
  "- No formatting slop.\n" +
  "- The draft does not have robotic symmetry or stacked punchy fragments.\n" +
  "- The writer would recognise the edited draft as their own voice.\n" +
  "- The draft would sound natural if read aloud to a sharp colleague.\n" +
  "- The 'What changed' section lists only real edits, not reformulations of the same edit.";


export interface DraftFromBriefResult extends ParsedDraft {
  format: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export async function draftFromBrief(
  brief: ContentBrief,
  opts: { isDefaultMarket?: boolean; instructions?: string; guest?: string | null; soundLikeMeInstructions?: string | null; sourceContext?: string | null } = {},
): Promise<DraftFromBriefResult> {
  const format = coerceFormat(brief.format);

  // When the draft is source-driven (synthesized from existing content, e.g.
  // a LinkedIn digest or a repurposed asset), competitive intelligence and
  // briefing action items steer the AI away from the source material and
  // produce irrelevant output. Strip those sections but keep messaging
  // framework, GTM plan, personas, and brand identity — those are still
  // appropriate voice/positioning grounding.
  const hasSourceContext = !!opts.sourceContext?.trim();

  const strategicCtx = await loadStrategicContext(
    brief.tenantDomain,
    brief.marketId || undefined,
    opts.isDefaultMarket,
  );
  // For source-driven drafts, zero out competitive intel and briefing action
  // items before formatting so they never reach the prompt.
  const strategicBlock = formatStrategicContextForPrompt(
    hasSourceContext
      ? { ...strategicCtx, competitiveIntelligence: "", briefingActionItems: "" }
      : strategicCtx,
  );

  let personaBlock = "";
  if (brief.targetPersonaId) {
    const [persona] = await db
      .select()
      .from(personas)
      .where(eq(personas.id, brief.targetPersonaId));
    if (persona) personaBlock = formatPersonaContextForPrompt([persona as any]);
  }

  // Founding signals are also skipped for source-driven drafts — they supply
  // campaign context that is irrelevant when the output must stay faithful to
  // the provided source material.
  let foundingSignalsBlock = "";
  if (brief.campaignId && !hasSourceContext) {
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
<the full post — use ## for section headings, ### for sub-headings, **bold** for emphasis, and - for bulleted lists; include inline hyperlinks as [text](url) where relevant>
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
    opts.sourceContext?.trim() ? `## Source content (synthesize from this — do not invent facts outside it)\n${opts.sourceContext.trim()}` : "",
    opts.instructions?.trim() ? `## Additional instructions\n${opts.instructions.trim()}` : "",
    responseFormat,
  ]
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt = opts.soundLikeMeInstructions?.trim()
    ? SYSTEM_PROMPT + `\n\nWriting instructions (follow exactly):\n${opts.soundLikeMeInstructions.trim()}`
    : SYSTEM_PROMPT;

  const result = await completeForFeature("marketing_tasks", prompt, {
    tenantDomain: brief.tenantDomain,
    systemPrompt,
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

export interface SharpenParams {
  tenantDomain: string;
  /** The full draft text to sharpen (Markdown). */
  content: string;
  /** Optional email subject line — returned sharpened if provided. */
  subject?: string | null;
}

export interface SharpenResult {
  content: string;
  subject: string | null;
  changelog: string[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

/**
 * Apply a minimum-effective-edit pass to remove AI-slop patterns from a draft.
 * Only changes sentences that violate the voice rules; preserves everything else.
 * Returns the cleaned draft plus a short bullet changelog of what changed.
 */
export async function sharpenContent(p: SharpenParams): Promise<SharpenResult> {
  const subjectLine = p.subject?.trim()
    ? `Subject line: ${p.subject.trim()}\n\n`
    : "";

  const prompt = [
    "Remove AI-writing patterns from the draft below. Apply the minimum effective edit: only change sentences that have a clear problem. Preserve all facts, names, numbers, structure, and the author's tone exactly.",
    "Problems to fix (change ONLY sentences that have one of these):\n" +
    "- Banned words (replace with concrete, plain alternatives or cut)\n" +
    "- Throat-clearing openers, faux-insight setups, fake-profound kickers\n" +
    "- Importance puffery and weasel attribution\n" +
    "- Superficial -ing clause openers\n" +
    "- Summary-recap endings\n" +
    "- Formatting slop (emoji in bullets, mid-sentence bold for drama)",
    `## Draft to sharpen\n${subjectLine}${p.content}`,
    `## Response format\nRespond with exactly these two sections and nothing else:\n===DRAFT===\n<the full edited draft in Markdown, subject line first if one was provided>\n===CHANGELOG===\n<bullet list of what changed, max 8 bullets, one sentence each — if nothing needed changing, write "No AI-slop patterns found.">`,
  ].join("\n\n");

  const result = await completeForFeature("marketing_tasks", prompt, {
    tenantDomain: p.tenantDomain,
    systemPrompt: SHARPEN_SYSTEM_PROMPT,
    maxTokens: 8192,
  });

  const text = result.text;
  const draftMatch = text.match(/===DRAFT===\s*([\s\S]*?)(?:===CHANGELOG===|$)/i);
  const changelogMatch = text.match(/===CHANGELOG===\s*([\s\S]*)$/i);

  let rawDraft = draftMatch ? draftMatch[1].trim() : text.trim();
  const rawChangelog = changelogMatch ? changelogMatch[1].trim() : "";

  // Split off the subject line if one was provided.
  let returnedSubject: string | null = null;
  if (p.subject?.trim()) {
    const lines = rawDraft.split("\n");
    const subjectLineIdx = lines.findIndex((l) => /^subject\s*line\s*[:：]/i.test(l.trim()) || /^subject\s*[:：]/i.test(l.trim()));
    if (subjectLineIdx >= 0) {
      returnedSubject = lines[subjectLineIdx].replace(/^.*?[:：]\s*/i, "").trim() || p.subject.trim();
      rawDraft = lines.slice(subjectLineIdx + 1).join("\n").trim();
    } else {
      returnedSubject = p.subject.trim();
    }
  }

  const changelog = rawChangelog
    .split(/\n+/)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 8);

  return {
    content: rawDraft || p.content,
    subject: returnedSubject,
    changelog,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    model: result.model,
  };
}
