/**
 * Discovery intent expansion.
 *
 * Niche prospecting asks ("fintech tech leaders in Seattle for an AI dinner")
 * fail when the raw targeting labels are sent to a contact database verbatim:
 * "Seattle" misses Bellevue/Redmond/Tukwila, "fintech" misses banks, credit
 * unions, insurers, and wealth managers, and exact titles miss "EVP & CTO".
 *
 * This module expands the campaign's ICP criteria BEFORE the search:
 * 1. An AI pass interprets the intent and proposes adjacent industries,
 *    metro-area locations, and title variants.
 * 2. A deterministic static expansion (metro suburb tables, adjacent-industry
 *    tables, seniority title variants) is used as the fallback when the AI
 *    pass is unavailable or fails — and is unit-testable.
 *
 * The expansion result carries a summary of what was added so the UI can show
 * the user exactly how their targeting was broadened.
 */

import type { IcpCriteria } from "./prospector-core";
import { completeForFeature } from "./ai-provider";
import { AI_FEATURES } from "@shared/schema";

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface IntentExpansionDetail {
  /** Locations added beyond what the user entered (metro suburbs etc.). */
  addedGeographies: string[];
  /** Industries added beyond what the user entered (adjacent verticals). */
  addedIndustries: string[];
  /** Role/title variants added beyond what the user entered. */
  addedRoles: string[];
  /** How the expansion was produced. */
  method: "ai" | "static" | "none";
}

export interface IntentExpansionResult {
  criteria: IcpCriteria;
  detail: IntentExpansionDetail;
}

// ---------------------------------------------------------------------------
// Static tables (deterministic fallback)
// ---------------------------------------------------------------------------

/** Major metros → surrounding cities people/companies are actually tagged with. */
const METRO_AREAS: Record<string, string[]> = {
  seattle: ["Bellevue, Washington", "Redmond, Washington", "Kirkland, Washington", "Tacoma, Washington", "Everett, Washington", "Tukwila, Washington", "Bothell, Washington"],
  "san francisco": ["Oakland, California", "San Jose, California", "Palo Alto, California", "Mountain View, California", "Redwood City, California", "Berkeley, California"],
  "new york": ["Brooklyn, New York", "Jersey City, New Jersey", "Newark, New Jersey", "Stamford, Connecticut", "White Plains, New York"],
  boston: ["Cambridge, Massachusetts", "Waltham, Massachusetts", "Burlington, Massachusetts", "Quincy, Massachusetts"],
  chicago: ["Evanston, Illinois", "Naperville, Illinois", "Schaumburg, Illinois", "Oak Brook, Illinois"],
  austin: ["Round Rock, Texas", "Cedar Park, Texas", "Georgetown, Texas"],
  denver: ["Boulder, Colorado", "Aurora, Colorado", "Englewood, Colorado", "Centennial, Colorado"],
  atlanta: ["Alpharetta, Georgia", "Marietta, Georgia", "Sandy Springs, Georgia", "Roswell, Georgia"],
  "los angeles": ["Santa Monica, California", "Pasadena, California", "Irvine, California", "El Segundo, California", "Burbank, California"],
  portland: ["Beaverton, Oregon", "Hillsboro, Oregon", "Lake Oswego, Oregon", "Vancouver, Washington"],
  dallas: ["Plano, Texas", "Irving, Texas", "Frisco, Texas", "Richardson, Texas"],
  washington: ["Arlington, Virginia", "Reston, Virginia", "Bethesda, Maryland", "Tysons, Virginia", "McLean, Virginia"],
  miami: ["Fort Lauderdale, Florida", "Boca Raton, Florida", "Coral Gables, Florida"],
  minneapolis: ["St. Paul, Minnesota", "Bloomington, Minnesota", "Eden Prairie, Minnesota"],
  phoenix: ["Scottsdale, Arizona", "Tempe, Arizona", "Chandler, Arizona"],
  london: ["Reading, England", "Cambridge, England", "Oxford, England"],
  toronto: ["Mississauga, Ontario", "Markham, Ontario", "Waterloo, Ontario"],
};

/** Industry label → adjacent verticals that share buyers and problems. */
const ADJACENT_INDUSTRIES: Record<string, string[]> = {
  fintech: ["banking", "credit union", "insurance", "wealth management", "payments", "asset management"],
  banking: ["credit union", "fintech", "wealth management", "financial services"],
  insurance: ["insurtech", "financial services", "health insurance"],
  "wealth management": ["asset management", "private equity", "financial advisory", "investment management"],
  "asset management": ["wealth management", "private equity", "hedge fund", "investment management"],
  "private equity": ["venture capital", "asset management", "investment management"],
  healthtech: ["healthcare", "health insurance", "hospital systems", "digital health", "life sciences"],
  healthcare: ["healthtech", "health insurance", "hospital systems", "life sciences"],
  edtech: ["higher education", "e-learning", "education"],
  cybersecurity: ["information security", "network security", "managed security services", "risk management"],
  saas: ["software", "cloud computing", "enterprise software"],
  software: ["saas", "cloud computing", "it services"],
  retail: ["e-commerce", "consumer goods", "hospitality"],
  ecommerce: ["retail", "consumer goods", "marketplaces"],
  manufacturing: ["industrial automation", "supply chain", "logistics"],
  logistics: ["supply chain", "transportation", "manufacturing"],
  "real estate": ["proptech", "construction", "property management"],
  legal: ["legaltech", "professional services", "compliance"],
  media: ["entertainment", "publishing", "advertising"],
  energy: ["utilities", "renewables", "oil and gas"],
};

/** Role label → common variant titles for the same seat. */
const ROLE_VARIANTS: Record<string, string[]> = {
  cto: ["CIO", "VP Engineering", "Head of Technology", "EVP Technology", "Chief Information Officer"],
  cio: ["CTO", "VP Information Technology", "Head of IT", "Chief Digital Officer"],
  ciso: ["VP Security", "Head of Information Security", "Director of Security"],
  cmo: ["VP Marketing", "Head of Marketing", "Chief Growth Officer"],
  cro: ["VP Sales", "Chief Sales Officer", "Head of Revenue"],
  cfo: ["VP Finance", "Head of Finance", "Chief Accounting Officer"],
  ceo: ["Founder", "Co-Founder", "President", "Managing Director"],
  cpo: ["VP Product", "Head of Product"],
  coo: ["VP Operations", "Head of Operations"],
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function addUnique(target: string[], added: string[], existing: Set<string>, values: string[], cap: number) {
  for (const v of values) {
    const key = norm(v);
    if (!key || existing.has(key)) continue;
    if (target.length >= cap) return;
    existing.add(key);
    target.push(v);
    added.push(v);
  }
}

/**
 * Deterministic expansion using the static tables above. Pure — unit-testable.
 * Caps keep the result inside Apollo's per-filter limits (10 each).
 */
export function expandCriteriaStatic(criteria: IcpCriteria): IntentExpansionResult {
  const geographies = [...(criteria.geographies ?? [])];
  const industries = [...(criteria.industries ?? [])];
  const roles = [...(criteria.roles ?? [])];

  const geoSeen = new Set(geographies.map(norm));
  const indSeen = new Set(industries.map(norm));
  const roleSeen = new Set(roles.map(norm));

  const addedGeographies: string[] = [];
  const addedIndustries: string[] = [];
  const addedRoles: string[] = [];

  for (const g of criteria.geographies ?? []) {
    // Match "Seattle", "Seattle, WA", "Seattle area", "Greater Seattle"…
    const key = Object.keys(METRO_AREAS).find((m) => norm(g).includes(m));
    if (key) addUnique(geographies, addedGeographies, geoSeen, METRO_AREAS[key], 10);
  }

  for (const ind of criteria.industries ?? []) {
    const adj = ADJACENT_INDUSTRIES[norm(ind)];
    if (adj) addUnique(industries, addedIndustries, indSeen, adj, 10);
  }

  for (const role of criteria.roles ?? []) {
    const variants = ROLE_VARIANTS[norm(role)];
    if (variants) addUnique(roles, addedRoles, roleSeen, variants, 10);
  }

  const anyAdded = addedGeographies.length + addedIndustries.length + addedRoles.length > 0;
  return {
    criteria: { ...criteria, geographies, industries, roles },
    detail: {
      addedGeographies,
      addedIndustries,
      addedRoles,
      method: anyAdded ? "static" : "none",
    },
  };
}

// ---------------------------------------------------------------------------
// AI expansion
// ---------------------------------------------------------------------------

const EXPANSION_SYSTEM_PROMPT = `You expand B2B prospecting targeting criteria so a contact-database search finds everyone the user actually means, not just literal keyword matches. You respond with strict JSON only.`;

function buildExpansionPrompt(criteria: IcpCriteria, goal?: string | null): string {
  return [
    goal ? `Campaign goal: ${goal}` : "",
    "Current targeting filters:",
    `- Roles/titles: ${(criteria.roles ?? []).join("; ") || "(none)"}`,
    `- Industries: ${(criteria.industries ?? []).join("; ") || "(none)"}`,
    `- Geographies: ${(criteria.geographies ?? []).join("; ") || "(none)"}`,
    "",
    "Expand these so a people-database search captures the user's real intent:",
    "1. geographies: for each city, add the surrounding metro-area cities and suburbs where target companies are actually headquartered (as \"City, State\" strings). Max 8 additions.",
    "2. industries: add adjacent verticals that share the same buyers and problems (e.g. fintech → banking, credit unions, insurance, wealth management). Max 6 additions.",
    "3. roles: add common variant titles for the same seats (e.g. CTO → CIO, VP Engineering, Head of Technology). Max 6 additions.",
    "Only ADD items — never remove or rephrase the originals. Do not add items already in the list.",
    "",
    'Respond with ONLY a JSON object (no prose, no fences): {"geographies": string[], "industries": string[], "roles": string[]} — each array contains ONLY the additions.',
  ]
    .filter(Boolean)
    .join("\n");
}

function parseStringArray(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x).trim())
    .filter((x) => x.length > 0 && x.length < 80)
    .slice(0, cap);
}

/**
 * Expand ICP criteria with an AI pass; fall back to the static tables when the
 * AI is unavailable or returns unusable output. Never throws.
 */
export async function expandCriteria(
  tenantDomain: string,
  criteria: IcpCriteria,
  goal?: string | null,
): Promise<IntentExpansionResult> {
  // Nothing to expand from — skip the AI call.
  const hasAnyTargeting =
    (criteria.roles?.length ?? 0) + (criteria.industries?.length ?? 0) + (criteria.geographies?.length ?? 0) > 0;
  if (!hasAnyTargeting) {
    return { criteria, detail: { addedGeographies: [], addedIndustries: [], addedRoles: [], method: "none" } };
  }

  try {
    const result = await completeForFeature(AI_FEATURES.PROSPECT_RESEARCH, buildExpansionPrompt(criteria, goal), {
      systemPrompt: EXPANSION_SYSTEM_PROMPT,
      maxTokens: 1024,
      temperature: 0.2,
      tenantDomain,
    });

    const start = result.text.indexOf("{");
    const end = result.text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("no JSON object in expansion response");
    const parsed = JSON.parse(result.text.slice(start, end + 1)) as Record<string, unknown>;

    const geographies = [...(criteria.geographies ?? [])];
    const industries = [...(criteria.industries ?? [])];
    const roles = [...(criteria.roles ?? [])];
    const geoSeen = new Set(geographies.map(norm));
    const indSeen = new Set(industries.map(norm));
    const roleSeen = new Set(roles.map(norm));
    const addedGeographies: string[] = [];
    const addedIndustries: string[] = [];
    const addedRoles: string[] = [];

    addUnique(geographies, addedGeographies, geoSeen, parseStringArray(parsed.geographies, 8), 10);
    addUnique(industries, addedIndustries, indSeen, parseStringArray(parsed.industries, 6), 10);
    addUnique(roles, addedRoles, roleSeen, parseStringArray(parsed.roles, 6), 10);

    const anyAdded = addedGeographies.length + addedIndustries.length + addedRoles.length > 0;
    if (!anyAdded) return expandCriteriaStatic(criteria);

    console.log(
      `[discovery] AI intent expansion: +${addedGeographies.length} geos, +${addedIndustries.length} industries, +${addedRoles.length} roles`,
    );
    return {
      criteria: { ...criteria, geographies, industries, roles },
      detail: { addedGeographies, addedIndustries, addedRoles, method: "ai" },
    };
  } catch (err) {
    console.warn("[discovery] AI intent expansion failed — using static expansion:", (err as Error).message);
    return expandCriteriaStatic(criteria);
  }
}
