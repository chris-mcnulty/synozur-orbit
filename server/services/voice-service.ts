/**
 * Voice Service
 *
 * Resolves a per-account voice profile + optional ICP persona + optional
 * messaging-framework refs (long-form, marketing-tagged grounding doc, or
 * global brand-voice/marketing-guideline doc) into a structured system
 * prompt for AI rewrites and composed posts.
 *
 * Design rules:
 *  - ICPs and frameworks are always optional. When omitted we render NO
 *    placeholder line — the model isn't biased toward a generic audience.
 *  - Per-doc text is truncated to a token budget; total grounding capped at
 *    ~6k tokens to keep rewrite latency predictable.
 *  - Phase-2 caching: callers pass tenantDomain to completeForFeature so the
 *    response cache picks up identical (voice, persona, framework, draft)
 *    rewrites without an extra layer here.
 */

import { db } from "../db";
import { and, eq, inArray } from "drizzle-orm";
import {
  socialAccounts,
  socialAccountVoiceProfiles,
  personas,
  longFormRecommendations,
  groundingDocuments,
  globalGroundingDocuments,
  MESSAGING_FRAMEWORK_GLOBAL_CATEGORIES,
  type SocialAccount,
  type SocialAccountVoiceProfile,
  type VoiceFrameworkRef,
  type VoiceProfileSnapshot,
  type Persona,
} from "@shared/schema";

// Per-doc and total budgets in approximate characters. ~4 chars/token.
const PER_DOC_CHAR_BUDGET = 8_000;
const TOTAL_GROUNDING_CHAR_BUDGET = 24_000;

export interface ResolvedFramework {
  kind: VoiceFrameworkRef["kind"];
  id: string;
  label: string;
  text: string;
}

export interface VoicePromptContext {
  account: SocialAccount;
  profile: SocialAccountVoiceProfile | null;
  persona?: Persona | null;
  frameworks: ResolvedFramework[];
  platform: string;
}

export interface BuildSystemPromptInput extends VoicePromptContext {
  /** Free-text the user typed in the rewrite panel (not the post itself). */
  instructions?: string | null;
}

// ─── Fetch helpers ──────────────────────────────────────────────────────────

export async function fetchVoiceProfile(socialAccountId: string): Promise<SocialAccountVoiceProfile | null> {
  const [row] = await db.select().from(socialAccountVoiceProfiles)
    .where(eq(socialAccountVoiceProfiles.socialAccountId, socialAccountId));
  return row ?? null;
}

export async function fetchPersona(personaId: string, tenantDomain: string): Promise<Persona | null> {
  const [row] = await db.select().from(personas).where(and(
    eq(personas.id, personaId),
    eq(personas.tenantDomain, tenantDomain),
  ));
  return row ?? null;
}

/**
 * Resolve a list of polymorphic framework refs to their text content,
 * filtering invalid refs and enforcing tenant scope. Total text returned
 * is capped at TOTAL_GROUNDING_CHAR_BUDGET; per-doc capped at
 * PER_DOC_CHAR_BUDGET. Returns the resolved list in input order.
 */
export async function resolveFrameworkRefs(
  refs: VoiceFrameworkRef[] | null | undefined,
  tenantDomain: string,
): Promise<ResolvedFramework[]> {
  if (!Array.isArray(refs) || refs.length === 0) return [];

  const longFormIds = refs.filter(r => r.kind === "long_form").map(r => r.id);
  const groundingIds = refs.filter(r => r.kind === "grounding").map(r => r.id);
  const globalIds = refs.filter(r => r.kind === "global").map(r => r.id);

  const [longFormRows, groundingRows, globalRows] = await Promise.all([
    longFormIds.length
      ? db.select({ id: longFormRecommendations.id, content: longFormRecommendations.content })
          .from(longFormRecommendations)
          .where(and(
            inArray(longFormRecommendations.id, longFormIds),
            eq(longFormRecommendations.tenantDomain, tenantDomain),
            eq(longFormRecommendations.type, "messaging_framework"),
          ))
      : Promise.resolve([] as Array<{ id: string; content: string | null }>),
    groundingIds.length
      ? db.select({
          id: groundingDocuments.id,
          name: groundingDocuments.name,
          contexts: groundingDocuments.contexts,
          extractedText: groundingDocuments.extractedText,
        }).from(groundingDocuments)
          .where(and(
            inArray(groundingDocuments.id, groundingIds),
            eq(groundingDocuments.tenantDomain, tenantDomain),
          ))
      : Promise.resolve([] as Array<{ id: string; name: string; contexts: string[] | null; extractedText: string | null }>),
    globalIds.length
      ? db.select({
          id: globalGroundingDocuments.id,
          name: globalGroundingDocuments.name,
          category: globalGroundingDocuments.category,
          extractedText: globalGroundingDocuments.extractedText,
        }).from(globalGroundingDocuments)
          .where(and(
            inArray(globalGroundingDocuments.id, globalIds),
            eq(globalGroundingDocuments.isActive, true),
          ))
      : Promise.resolve([] as Array<{ id: string; name: string; category: string; extractedText: string | null }>),
  ]);

  const longFormById = new Map(longFormRows.map(r => [r.id, r] as const));
  const groundingById = new Map(groundingRows.map(r => [r.id, r] as const));
  const globalById = new Map(globalRows.map(r => [r.id, r] as const));

  const out: ResolvedFramework[] = [];
  let total = 0;
  for (const ref of refs) {
    let label = "";
    let text = "";
    if (ref.kind === "long_form") {
      const row = longFormById.get(ref.id);
      if (!row || !row.content) continue;
      label = "Messaging Framework";
      text = row.content;
    } else if (ref.kind === "grounding") {
      const row = groundingById.get(ref.id);
      if (!row || !row.extractedText) continue;
      if (!Array.isArray(row.contexts) || !row.contexts.includes("marketing_content")) continue;
      label = row.name;
      text = row.extractedText;
    } else if (ref.kind === "global") {
      const row = globalById.get(ref.id);
      if (!row || !row.extractedText) continue;
      if (!(MESSAGING_FRAMEWORK_GLOBAL_CATEGORIES as readonly string[]).includes(row.category)) continue;
      label = row.name;
      text = row.extractedText;
    }
    if (!text) continue;
    const remaining = TOTAL_GROUNDING_CHAR_BUDGET - total;
    if (remaining <= 0) break;
    const truncated = text.length > Math.min(PER_DOC_CHAR_BUDGET, remaining)
      ? text.slice(0, Math.min(PER_DOC_CHAR_BUDGET, remaining)) + "\n…[truncated]"
      : text;
    out.push({ kind: ref.kind, id: ref.id, label, text: truncated });
    total += truncated.length;
  }
  return out;
}

// ─── Prompt assembly ────────────────────────────────────────────────────────

function toneAdjectives(tone: NonNullable<SocialAccountVoiceProfile["toneAttributes"]> | null): string {
  if (!tone) return "";
  const dims: Array<[keyof NonNullable<SocialAccountVoiceProfile["toneAttributes"]>, string]> = [
    ["formal", "formal"],
    ["playful", "playful"],
    ["technical", "technical"],
    ["warm", "warm"],
    ["bold", "bold"],
  ];
  const active = dims
    .map(([k, label]) => {
      const v = (tone as Record<string, number | undefined>)[k] ?? 0;
      if (v <= 0) return null;
      const intensity = v >= 0.8 ? "strongly" : v >= 0.5 ? "noticeably" : "somewhat";
      return `${intensity} ${label}`;
    })
    .filter(Boolean) as string[];
  return active.join(", ");
}

const HASHTAG_GUIDANCE: Record<string, string> = {
  none: "Do not include any hashtags.",
  minimal: "Use 1–2 hashtags maximum.",
  standard: "Include 3–5 relevant hashtags.",
  heavy: "Include 6+ relevant hashtags.",
};

const EMOJI_GUIDANCE: Record<string, string> = {
  none: "Do not use emoji.",
  sparing: "Use emoji sparingly — at most one or two per post when they add real meaning.",
  liberal: "Emoji are welcome to add tone and visual rhythm.",
};

export function buildSystemPrompt(input: BuildSystemPromptInput): string {
  const { account, profile, persona, frameworks, platform } = input;
  const lines: string[] = [];

  lines.push(`You are drafting a ${platform} post on behalf of ${account.accountName}.`);

  // Person + perspective
  if (profile) {
    const person = profile.person === "third" ? "third" : "first";
    const persp = profile.authorPerspective === "brand" ? "as the brand/company" : "as an individual";
    lines.push(`Speak in the ${person} person, ${persp}.`);
  }

  // Tone
  const tone = profile?.toneAttributes ? toneAdjectives(profile.toneAttributes) : "";
  if (tone) lines.push(`Tone: ${tone}.`);

  // Style guidance
  if (profile?.styleGuidance) {
    lines.push(`Style notes: ${profile.styleGuidance.trim()}`);
  }

  // Policies
  if (profile) {
    lines.push(EMOJI_GUIDANCE[profile.emojiPolicy] ?? EMOJI_GUIDANCE.sparing);
    lines.push(HASHTAG_GUIDANCE[profile.hashtagPolicy] ?? HASHTAG_GUIDANCE.standard);
  }
  if (profile?.maxLength) {
    lines.push(`Keep the post under ${profile.maxLength} characters.`);
  }

  // Phrase preferences
  if (profile?.preferredPhrases?.length) {
    lines.push(`Prefer phrases: ${profile.preferredPhrases.map(p => `"${p}"`).join(", ")}.`);
  }
  if (profile?.forbiddenPhrases?.length) {
    lines.push(`Never use these phrases: ${profile.forbiddenPhrases.map(p => `"${p}"`).join(", ")}.`);
  }

  // Few-shot snippets
  if (profile?.sampleSnippets && profile.sampleSnippets.length > 0) {
    lines.push("");
    lines.push("Examples of the desired voice:");
    profile.sampleSnippets.forEach((s, i) => {
      const label = s.label ? ` (${s.label})` : "";
      lines.push(`Example ${i + 1}${label}:\n${s.content.trim()}`);
    });
  }

  // Audience (optional — only if a persona was supplied)
  if (persona) {
    lines.push("");
    lines.push("Audience:");
    lines.push(`- Persona: ${persona.name}${persona.role ? ` (${persona.role})` : ""}${persona.isIcp ? " — ICP" : ""}`);
    if (persona.industry) lines.push(`- Industry: ${persona.industry}`);
    if (persona.companySize) lines.push(`- Company size: ${persona.companySize}`);
    if (persona.painPoints?.length) lines.push(`- Pain points: ${persona.painPoints.join("; ")}`);
    if (persona.goals?.length) lines.push(`- Goals: ${persona.goals.join("; ")}`);
    if (persona.objections?.length) lines.push(`- Likely objections: ${persona.objections.join("; ")}`);
  }

  // Messaging frameworks (optional — only if any refs resolved)
  if (frameworks.length > 0) {
    lines.push("");
    lines.push("Messaging guidance from the following sources. Treat as authoritative for positioning, vocabulary, and brand claims:");
    frameworks.forEach((f, idx) => {
      lines.push("");
      lines.push(`--- ${idx + 1}. ${f.label} ---`);
      lines.push(f.text);
    });
    lines.push("");
    lines.push("--- end of messaging guidance ---");
  }

  // User-supplied free-text instructions
  if (input.instructions && input.instructions.trim()) {
    lines.push("");
    lines.push(`Additional instructions from the author: ${input.instructions.trim()}`);
  }

  return lines.join("\n");
}

// ─── User prompt for rewrites ───────────────────────────────────────────────

export interface BuildUserPromptInput {
  draft?: string | null;
  brief?: string | null;
  variantCount?: number;
}

export function buildRewriteUserPrompt(input: BuildUserPromptInput): string {
  const variantCount = Math.max(1, Math.min(5, input.variantCount ?? 3));
  const lines: string[] = [];
  if (input.draft && input.draft.trim()) {
    lines.push("Current draft:");
    lines.push(input.draft.trim());
  } else if (input.brief && input.brief.trim()) {
    lines.push("Brief / topic to draft from:");
    lines.push(input.brief.trim());
  } else {
    lines.push("Draft a short post in the configured voice. Pick an angle that fits the audience and any messaging guidance above.");
  }
  lines.push("");
  lines.push(
    `Return ${variantCount} distinct variants. Each variant must stand alone — no preamble, no prefix labels, no commentary.`
  );
  lines.push("Separate variants with the literal line `---VARIANT---` on its own line. Output ONLY the variants and the separators.");
  return lines.join("\n");
}

export function parseVariants(text: string, expected: number): string[] {
  const parts = text.split(/^---VARIANT---\s*$/m).map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return [text.trim()].filter(Boolean);
  // If the model returned only a single block, treat the whole thing as one
  // variant rather than failing — the caller will display what it got.
  return parts.slice(0, Math.max(parts.length, expected));
}

// ─── Snapshot capture (for generated_posts.voice_profile_snapshot) ──────────

export function snapshotVoiceProfile(
  profile: SocialAccountVoiceProfile,
): VoiceProfileSnapshot {
  return {
    profileId: profile.id,
    capturedAt: new Date().toISOString(),
    person: (profile.person === "third" ? "third" : "first"),
    authorPerspective: (profile.authorPerspective === "brand" ? "brand" : "individual"),
    toneAttributes: profile.toneAttributes ?? null,
    styleGuidance: profile.styleGuidance ?? null,
    forbiddenPhrases: profile.forbiddenPhrases ?? null,
    preferredPhrases: profile.preferredPhrases ?? null,
    emojiPolicy: (profile.emojiPolicy as VoiceProfileSnapshot["emojiPolicy"]) ?? "sparing",
    hashtagPolicy: (profile.hashtagPolicy as VoiceProfileSnapshot["hashtagPolicy"]) ?? "standard",
    maxLength: profile.maxLength ?? null,
    defaultPersonaId: profile.defaultPersonaId ?? null,
    defaultFrameworkRefs: profile.defaultFrameworkRefs ?? null,
  };
}
