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
 */
function segmentsToEmployeeRanges(segments: string[]): string[] {
  const ranges: string[] = [];
  for (const seg of segments) {
    const s = seg.toLowerCase();
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
  if (criteria.roles?.length) {
    body.person_titles = criteria.roles.slice(0, 10);
  }

  if (criteria.geographies?.length) {
    body.person_locations = criteria.geographies.slice(0, 10);
  }

  const employeeRanges = segmentsToEmployeeRanges(criteria.segments ?? []);
  if (employeeRanges.length) {
    body.organization_num_employees_ranges = employeeRanges;
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
