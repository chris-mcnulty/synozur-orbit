/**
 * Asserts that searchApollo makes a bounded number of Apollo API requests when
 * the expanded account list exceeds 10 organisations (i.e. triggers batching).
 *
 * Call budget for a 35-account list (4 natural batches, capped at 3):
 *   3  people-search batches  (capped by MAX_PEOPLE_SEARCH_BATCHES)
 *   ─────────────────────────────────────────────
 *   ≤ MAX_PEOPLE_SEARCH_BATCHES total fetch calls
 *
 * Without the cap the natural batch count would be ceil(35/10) = 4 calls.
 */

import { strict as assert } from "node:assert";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import {
  searchApollo,
  MAX_PEOPLE_SEARCH_BATCHES,
} from "../apollo-discovery-provider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a list of `count` company-name strings. */
function makeAccountList(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Company ${i + 1}`);
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
  return JSON.stringify({
    people: [],
    pagination: { page: 1, per_page: 10, total_entries: 0, total_pages: 0 },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("searchApollo — bounded batch call count", () => {
  beforeEach(() => {
    process.env.APOLLO_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.APOLLO_API_KEY;
    vi.restoreAllMocks();
  });

  it.each(["Acme", "acme.com"])("restricts explicit company %s by organization IDs without expanding", async (company) => {
    const fetchMock = vi.fn(async (_url: string, opts?: RequestInit) => {
      const body = JSON.parse(String(opts?.body));
      const data = body.organization_ids
        ? { people: [
            { name: "Alice Chen", organization: { id: "org-acme", name: "Acme" } },
            { name: "Bob Jones", organization: { id: "org-other", name: "Other" } },
          ] }
        : { organizations: [
            { id: "org-acme", name: "Acme, Inc.", primary_domain: "acme.com" },
            { id: "org-other", name: "Acme Consulting", primary_domain: "other.com" },
          ] };
      return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchApollo("tenant.example", { criteria: {}, company, limit: 10 });
    assert.equal(fetchMock.mock.calls.length, 2);
    const orgBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const peopleBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    if (company.includes(".")) assert.deepEqual(orgBody.q_organization_domains_list, ["acme.com"]);
    else assert.equal(orgBody.q_organization_name, "Acme");
    assert.deepEqual(peopleBody.organization_ids, ["org-acme"]);
    assert.equal(peopleBody.organization_names, undefined);
    assert.equal(result.expansionSummary, undefined);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].name, "Alice Chen");
    assert.equal(result.candidates[0].companyDomain, "acme.com");
  });

  it("caps people-search batches at MAX_PEOPLE_SEARCH_BATCHES for a large named-account list", async () => {
    // 35 accounts → 4 natural batches of 10 — the cap should limit it to 3.
    const accounts = makeAccountList(35);
    let callCount = 0;

    const fetchMock = vi.fn(async (_url: string, _opts?: RequestInit) => {
      callCount++;
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(makePeopleResponse(String(callCount))),
        text: async () => makePeopleResponse(String(callCount)),
      };
    });

    vi.stubGlobal("fetch", fetchMock);

    await searchApollo("tenant.example.com", {
      criteria: {
        roles: ["VP Sales"],
        industries: ["saas"],
        geographies: ["New York, NY"],
        segments: [],
      },
      namedAccounts: accounts,
      limit: 50,
    });

    assert.ok(
      callCount <= MAX_PEOPLE_SEARCH_BATCHES,
      `Expected ≤ ${MAX_PEOPLE_SEARCH_BATCHES} fetch calls for 35 accounts (4 natural batches), got ${callCount}`,
    );
  });

  it("makes exactly 1 call when the account list fits in a single batch (≤10 accounts)", async () => {
    const accounts = makeAccountList(8);
    let callCount = 0;

    const fetchMock = vi.fn(async (_url: string, _opts?: RequestInit) => {
      callCount++;
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(makePeopleResponse(String(callCount))),
        text: async () => makePeopleResponse(String(callCount)),
      };
    });

    vi.stubGlobal("fetch", fetchMock);

    await searchApollo("tenant.example.com", {
      criteria: {
        roles: ["CRO"],
        industries: ["fintech"],
        geographies: ["London, UK"],
        segments: [],
      },
      namedAccounts: accounts,
      limit: 30,
    });

    assert.equal(callCount, 1, "Expected exactly 1 fetch call for ≤10 accounts");
  });

  it("makes a single call with no named accounts and applies relaxation on 0 results", async () => {
    let callCount = 0;

    const fetchMock = vi.fn(async (_url: string, _opts?: RequestInit) => {
      callCount++;
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(makeEmptyPeopleResponse()),
        text: async () => makeEmptyPeopleResponse(),
      };
    });

    vi.stubGlobal("fetch", fetchMock);

    await searchApollo("tenant.example.com", {
      criteria: {
        roles: ["CMO"],
        industries: ["saas"],
        geographies: ["Austin, TX"],
        segments: [],
      },
      limit: 25,
    });

    // 1 strict call + up to 3 relaxation tiers (but early-exit on first hit or exhaustion)
    assert.ok(callCount >= 1, "Expected at least 1 fetch call");
    assert.ok(callCount <= 4, `Expected ≤ 4 fetch calls (1 strict + 3 relaxation tiers), got ${callCount}`);
  });
});
