/**
 * Web-grounded discovery backend — two-stage agentic research.
 *
 * The original single-pass prompt asked the model to find both companies AND
 * people in one sweep. That misses the same niche/local asks that fool literal
 * database queries because the model runs 1–2 broad searches and gives up.
 *
 * Copilot-class results come from iterating the way a human researcher would:
 *   Stage 1 — Company research: find 15-20 fitting organizations in the target
 *             geography and industry using local business journals, directories,
 *             conference lists, and chamber rosters. (5 searches)
 *   Stage 2 — People lookup: for each verified company, find the senior
 *             decision-maker and confirm from an authoritative source such as
 *             the company's own leadership page or a recent press release.
 *             (10 searches)
 *
 * The two-stage approach:
 *   • Gives the model a focused task at each step.
 *   • Produces a verified company list that grounds Stage 2 searches.
 *   • Achieves the iterative verification loop Copilot uses.
 *
 * Fallback: when Stage 1 produces no companies (Anthropic web search
 * unavailable, empty response, or parse failure), the provider falls back to
 * the classic single-pass prompt so discovery always returns something.
 */

import { completeWithWebSearch, isWebSearchAvailable } from "./ai-provider";
import {
  buildCompanyResearchPrompt,
  buildPeopleLookupPrompt,
  buildDiscoveryPrompt,
  parseDiscoveryCandidates,
  type DiscoveryCandidate,
  type DiscoverySearchInput,
} from "./discovery-provider-core";
export type { DiscoveryCandidate };

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const COMPANY_RESEARCH_SYSTEM = `You are a B2B market researcher. You find real, currently-operating companies in a target geography and industry using public web sources: local business journals, industry associations, chamber-of-commerce directories, conference sponsor lists, and LinkedIn company search. You are thorough and geographically broad — you include surrounding metro areas, not just the exact city named. You respond with strict JSON only.`;

const PEOPLE_LOOKUP_SYSTEM = `You are a B2B prospecting researcher. For a list of companies, you find the current senior decision-makers who match a target role, verifying each person from an authoritative public source: the company's own team/leadership page, a recent press release, a conference speaker list, or an official event page. You never fabricate names, titles, or contact details. You respond with strict JSON only.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebDiscoveryResult {
  candidates: DiscoveryCandidate[];
  /** Candidates silently dropped by the name heuristic during parsing. */
  droppedCount: number;
  usage: { inputTokens: number; outputTokens: number };
  searchCount: number;
  model: string;
  provider: string;
  /** How the search was executed. */
  mode: "two-stage" | "single-pass";
}

export { isWebSearchAvailable };

/** Human-readable note for the UI when web discovery is unavailable. */
export function webDiscoveryReason(): string {
  return isWebSearchAvailable()
    ? "Web discovery searches public sources for net-new prospects."
    : "Web discovery needs the Anthropic AI provider, which isn't configured.";
}

// ---------------------------------------------------------------------------
// Company list parsing (Stage 1 output)
// ---------------------------------------------------------------------------

function parseCompanyList(text: string): string[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const raw = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(raw)) return [];
    return raw
      .map((v: unknown) => String(v ?? "").trim())
      .filter((s: string) => s.length > 1 && s.length < 120);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Two-stage agentic search
// ---------------------------------------------------------------------------

async function searchWebTwoStage(
  _tenantDomain: string,
  input: DiscoverySearchInput,
): Promise<WebDiscoveryResult> {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalSearchCount = 0;
  let model = "";
  let provider = "";

  // ── Stage 1: Company research ──────────────────────────────────────────────
  const stage1Prompt = buildCompanyResearchPrompt(input);
  const stage1 = await completeWithWebSearch(stage1Prompt, {
    systemPrompt: COMPANY_RESEARCH_SYSTEM,
    maxTokens: 2048,
    // 5 searches is enough to cover local business journals + sector directories
    // + conference lists across the metro area.
    maxSearches: 5,
  });

  totalInputTokens += stage1.usage.inputTokens;
  totalOutputTokens += stage1.usage.outputTokens;
  totalSearchCount += stage1.searchCount;
  model = stage1.model;
  provider = stage1.provider;

  const companies = parseCompanyList(stage1.text);
  if (companies.length === 0) {
    // Stage 1 produced nothing — fall back to single-pass.
    console.log("[web-discovery] Stage 1 returned no companies — falling back to single-pass");
    throw new Error("stage1_empty");
  }

  console.log(`[web-discovery] Stage 1: found ${companies.length} companies`);

  // ── Stage 2: People lookup ─────────────────────────────────────────────────
  const stage2Prompt = buildPeopleLookupPrompt(input, companies);
  // Give the model 1 search per company + a few extra for verification passes.
  const stage2Searches = Math.min(companies.length + 5, 15);
  const stage2 = await completeWithWebSearch(stage2Prompt, {
    systemPrompt: PEOPLE_LOOKUP_SYSTEM,
    maxTokens: 4096,
    maxSearches: stage2Searches,
  });

  totalInputTokens += stage2.usage.inputTokens;
  totalOutputTokens += stage2.usage.outputTokens;
  totalSearchCount += stage2.searchCount;

  const parsed = parseDiscoveryCandidates(stage2.text, "web", input.limit);
  console.log(
    `[web-discovery] Stage 2: ${parsed.candidates.length} candidates from ${companies.length} companies (${stage2.searchCount} searches)`,
  );

  return {
    candidates: parsed.candidates,
    droppedCount: parsed.droppedCount,
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    searchCount: totalSearchCount,
    model,
    provider,
    mode: "two-stage",
  };
}

// ---------------------------------------------------------------------------
// Single-pass fallback (original approach, used when Stage 1 fails)
// ---------------------------------------------------------------------------

async function searchWebSinglePass(
  _tenantDomain: string,
  input: DiscoverySearchInput,
): Promise<WebDiscoveryResult> {
  const prompt = buildDiscoveryPrompt(input);
  const result = await completeWithWebSearch(prompt, {
    systemPrompt: PEOPLE_LOOKUP_SYSTEM,
    maxTokens: 4096,
    // More searches than before: broad searches need room to cover metro areas
    // and adjacent verticals.
    maxSearches: Math.min(12, Math.max(5, Math.ceil(input.limit / 3))),
  });

  const parsed = parseDiscoveryCandidates(result.text, "web", input.limit);
  return {
    candidates: parsed.candidates,
    droppedCount: parsed.droppedCount,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    searchCount: result.searchCount,
    model: result.model,
    provider: result.provider,
    mode: "single-pass",
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Find net-new prospects from the public web for the given ICP criteria.
 *
 * Uses the two-stage agentic approach (company research → people lookup) by
 * default, falling back to the classic single-pass prompt if Stage 1 produces
 * no companies. Returns parsed (not yet deduped/scored) candidates — the
 * discovery service handles dedup/scoring.
 */
export async function searchWeb(
  tenantDomain: string,
  input: DiscoverySearchInput,
): Promise<WebDiscoveryResult> {
  try {
    return await searchWebTwoStage(tenantDomain, input);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    // stage1_empty: planned fallback — not a real error.
    // Other errors: surface them so the caller can decide.
    if (msg !== "stage1_empty") throw err;
    console.log("[web-discovery] Falling back to single-pass search");
    return searchWebSinglePass(tenantDomain, input);
  }
}
