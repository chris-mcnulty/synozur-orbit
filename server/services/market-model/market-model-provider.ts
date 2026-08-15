/**
 * MarketModelProvider — the Path A / Path B strategy seam (design §4.2)
 *
 * All AI-assisted market modeling (sizing, needs maps, priority) goes through
 * this interface. Path A (native, in-house composition of Orbit's AI + Census +
 * pricing + web-search) is the default and the only implementation for v1;
 * Path B (an external MCP tool such as Segmentable) can later implement the same
 * interface without touching routes, storage, or UI — the output shapes are
 * identical either way (they're the shared types in @shared/market-intelligence).
 *
 * #543 fills in NativeMarketModelProvider.estimateSizing / buildNeedsMap /
 * scoreSegmentPriority. This module and the shared types are the finished
 * contract those implementations write against.
 */

import type {
  SegmentSizing,
  NeedsMap,
  PrioritySuggestion,
  Firmographics,
  MarketIntelligenceSourceInput,
  MatrixCellScore,
} from "@shared/market-intelligence";
// Value import (ESM). `native` imports only types from this module, so there is
// no runtime import cycle.
import { NativeMarketModelProvider } from "./native-market-model-provider";

// ─── Inputs ───────────────────────────────────────────────────────────────────

/** Common context every model call needs for scoping, caching, and grounding. */
export interface MarketModelContext {
  tenantDomain: string;
  marketId?: string | null;
  /** Attributes AI usage/cost to the acting user when provided. */
  userId?: string | null;
  /** b2b vs b2c changes the sizing method and grounding prompts. */
  businessType?: "b2b" | "b2c";
}

export interface SizingInput extends MarketModelContext {
  segmentName: string;
  description?: string;
  firmographics?: Firmographics;
  /** Average contract value (whole currency units) for bottom-up = population × ACV. */
  acv?: number;
  currency?: string;
}

export interface NeedsMapInput extends MarketModelContext {
  segmentName: string;
  description?: string;
  firmographics?: Firmographics;
  /** Optional existing needs map to refine rather than replace. */
  existing?: NeedsMap;
}

export interface PriorityInput extends MarketModelContext {
  segmentName: string;
  /** The segment's SAM midpoint drives the opportunity component of the score. */
  samMid?: number;
  needsMap?: NeedsMap;
}

export interface MatrixScoreInput extends MarketModelContext {
  segmentName: string;
  samMid?: number;
  /** The buyer need (one Needs Map item) this row scores channels for. */
  need: string;
  /** The channel axis to score (canonical channels). */
  channels: Array<{ key: string; label: string }>;
}

// ─── Outputs ───────────────────────────────────────────────────────────────────

/** Results are paired with the citations that justify them, for provenance. */
export interface SizingResult {
  sizing: SegmentSizing;
  sources: MarketIntelligenceSourceInput[];
}

export interface NeedsMapResult {
  needsMap: NeedsMap;
  sources: MarketIntelligenceSourceInput[];
}

export interface MatrixScoreResult {
  /** Per-channel scores for one (segment, need) row. ROI is derived downstream. */
  cells: MatrixCellScore[];
}

/** A candidate segment proposed from a brief when a market has none yet (#547). */
export interface ProposedSegment {
  name: string;
  description?: string;
  firmographics: Firmographics;
  pains: string[];
}
export interface ProposeSegmentsInput extends MarketModelContext {
  brief: string;
  count: number;
}
export interface ProposeSegmentsResult {
  segments: ProposedSegment[];
}

// ─── The contract ───────────────────────────────────────────────────────────────

export interface MarketModelProvider {
  /** Identifies the active path in logs and provenance. */
  readonly name: string;
  estimateSizing(input: SizingInput): Promise<SizingResult>;
  buildNeedsMap(input: NeedsMapInput): Promise<NeedsMapResult>;
  scoreSegmentPriority(input: PriorityInput): Promise<PrioritySuggestion>;
  /** Score every channel for one (segment, need). ROI/whitespace derived downstream. */
  scoreMatrix(input: MatrixScoreInput): Promise<MatrixScoreResult>;
  /** Propose candidate segments from a brief (used by the study wizard, #547). */
  proposeSegments(input: ProposeSegmentsInput): Promise<ProposeSegmentsResult>;
}

/** Thrown by provider methods that #543 has not implemented yet. */
export class MarketModelNotImplementedError extends Error {
  constructor(method: string) {
    super(`MarketModelProvider.${method} is not implemented yet (Task #543).`);
    this.name = "MarketModelNotImplementedError";
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────────

let cached: MarketModelProvider | null = null;

/**
 * Resolve the active provider. Path A is the default; a future Path B adapter can
 * be selected via env (e.g. MARKET_MODEL_PROVIDER=segmentable) without changing
 * any caller. Cached after first construction. `native` imports only *types* from
 * this module, so the static import below creates no runtime cycle — and unlike
 * `require()`, it works under ESM ("type":"module").
 */
export function getMarketModelProvider(): MarketModelProvider {
  if (cached) return cached;
  // Path B would branch here on process.env.MARKET_MODEL_PROVIDER.
  cached = new NativeMarketModelProvider();
  return cached;
}

/** Test seam: override or reset the cached provider. */
export function __setMarketModelProvider(provider: MarketModelProvider | null): void {
  cached = provider;
}
