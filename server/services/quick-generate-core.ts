/**
 * Quick Generate core — pure helpers for the prompt-grounded "Quick Generate"
 * flow (one free-text prompt → social posts / blog post / newsletter email).
 *
 * Modeled on the SignalAI angles-first ideation pattern: the user's raw prompt
 * is the ONLY factual source. An optional angle — one "distinct take or hook"
 * string plus 3–5 key points drawn from the prompt — can steer the take, but
 * is never a strategy object (no demand signal / differentiation forcing,
 * which is what makes the interview flow hallucinate on plain announcements).
 *
 * Everything in this file is deterministic and unit-testable; the AI calls
 * live in quick-generate-service.ts.
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";
import { coerceFitAssessment } from "./brief-interview-core";
import { clampForPlatform, coercePlatform, SUPPORTED_PLATFORMS, type RepurposePlatform } from "./repurpose-core";
import type { BriefFitAssessment } from "@shared/schema";

// ── Deliverables ────────────────────────────────────────────────────────────

export const QUICK_DELIVERABLES = ["social", "blog", "newsletter"] as const;
export type QuickDeliverable = (typeof QUICK_DELIVERABLES)[number];

export function coerceDeliverables(raw: unknown): QuickDeliverable[] {
  const values = Array.isArray(raw) ? raw : [];
  const out: QuickDeliverable[] = [];
  for (const v of values) {
    const norm = String(v).trim().toLowerCase();
    if ((QUICK_DELIVERABLES as readonly string[]).includes(norm) && !out.includes(norm as QuickDeliverable)) {
      out.push(norm as QuickDeliverable);
    }
  }
  return out;
}

// ── Grounding rules (shared across every Quick Generate prompt) ─────────────

export const QUICK_GROUNDING_RULES =
  "Grounding rules (strict, non-negotiable):\n" +
  "- The user's prompt is the ONLY source of facts. State only facts present in it: events, venues, dates, piece or work names, sponsor thanks, invitations.\n" +
  "- Do NOT invent products, collections, series names, career narratives, statistics, awards, press mentions, quotes, or history the prompt does not state.\n" +
  "- Do NOT add market positioning, differentiation claims, demand signals, or competitor commentary.\n" +
  "- Fix obvious spelling and typing mistakes from the prompt in your output (e.g. \"Plam Springs\" becomes \"Palm Springs\", \"favorit peices\" becomes \"favorite pieces\") without changing any facts.\n" +
  "- If the prompt does not state a detail, leave it out rather than guessing.";

// ── Angles ──────────────────────────────────────────────────────────────────

export interface QuickAngle {
  title: string;
  summary: string | null;
  /** The distinct take or hook — one string, never a strategy object. */
  angle: string;
  /** 3–5 key points sourced only from the prompt. */
  keyPoints: string[];
  audience: string | null;
  fitAssessment: BriefFitAssessment;
}

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
};

/**
 * Normalize one raw AI angle object. Returns null when there is no usable
 * hook (neither `angle` nor `title`). Weak-fit angles are KEPT — the fit
 * assessment marks them "reject" so the UI can show them as not recommended
 * rather than silently omitting them.
 */
export function normalizeQuickAngle(raw: any): QuickAngle | null {
  const angle = str(raw?.angle) ?? str(raw?.hook) ?? str(raw?.title);
  if (!angle) return null;
  const title = str(raw?.title) ?? angle;

  const keyPointsRaw = Array.isArray(raw?.keyPoints)
    ? raw.keyPoints
    : Array.isArray(raw?.key_points)
      ? raw.key_points
      : [];
  const keyPoints = keyPointsRaw
    .map((p: unknown) => String(p ?? "").trim())
    .filter(Boolean)
    .slice(0, 5);

  return {
    title,
    summary: str(raw?.summary),
    angle,
    keyPoints,
    audience: str(raw?.audience),
    fitAssessment: coerceFitAssessment(raw?.fitAssessment ?? raw?.fit_assessment),
  };
}

/** Strip code fences and parse a JSON array (direct or embedded in prose). */
export function parseJsonArrayLoose(text: string): any[] {
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  try {
    const direct = JSON.parse(cleaned);
    if (Array.isArray(direct)) return direct;
  } catch {
    // fall through to embedded-array extraction
  }
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const embedded = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(embedded)) return embedded;
    } catch {
      // no usable array
    }
  }
  return [];
}

export const MAX_QUICK_ANGLES = 8;

// ── Angle tokens (server-bound angles) ──────────────────────────────────────
//
// The angles endpoint signs every angle it generates, bound to the tenant and
// the exact prompt. The drafting endpoint only accepts an angle whose token
// verifies — a client-invented or hand-edited angle would otherwise be a
// fact-injection path into prompts that promise to be prompt-grounded.

/** Canonical serialization: exactly the fields that reach drafting prompts, in fixed order. */
function canonicalAngle(angle: QuickAngle): string {
  return JSON.stringify({
    title: angle.title,
    summary: angle.summary,
    angle: angle.angle,
    keyPoints: angle.keyPoints,
    audience: angle.audience,
    fitAssessment: {
      voiceFit: angle.fitAssessment.voiceFit,
      topicFit: angle.fitAssessment.topicFit,
      recommendation: angle.fitAssessment.recommendation,
      rationale: angle.fitAssessment.rationale,
    },
  });
}

export interface AngleTokenScope {
  prompt: string;
  tenantDomain: string;
  secret: string;
}

export function signQuickAngle(angle: QuickAngle, scope: AngleTokenScope): string {
  const promptHash = createHash("sha256").update(scope.prompt.trim()).digest("hex");
  return createHmac("sha256", scope.secret)
    .update(`${scope.tenantDomain}\n${promptHash}\n${canonicalAngle(angle)}`)
    .digest("hex");
}

export function verifyQuickAngleToken(
  angle: QuickAngle,
  token: unknown,
  scope: AngleTokenScope,
): boolean {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return false;
  const expected = signQuickAngle(angle, scope);
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(token, "hex"));
}

export function parseQuickAngles(text: string): QuickAngle[] {
  return parseJsonArrayLoose(text)
    .map(normalizeQuickAngle)
    .filter((a): a is QuickAngle => a !== null)
    .slice(0, MAX_QUICK_ANGLES);
}

/**
 * Format the selected angle for a drafting prompt. The angle string travels
 * VERBATIM (Bleu Trail's copywriter pattern: "- Angle: <angle>"); key points
 * ride along as prompt-sourced emphasis, never as new facts.
 */
export function buildAngleBlock(angle: QuickAngle | null | undefined): string {
  if (!angle?.angle?.trim()) return "";
  const lines = [
    "## Selected angle (steers the take — it adds NO new facts)",
    `- Angle: ${angle.angle.trim()}`,
  ];
  if (angle.keyPoints.length) {
    lines.push("- Key points to work in (all drawn from the prompt):");
    for (const p of angle.keyPoints) lines.push(`  - ${p}`);
  }
  if (angle.audience) lines.push(`- Audience: ${angle.audience}`);
  return lines.join("\n");
}

// ── Prompt builders ─────────────────────────────────────────────────────────

export function buildQuickAnglesPrompt(params: { prompt: string; voiceBlock?: string }): string {
  return [
    `Propose 6-8 candidate content angles for the announcement below.`,
    params.voiceBlock?.trim() ?? "",
    `## The user's prompt (the ONLY source of facts)\n${params.prompt.trim()}`,
    `## Rules
- An "angle" is ONE distinct take or hook, expressed as a single sentence. It is NOT a strategy: no demand signals, no differentiation claims, no positioning.
- Angles must be genuinely different from each other — a different emphasis, audience, or way in. No near-duplicates.
- keyPoints: 3-5 short points, each drawn ONLY from facts stated in the prompt. Never introduce a fact the prompt does not contain.
- Assess each angle honestly: voiceFit and topicFit are "strong", "moderate", or "weak" against the brand voice above and the prompt's subject. recommendation is "keep" or "reject" with a one-sentence rationale.
- Include weak angles with recommendation "reject" and an honest rationale — do NOT omit them.
- ${QUICK_GROUNDING_RULES.split("\n").join("\n- ").replace(/^- Grounding/, "Grounding")}

## Output JSON shape (array of 6-8, JSON only, no prose)
[{ "title": string, "summary": string (1-2 sentences), "angle": string (the distinct take or hook, one sentence), "keyPoints": string[] (3-5, prompt-sourced only), "audience": string, "fitAssessment": { "voiceFit": "strong" | "moderate" | "weak", "topicFit": "strong" | "moderate" | "weak", "recommendation": "keep" | "reject", "rationale": string } }]`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildQuickSocialPrompt(params: {
  prompt: string;
  platforms: RepurposePlatform[];
  count: number;
  angleBlock?: string;
  /** Style-only brand grounding (voice rules + brand identity) — never a fact source. */
  brandBlock?: string;
}): string {
  return [
    `Write ${params.count} social post draft(s) spread across these platforms: ${params.platforms.join(", ")}. They announce exactly what the user's prompt below says — nothing more.`,
    params.brandBlock?.trim() ?? "",
    `## The user's prompt (the ONLY source of facts — quote it, don't extend it)\n${params.prompt.trim()}`,
    params.angleBlock?.trim() ?? "",
    `## Rules
- ${QUICK_GROUNDING_RULES.split("\n").slice(1).join("\n- ").replace(/^- -/gm, "-")}
- Match each platform's native style and length (LinkedIn: 100-250 words; Twitter/X: under 280 characters; Instagram/Facebook: short and warm).
- Each post takes a slightly different way in, but all stay inside the prompt's facts.
- No hashtags.
- "imagePrompt": a concise visual concept for a paired graphic using only subjects the prompt mentions, or null.
- "scheduledDate": an ISO date (YYYY-MM-DD) ONLY when the prompt explicitly states a specific date the post should go out; otherwise null. A date range or month is NOT a specific date — use null.

## Output JSON shape (array of exactly ${params.count}, JSON only)
[{ "platform": "${SUPPORTED_PLATFORMS.join('" | "')}", "content": string, "imagePrompt": string | null, "scheduledDate": string | null }]`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildQuickNewsletterPrompt(params: {
  prompt: string;
  angleBlock?: string;
  /** Style-only brand grounding (voice rules + brand identity) — never a fact source. */
  brandBlock?: string;
}): string {
  return [
    `Write an email newsletter draft announcing exactly what the user's prompt below says — nothing more.`,
    params.brandBlock?.trim() ?? "",
    `## The user's prompt (the ONLY source of facts)\n${params.prompt.trim()}`,
    params.angleBlock?.trim() ?? "",
    `## Rules
- ${QUICK_GROUNDING_RULES.split("\n").slice(1).join("\n- ").replace(/^- -/gm, "-")}
- Plain text only — no HTML tags. Use line breaks and simple dashes for structure.
- A personal-feeling intro, 1-3 short sections, and a clear closing invitation drawn from the prompt.
- Do NOT add an "About" section, sign-off boilerplate, or footer.

## Response format (use these exact delimiters)
===EMAIL_BODY_START===
(the email body)
===EMAIL_BODY_END===

===SUBJECT_LINES_START===
1. (first subject line suggestion)
2. (second subject line suggestion)
3. (third subject line suggestion)
===SUBJECT_LINES_END===`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Extra instructions handed to the existing source-driven copywriter path
 * (draftFromBrief with sourceContext = the raw prompt). The source-context
 * mode already strips competitive intel, briefing action items, and founding
 * signals; this adds the explicit anti-fabrication rules plus the angle.
 */
export function buildQuickBlogInstructions(angle: QuickAngle | null | undefined): string {
  const angleBlock = buildAngleBlock(angle);
  return [QUICK_GROUNDING_RULES, angleBlock].filter(Boolean).join("\n\n");
}

// ── Response parsing ────────────────────────────────────────────────────────

export interface QuickSocialPost {
  platform: RepurposePlatform;
  content: string;
  imagePrompt: string | null;
  /** Set only when the prompt explicitly stated a posting date (and it's valid + future). */
  scheduledDate: Date | null;
}

function coerceScheduledDate(raw: unknown): Date | null {
  const s = str(raw);
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T09:00:00` : s);
  if (Number.isNaN(d.getTime())) return null;
  // Never date a draft in the past — undated is the honest default.
  if (d.getTime() <= Date.now()) return null;
  return d;
}

export function parseQuickSocialPosts(
  text: string,
  allowedPlatforms: RepurposePlatform[],
): QuickSocialPost[] {
  const allowed = allowedPlatforms.length ? allowedPlatforms : ["linkedin" as RepurposePlatform];
  return parseJsonArrayLoose(text)
    .map((raw): QuickSocialPost | null => {
      const content = str(raw?.content);
      if (!content) return null;
      let platform = coercePlatform(raw?.platform);
      if (!allowed.includes(platform)) platform = allowed[0];
      return {
        platform,
        content: clampForPlatform(content, platform),
        imagePrompt: str(raw?.imagePrompt ?? raw?.image_prompt),
        scheduledDate: coerceScheduledDate(raw?.scheduledDate ?? raw?.scheduled_date),
      };
    })
    .filter((p): p is QuickSocialPost => p !== null);
}

export interface QuickNewsletterDraft {
  subject: string;
  body: string;
  subjectSuggestions: string[];
}

export function parseQuickNewsletter(text: string): QuickNewsletterDraft {
  const bodyMatch = text.match(/===EMAIL_BODY_START===([\s\S]*?)===EMAIL_BODY_END===/);
  const body = (bodyMatch ? bodyMatch[1] : text).trim();

  let subjectSuggestions: string[] = [];
  const subjectMatch = text.match(/===SUBJECT_LINES_START===([\s\S]*?)===SUBJECT_LINES_END===/);
  if (subjectMatch) {
    subjectSuggestions = subjectMatch[1]
      .trim()
      .split("\n")
      .map((line) => line.replace(/^\d+\.\s*/, "").trim())
      .filter(Boolean);
  }

  return {
    subject: subjectSuggestions[0] || "Newsletter draft",
    body,
    subjectSuggestions,
  };
}

// ── Campaign naming ─────────────────────────────────────────────────────────

/**
 * Derive a campaign name from the prompt without an AI call: first sentence,
 * whitespace-collapsed, cut at a word boundary under 60 chars.
 */
export function deriveCampaignNameFromPrompt(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (!collapsed) return "Quick campaign";
  const sentence = collapsed.split(/(?<=[.!?])\s/)[0] || collapsed;
  if (sentence.length <= 60) return sentence.replace(/[.!?]+$/, "");
  const cut = sentence.slice(0, 60);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 30 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:!?]+$/, "") + "…";
}
