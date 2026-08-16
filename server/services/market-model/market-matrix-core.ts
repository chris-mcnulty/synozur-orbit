/**
 * GTM Opportunity Matrix — PURE core (Task #544)
 *
 * Deterministic logic behind matrix scoring: ROI derivation, whitespace
 * selection, the per-(segment,need) prompt builder, and the tolerant parser for
 * the AI's per-channel scores. No db/AI/network imports — fully unit-testable.
 * The provider (native-market-model-provider.ts) wires these to the AI layer;
 * the route orchestrates segments × needs and persists cells.
 */

import { type MatrixCellScore } from "@shared/market-intelligence";

// ─── ROI derivation ────────────────────────────────────────────────────────

/**
 * ROI (0..100) from revenue potential and execution effort, both 0..100.
 * Higher revenue and lower effort → higher ROI. roi = revenue × (100 − effort)/100.
 */
export function computeRoiScore(revenuePotential: number, executionEffort: number): number {
  const rev = clamp0to100(revenuePotential);
  const eff = clamp0to100(executionEffort);
  return Math.round(rev * ((100 - eff) / 100));
}

// ─── Whitespace selection ──────────────────────────────────────────────────

/**
 * Flag the batch's top-ROI cells (a cell clears both the ~80th percentile AND an
 * absolute floor, so a uniformly weak batch surfaces none). Pure over the ROI
 * scores.
 *
 * This is the *top-ROI* component of whitespace. When competitor-presence data
 * exists (Task #749) the full signal is high ROI AND low presence — see
 * computeWhitespaceFlagsWithPresence. Cells without presence data fall back to
 * this proxy alone.
 */
export function computeWhitespaceFlags(roiScores: number[], floor = 50): boolean[] {
  if (roiScores.length === 0) return [];
  const sorted = [...roiScores].sort((a, b) => b - a);
  const idx = Math.max(0, Math.ceil(sorted.length * 0.2) - 1);
  const percentileCut = sorted[idx];
  const cut = Math.max(percentileCut, floor);
  return roiScores.map((s) => s >= cut && s > 0);
}

/**
 * A cell with presence at or above this value is considered contested — a
 * competitor already owns the segment×need×channel space — and never whitespace.
 */
export const PRESENCE_WHITESPACE_MAX = 40;

/**
 * True whitespace (Task #749): high ROI (top-percentile + floor, same as the
 * proxy) AND low competitor presence. Cells with `presence: null` (no tracked
 * competitors, or the assessment failed) keep the pure top-ROI proxy behavior
 * so the matrix degrades gracefully when Research data is absent.
 */
export function computeWhitespaceFlagsWithPresence(
  cells: Array<{ roiScore: number; competitorPresence: number | null }>,
  floor = 50,
): boolean[] {
  const roiFlags = computeWhitespaceFlags(cells.map((c) => c.roiScore), floor);
  return cells.map((c, i) => {
    if (!roiFlags[i]) return false;
    if (c.competitorPresence == null) return true; // proxy fallback
    return c.competitorPresence <= PRESENCE_WHITESPACE_MAX;
  });
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

export const MATRIX_SYSTEM_PROMPT =
  "You are a GTM strategist scoring go-to-market channels for a specific buyer " +
  "segment and need. Score each channel on revenue potential and execution " +
  "effort. Be discriminating — do not give everything the same score. Return " +
  "only the requested JSON.";

export interface MatrixPromptInput {
  segmentName: string;
  need: string;
  samMid?: number;
  channels: Array<{ key: string; label: string }>;
}

export function buildMatrixPrompt(input: MatrixPromptInput): string {
  const channelList = input.channels.map((c) => `- ${c.key}: ${c.label}`).join("\n");
  return [
    `Segment: "${input.segmentName}"`,
    `Buyer need: "${input.need}"`,
    input.samMid ? `Serviceable market (SAM) ≈ $${input.samMid.toLocaleString("en-US")}.` : "",
    "",
    "Score EACH of these GTM channels for reaching this segment about this need:",
    channelList,
    "",
    "For each channel return revenuePotential (0-100) and executionEffort (0-100, " +
      "higher = costlier/harder), plus a short rationale.",
    "Return ONLY a JSON array using the exact channel keys above:",
    '[{ "channelKey": "outbound", "revenuePotential": 0-100, "executionEffort": 0-100, "rationale": "" }]',
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Competitor presence (Task #749) ────────────────────────────────────────

export const PRESENCE_SYSTEM_PROMPT =
  "You are a competitive-intelligence analyst. Given real competitor profiles " +
  "(names, positioning, crawled website/social content), assess how strongly " +
  "competitors already occupy each GTM channel for a specific buyer segment and " +
  "need. Base your scores ONLY on the supplied competitor evidence — do not " +
  "invent competitors. Be discriminating. Return only the requested JSON.";

export interface CompetitorContext {
  name: string;
  url?: string;
  /** Compact positioning/content summary drawn from Research-area crawl data. */
  summary?: string;
}

export interface PresencePromptInput {
  segmentName: string;
  need: string;
  channels: Array<{ key: string; label: string }>;
  competitors: CompetitorContext[];
}

export function buildPresencePrompt(input: PresencePromptInput): string {
  const channelList = input.channels.map((c) => `- ${c.key}: ${c.label}`).join("\n");
  const competitorList = input.competitors
    .map((c) => `- ${c.name}${c.url ? ` (${c.url})` : ""}${c.summary ? `: ${c.summary}` : ""}`)
    .join("\n");
  return [
    `Segment: "${input.segmentName}"`,
    `Buyer need: "${input.need}"`,
    "",
    "Tracked competitors (with intelligence gathered from their websites/socials):",
    competitorList,
    "",
    "For EACH of these GTM channels, score how strongly these competitors already",
    "occupy the channel for this segment and need (competitorPresence 0-100;",
    "0 = no competitor visible there, 100 = channel saturated by competitors):",
    channelList,
    "",
    "Name the competitors driving the score in topCompetitors (only names from the list above).",
    "Return ONLY a JSON array using the exact channel keys above:",
    '[{ "channelKey": "outbound", "competitorPresence": 0-100, "topCompetitors": ["Name"], "rationale": "" }]',
  ].join("\n");
}

export interface PresenceScore {
  channelKey: string;
  /** 0..100 — how strongly competitors already occupy this channel for this cell. */
  competitorPresence: number;
  topCompetitors: string[];
  rationale?: string;
}

/** Parse per-channel presence scores; clamps, filters to allowed channels, dedupes. */
export function parsePresenceScores(text: string, allowedChannelKeys: string[]): PresenceScore[] {
  const arr = extractJsonArray(text);
  const allowed = new Set(allowedChannelKeys);
  const seen = new Set<string>();
  const out: PresenceScore[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw.channelKey !== "string") continue;
    const key = raw.channelKey.trim();
    if (!allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({
      channelKey: key,
      competitorPresence: clamp0to100(Number(raw.competitorPresence)),
      topCompetitors: Array.isArray(raw.topCompetitors)
        ? raw.topCompetitors.filter((n: unknown) => typeof n === "string" && n.trim()).map((n: string) => n.trim())
        : [],
      rationale: typeof raw.rationale === "string" ? raw.rationale.trim() : undefined,
    });
  }
  return out;
}

// ─── Parser ─────────────────────────────────────────────────────────────────

/**
 * Parse the AI's per-channel scores, clamped to 0..100 and filtered to the
 * allowed channel keys (drops hallucinated channels, dedupes to the first hit).
 */
export function parseMatrixScores(text: string, allowedChannelKeys: string[]): MatrixCellScore[] {
  const arr = extractJsonArray(text);
  const allowed = new Set(allowedChannelKeys);
  const seen = new Set<string>();
  const out: MatrixCellScore[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw.channelKey !== "string") continue;
    const key = raw.channelKey.trim();
    if (!allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({
      channelKey: key,
      revenuePotential: clamp0to100(Number(raw.revenuePotential)),
      executionEffort: clamp0to100(Number(raw.executionEffort)),
      rationale: typeof raw.rationale === "string" ? raw.rationale.trim() : undefined,
    });
  }
  return out;
}

// ─── local helpers (no deps) ─────────────────────────────────────────────────

function clamp0to100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function extractJsonArray(text: string): any[] {
  const cleaned = (text || "").replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.cells)) return parsed.cells;
    if (Array.isArray(parsed?.items)) return parsed.items;
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const a = JSON.parse(match[0]);
        if (Array.isArray(a)) return a;
      } catch {
        /* fall through */
      }
    }
  }
  return [];
}
