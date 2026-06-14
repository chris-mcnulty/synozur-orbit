/**
 * Free web-grounded discovery backend.
 *
 * The harness-faithful, no-data-vendor path: it asks the model to find
 * net-new, ICP-matching people from the public web using Anthropic's
 * `web_search` server tool, then parses the grounded results into candidates.
 * No paid contact database (Apollo/ZoomInfo) and no LinkedIn seat required —
 * just AI tokens. The deterministic prompt/parse logic lives in
 * `discovery-provider-core.ts`.
 */

import { completeWithWebSearch, isWebSearchAvailable } from "./ai-provider";
import {
  buildDiscoveryPrompt,
  parseDiscoveryCandidates,
  type DiscoveryCandidate,
  type DiscoverySearchInput,
} from "./discovery-provider-core";

const SYSTEM_PROMPT = `You are a B2B prospecting researcher. You find real, currently-employed decision-makers who match an Ideal Customer Profile, grounded in live public web sources. You never fabricate people, titles, companies, or contact details — if you cannot verify someone from a real source, you leave them out. You only return contact details (email, LinkedIn) you actually found on a source. You respond with strict JSON only.`;

export interface WebDiscoveryResult {
  candidates: DiscoveryCandidate[];
  usage: { inputTokens: number; outputTokens: number };
  searchCount: number;
  model: string;
  provider: string;
}

export { isWebSearchAvailable };

/** Human-readable note for the UI when web discovery is unavailable. */
export function webDiscoveryReason(): string {
  return isWebSearchAvailable()
    ? "Web discovery searches public sources for net-new prospects."
    : "Web discovery needs the Anthropic AI provider, which isn't configured.";
}

/**
 * Find net-new prospects from the public web for the given ICP criteria.
 * Returns parsed (but not yet deduped or scored) candidates — the discovery
 * service handles dedup/scoring against the campaign's existing prospects.
 */
export async function searchWeb(
  _tenantDomain: string,
  input: DiscoverySearchInput,
): Promise<WebDiscoveryResult> {
  const prompt = buildDiscoveryPrompt(input);
  const result = await completeWithWebSearch(prompt, {
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: 4096,
    // Give the model room to run a few searches across the targeting facets.
    maxSearches: Math.min(8, Math.max(3, Math.ceil(input.limit / 5))),
  });

  const candidates = parseDiscoveryCandidates(result.text, "web", input.limit);
  return {
    candidates,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    searchCount: result.searchCount,
    model: result.model,
    provider: result.provider,
  };
}
