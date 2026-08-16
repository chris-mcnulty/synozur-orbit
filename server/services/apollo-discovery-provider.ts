/**
 * Apollo.io discovery backend.
 *
 * Calls the Apollo People Search API to find ICP-matching prospects from
 * Apollo's contact database (~275 M people). Returns DiscoveryCandidate[]
 * ready for dedup + ICP scoring in the discovery service.
 *
 * Requires: APOLLO_API_KEY secret.
 * Endpoint:  POST https://api.apollo.io/v1/mixed_people/search
 *
 * ── Targeting source decision ──────────────────────────────────────────────
 * Apollo targeting is intentionally derived from persona / campaign ICP
 * criteria (role, industry, companySize, target overrides) — NOT from
 * market_segments firmographics. The rationale:
 *
 *   • Personas are the authoritative qualitative record for who to reach.
 *     market_segments layer on top of personas with quantitative sizing
 *     (TAM/SAM), priority scores, and a Needs Map — all useful for GTM
 *     prioritization but not granular enough to replace role/title filters.
 *
 *   • market_segments.firmographics captures industry + company size, which
 *     map onto personas.industry / personas.companySize. Since backfill seeds
 *     those fields directly from the persona, targeting from the persona
 *     produces equivalent Apollo filters while avoiding a second code path.
 *
 *   • If a segment has diverged from its source persona (user or AI edits),
 *     the divergence is surfaced in the UI (see market-segments.tsx) and the
 *     user can one-click re-sync; discovery then picks up the updated persona
 *     fields automatically on the next run.
 *
 *   • Future option: expose an optional `useSegmentFirmographics` flag on
 *     DiscoverySearchInput that substitutes segment firmographics for
 *     persona.industry + persona.companySize when set. Not implemented yet
 *     because no campaign workflow sends a segmentId into the discovery call.
 */

import type { DiscoveryCandidate, DiscoverySearchInput } from "./discovery-provider-core";
import { isBadName } from "./discovery-provider-core";

const APOLLO_API_URL = "https://api.apollo.io/v1/mixed_people/api_search";
const APOLLO_ORG_SEARCH_URL = "https://api.apollo.io/v1/mixed_companies/search";

// ---------------------------------------------------------------------------
// Applied-filter diagnostics (returned so the caller can surface hints)
// ---------------------------------------------------------------------------

/**
 * A structured record of the filters that were actually sent to the Apollo
 * People Search API. Returned alongside candidates so the discovery service
 * can include them in `DiscoverResult.apolloDiagnostics` when the search
 * returns 0 results.
 */
export interface ApolloAppliedFilters {
  /** Job-title keywords sent as `person_titles` (after normalisation). */
  personTitles: string[];
  /** Geography strings sent as `person_locations`. */
  locations: string[];
  /** Industry keywords joined into `q_keywords`. */
  industries: string[];
  /** Headcount range strings sent as `organization_num_employees_ranges`. */
  employeeRanges: string[];
  /** Company names sent as `organization_names`. */
  namedAccounts: string[];
  /**
   * Segments from the ICP criteria that were *not* sent to Apollo because they
   * look like AUM / revenue descriptors (e.g. "$1B+ AUM") rather than headcount
   * descriptors. Apollo filters by employee count, not by AUM.
   */
  skippedSegments: string[];
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export function isApolloAvailable(): boolean {
  return !!process.env.APOLLO_API_KEY?.trim();
}

export function apolloReason(): string {
  return isApolloAvailable()
    ? "Apollo contact database ready."
    : "Apollo isn't configured — set APOLLO_API_KEY to enable it.";
}

// ---------------------------------------------------------------------------
// Role acronym → full-title synonym map
// ---------------------------------------------------------------------------

/**
 * Maps common GTM/exec acronyms to their full-form equivalents.
 * Keys are lowercase; values are the canonical expansions to add alongside
 * the original acronym in Apollo's person_titles filter.
 */
const ROLE_SYNONYMS: Record<string, string[]> = {
  cro: ["Chief Revenue Officer"],
  cmo: ["Chief Marketing Officer"],
  cto: ["Chief Technology Officer"],
  coo: ["Chief Operating Officer"],
  cfo: ["Chief Financial Officer"],
  ciso: ["Chief Information Security Officer"],
  cdo: ["Chief Digital Officer", "Chief Data Officer"],
  cpo: ["Chief Product Officer"],
  cso: ["Chief Sales Officer", "Chief Strategy Officer"],
  cao: ["Chief Analytics Officer"],
  cco: ["Chief Customer Officer", "Chief Compliance Officer"],
  chro: ["Chief Human Resources Officer"],
  "vp sales": ["Vice President of Sales", "VP of Sales"],
  "vp marketing": ["Vice President of Marketing", "VP of Marketing"],
  "vp engineering": ["Vice President of Engineering", "VP of Engineering"],
  "vp product": ["Vice President of Product", "VP of Product"],
  "vp operations": ["Vice President of Operations", "VP of Operations"],
  "vp finance": ["Vice President of Finance", "VP of Finance"],
  "vp business development": ["Vice President of Business Development"],
  svp: ["Senior Vice President"],
  evp: ["Executive Vice President"],
  avp: ["Assistant Vice President"],
  gm: ["General Manager"],
  md: ["Managing Director"],
};

// ---------------------------------------------------------------------------
// Industry / partner-segment → Apollo keyword tag mapping
// ---------------------------------------------------------------------------

/**
 * Maps common ICP industry/partner labels to Apollo's q_organization_keyword_tags
 * structured field values. These are sent as a dedicated structured filter rather
 * than being crammed into the free-text q_keywords blob.
 *
 * Lookup is case-insensitive (keys are lowercase).
 */
const INDUSTRY_KEYWORD_TAGS: Record<string, string[]> = {
  isv: ["independent software vendor", "software"],
  "isv software": ["independent software vendor", "software"],
  "microsoft partner": ["microsoft partner", "microsoft dynamics", "microsoft gold partner"],
  "microsoft partners": ["microsoft partner", "microsoft dynamics", "microsoft gold partner"],
  "managed service provider": ["managed services", "managed service provider", "it services"],
  msp: ["managed services", "managed service provider", "it services"],
  saas: ["saas", "software as a service", "cloud software"],
  "systems integrator": ["systems integrator", "systems integration", "it consulting"],
  si: ["systems integrator", "systems integration"],
  fintech: ["financial technology", "fintech", "financial services technology"],
  healthtech: ["health technology", "healthcare technology", "digital health"],
  "health tech": ["health technology", "healthcare technology", "digital health"],
  edtech: ["education technology", "edtech", "e-learning"],
  martech: ["marketing technology", "martech"],
  cloud: ["cloud computing", "cloud services", "cloud infrastructure"],
  "cloud computing": ["cloud computing", "cloud services"],
  cybersecurity: ["cybersecurity", "information security", "network security", "cyber security"],
  "information security": ["cybersecurity", "information security"],
  ai: ["artificial intelligence", "machine learning", "ai"],
  "artificial intelligence": ["artificial intelligence", "machine learning"],
  "data analytics": ["data analytics", "business intelligence", "analytics"],
  "business intelligence": ["business intelligence", "data analytics"],
  "professional services": ["professional services", "consulting", "advisory"],
  consulting: ["consulting", "professional services", "management consulting"],
  "digital transformation": ["digital transformation", "technology consulting"],
  ecommerce: ["e-commerce", "ecommerce", "online retail"],
  "e-commerce": ["e-commerce", "ecommerce"],
  "private equity": ["private equity", "pe", "investment management"],
  pe: ["private equity", "investment management"],
  "asset management": ["asset management", "investment management", "wealth management"],
  "wealth management": ["wealth management", "financial advisory", "investment management"],
};

// ---------------------------------------------------------------------------
// ICP → Apollo parameter mapping
// ---------------------------------------------------------------------------

/**
 * Map free-text segment labels to Apollo employee-count ranges.
 * Apollo accepts ranges like "1,200" (1–200 employees).
 *
 * Returns an empty array when the segment looks like an AUM/revenue
 * descriptor (e.g. "$1B+ AUM", "$500M revenue") rather than a headcount
 * descriptor — those don't translate to employee counts.
 */
function segmentsToEmployeeRanges(segments: string[]): string[] {
  const ranges: string[] = [];
  for (const seg of segments) {
    const s = seg.toLowerCase();
    // Skip financial-size descriptors — AUM/revenue ≠ headcount.
    if (/\$[\d.]+[mb]|\baum\b|\brevenue\b|\bfund\b/i.test(s)) continue;
    if (s.includes("startup") || s.includes("very small")) {
      ranges.push("1,10", "11,50");
    } else if (s.includes("smb") || s.includes("small")) {
      ranges.push("1,200");
    } else if (s.includes("mid") || s.includes("commercial")) {
      ranges.push("201,1000");
    } else if (s.includes("enterprise") || s.includes("large")) {
      ranges.push("1001,10000", "10001,1000000");
    }
  }
  return [...new Set(ranges)];
}

/**
 * Apollo's person_titles filter expects individual, atomic job-title keywords.
 * ICP persona role fields are often written as combined English sentences.
 *
 * This function:
 * 1. Splits combined role strings into atomic parts.
 * 2. Expands known acronyms (CRO, CMO…) into both the acronym AND the full title
 *    so Apollo matches both "CRO" profiles and "Chief Revenue Officer" profiles.
 * 3. Deduplicates and caps at 10 (Apollo API limit).
 */
function normalizePersonTitles(roles: string[]): string[] {
  const out: string[] = [];

  for (const role of roles) {
    // Split on common list separators: ", " / " or " / " / " | "
    const parts = role.split(/,\s+|\s+or\s+|\s*[\/|]\s*/i);
    for (const part of parts) {
      // Strip context qualifiers that follow the title: "at a ...", "for ...",
      // "in ...", "managing ...", "with ...", "overseeing ...", etc.
      const clean = part
        .replace(/\s+(at|for|in|of|with|managing|overseeing|within|across|reporting)\s+.*/i, "")
        .trim();
      if (clean.length <= 1 || clean.length >= 80) continue;

      out.push(clean);

      // Check if this matches a known acronym synonym (case-insensitive).
      const key = clean.toLowerCase();
      const synonyms = ROLE_SYNONYMS[key];
      if (synonyms?.length) {
        out.push(...synonyms);
      } else {
        // Multi-word: check if it matches a "vp X" pattern.
        const vpMatch = key.match(/^vp\s+(.+)$/);
        if (vpMatch) {
          const vpKey = `vp ${vpMatch[1].trim()}`;
          const vpSynonyms = ROLE_SYNONYMS[vpKey];
          if (vpSynonyms?.length) out.push(...vpSynonyms);
        }
      }
    }
  }

  // Dedupe case-insensitively; cap at 10 (Apollo API limit).
  const seen = new Set<string>();
  return out.filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

/**
 * Map industry/partner-segment labels to structured Apollo keyword tags.
 *
 * Returns two lists:
 * - `structured`: tags matched via INDUSTRY_KEYWORD_TAGS (sent as q_organization_keyword_tags)
 * - `fallback`: labels with no structured match (sent via q_keywords blob as before)
 */
function mapIndustriesToTags(industries: string[]): { structured: string[]; fallback: string[] } {
  const structured: string[] = [];
  const fallback: string[] = [];
  const seen = new Set<string>();

  for (const ind of industries) {
    const key = ind.toLowerCase().trim();
    const tags = INDUSTRY_KEYWORD_TAGS[key];
    if (tags?.length) {
      for (const t of tags) {
        if (!seen.has(t)) {
          seen.add(t);
          structured.push(t);
        }
      }
    } else {
      fallback.push(ind);
    }
  }
  return { structured, fallback };
}

// ---------------------------------------------------------------------------
// Apollo response shapes
// ---------------------------------------------------------------------------

interface ApolloPerson {
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  linkedin_url?: string;
  email?: string;
  email_status?: string;
  city?: string;
  state?: string;
  country?: string;
  organization?: {
    name?: string;
    industry?: string;
  };
}

interface ApolloSearchResponse {
  people?: ApolloPerson[];
  pagination?: {
    page: number;
    per_page: number;
    total_entries: number;
    total_pages: number;
  };
  error_code?: string;
  message?: string;
}

interface ApolloOrganization {
  id?: string;
  name?: string;
  primary_domain?: string;
  industry?: string;
  estimated_num_employees?: number;
}

interface ApolloOrgSearchResponse {
  organizations?: ApolloOrganization[];
  accounts?: ApolloOrganization[];
  pagination?: { total_entries: number };
  error_code?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Main error class
// ---------------------------------------------------------------------------

export class ApolloDiscoveryError extends Error {
  constructor(message: string, readonly code: "not_available" | "api_error") {
    super(message);
    this.name = "ApolloDiscoveryError";
  }
}

// ---------------------------------------------------------------------------
// Company-similarity expansion
// ---------------------------------------------------------------------------

/**
 * Expansion summary returned alongside discovery results so the UI can show
 * "Searched 34 companies similar to AvePoint & Protiviti".
 */
export interface ApolloExpansionSummary {
  /** The seed companies the user entered (before expansion). */
  seedCompanies: string[];
  /** Total companies actually searched (seed + similar). */
  expandedCount: number;
}

export interface ApolloSearchResult {
  candidates: DiscoveryCandidate[];
  /** Structured record of every filter sent to Apollo — used by the UI to
   *  surface diagnostic hints when 0 results are returned. */
  appliedFilters: ApolloAppliedFilters;
  /** Set when seed companies were expanded into a broader similar-company list. */
  expansionSummary?: ApolloExpansionSummary;
  /**
   * Set when the strict query returned 0 results and a relaxation tier
   * produced the candidates instead. Human-readable, shown in the UI.
   */
  relaxationApplied?: string;
  /**
   * Number of raw Apollo records dropped during normalization (bad names,
   * single-token names, role labels). Mirrors `droppedCount` in DiscoverResult.
   */
  droppedCount: number;
}

// ---------------------------------------------------------------------------
// Progressive filter relaxation
// ---------------------------------------------------------------------------

/**
 * Apollo seniority values covering decision-maker seats. Used when the
 * relaxation ladder drops exact titles in favor of seniority-level matching.
 */
const DECISION_MAKER_SENIORITIES = ["owner", "founder", "c_suite", "partner", "vp", "head", "director"];

export interface RelaxationTier {
  /** Human-readable description surfaced to the user. */
  label: string;
  /** The modified request body for this tier. */
  body: Record<string, unknown>;
}

/**
 * Build the ladder of progressively-broader request bodies tried when the
 * strict query returns 0 results. Each tier relaxes ONE additional dimension
 * (cumulatively) in order of least → most information lost:
 *
 *   1. Drop the company-size (headcount) filter.
 *   2. Also drop the industry filters (keyword tags + free-text blob).
 *   3. Also replace exact titles with decision-maker seniority levels.
 *
 * Tiers that would be identical to the previous body (nothing to relax at
 * that step) are skipped. Pure — unit-testable.
 */
export function buildRelaxationTiers(baseBody: Record<string, unknown>): RelaxationTier[] {
  const tiers: RelaxationTier[] = [];
  let current = { ...baseBody };

  // Tier 1: drop company-size — least information lost; sector + titles intact.
  if (current.organization_num_employees_ranges) {
    const { organization_num_employees_ranges: _drop, ...rest } = current;
    current = rest;
    tiers.push({ label: "company-size filter removed", body: { ...current } });
  }

  // Tier 2: replace exact titles with decision-maker seniorities — still scoped
  // to the right industry and geography; catches "EVP & CTO" / "Head of Tech"
  // variants that exact-title matching misses.
  if (current.person_titles) {
    const { person_titles: _p, ...rest } = current;
    current = { ...rest, person_seniorities: DECISION_MAKER_SENIORITIES };
    tiers.push({
      label: tiers.length
        ? "company-size filter removed and titles broadened to senior decision-makers"
        : "exact titles broadened to senior decision-makers",
      body: { ...current },
    });
  }

  // Tier 3: last resort — also drop the industry filter. Keeps geography so we
  // stay in the right market; returns any senior leader in the area.
  if (current.q_organization_keyword_tags || current.q_keywords) {
    const { q_organization_keyword_tags: _t, q_keywords: _k, ...rest } = current;
    current = rest;
    tiers.push({
      label: "broadened to senior decision-makers across all industries in the target locations",
      body: { ...current },
    });
  }

  return tiers;
}

/**
 * Given a small list of seed companies, find similar organizations via Apollo's
 * company search (same industry tags + similar employee range).
 * Returns an expanded list of company names (up to ~50 total).
 *
 * Falls back to the seed list on any error (never throws).
 */
async function expandSimilarCompanies(
  apiKey: string,
  seedCompanies: string[],
  employeeRanges: string[],
  industryTags: string[],
): Promise<string[]> {
  try {
    // Build a search that targets the same industry + size profile.
    // We ask Apollo for up to MAX_ORG_LIST_SIZE organizations and take their
    // names. Fetching more than this would be silently discarded downstream
    // (the batch cap trims any excess), so there is no reason to request extra
    // paid results from Apollo.
    const body: Record<string, unknown> = {
      page: 1,
      per_page: MAX_ORG_LIST_SIZE,
    };

    if (employeeRanges.length) {
      body.organization_num_employees_ranges = employeeRanges;
    }

    if (industryTags.length) {
      // Use a representative subset (Apollo has a keyword limit).
      body.q_organization_keyword_tags = industryTags.slice(0, 5);
    }

    // Also pass the seed companies as context — Apollo will return similar orgs.
    if (seedCompanies.length) {
      body.q_organization_name = seedCompanies[0]; // seed with primary company name
    }

    console.log("[Apollo] org-expansion body:", JSON.stringify(body));

    const res = await fetch(APOLLO_ORG_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify(body),
    });

    const rawText = await res.text();
    console.log(`[Apollo] org-expansion ${res.status}:`, rawText.slice(0, 300));

    if (!res.ok) {
      console.warn("[Apollo] org-expansion non-OK, skipping expansion");
      return seedCompanies;
    }

    const data = JSON.parse(rawText) as ApolloOrgSearchResponse;
    const orgs = data.organizations ?? data.accounts ?? [];
    const names = orgs
      .map((o) => (o.name ?? "").trim())
      .filter(Boolean);

    if (names.length === 0) return seedCompanies;

    // Merge: seed companies first, then similar (deduplicated).
    const seen = new Set(seedCompanies.map((n) => n.toLowerCase()));
    const combined = [...seedCompanies];
    for (const n of names) {
      if (!seen.has(n.toLowerCase())) {
        seen.add(n.toLowerCase());
        combined.push(n);
      }
    }
    console.log(`[Apollo] org-expansion: ${seedCompanies.length} seeds → ${combined.length} total`);
    return combined;
  } catch (err) {
    console.warn("[Apollo] org-expansion failed, using seeds only:", (err as Error).message);
    return seedCompanies;
  }
}

// ---------------------------------------------------------------------------
// Single Apollo people-search call (internal helper)
// ---------------------------------------------------------------------------

async function apolloPeopleSearch(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<ApolloPerson[]> {
  const res = await fetch(APOLLO_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      "Cache-Control": "no-cache",
    },
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  console.log(`[Apollo] people-search ${res.status}:`, rawText.slice(0, 500));

  let response: ApolloSearchResponse;
  try {
    response = JSON.parse(rawText) as ApolloSearchResponse;
  } catch {
    throw new ApolloDiscoveryError(
      `Apollo returned non-JSON: ${res.status} ${rawText.slice(0, 200)}`,
      "api_error",
    );
  }

  if (!res.ok) {
    const msg =
      response.message ??
      (response as any).error ??
      (response as any).error_description ??
      `HTTP ${res.status}: ${rawText.slice(0, 200)}`;
    throw new ApolloDiscoveryError(`Apollo API error: ${msg}`, "api_error");
  }

  return response.people ?? [];
}

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

/**
 * Search Apollo for ICP-matching people and return DiscoveryCandidate[].
 *
 * Enhancements over the base implementation:
 * 1. Role acronyms (CRO, CMO…) are expanded to include their full-title forms.
 * 2. Industry/partner segments are mapped to structured Apollo keyword tags
 *    instead of the free-text q_keywords blob.
 * 3. Named accounts (≤3 seed companies) are expanded to similar orgs via
 *    Apollo's org search endpoint.
 * 4. When the expanded company list exceeds Apollo's 10-org limit the search
 *    is batched into parallel calls and results are deduplicated.
 */
export async function searchApollo(
  _tenantDomain: string,
  input: DiscoverySearchInput,
): Promise<ApolloSearchResult> {
  const apiKey = process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) {
    throw new ApolloDiscoveryError(apolloReason(), "not_available");
  }

  const { criteria, namedAccounts, limit } = input;

  // ── Base request body ──────────────────────────────────────────────────────

  const baseBody: Record<string, unknown> = {
    page: 1,
    per_page: Math.min(limit, 100),
  };

  // Role titles — expanded with synonyms.
  if (criteria.roles?.length) {
    const titles = normalizePersonTitles(criteria.roles);
    if (titles.length) baseBody.person_titles = titles;
  }

  if (criteria.geographies?.length) {
    baseBody.person_locations = criteria.geographies.slice(0, 10);
  }

  // Employee ranges (skip when named accounts are specified — the account list
  // already scopes the search; AUM/revenue segments don't map to headcount).
  const employeeRanges = !namedAccounts?.length
    ? segmentsToEmployeeRanges(criteria.segments ?? [])
    : segmentsToEmployeeRanges(criteria.segments ?? []); // still compute for org-expansion

  if (!namedAccounts?.length && employeeRanges.length) {
    baseBody.organization_num_employees_ranges = employeeRanges;
  }

  // ── Industry tags — structured first, keyword blob as fallback ─────────────
  const { structured: industryTags, fallback: industryFallback } = mapIndustriesToTags(
    criteria.industries ?? [],
  );

  if (industryTags.length) {
    // Apollo's q_organization_keyword_tags accepts an array of tag strings.
    baseBody.q_organization_keyword_tags = industryTags.slice(0, 10);
    console.log("[Apollo] structured industry tags:", industryTags.slice(0, 10));
  }

  // Fall back to q_keywords blob for any labels without a structured match.
  // Apollo's "Value too long" error fires well below 255 chars in practice —
  // keep to ≤3 terms and 100 chars to stay safe.
  if (industryFallback.length) {
    const kw = industryFallback.slice(0, 3).join(" ").slice(0, 100);
    baseBody.q_keywords = kw;
  }

  // ── Named accounts + similarity expansion ─────────────────────────────────

  let expansionSummary: ApolloExpansionSummary | undefined;
  let finalAccountList: string[] = namedAccounts ? [...namedAccounts] : [];

  if (namedAccounts?.length) {
    const isSeedMode = namedAccounts.length <= 3;

    if (isSeedMode) {
      // Expand seed companies into a broader similar-company list.
      finalAccountList = await expandSimilarCompanies(
        apiKey,
        namedAccounts,
        employeeRanges,
        industryTags,
      );
      if (finalAccountList.length > namedAccounts.length) {
        expansionSummary = {
          seedCompanies: namedAccounts,
          expandedCount: finalAccountList.length,
        };
      }

      // Guard against expansion returning more orgs than the downstream batch
      // cap can handle. Trimming here prevents MAX_ORG_LIST_SIZE from silently
      // being exceeded if per_page is ever raised on the org search or the
      // dedup merge grows the list further.
      if (finalAccountList.length > MAX_ORG_LIST_SIZE) {
        console.warn(
          `[Apollo] org-list trimmed from ${finalAccountList.length} → ${MAX_ORG_LIST_SIZE} ` +
            `(MAX_ORG_LIST_SIZE=${MAX_ORG_LIST_SIZE}). Increase MAX_PEOPLE_SEARCH_BATCHES to search more orgs.`,
        );
        finalAccountList = finalAccountList.slice(0, MAX_ORG_LIST_SIZE);
        if (expansionSummary) {
          expansionSummary.expandedCount = finalAccountList.length;
        }
      }
    } else {
      finalAccountList = namedAccounts;
    }
  }

  // ── Applied-filter record (for diagnostics when 0 results are returned) ────

  const appliedFilters: ApolloAppliedFilters = {
    personTitles: Array.isArray(baseBody.person_titles) ? (baseBody.person_titles as string[]) : [],
    locations: Array.isArray(baseBody.person_locations) ? (baseBody.person_locations as string[]) : [],
    industries: [...industryTags, ...industryFallback],
    employeeRanges: Array.isArray(baseBody.organization_num_employees_ranges)
      ? (baseBody.organization_num_employees_ranges as string[])
      : [],
    namedAccounts: finalAccountList.slice(0, 10),
    skippedSegments: (criteria.segments ?? []).filter(
      (seg) => segmentsToEmployeeRanges([seg]).length === 0,
    ),
  };

  // ── Batch execution ────────────────────────────────────────────────────────

  let allPeople: ApolloPerson[] = [];
  let relaxationApplied: string | undefined;

  if (finalAccountList.length === 0) {
    // No named accounts — single call, then a relaxation ladder on 0 results.
    console.log("[Apollo] request body (no accounts):", JSON.stringify(baseBody));
    try {
      allPeople = await apolloPeopleSearch(apiKey, baseBody);
    } catch (err) {
      if (err instanceof ApolloDiscoveryError) throw err;
      throw new ApolloDiscoveryError(
        `Apollo request failed: ${(err as Error).message}`,
        "api_error",
      );
    }

    // Progressive relaxation: retry with each broader tier until one hits.
    if (allPeople.length === 0) {
      for (const tier of buildRelaxationTiers(baseBody)) {
        console.log(`[Apollo] 0 results — relaxing: ${tier.label}`);
        try {
          const people = await apolloPeopleSearch(apiKey, tier.body);
          if (people.length > 0) {
            allPeople = people;
            relaxationApplied = tier.label;
            break;
          }
        } catch (err) {
          // A relaxed retry failing shouldn't kill the whole search — the
          // strict query already succeeded (with 0 rows).
          console.warn(`[Apollo] relaxation tier "${tier.label}" failed:`, (err as Error).message);
        }
      }
    }
  } else if (finalAccountList.length <= 10) {
    // Fits in a single call.
    const body = { ...baseBody, organization_names: finalAccountList };
    console.log("[Apollo] request body (≤10 accounts):", JSON.stringify(body));
    try {
      allPeople = await apolloPeopleSearch(apiKey, body);
    } catch (err) {
      if (err instanceof ApolloDiscoveryError) throw err;
      throw new ApolloDiscoveryError(
        `Apollo request failed: ${(err as Error).message}`,
        "api_error",
      );
    }
  } else {
    // Batch: split into groups of 10 and run in parallel.
    const allBatches: string[][] = [];
    for (let i = 0; i < finalAccountList.length; i += 10) {
      allBatches.push(finalAccountList.slice(i, i + 10));
    }
    // Enforce a hard cap so a large similar-company expansion can't silently
    // multiply paid Apollo calls.
    const batches = allBatches.slice(0, MAX_PEOPLE_SEARCH_BATCHES);
    if (allBatches.length > MAX_PEOPLE_SEARCH_BATCHES) {
      console.warn(
        `[Apollo] searchApollo: capped people-search batches at ${MAX_PEOPLE_SEARCH_BATCHES} ` +
          `(${allBatches.length} batches would have been needed for ${finalAccountList.length} accounts)`,
      );
    }
    console.log(`[Apollo] batching ${finalAccountList.length} accounts into ${batches.length} calls (cap: ${MAX_PEOPLE_SEARCH_BATCHES})`);

    const perBatch = Math.max(10, Math.ceil(limit / batches.length));

    const results = await Promise.allSettled(
      batches.map((batch) => {
        const body = {
          ...baseBody,
          per_page: Math.min(perBatch, 100),
          organization_names: batch,
        };
        return apolloPeopleSearch(apiKey, body);
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        allPeople.push(...result.value);
      } else {
        console.warn("[Apollo] batch call failed:", result.reason?.message);
      }
    }

    // Deduplicate by Apollo person ID across batches.
    const seenIds = new Set<string>();
    allPeople = allPeople.filter((p) => {
      if (!p.id) return true; // no ID → keep (can't dedup)
      if (seenIds.has(p.id)) return false;
      seenIds.add(p.id);
      return true;
    });

    console.log(`[Apollo] batch results: ${allPeople.length} people (after dedup)`);
  }

  // ── Map Apollo person → DiscoveryCandidate ─────────────────────────────────

  const candidates: DiscoveryCandidate[] = allPeople.slice(0, limit).map((p) => {
    const name = p.name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    const locationParts = [p.city, p.state, p.country].filter(Boolean);

    return {
      name: name || "Unknown",
      title: p.title ?? null,
      companyName: p.organization?.name ?? null,
      email: p.email ?? null,
      linkedinUrl: p.linkedin_url
        ? p.linkedin_url.startsWith("http")
          ? p.linkedin_url
          : `https://${p.linkedin_url}`
        : null,
      geography: locationParts.length ? locationParts.join(", ") : null,
      industry: p.organization?.industry ?? null,
      segment: null,
      sourceUrl: p.linkedin_url
        ? p.linkedin_url.startsWith("http")
          ? p.linkedin_url
          : `https://${p.linkedin_url}`
        : null,
      source: "apollo" as const,
    };
  });

  // Drop rows with no usable name, single-token names, and company/role-label names.
  // Apollo sometimes returns records where `name` is only a first name or a role
  // label (e.g. "Skylar", "Hunter", "VP of Engineering") — the same quality gate
  // that the web parser applies must also run here.
  const filtered = candidates.filter((c) => {
    if (!c.name || c.name === "Unknown") return false;
    if (!c.name.includes(" ")) {
      console.debug(`[Apollo] dropped single-token name: "${c.name}"`);
      return false;
    }
    if (isBadName(c.name)) {
      console.debug(`[Apollo] dropped non-person name: "${c.name}"`);
      return false;
    }
    return true;
  });

  const droppedCount = candidates.length - filtered.length;
  if (droppedCount > 0) {
    console.log(`[Apollo] dropped ${droppedCount} of ${candidates.length} candidates during normalization`);
  }

  return {
    candidates: filtered,
    appliedFilters,
    expansionSummary,
    relaxationApplied,
    droppedCount,
  };
}

// ---------------------------------------------------------------------------
// Companies-first search (event campaigns)
// ---------------------------------------------------------------------------

function apolloPersonToCandidate(p: ApolloPerson): DiscoveryCandidate {
  const name = p.name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  const locationParts = [p.city, p.state, p.country].filter(Boolean);
  const li = p.linkedin_url ? (p.linkedin_url.startsWith("http") ? p.linkedin_url : `https://${p.linkedin_url}`) : null;
  return {
    name: name || "Unknown",
    title: p.title ?? null,
    companyName: p.organization?.name ?? null,
    email: p.email ?? null,
    linkedinUrl: li,
    geography: locationParts.length ? locationParts.join(", ") : null,
    industry: p.organization?.industry ?? null,
    segment: null,
    sourceUrl: li,
    source: "apollo" as const,
  };
}

/**
 * Hard cap on the number of people-search batches issued per
 * `searchApolloCompaniesFirst` call (applies to both the primary pass and the
 * optional seniority retry). Apollo bills per request, so this keeps the total
 * call count predictable as the org cluster grows.
 *
 * With 25 orgs fetched in Step 1 (per_page=25) and 10 orgs per batch, the
 * natural batch count is ceil(25/10) = 3, which already fits within this cap.
 * The cap prevents future edits from quietly multiplying paid API calls.
 */
export const MAX_PEOPLE_SEARCH_BATCHES = 3;

/**
 * Hard ceiling on the number of org names that can enter the people-search
 * pipeline. Each 10-org chunk costs one Apollo API call, so this directly
 * bounds the maximum spend per discovery run.
 *
 * = MAX_PEOPLE_SEARCH_BATCHES × 10  (one full batch worth per allowed call).
 */
export const MAX_ORG_LIST_SIZE = MAX_PEOPLE_SEARCH_BATCHES * 10;

/**
 * Companies-first discovery: the way a human fills an event room.
 *
 * Instead of one people-search where every filter must match at once, this:
 * 1. Finds fitting organizations in the target geography/industry (an
 *    "account cluster") via Apollo's org search.
 * 2. Looks up the senior decision-makers at each of those companies.
 *
 * Used for event-invite campaigns when the regular people-search yields
 * little. Returns [] rather than throwing on any failure.
 */
export async function searchApolloCompaniesFirst(
  input: DiscoverySearchInput,
): Promise<{ candidates: DiscoveryCandidate[]; accountCluster: string[]; droppedCount: number }> {
  const apiKey = process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) return { candidates: [], accountCluster: [], droppedCount: 0 };

  const { criteria, limit } = input;

  try {
    // ── Step 1: account cluster — orgs in the geography + industry ─────────
    const { structured: industryTags } = mapIndustriesToTags(criteria.industries ?? []);
    const orgBody: Record<string, unknown> = { page: 1, per_page: 25 };
    if (criteria.geographies?.length) {
      orgBody.organization_locations = criteria.geographies.slice(0, 10);
    }
    if (industryTags.length) {
      orgBody.q_organization_keyword_tags = industryTags.slice(0, 5);
    } else if (criteria.industries?.length) {
      orgBody.q_keywords = criteria.industries.join(" ").slice(0, 255);
    }

    console.log("[Apollo] companies-first org search:", JSON.stringify(orgBody));
    const orgRes = await fetch(APOLLO_ORG_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey, "Cache-Control": "no-cache" },
      body: JSON.stringify(orgBody),
    });
    if (!orgRes.ok) {
      console.warn(`[Apollo] companies-first org search ${orgRes.status} — skipping`);
      return { candidates: [], accountCluster: [], droppedCount: 0 };
    }
    const orgData = (await orgRes.json()) as ApolloOrgSearchResponse;
    const orgNames = (orgData.organizations ?? orgData.accounts ?? [])
      .map((o) => (o.name ?? "").trim())
      .filter(Boolean);
    if (orgNames.length === 0) return { candidates: [], accountCluster: [], droppedCount: 0 };

    // ── Step 2: senior people at those companies ───────────────────────────
    const titles = criteria.roles?.length ? normalizePersonTitles(criteria.roles) : [];
    const peopleBase: Record<string, unknown> = {
      page: 1,
      per_page: Math.min(limit, 100),
    };
    if (titles.length) peopleBase.person_titles = titles;
    else peopleBase.person_seniorities = DECISION_MAKER_SENIORITIES;

    const allBatches: string[][] = [];
    for (let i = 0; i < orgNames.length; i += 10) allBatches.push(orgNames.slice(i, i + 10));
    // Enforce the hard cap so future org-cluster growth can't silently multiply
    // paid Apollo calls.
    const batches = allBatches.slice(0, MAX_PEOPLE_SEARCH_BATCHES);
    if (allBatches.length > MAX_PEOPLE_SEARCH_BATCHES) {
      console.warn(
        `[Apollo] companies-first: capped people-search batches at ${MAX_PEOPLE_SEARCH_BATCHES} ` +
          `(${allBatches.length} batches would have been needed for ${orgNames.length} orgs)`,
      );
    }

    const results = await Promise.allSettled(
      batches.map((batch) => apolloPeopleSearch(apiKey, { ...peopleBase, organization_names: batch })),
    );

    const allPeople: ApolloPerson[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") allPeople.push(...r.value);
      else console.warn("[Apollo] companies-first people batch failed:", r.reason?.message);
    }

    // If titles were too strict for these accounts, retry once with seniorities.
    if (allPeople.length === 0 && titles.length) {
      const retry = await Promise.allSettled(
        batches.map((batch) =>
          apolloPeopleSearch(apiKey, {
            ...peopleBase,
            person_titles: undefined,
            person_seniorities: DECISION_MAKER_SENIORITIES,
            organization_names: batch,
          }),
        ),
      );
      for (const r of retry) {
        if (r.status === "fulfilled") allPeople.push(...r.value);
      }
    }

    const seenIds = new Set<string>();
    const deduped = allPeople.filter((p) => {
      if (!p.id) return true;
      if (seenIds.has(p.id)) return false;
      seenIds.add(p.id);
      return true;
    });

    const mapped = deduped.slice(0, limit).map(apolloPersonToCandidate);
    const candidates = mapped.filter((c) => {
      if (!c.name || c.name === "Unknown") return false;
      if (!c.name.includes(" ")) return false;
      if (isBadName(c.name)) return false;
      return true;
    });
    const droppedCount = mapped.length - candidates.length;
    if (droppedCount > 0) {
      console.log(`[Apollo] companies-first: dropped ${droppedCount} of ${mapped.length} candidates during normalization`);
    }

    console.log(`[Apollo] companies-first: ${orgNames.length} orgs → ${candidates.length} people`);
    return { candidates, accountCluster: orgNames, droppedCount };
  } catch (err) {
    console.warn("[Apollo] companies-first search failed:", (err as Error).message);
    return { candidates: [], accountCluster: [], droppedCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// People Match (single-person enrichment)
// ---------------------------------------------------------------------------

const APOLLO_MATCH_URL = "https://api.apollo.io/v1/people/match";

export interface ApolloMatchInput {
  name?: string | null;
  title?: string | null;
  companyName?: string | null;
  linkedinUrl?: string | null;
}

export interface ApolloMatchResult {
  email: string | null;
  linkedinUrl: string | null;
}

function normalizeApolloLinkedIn(url?: string | null): string | null {
  if (!url) return null;
  return url.startsWith("http") ? url : `https://${url}`;
}

/** Apollo sometimes returns a masked placeholder instead of a real address. */
function isUsableApolloEmail(email?: string | null): email is string {
  if (!email) return false;
  if (/not_unlocked|email_not_unlocked|^[^@]*@domain\.com$/i.test(email)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Apollo People Match — enrich one known person (name + company, optionally a
 * LinkedIn URL) to their work email + LinkedIn profile. A direct Apollo API
 * call, so it is independent of the active AI provider (works whether the
 * tenant runs on Azure Foundry or Anthropic). Returns null when Apollo isn't
 * configured or there's no confident match; never throws.
 */
export async function matchApolloPerson(input: ApolloMatchInput): Promise<ApolloMatchResult | null> {
  const apiKey = process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) return null;

  const [firstName, ...rest] = (input.name ?? "").trim().split(/\s+/).filter(Boolean);
  const lastName = rest.join(" ");

  const body: Record<string, unknown> = {};
  if (input.name) body.name = input.name;
  if (firstName) body.first_name = firstName;
  if (lastName) body.last_name = lastName;
  if (input.companyName) body.organization_name = input.companyName;
  if (input.linkedinUrl) body.linkedin_url = input.linkedinUrl;

  try {
    const res = await fetch(APOLLO_MATCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey, "Cache-Control": "no-cache" },
      body: JSON.stringify(body),
    });
    const rawText = await res.text();
    if (!res.ok) {
      console.warn(`[Apollo] match ${res.status}:`, rawText.slice(0, 200));
      return null;
    }
    const data = JSON.parse(rawText) as { person?: ApolloPerson };
    const p = data.person;
    if (!p) return null;
    return {
      email: isUsableApolloEmail(p.email) ? p.email.toLowerCase() : null,
      linkedinUrl: normalizeApolloLinkedIn(p.linkedin_url),
    };
  } catch (err) {
    console.warn("[Apollo] match failed:", (err as Error).message);
    return null;
  }
}
