/**
 * Asserts that searchApolloCompaniesFirst makes a bounded number of Apollo API
 * requests for a 25-org cluster — the maximum returned by the org-search step.
 *
 * Call budget for a 25-org cluster:
 *   1  org search   (APOLLO_ORG_SEARCH_URL)
 *   3  people-search batches  (ceil(25/10), capped by MAX_PEOPLE_SEARCH_BATCHES)
 *   3  seniority-retry batches (only when primary pass returns 0 people)
 *   ─────────────────────────────────────────────
 *   ≤ 7 total fetch calls
 */

import { strict as assert } from "node:assert";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import {
  searchApolloCompaniesFirst,
  MAX_PEOPLE_SEARCH_BATCHES,
} from "../apollo-discovery-provider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake org-search response with `count` organization records. */
function makeOrgResponse(count: number): string {
  const organizations = Array.from({ length: count }, (_, i) => ({
    id: `org-${i}`,
    name: `Company ${i + 1}`,
    primary_domain: `company${i + 1}.com`,
    industry: "Software",
    estimated_num_employees: 200,
  }));
  return JSON.stringify({ organizations, pagination: { total_entries: count } });
}

/** Build a fake people-search response with one person record. */
function makePeopleResponse(suffix: string): string {
  return JSON.stringify({
    people: [
      {
        id: `person-${suffix}`,
        name: `Alice ${suffix}`,
        title: "VP Sales",
        linkedin_url: `https://linkedin.com/in/alice-${suffix}`,
        email: `alice-${suffix}@company.com`,
        organization: { name: `Company ${suffix}` },
      },
    ],
    pagination: { page: 1, per_page: 10, total_entries: 1, total_pages: 1 },
  });
}

/** Build a fake empty people-search response. */
function makeEmptyPeopleResponse(): string {
  return JSON.stringify({ people: [], pagination: { page: 1, per_page: 10, total_entries: 0, total_pages: 0 } });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("searchApolloCompaniesFirst — bounded Apollo call count", () => {
  beforeEach(() => {
    process.env.APOLLO_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.APOLLO_API_KEY;
    vi.restoreAllMocks();
  });

  it("MAX_PEOPLE_SEARCH_BATCHES is 3 (matches the 25-org cluster batch count)", () => {
    assert.equal(MAX_PEOPLE_SEARCH_BATCHES, 3);
  });

  it("makes exactly 1 org-search + ≤ MAX_PEOPLE_SEARCH_BATCHES people-search calls when orgs return results", async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async (url: string) => {
      callCount++;
      const urlStr = String(url);
      if (urlStr.includes("mixed_companies")) {
        // Org search: return 25 orgs
        return {
          ok: true,
          status: 200,
          json: async () => JSON.parse(makeOrgResponse(25)),
          text: async () => makeOrgResponse(25),
        };
      }
      // People search: return one person per batch
      const batchIndex = callCount;
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(makePeopleResponse(String(batchIndex))),
        text: async () => makePeopleResponse(String(batchIndex)),
      };
    });

    vi.stubGlobal("fetch", fetchMock);

    await searchApolloCompaniesFirst({
      criteria: {
        roles: ["VP Sales"],
        industries: ["saas"],
        geographies: ["New York, NY"],
        segments: [],
      },
      limit: 50,
    });

    // 1 org-search + up to MAX_PEOPLE_SEARCH_BATCHES people-search calls
    const maxExpected = 1 + MAX_PEOPLE_SEARCH_BATCHES;
    assert.ok(
      callCount <= maxExpected,
      `Expected ≤ ${maxExpected} fetch calls for a 25-org cluster, got ${callCount}`,
    );
    assert.equal(fetchMock.mock.calls.length, callCount);
  });

  it("makes at most 1 + 2 × MAX_PEOPLE_SEARCH_BATCHES calls when the primary pass returns 0 people (seniority retry)", async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async (url: string) => {
      callCount++;
      const urlStr = String(url);
      if (urlStr.includes("mixed_companies")) {
        // Org search: return 25 orgs
        return {
          ok: true,
          status: 200,
          json: async () => JSON.parse(makeOrgResponse(25)),
          text: async () => makeOrgResponse(25),
        };
      }
      // People search: always empty → triggers seniority retry
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(makeEmptyPeopleResponse()),
        text: async () => makeEmptyPeopleResponse(),
      };
    });

    vi.stubGlobal("fetch", fetchMock);

    await searchApolloCompaniesFirst({
      criteria: {
        roles: ["Chief Revenue Officer"],
        industries: ["fintech"],
        geographies: ["London, UK"],
        segments: [],
      },
      limit: 30,
    });

    // 1 org-search + MAX_PEOPLE_SEARCH_BATCHES primary + MAX_PEOPLE_SEARCH_BATCHES retry
    const maxExpected = 1 + 2 * MAX_PEOPLE_SEARCH_BATCHES;
    assert.ok(
      callCount <= maxExpected,
      `Expected ≤ ${maxExpected} fetch calls (with seniority retry) for a 25-org cluster, got ${callCount}`,
    );
  });

  it("returns 0 candidates and an empty accountCluster when APOLLO_API_KEY is missing", async () => {
    delete process.env.APOLLO_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchApolloCompaniesFirst({
      criteria: { roles: ["CRO"], industries: [], geographies: [], segments: [] },
      limit: 25,
    });

    assert.equal(result.candidates.length, 0);
    assert.equal(result.accountCluster.length, 0);
    assert.equal(fetchMock.mock.calls.length, 0, "should make no fetch calls without an API key");
  });

  it("returns 0 candidates without throwing when org search fails", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ message: "Forbidden" }),
      text: async () => JSON.stringify({ message: "Forbidden" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchApolloCompaniesFirst({
      criteria: { roles: ["CMO"], industries: ["saas"], geographies: ["Austin, TX"], segments: [] },
      limit: 25,
    });

    assert.equal(result.candidates.length, 0);
    // Only the one org-search call should have been made
    assert.equal(fetchMock.mock.calls.length, 1);
  });
});
