/**
 * Task #102 — Sentiment & Tone Analyzer.
 *
 * Scores any captured competitor artifact (page snapshot, social post, blog
 * post, news item, change description) with:
 *   - sentimentScore: float in [-1, +1]
 *   - toneLabel: one of TONE_LABELS
 *   - toneNote: one-sentence rationale
 *
 * The analyzer ALWAYS runs server-side regardless of plan. UI/alerts are
 * gated separately by the `sentimentAnalysis` feature key.
 *
 * Uses Replit's Anthropic integration when available; falls back to a
 * deterministic heuristic mock in dev/test/no-key environments so all
 * downstream code paths can rely on every artifact eventually being scored.
 */

import Anthropic from "@anthropic-ai/sdk";
import { TONE_LABELS, type ToneLabel } from "@shared/schema";
import { logAiUsage } from "./ai-usage-logger";

export interface SentimentResult {
  /** Numeric score in [-1,+1], or null when the artifact was deliberately
   *  skipped (e.g. non-English content). Skipped rows are still persisted
   *  with `analyzedAt` + a sentinel `analyzerVersion` so they aren't retried,
   *  but downstream summaries/alerts must exclude them by filtering on a
   *  non-null score. */
  sentimentScore: number | null;
  toneLabel: ToneLabel | null;
  toneNote: string;
  analyzerVersion: string;
  skipped?: "non_english" | "too_short";
}

export interface AnalyzerContext {
  competitorName?: string;
  artifactType?: string; // e.g. "blog_post", "change", "social_update"
  surface?: string; // e.g. "linkedin", "blog", "website"
  // Tenant context for AI usage attribution (optional — callers that don't have it simply omit)
  tenantDomain?: string | null;
  marketId?: string | null;
}

const MAX_INPUT_CHARS = 6000;
const MIN_INPUT_CHARS = 8;
const MOCK_VERSION = "mock-1";
const SKIPPED_NON_ENGLISH_VERSION = "skipped-non-english/v1";
const SKIPPED_TOO_SHORT_VERSION = "skipped-too-short/v1";
const CLAUDE_MODEL = "claude-sonnet-4-5";
const ANALYZER_VERSION = `claude-sonnet-4-5/v1`;

/**
 * English detection — heuristic, dependency-free. Flags content that's
 * clearly non-English so we can skip scoring instead of mis-scoring it.
 *
 * Strategy:
 *  1. If the text is mostly non-Latin script (CJK, Arabic, Cyrillic,
 *     Devanagari, Hebrew, Thai, etc.), it's not English.
 *  2. Otherwise check for a small bag of high-frequency English stopwords;
 *     if at least two appear, treat it as English. Marketing/social content
 *     in other Latin-script languages (es/fr/de/pt/it/nl) almost never
 *     hits two of these, while even short English copy usually does.
 */
const ENGLISH_STOPWORDS = new Set([
  "the","and","of","to","a","in","is","that","for","with","on","this","you",
  "we","our","your","are","be","by","as","an","at","or","from","it","but",
  "have","has","not","will","can","more","new","about","how","why","what",
]);

export interface LanguageDetection {
  isEnglish: boolean;
  reason?: "non_latin_script" | "stopword_floor";
}

export function detectEnglish(rawText: string): LanguageDetection {
  const text = (rawText || "").trim();
  if (text.length === 0) return { isEnglish: true };

  // Count letters by script. We only care whether *most* of the alphabetic
  // characters are Latin; punctuation/whitespace/digits are ignored.
  let latin = 0;
  let nonLatin = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) || 0;
    // Latin Basic + Latin-1 Supplement + Latin Extended-A/B
    const isLatinLetter =
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0xc0 && code <= 0x024f);
    if (isLatinLetter) {
      latin++;
      continue;
    }
    // Common non-Latin alphabetic ranges:
    // CJK 0x3400-0x9fff, Hangul 0xac00-0xd7af, Hiragana/Katakana 0x3040-0x30ff,
    // Cyrillic 0x0400-0x04ff, Greek 0x0370-0x03ff, Arabic 0x0600-0x06ff,
    // Hebrew 0x0590-0x05ff, Devanagari 0x0900-0x097f, Thai 0x0e00-0x0e7f
    if (
      (code >= 0x3400 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0x0400 && code <= 0x04ff) ||
      (code >= 0x0370 && code <= 0x03ff) ||
      (code >= 0x0600 && code <= 0x06ff) ||
      (code >= 0x0590 && code <= 0x05ff) ||
      (code >= 0x0900 && code <= 0x097f) ||
      (code >= 0x0e00 && code <= 0x0e7f)
    ) {
      nonLatin++;
    }
  }
  const totalLetters = latin + nonLatin;
  if (totalLetters > 0 && nonLatin / totalLetters > 0.3) {
    return { isEnglish: false, reason: "non_latin_script" };
  }

  // Latin-script: require ≥2 English stopwords for sentences with ≥6 words.
  const tokens = text.toLowerCase().match(/[a-z']+/g) || [];
  if (tokens.length < 6) {
    // Too short to reliably classify — accept as English to avoid skipping
    // legitimate short English headlines.
    return { isEnglish: true };
  }
  let stopHits = 0;
  for (const tok of tokens) {
    if (ENGLISH_STOPWORDS.has(tok)) {
      stopHits++;
      if (stopHits >= 2) return { isEnglish: true };
    }
  }
  return { isEnglish: false, reason: "stopword_floor" };
}

export const SKIPPED_RESULT_NON_ENGLISH = SKIPPED_NON_ENGLISH_VERSION;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function isToneLabel(s: unknown): s is ToneLabel {
  return typeof s === "string" && (TONE_LABELS as readonly string[]).includes(s);
}

export function isAnalyzerAvailable(): boolean {
  return !!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
}

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    });
  }
  return cachedClient;
}

/**
 * Heuristic fallback: cheap keyword scoring so backfill produces signal even
 * without an LLM. Produces deterministic, reproducible output for the same
 * input text. Marked `analyzerVersion = mock-1` so we can re-score later.
 */
function heuristicAnalyze(text: string): SentimentResult {
  const t = text.toLowerCase();
  const positive = ["launch", "growth", "win", "success", "leader", "best", "fastest", "free", "new", "improve", "love", "amazing", "innovat", "excellent", "trusted"];
  const negative = ["bug", "issue", "fail", "delay", "problem", "concern", "risk", "decline", "lawsuit", "outage", "vulnerab", "deprecat", "remov", "shutdown", "loss"];
  let score = 0;
  for (const w of positive) if (t.includes(w)) score += 0.15;
  for (const w of negative) if (t.includes(w)) score -= 0.18;
  score = clamp(score, -1, 1);

  let tone: ToneLabel = "measured";
  if (/\b(now|today|urgent|immediately|don'?t miss|limited)\b/.test(t)) tone = "urgent";
  else if (/\b(buy|sale|free|sign up|trial|discount|save|offer)\b/.test(t)) tone = "promotional";
  else if (/\b(api|sdk|architect|infrastructure|protocol|kubernetes|encryption|compiler|latency|throughput)\b/.test(t)) tone = "technical";
  else if (/\b(unfair|misleading|debunk|claim|response to|setting the record|incorrect)\b/.test(t)) tone = "defensive";
  else if (/\b(beat|crush|destroy|outperform|dominat|war\b|battle)\b/.test(t)) tone = "aggressive";
  else if (/\b(care|listen|community|together|support you|here for you|empath)\b/.test(t)) tone = "empathetic";
  else if (score > 0.25) tone = "confident";

  return {
    sentimentScore: Number(score.toFixed(3)),
    toneLabel: tone,
    toneNote: `Heuristic fallback scored ${score >= 0 ? "positive" : "negative"} sentiment with ${tone} tone based on keyword cues.`,
    analyzerVersion: MOCK_VERSION,
  };
}

const SYSTEM_PROMPT = `You analyze competitor marketing/communications artifacts for sentiment and tone.

Return ONLY a JSON object — no prose, no markdown, no code fences — matching this exact shape:
{
  "sentimentScore": number,   // -1.0 (very negative) to +1.0 (very positive); 0 = neutral
  "toneLabel": string,        // one of: ${TONE_LABELS.join(", ")}
  "toneNote": string          // ONE sentence (max 200 chars) explaining the score and tone
}

Calibration:
- sentimentScore reflects the affective valence of the message itself, not your opinion of the company. Promotional but upbeat copy is positive; defensive crisis comms is negative.
- toneLabel must be the single best fit. Prefer "measured" for neutral/balanced corporate copy.
- toneNote is one short, concrete sentence — no hedging, no preamble.`;

function buildUserPrompt(text: string, ctx?: AnalyzerContext): string {
  const meta: string[] = [];
  if (ctx?.competitorName) meta.push(`Competitor: ${ctx.competitorName}`);
  if (ctx?.artifactType) meta.push(`Artifact type: ${ctx.artifactType}`);
  if (ctx?.surface) meta.push(`Surface: ${ctx.surface}`);
  const header = meta.length > 0 ? meta.join("\n") + "\n\n" : "";
  const trimmed = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) + "…" : text;
  return `${header}Content to analyze:\n"""\n${trimmed}\n"""`;
}

function tryParseJson(s: string): any | null {
  // Strip code fences if model added them despite instructions.
  const cleaned = s
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Best-effort: pull the first {...} block.
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

/**
 * Score a single artifact. NEVER throws — falls back to the heuristic
 * analyzer on any error so capture pipelines are not blocked by the LLM.
 */
export async function analyzeArtifact(
  rawText: string | null | undefined,
  ctx?: AnalyzerContext,
): Promise<SentimentResult | null> {
  const text = (rawText || "").trim();
  // Too-short artifacts (empty descriptions, single-word changes, etc.)
  // are persisted as a skipped row with NULL score/tone so they're
  // excluded from summaries — but `analyzedAt` is still set, so the
  // backfill won't infinitely retry them and starve out older rows.
  if (text.length < MIN_INPUT_CHARS) {
    return {
      sentimentScore: null,
      toneLabel: null,
      toneNote: `Insufficient text content; sentiment analysis skipped.`,
      analyzerVersion: SKIPPED_TOO_SHORT_VERSION,
      skipped: "too_short",
    };
  }

  // Task #102 — English-only: detect and skip non-English content rather
  // than mis-scoring it. The caller marks the row as "analyzed" with a
  // sentinel analyzerVersion so it isn't repeatedly retried.
  const lang = detectEnglish(text);
  if (!lang.isEnglish) {
    // Persist as a skipped row: NULL score + NULL tone so summaries and
    // tone-shift detection exclude it; analyzedAt + sentinel version stop
    // the backfill from retrying it.
    return {
      sentimentScore: null,
      toneLabel: null,
      toneNote: `Non-English content (${lang.reason}); sentiment analysis skipped.`,
      analyzerVersion: SKIPPED_NON_ENGLISH_VERSION,
      skipped: "non_english",
    };
  }

  if (!isAnalyzerAvailable()) {
    return heuristicAnalyze(text);
  }

  try {
    const response = await client().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 256,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(text, ctx) }],
    });

    void logAiUsage({ tenantDomain: ctx?.tenantDomain, marketId: ctx?.marketId }, "analyze_sentiment", "anthropic", CLAUDE_MODEL, response.usage);
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return heuristicAnalyze(text);

    const parsed = tryParseJson(block.text);
    if (!parsed || typeof parsed !== "object") return heuristicAnalyze(text);

    const score = typeof parsed.sentimentScore === "number" ? clamp(parsed.sentimentScore, -1, 1) : null;
    const tone = isToneLabel(parsed.toneLabel) ? parsed.toneLabel : null;
    const note = typeof parsed.toneNote === "string" ? parsed.toneNote.trim().slice(0, 280) : null;

    if (score === null || tone === null || !note) {
      return heuristicAnalyze(text);
    }

    return {
      sentimentScore: Number(score.toFixed(3)),
      toneLabel: tone,
      toneNote: note,
      analyzerVersion: ANALYZER_VERSION,
    };
  } catch (err) {
    console.warn(`[sentiment-analyzer] Claude call failed, using heuristic fallback:`, err instanceof Error ? err.message : err);
    return heuristicAnalyze(text);
  }
}

/**
 * Build the canonical text-to-analyze for an Activity row. Uses summary
 * when present (it's already condensed) otherwise falls back to description.
 */
export function buildActivityAnalyzerText(args: {
  description: string;
  summary?: string | null;
  details?: unknown;
}): string {
  const parts: string[] = [];
  if (args.summary) parts.push(args.summary);
  parts.push(args.description);
  // Pull a body/text/content field out of details if available.
  if (args.details && typeof args.details === "object") {
    const d = args.details as Record<string, unknown>;
    for (const key of ["text", "content", "body", "postText", "title"]) {
      const v = d[key];
      if (typeof v === "string" && v.trim().length > 0) {
        parts.push(v);
        break;
      }
    }
  }
  return parts.join("\n").slice(0, MAX_INPUT_CHARS);
}
