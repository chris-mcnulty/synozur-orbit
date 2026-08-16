/**
 * Market sizing / needs-map / priority — PURE core (Task #543)
 *
 * All the deterministic logic behind NativeMarketModelProvider: the bottom-up
 * math, the reconciliation of bottom-up vs top-down into a low/mid/high range +
 * confidence, the prompt builders, and the AI-output parsers. No db / AI / network
 * imports so it is exhaustively unit-testable (repo `*-core` convention). The
 * provider (native-market-model-provider.ts) wires these to Census, web-search,
 * and the AI layer.
 */

import {
  type MoneyRange,
  type SizingMethod,
  type SizingConfidence,
  type NeedsMap,
  type Firmographics,
  DEFAULT_CURRENCY,
  clampPriorityScore,
} from "@shared/market-intelligence";

// Fraction of the total industry population that is realistically serviceable
// when we have no structured geo/size haircut yet (EMPSZES + geography crosswalk
// are a documented follow-up). Deliberately conservative; surfaced in rationale.
export const DEFAULT_SAM_REACHABLE_FRACTION = 0.35;

// ─── Bottom-up ────────────────────────────────────────────────────────────────

export interface BottomUpInput {
  /** Business establishments in the segment's industry (from Census CBP). */
  establishments: number;
  /** Average contract value, whole currency units. */
  acv: number;
  /** Serviceable fraction (0..1); defaults to DEFAULT_SAM_REACHABLE_FRACTION. */
  reachableFraction?: number;
}

export interface RawEstimate {
  tam: number;
  sam: number;
}

/** TAM = population × ACV; SAM = TAM × reachable fraction. Returns null if unusable. */
export function computeBottomUp(input: BottomUpInput): RawEstimate | null {
  const { establishments, acv } = input;
  if (!(establishments > 0) || !(acv > 0)) return null;
  const frac = clampFraction(input.reachableFraction ?? DEFAULT_SAM_REACHABLE_FRACTION);
  const tam = Math.round(establishments * acv);
  const sam = Math.round(tam * frac);
  return { tam, sam };
}

// ─── Reconciliation → range + confidence ───────────────────────────────────────

export interface ReconciledSizing {
  tam: MoneyRange;
  sam: MoneyRange;
  method: SizingMethod;
  confidence: SizingConfidence;
}

/**
 * Blend bottom-up and top-down estimates into low/mid/high ranges with a method
 * label and confidence. Per-field: with two positive candidates the range spans
 * them (mid = geometric mean); with one, a ±30% band; with none, zeros.
 */
export function reconcileSizing(
  bottomUp: RawEstimate | null,
  topDown: RawEstimate | null,
  opts: { hasSources?: boolean; currency?: string } = {},
): ReconciledSizing {
  const currency = opts.currency ?? DEFAULT_CURRENCY;

  const rawTam = blendRange([bottomUp?.tam, topDown?.tam], currency);
  const rawSam = blendRange([bottomUp?.sam, topDown?.sam], currency);
  // Domain invariant: SAM ⊆ TAM. Two ways it can break:
  //  1. A malformed response reports SAM > TAM → clamp SAM down to TAM.
  //  2. Only SAM is known (no TAM figure) → TAM is at least SAM, so lift the TAM
  //     bound up to SAM rather than leaving TAM=0 with a positive SAM.
  const tam = {
    low: rawTam.low || rawSam.low,
    mid: rawTam.mid || rawSam.mid,
    high: rawTam.high || rawSam.high,
    currency,
  };
  const sam = {
    low: Math.min(rawSam.low, tam.low),
    mid: Math.min(rawSam.mid, tam.mid),
    high: Math.min(rawSam.high, tam.high),
    currency,
  };

  let method: SizingMethod;
  let confidence: SizingConfidence;

  if (bottomUp && topDown) {
    method = "triangulated";
    const ratio = agreementRatio(bottomUp.tam, topDown.tam);
    if (ratio >= 0.5 && opts.hasSources) confidence = "high";
    else if (ratio >= 0.25) confidence = "medium";
    else confidence = "low";
  } else if (bottomUp || topDown) {
    method = bottomUp ? "bottom_up" : "top_down";
    confidence = opts.hasSources ? "medium" : "low";
  } else {
    method = "bottom_up";
    confidence = "low";
  }

  return { tam, sam, method, confidence };
}

/** 0..1 — how close two estimates are (min/max). 1 = identical, →0 = far apart. */
export function agreementRatio(a: number, b: number): number {
  const hi = Math.max(a, b);
  if (!(hi > 0)) return 0;
  return Math.max(0, Math.min(a, b)) / hi;
}

function blendRange(candidates: (number | undefined)[], currency: string): MoneyRange {
  const positives = candidates.filter((n): n is number => typeof n === "number" && n > 0);
  if (positives.length >= 2) {
    return {
      low: Math.min(...positives),
      high: Math.max(...positives),
      mid: Math.round(geoMean(positives)),
      currency,
    };
  }
  if (positives.length === 1) {
    const v = positives[0];
    return { low: Math.round(v * 0.7), mid: v, high: Math.round(v * 1.3), currency };
  }
  return { low: 0, mid: 0, high: 0, currency };
}

function geoMean(values: number[]): number {
  const sumLogs = values.reduce((acc, v) => acc + Math.log(v), 0);
  return Math.exp(sumLogs / values.length);
}

function clampFraction(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SAM_REACHABLE_FRACTION;
  return Math.max(0, Math.min(1, n));
}

/** Compose a human-readable, method-aware rationale for a sizing result. */
export function buildSizingRationale(args: {
  bottomUp: RawEstimate | null;
  topDown: RawEstimate | null;
  method: SizingMethod;
  confidence: SizingConfidence;
  reachableFraction?: number;
  notes?: string;
}): string {
  const parts: string[] = [];
  const frac = clampFraction(args.reachableFraction ?? DEFAULT_SAM_REACHABLE_FRACTION);

  if (args.method === "triangulated") {
    parts.push("Triangulated from bottom-up (Census establishment counts × ACV) and top-down (published market figures).");
  } else if (args.method === "bottom_up") {
    parts.push("Bottom-up estimate from Census establishment counts × ACV; no sourced top-down figure was available, so the range is a ±30% band.");
  } else {
    parts.push("Top-down estimate from published market figures; no Census/ACV bottom-up was available, so the range is a ±30% band.");
  }

  if (args.bottomUp) {
    parts.push(`SAM applies a ${Math.round(frac * 100)}% serviceable fraction to the total industry population (geo/size haircuts are a documented refinement).`);
  }
  parts.push(`Confidence: ${args.confidence}.`);
  if (args.notes) parts.push(args.notes);
  return parts.join(" ");
}

// ─── Prompt builders ────────────────────────────────────────────────────────

export const TOP_DOWN_SYSTEM_PROMPT =
  "You are a market research analyst. Use web search to find PUBLISHED market-size " +
  "figures from credible sources (analyst firms, industry associations, government, " +
  "reputable press). Never fabricate numbers. Every figure must trace to a source. " +
  "Return only the requested JSON.";

export interface TopDownPromptInput {
  segmentName: string;
  description?: string;
  firmographics?: Firmographics;
}

export function buildTopDownSizingPrompt(input: TopDownPromptInput): string {
  const geo = input.firmographics?.geography ?? "United States";
  const industry = input.firmographics?.industry ?? input.segmentName;
  const bt = input.firmographics?.businessType ?? "b2b";
  return [
    `Estimate the market size for this ${bt.toUpperCase()} buyer segment.`,
    `Segment: "${input.segmentName}"`,
    input.description ? `Description: ${input.description}` : "",
    `Industry: ${industry}`,
    `Geography: ${geo}`,
    "",
    "Find published TAM (total addressable market) and, where available, SAM " +
      "(serviceable addressable market) figures in USD. Prefer recent figures.",
    "Return ONLY this JSON:",
    '{ "tamUsd": <number|null>, "samUsd": <number|null>, "asOfYear": <number|null>,',
    '  "sources": [{ "title": "", "publisher": "", "url": "", "figure": "", "year": <number|null> }],',
    '  "notes": "" }',
    "Use whole USD (e.g. 12300000000 for $12.3B). Null a figure you cannot source.",
  ]
    .filter(Boolean)
    .join("\n");
}

export const NEEDS_MAP_SYSTEM_PROMPT =
  "You are a B2B market strategist. Produce a concise, concrete Needs Map for a " +
  "buyer segment. Prefer specific, non-generic items. Return only the requested JSON.";

export interface NeedsMapPromptInput {
  segmentName: string;
  description?: string;
  firmographics?: Firmographics;
  /** Grounding text (persona pains/goals, briefings) assembled by the caller. */
  grounding?: string;
  existing?: NeedsMap;
}

export function buildNeedsMapPrompt(input: NeedsMapPromptInput): string {
  return [
    `Build a Needs Map for the buyer segment "${input.segmentName}".`,
    input.description ? `Description: ${input.description}` : "",
    input.firmographics?.industry ? `Industry: ${input.firmographics.industry}` : "",
    input.grounding ? `\nGrounding context:\n${input.grounding}` : "",
    input.existing ? `\nRefine this existing map where it is weak:\n${JSON.stringify(input.existing)}` : "",
    "",
    "Return ONLY this JSON (each array 3–6 concise items):",
    '{ "pains": [], "triggers": [], "barriers": [], "buyingCriteria": [] }',
    "- pains: problems this segment feels acutely",
    "- triggers: events that start a buying cycle",
    "- barriers: what blocks or slows adoption",
    "- buyingCriteria: how they evaluate and choose a vendor",
  ]
    .filter(Boolean)
    .join("\n");
}

export const PRIORITY_SYSTEM_PROMPT =
  "You are a GTM strategist scoring which buyer segments to prioritize. Return only " +
  "the requested JSON.";

export interface PriorityPromptInput {
  segmentName: string;
  samMid?: number;
  needsMap?: NeedsMap;
  firmographics?: Firmographics;
  /** Competitive/solution-fit context assembled by the caller. */
  grounding?: string;
}

export function buildPriorityPrompt(input: PriorityPromptInput): string {
  return [
    `Score the go-to-market priority of the segment "${input.segmentName}" from 1 (deprioritize) to 10 (pursue first).`,
    input.samMid ? `Serviceable market (SAM) midpoint: ~$${input.samMid.toLocaleString("en-US")}.` : "",
    input.firmographics?.industry ? `Industry: ${input.firmographics.industry}` : "",
    input.needsMap ? `Needs Map: ${JSON.stringify(input.needsMap)}` : "",
    input.grounding ? `\nContext:\n${input.grounding}` : "",
    "",
    "Weigh: opportunity size (SAM), strategic/solution fit, competitive intensity, and reachability.",
    'Return ONLY this JSON: { "score": <integer 1-10>, "rationale": "one or two sentences" }',
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

export interface TopDownParsed {
  estimate: RawEstimate | null;
  sources: Array<{ title?: string; publisher?: string; url?: string; excerpt?: string }>;
  notes?: string;
}

/** Parse the top-down web-search JSON. Tolerant of code fences and prose wrappers. */
export function parseTopDownSizing(text: string): TopDownParsed {
  const obj = parseJsonObject(text);
  if (!obj) return { estimate: null, sources: [] };

  const tam = toPositiveNumber(obj.tamUsd);
  const sam = toPositiveNumber(obj.samUsd);
  const estimate: RawEstimate | null = tam || sam ? { tam: tam ?? 0, sam: sam ?? 0 } : null;

  const year = typeof obj.asOfYear === "number" ? obj.asOfYear : undefined;
  const sources = Array.isArray(obj.sources)
    ? obj.sources
        .filter((s: any) => s && (s.url || s.title))
        .map((s: any) => ({
          title: str(s.title),
          publisher: str(s.publisher),
          url: str(s.url),
          excerpt: [str(s.figure), s.year ?? year ? `(${s.year ?? year})` : ""].filter(Boolean).join(" "),
        }))
    : [];

  return { estimate, sources, notes: str(obj.notes) };
}

export function parseNeedsMap(text: string): NeedsMap {
  const obj = parseJsonObject(text) ?? {};
  return {
    pains: strArray(obj.pains),
    triggers: strArray(obj.triggers),
    barriers: strArray(obj.barriers),
    buyingCriteria: strArray(obj.buyingCriteria),
  };
}

export function parsePriority(text: string): { score: number; rationale: string } {
  const obj = parseJsonObject(text) ?? {};
  return {
    score: clampPriorityScore(Number(obj.score)),
    rationale: str(obj.rationale) ?? "",
  };
}

// ─── local pure helpers (kept in-module so core has no deps) ─────────────────────

export function parseJsonObject(text: string): any | null {
  const cleaned = (text || "").replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function toPositiveNumber(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .slice(0, 8);
}
