/**
 * Apollo.io discovery backend.
 *
 * Calls the Apollo People Search API to find ICP-matching prospects from
 * Apollo's contact database (~275 M people). Returns DiscoveryCandidate[]
 * ready for dedup + ICP scoring in the discovery service.
 *
 * Requires: APOLLO_API_KEY secret.
 * Endpoint:  POST https://api.apollo.io/v1/mixed_people/search
 */

import type { DiscoveryCandidate, DiscoverySearchInput } from "./discovery-provider-core";

const APOLLO_API_URL = "https://api.apollo.io/v1/mixed_people/api_search";

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
 * Apollo's person_titles filter expects individual, atomic job-title keywords
 * (e.g. "CTO", "Chief Investment Officer"). ICP persona role fields are often
 * written as combined English sentences ("CTO, COO, or CFO at a PE firm") —
 * split them into clean, individual titles before sending to the API.
 */
function normalizePersonTitles(roles: string[]): string[] {
  const out: string[] = [];
  for (const role of roles) {
    // Split on common list separators: ", " / " or " / " / " / " | "
    const parts = role.split(/,\s+|\s+or\s+|\s*[\/|]\s*/i);
    for (const part of parts) {
      // Strip context qualifiers that follow the title: "at a ...", "for ...",
      // "in ...", "managing ...", "with ...", "overseeing ...", etc.
      const clean = part
        .replace(/\s+(at|for|in|of|with|managing|overseeing|within|across|reporting)\s+.*/i, "")
        .trim();
      if (clean.length > 1 && clean.length < 80) {
        out.push(clean);
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

// ---------------------------------------------------------------------------
// Apollo response shape (partial — only fields we use)
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

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

export class ApolloDiscoveryError extends Error {
  constructor(message: string, readonly code: "not_available" | "api_error") {
    super(message);
    this.name = "ApolloDiscoveryError";
  }
}

/**
 * Search Apollo for ICP-matching people and return DiscoveryCandidate[].
 */
export async function searchApollo(
  _tenantDomain: string,
  input: DiscoverySearchInput,
): Promise<DiscoveryCandidate[]> {
  const apiKey = process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) {
    throw new ApolloDiscoveryError(apolloReason(), "not_available");
  }

  const { criteria, namedAccounts, limit } = input;

  // Build request body from ICP criteria.
  const body: Record<string, unknown> = {
    page: 1,
    per_page: Math.min(limit, 100),
  };

  // Apollo limits: person_titles ≤ 10 entries, q_keywords ≤ 255 chars.
  // normalizePersonTitles splits combined role strings ("CTO, COO, or CFO at a PE firm")
  // into individual atomic title keywords that Apollo can actually match against.
  if (criteria.roles?.length) {
    const titles = normalizePersonTitles(criteria.roles);
    if (titles.length) body.person_titles = titles;
  }

  if (criteria.geographies?.length) {
    body.person_locations = criteria.geographies.slice(0, 10);
  }

  // Skip headcount ranges when named accounts are specified — the firm list
  // already scopes the search and employee ranges based on AUM/revenue don't
  // translate to Apollo's headcount field (a $1B AUM PE firm may have <100 staff).
  if (!namedAccounts?.length) {
    const employeeRanges = segmentsToEmployeeRanges(criteria.segments ?? []);
    if (employeeRanges.length) {
      body.organization_num_employees_ranges = employeeRanges;
    }
  }

  // Industries → q_keywords (capped at 255 chars to avoid Apollo "value too long").
  // Named accounts are sent via organization_names (proper array field), NOT joined
  // into q_keywords, to avoid blowing the length limit.
  const industryKeywords = (criteria.industries ?? []).filter(Boolean);
  if (industryKeywords.length) {
    const kw = industryKeywords.join(" ").slice(0, 255);
    body.q_keywords = kw;
  }

  // Named accounts → organization_names (array, max 10 entries).
  if (namedAccounts?.length) {
    body.organization_names = namedAccounts.slice(0, 10);
  }

  console.log("[Apollo] request body:", JSON.stringify(body));

  let response: ApolloSearchResponse;
  let rawText = "";
  try {
    const res = await fetch(APOLLO_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify(body),
    });

    rawText = await res.text();
    console.log(`[Apollo] response ${res.status}:`, rawText.slice(0, 500));

    try {
      response = JSON.parse(rawText) as ApolloSearchResponse;
    } catch {
      throw new ApolloDiscoveryError(
        `Apollo returned non-JSON: ${res.status} ${rawText.slice(0, 200)}`,
        "api_error",
      );
    }

    if (!res.ok) {
      // Apollo can return errors under .message, .error, or .error_description.
      const msg =
        response.message ??
        (response as any).error ??
        (response as any).error_description ??
        `HTTP ${res.status}: ${rawText.slice(0, 200)}`;
      throw new ApolloDiscoveryError(`Apollo API error: ${msg}`, "api_error");
    }
  } catch (err) {
    if (err instanceof ApolloDiscoveryError) throw err;
    throw new ApolloDiscoveryError(
      `Apollo request failed: ${(err as Error).message}`,
      "api_error",
    );
  }

  const people = response.people ?? [];

  // Map Apollo person → DiscoveryCandidate.
  const candidates: DiscoveryCandidate[] = people.map((p) => {
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

  // Drop any rows with no usable name.
  return candidates.filter((c) => c.name && c.name !== "Unknown");
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

