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
 * NOTE: this is a *top-ROI* signal, not a true competition/coverage measure — we
 * don't yet have per-channel coverage data. It's surfaced in the UI as "top ROI"
 * (a whitespace proxy). Real whitespace (high ROI + low current coverage) is a
 * documented follow-up once coverage data exists; the DB column keeps the
 * `is_whitespace` name to avoid a migration.
 */
export function computeWhitespaceFlags(roiScores: number[], floor = 50): boolean[] {
  if (roiScores.length === 0) return [];
  const sorted = [...roiScores].sort((a, b) => b - a);
  const idx = Math.max(0, Math.ceil(sorted.length * 0.2) - 1);
  const percentileCut = sorted[idx];
  const cut = Math.max(percentileCut, floor);
  return roiScores.map((s) => s >= cut && s > 0);
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
