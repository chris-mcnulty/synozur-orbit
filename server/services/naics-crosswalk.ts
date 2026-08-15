/**
 * NAICS Crosswalk — pure fast-path (Task #543, Phase 1)
 *
 * Static, dependency-free lookup from common B2B/tech industry phrases to NAICS
 * codes. Deliberately isolated from the AI resolver (naics-mapping.ts) and the
 * db-backed AI layer so it stays trivially unit-testable — mirrors the repo's
 * `*-core.ts` convention. Codes are NAICS-2017 (the vintage the CBP API's
 * NAICS2017 predicate expects). Intentionally small; extend as real segments
 * accumulate.
 */

export interface NaicsMatch {
  /** NAICS-2017 code, 2–6 digits, as a string (leading digits matter). */
  code: string;
  /** Human-readable industry label. */
  label: string;
  /** 0..1 — how confident we are this code fits the segment. */
  confidence: number;
  /** Where the match came from, for provenance/debugging. */
  source: "crosswalk" | "ai";
}

interface CrosswalkEntry {
  keywords: string[];
  code: string;
  label: string;
}

const SEED_CROSSWALK: CrosswalkEntry[] = [
  { keywords: ["saas", "software", "b2b software", "cloud software", "application software"], code: "511210", label: "Software Publishers" },
  { keywords: ["it services", "systems integrator", "computer systems design", "custom software", "software development"], code: "5415", label: "Computer Systems Design and Related Services" },
  { keywords: ["data processing", "hosting", "cloud hosting", "infrastructure"], code: "518210", label: "Data Processing, Hosting, and Related Services" },
  { keywords: ["management consulting", "strategy consulting", "consulting"], code: "541611", label: "Administrative Management and General Management Consulting Services" },
  { keywords: ["marketing agency", "advertising", "marketing services", "digital marketing"], code: "5418", label: "Advertising, Public Relations, and Related Services" },
  { keywords: ["financial services", "fintech", "banking", "finance"], code: "52", label: "Finance and Insurance" },
  { keywords: ["insurance", "insurtech"], code: "5241", label: "Insurance Carriers" },
  { keywords: ["healthcare", "health care", "healthtech", "medical", "providers"], code: "62", label: "Health Care and Social Assistance" },
  { keywords: ["hospital"], code: "622", label: "Hospitals" },
  { keywords: ["manufacturing", "industrial", "manufacturer"], code: "31-33", label: "Manufacturing" },
  { keywords: ["retail", "ecommerce", "e-commerce", "retailer"], code: "44-45", label: "Retail Trade" },
  { keywords: ["wholesale", "distribution", "distributor"], code: "42", label: "Wholesale Trade" },
  { keywords: ["education", "edtech", "schools", "university", "higher ed"], code: "61", label: "Educational Services" },
  { keywords: ["real estate", "proptech"], code: "53", label: "Real Estate and Rental and Leasing" },
  { keywords: ["legal", "law firm", "legaltech"], code: "5411", label: "Legal Services" },
  { keywords: ["accounting", "tax", "bookkeeping"], code: "5412", label: "Accounting, Tax Preparation, Bookkeeping, and Payroll Services" },
  { keywords: ["logistics", "transportation", "supply chain", "freight"], code: "48-49", label: "Transportation and Warehousing" },
  { keywords: ["construction", "contech"], code: "23", label: "Construction" },
  { keywords: ["hospitality", "hotel", "restaurant", "food service"], code: "72", label: "Accommodation and Food Services" },
  { keywords: ["media", "publishing", "content"], code: "51", label: "Information" },
  { keywords: ["telecom", "telecommunications"], code: "517", label: "Telecommunications" },
];

/**
 * Look up NAICS codes for an industry string using the static crosswalk only.
 * Pure and synchronous — safe to unit-test and to call on a hot path. Returns
 * all distinct matches (a phrase like "healthcare software" can hit both).
 */
export function lookupNaicsCrosswalk(industryText: string): NaicsMatch[] {
  if (!industryText?.trim()) return [];
  const haystack = industryText.toLowerCase();
  const seen = new Set<string>();
  const matches: NaicsMatch[] = [];

  for (const entry of SEED_CROSSWALK) {
    const hit = entry.keywords.find((kw) => matchesKeyword(haystack, kw));
    if (hit && !seen.has(entry.code)) {
      seen.add(entry.code);
      matches.push({
        code: entry.code,
        label: entry.label,
        // Longer keyword match ⇒ more specific ⇒ higher confidence.
        confidence: hit.length >= 8 ? 0.8 : 0.65,
        source: "crosswalk",
      });
    }
  }
  return matches;
}

/**
 * Token-boundary keyword match: `hospital` matches "hospital ward" but NOT
 * "hospitality". Alphanumeric runs are treated as tokens, so hyphenated/spaced
 * phrases (e.g. "e-commerce", "it services") still match as whole terms.
 */
function matchesKeyword(haystack: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(haystack);
}
