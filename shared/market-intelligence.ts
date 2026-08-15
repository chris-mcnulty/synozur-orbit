/**
 * Strategic Intelligence Stack — shared domain types (Tasks #543/#544/#547)
 *
 * The contracts that cross the client/server boundary and type the jsonb columns
 * on `market_segments` (needs_map, firmographics) and the shape of AI-estimation
 * results. Kept in shared/ so the #543 server services, the routes, and the
 * Segments UI all agree on one set of shapes — and so the output-compatibility
 * rule (wizard #547 writes the same shapes as hand-built data) is enforced by
 * the type system rather than by convention.
 *
 * Pure types + tiny constructors only — no runtime deps, safe to import anywhere.
 */

// ─── Sizing ─────────────────────────────────────────────────────────────────

export type SizingMethod = "top_down" | "bottom_up" | "triangulated";
export type SizingConfidence = "low" | "medium" | "high";

/**
 * A money range. Values are whole units of `currency` (e.g. whole USD) to match
 * the bigint columns on market_segments. `mid` is the point estimate; low/high
 * bound the honest uncertainty of a market estimate.
 */
export interface MoneyRange {
  low: number;
  mid: number;
  high: number;
  currency: string; // ISO 4217, default "USD"
}

/**
 * The full sizing result for a segment — what a MarketModelProvider returns and
 * what the sizing columns on market_segments persist.
 */
export interface SegmentSizing {
  tam: MoneyRange;
  sam: MoneyRange;
  method: SizingMethod;
  confidence: SizingConfidence;
  /** Cited narrative explaining how the figures were derived. */
  rationale: string;
}

// ─── Needs Map + firmographics (jsonb column shapes) ──────────────────────────

/** The four-field strategic Needs Map stored in market_segments.needs_map. */
export interface NeedsMap {
  pains: string[];
  triggers: string[];
  barriers: string[];
  buyingCriteria: string[];
}

/** Firmographic filters that drive bottom-up sizing (market_segments.firmographics). */
export interface Firmographics {
  industry?: string;
  /** Free-text or banded company size, e.g. "50-200", "enterprise". */
  companySize?: string;
  /** Geography scope, e.g. "US", "US-CA", "EU". */
  geography?: string;
  businessType?: "b2b" | "b2c";
}

// ─── Priority ─────────────────────────────────────────────────────────────────

export interface PrioritySuggestion {
  /** 1..10 inclusive. */
  score: number;
  rationale: string;
}

// ─── Provenance ───────────────────────────────────────────────────────────────

export type SourceScopeType = "segment_sizing" | "needs_map" | "matrix_cell" | "study";

/** A citation to persist into market_intelligence_sources. */
export interface MarketIntelligenceSourceInput {
  url?: string;
  title?: string;
  publisher?: string;
  excerpt?: string;
  /** Which field this source backs, e.g. "tam" | "sam" | "pains". */
  usedForField?: string;
}

// ─── Constructors / guards ────────────────────────────────────────────────────

export const DEFAULT_CURRENCY = "USD";

export function emptyNeedsMap(): NeedsMap {
  return { pains: [], triggers: [], barriers: [], buyingCriteria: [] };
}

export function emptyMoneyRange(currency: string = DEFAULT_CURRENCY): MoneyRange {
  return { low: 0, mid: 0, high: 0, currency };
}

/** Clamp an arbitrary number to the valid 1..10 priority range (integer). */
export function clampPriorityScore(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(10, Math.round(n)));
}

/** True when low ≤ mid ≤ high and all are non-negative — a well-formed range. */
export function isValidMoneyRange(r: MoneyRange | null | undefined): boolean {
  if (!r) return false;
  return (
    Number.isFinite(r.low) &&
    Number.isFinite(r.mid) &&
    Number.isFinite(r.high) &&
    r.low >= 0 &&
    r.low <= r.mid &&
    r.mid <= r.high
  );
}
