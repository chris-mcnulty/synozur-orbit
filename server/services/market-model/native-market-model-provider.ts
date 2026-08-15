/**
 * NativeMarketModelProvider — Path A (in-house) implementation (Task #543).
 *
 * Composes primitives Orbit already owns:
 *   estimateSizing        → bottom-up (Census establishment counts × ACV) triangulated
 *                           with top-down published figures (completeWithWebSearch);
 *                           returns a low/mid/high range + confidence + cited sources.
 *   buildNeedsMap         → completeForFeature('segment_needs_map', …).
 *   scoreSegmentPriority  → completeForFeature('segment_priority', …).
 *
 * All deterministic logic (math, prompts, parsing, rationale) lives in the pure
 * market-sizing-core.ts; this file is the thin I/O wiring.
 */

import type {
  MarketModelProvider,
  SizingInput,
  SizingResult,
  NeedsMapInput,
  NeedsMapResult,
  PriorityInput,
} from "./market-model-provider";
import {
  type PrioritySuggestion,
  type MarketIntelligenceSourceInput,
  DEFAULT_CURRENCY,
} from "@shared/market-intelligence";
import { AI_FEATURES } from "@shared/schema";
import { completeForFeature, completeWithWebSearch, isWebSearchAvailable } from "../ai-provider";
import { getIndustryStatsForSegment, isCensusAvailable } from "../census-market-data-provider";
import {
  type RawEstimate,
  computeBottomUp,
  reconcileSizing,
  buildSizingRationale,
  buildTopDownSizingPrompt,
  parseTopDownSizing,
  buildNeedsMapPrompt,
  parseNeedsMap,
  buildPriorityPrompt,
  parsePriority,
  TOP_DOWN_SYSTEM_PROMPT,
  NEEDS_MAP_SYSTEM_PROMPT,
  PRIORITY_SYSTEM_PROMPT,
} from "./market-sizing-core";

export class NativeMarketModelProvider implements MarketModelProvider {
  readonly name = "native";

  async estimateSizing(input: SizingInput): Promise<SizingResult> {
    const currency = input.currency ?? DEFAULT_CURRENCY;
    const sources: MarketIntelligenceSourceInput[] = [];

    // ── Bottom-up: Census establishment count × ACV ──────────────────────────
    let bottomUp: RawEstimate | null = null;
    const industry = input.firmographics?.industry;
    if (input.acv && input.acv > 0 && industry && isCensusAvailable()) {
      try {
        const stats = await getIndustryStatsForSegment(industry, {
          tenantDomain: input.tenantDomain,
          geographyFor: undefined, // national; geo filtering is a documented follow-up
        });
        const primary = stats.find((s) => s.stats && s.stats.establishments > 0);
        if (primary?.stats) {
          bottomUp = computeBottomUp({
            establishments: primary.stats.establishments,
            acv: input.acv,
          });
          sources.push({
            title: `U.S. Census County Business Patterns — ${primary.stats.naicsLabel || primary.naics.code} (${primary.stats.year})`,
            publisher: "U.S. Census Bureau",
            url: "https://www.census.gov/programs-surveys/cbp.html",
            usedForField: "tam",
            excerpt: `${primary.stats.establishments.toLocaleString("en-US")} establishments × $${input.acv.toLocaleString("en-US")} ACV`,
          });
        }
      } catch (err: any) {
        console.warn(`[market-model] bottom-up sizing failed: ${err?.message ?? err}`);
      }
    }

    // ── Top-down: published figures via web search ────────────────────────────
    let topDown: RawEstimate | null = null;
    let topDownNotes: string | undefined;
    if (isWebSearchAvailable()) {
      try {
        const prompt = buildTopDownSizingPrompt({
          segmentName: input.segmentName,
          description: input.description,
          firmographics: input.firmographics,
        });
        const res = await completeWithWebSearch(prompt, {
          systemPrompt: TOP_DOWN_SYSTEM_PROMPT,
          temperature: 0,
          maxTokens: 2048,
          maxSearches: 6,
        });
        const parsed = parseTopDownSizing(res.text);
        topDown = parsed.estimate;
        topDownNotes = parsed.notes;
        for (const s of parsed.sources) sources.push({ ...s, usedForField: "tam" });
      } catch (err: any) {
        console.warn(`[market-model] top-down sizing failed: ${err?.message ?? err}`);
      }
    }

    if (!bottomUp && !topDown) {
      throw new Error(
        "Unable to size segment: neither bottom-up (needs CENSUS_API_KEY + ACV + industry) " +
          "nor top-down (needs the Anthropic web-search provider) inputs were available.",
      );
    }

    const hasSources = sources.length > 0;
    const reconciled = reconcileSizing(bottomUp, topDown, { hasSources, currency });
    const rationale = buildSizingRationale({
      bottomUp,
      topDown,
      method: reconciled.method,
      confidence: reconciled.confidence,
      notes: topDownNotes,
    });

    return { sizing: { ...reconciled, rationale }, sources };
  }

  async buildNeedsMap(input: NeedsMapInput): Promise<NeedsMapResult> {
    const prompt = buildNeedsMapPrompt({
      segmentName: input.segmentName,
      description: input.description,
      firmographics: input.firmographics,
      existing: input.existing,
    });
    const res = await completeForFeature(AI_FEATURES.SEGMENT_NEEDS_MAP, prompt, {
      tenantDomain: input.tenantDomain,
      systemPrompt: NEEDS_MAP_SYSTEM_PROMPT,
      temperature: 0.3,
      maxTokens: 1024,
    });
    return { needsMap: parseNeedsMap(res.text), sources: [] };
  }

  async scoreSegmentPriority(input: PriorityInput): Promise<PrioritySuggestion> {
    const prompt = buildPriorityPrompt({
      segmentName: input.segmentName,
      samMid: input.samMid,
      needsMap: input.needsMap,
    });
    const res = await completeForFeature(AI_FEATURES.SEGMENT_PRIORITY, prompt, {
      tenantDomain: input.tenantDomain,
      systemPrompt: PRIORITY_SYSTEM_PROMPT,
      temperature: 0.2,
      maxTokens: 512,
    });
    return parsePriority(res.text);
  }
}
