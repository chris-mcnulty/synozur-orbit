/**
 * NativeMarketModelProvider — Path A (in-house) implementation.
 *
 * This is the implementation surface for Task #543. The three methods compose
 * primitives Orbit already owns:
 *
 *   estimateSizing        → bottom-up: census-market-data-provider
 *                           (getIndustryStatsForSegment) × ACV, triangulated
 *                           with top-down published figures via
 *                           ai-provider.completeWithWebSearch; returns a
 *                           low/mid/high range + confidence + cited sources.
 *   buildNeedsMap         → completeForFeature('segment_needs_map', …) grounded
 *                           in persona + intelligence briefings.
 *   scoreSegmentPriority  → completeForFeature('segment_priority', …) blending
 *                           SAM, solution-fit, competitive intensity, reachability.
 *
 * Left as explicit throws (not fake data) so nothing downstream silently
 * consumes a placeholder before #543 lands. The contract, inputs/outputs, cost
 * metering (runMarketSizing quota), provenance store, Census provider, and NAICS
 * mapping are all in place — #543 is now purely filling these three methods plus
 * the routes/UI.
 */

import type {
  MarketModelProvider,
  SizingInput,
  SizingResult,
  NeedsMapInput,
  NeedsMapResult,
  PriorityInput,
} from "./market-model-provider";
import { MarketModelNotImplementedError } from "./market-model-provider";
import type { PrioritySuggestion } from "@shared/market-intelligence";

export class NativeMarketModelProvider implements MarketModelProvider {
  readonly name = "native";

  async estimateSizing(_input: SizingInput): Promise<SizingResult> {
    throw new MarketModelNotImplementedError("estimateSizing");
  }

  async buildNeedsMap(_input: NeedsMapInput): Promise<NeedsMapResult> {
    throw new MarketModelNotImplementedError("buildNeedsMap");
  }

  async scoreSegmentPriority(_input: PriorityInput): Promise<PrioritySuggestion> {
    throw new MarketModelNotImplementedError("scoreSegmentPriority");
  }
}
