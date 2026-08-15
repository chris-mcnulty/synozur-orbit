/**
 * NAICS Mapping — Strategic Intelligence Stack (Task #543, Phase 1)
 *
 * Everything Census-backed hangs off one translation: a segment's free-text
 * industry / firmographics → one or more NAICS codes. Resolved in two tiers,
 * cheapest first:
 *
 *   1. Static crosswalk (naics-crosswalk.ts) — zero cost, instant, deterministic.
 *   2. AI resolver (this module)             — completeForFeature('market_sizing')
 *      for anything the crosswalk misses. Cached per-tenant by the AI layer.
 *
 * The pure crosswalk lives in its own module so it (and the CBP URL builder)
 * stay unit-testable without dragging in the db-backed AI layer.
 */

import { AI_FEATURES } from "@shared/schema";
import { completeForFeature } from "./ai-provider";
import { logAiUsage } from "./ai-usage-logger";
import { extractJsonArray } from "./repurpose-core";
import { lookupNaicsCrosswalk, type NaicsMatch } from "./naics-crosswalk";

export { lookupNaicsCrosswalk, type NaicsMatch } from "./naics-crosswalk";

const NAICS_SYSTEM_PROMPT =
  "You are a NAICS classification expert. Map a described business audience to " +
  "the North American Industry Classification System (2017 vintage). Return ONLY " +
  "codes that genuinely fit. Prefer 4–6 digit codes for specific industries and " +
  "2–3 digit sectors for broad ones. Never invent codes.";

/**
 * Resolve NAICS codes for an industry description, crosswalk-first then AI for
 * the remainder. The AI call is cached per-tenant by the ai-provider layer.
 *
 * @param industryText  Free-text industry / audience description (e.g. the
 *                      segment's `firmographics.industry`).
 * @param opts.tenantDomain  Enables AI response caching (strongly recommended).
 * @param opts.forceAi  Skip the crosswalk fast-path (mainly for testing/quality).
 */
export async function resolveNaicsCodes(
  industryText: string,
  opts: { tenantDomain?: string; forceAi?: boolean } = {},
): Promise<NaicsMatch[]> {
  if (!industryText?.trim()) return [];

  if (!opts.forceAi) {
    const crosswalkHits = lookupNaicsCrosswalk(industryText);
    // A confident crosswalk hit is good enough — skip the AI spend.
    if (crosswalkHits.some((m) => m.confidence >= 0.8)) {
      return crosswalkHits;
    }
  }

  const prompt =
    `Business audience / industry: "${industryText}"\n\n` +
    "Return a JSON array (max 4 items) of the best-fitting NAICS-2017 codes:\n" +
    '[{ "code": "511210", "label": "Software Publishers", "confidence": 0.0-1.0 }]\n' +
    "Order by confidence descending. Return [] if nothing fits.";

  try {
    const result = await completeForFeature(AI_FEATURES.MARKET_SIZING, prompt, {
      tenantDomain: opts.tenantDomain,
      systemPrompt: NAICS_SYSTEM_PROMPT,
      temperature: 0,
      maxTokens: 512,
    });
    await logAiUsage(
      { tenantDomain: opts.tenantDomain },
      "market_sizing",
      result.provider,
      result.model,
      { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
      result.durationMs,
      { step: "naics_resolution" },
    );

    const parsed = extractJsonArray(result.text);
    const aiMatches: NaicsMatch[] = parsed
      .filter((r: any) => r && typeof r.code === "string")
      .map((r: any) => ({
        code: String(r.code).trim(),
        label: typeof r.label === "string" ? r.label : "",
        confidence: clamp01(Number(r.confidence)),
        source: "ai" as const,
      }));

    // Merge any low-confidence crosswalk hints so nothing is lost.
    const crosswalkHits = opts.forceAi ? [] : lookupNaicsCrosswalk(industryText);
    return dedupeByCode([...aiMatches, ...crosswalkHits]);
  } catch (err: any) {
    console.warn(`[naics-mapping] AI resolve failed for "${industryText}": ${err?.message ?? err}`);
    // Degrade to whatever the crosswalk found rather than failing sizing entirely.
    return opts.forceAi ? [] : lookupNaicsCrosswalk(industryText);
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function dedupeByCode(matches: NaicsMatch[]): NaicsMatch[] {
  const byCode = new Map<string, NaicsMatch>();
  for (const m of matches) {
    const existing = byCode.get(m.code);
    // Keep the highest-confidence instance of each code.
    if (!existing || m.confidence > existing.confidence) byCode.set(m.code, m);
  }
  return Array.from(byCode.values()).sort((a, b) => b.confidence - a.confidence);
}
