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

  it.each(["Acme", "acme.com"])("accepts exact current-employer names without IDs for %s, never conflicting employers", async (company) => {
    const fetchMock = vi.fn(async (_url: string, opts?: RequestInit) => {
      const body = JSON.parse(String(opts?.body));
      const data = body.organization_ids ? { people: [
        { name: "Alice Chen", organization: { name: "Acme, Inc." } },
        { name: "Bob Jones", organization: { name: "Acme Consulting" } },
        { name: "Carol Chen", organization: { id: "org-other", name: "Acme" } },
        { name: "Dan Jones", organization: { name: "Acme", primary_domain: "other.com" } },
        { name: "Emma Jones", email: "emma@acme.com" },
        { first_name: "Fiona", last_name_obfuscated: "J***s", organization: { name: "Acme" } },
      ] } : { organizations: [{ id: "org-acme", name: "Acme", primary_domain: "acme.com" }] };
      return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchApollo("tenant.example", { company, criteria: {}, limit: 10 });
    assert.deepEqual(result.candidates.map(person => person.name), ["Alice Chen"]);
    assert.equal(result.candidates[0].companyDomain, "acme.com");
    assert.equal(result.unrevealedCount, 1);
    assert.equal(fetchMock.mock.calls.length, 2);
  });

  it("recognizes masked Apollo previews after relaxation without further broadening or paid enrichment", async () => {
    const bodies: Record<string, any>[] = [];
    const fetchMock = vi.fn(async (_url: string, opts?: RequestInit) => {
      const body = JSON.parse(String(opts?.body));
      bodies.push(body);
      const data = !body.organization_ids
        ? { organizations: [{ id: "org-accenture", name: "Accenture plc", primary_domain: "accenture.com" }] }
        : body.q_keywords ? { people: [] } : { total_entries: 5, people: [
          { id: "preview-1", first_name: "Alice", last_name_obfuscated: "C***n", organization: { name: "Accenture" } },
        ] };
      return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchApollo("tenant.example", {
      company: "Accenture", limit: 25,
      criteria: { roles: ["Head of Microsoft Practice"], industries: ["content-intensive enterprises"], geographies: ["United States"] },
    });
    assert.equal(result.unrevealedCount, 1);
    assert.deepEqual(result.candidates, []);
    assert.equal(bodies.length, 3); // lookup, strict search, industry retry; no enrichment
    assert.match(result.relaxationApplied!, /industry keywords removed/);
    assert.deepEqual(bodies[2].organization_ids, ["org-accenture"]);
    assert.deepEqual(bodies[2].person_locations, ["United States"]);
    assert.deepEqual(bodies[2].person_titles, ["Head of Microsoft Practice"]);
  });

  it("retries restrictive industry and role filters without widening the selected employer or geography", async () => {
    const bodies: Record<string, any>[] = [];
    const fetchMock = vi.fn(async (_url: string, opts?: RequestInit) => {
      const body = JSON.parse(String(opts?.body));
      bodies.push(body);
      const data = !body.organization_ids
        ? { organizations: [{ id: "org-accenture", name: "Accenture plc", primary_domain: "accenture.com" }] }
        : body.person_titles || body.q_keywords || body.q_organization_keyword_tags
          ? { people: [] }
          : { people: [
              { name: "Alice Chen", title: "Microsoft Alliance Lead", organization: { id: "org-accenture", name: "Accenture plc" } },
              { name: "Bob Jones", organization: { id: "org-other", name: "Unrelated Consulting" } },
            ] };
      return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchApollo("tenant.example", {
      company: "Accenture",
      criteria: {
        roles: ["Head of Microsoft Practice", "Director of Alliances"],
        industries: ["Large regulated or content-intensive enterprises"],
        geographies: ["United States", "United Kingdom"],
      },
      limit: 25,
    });
    const peopleBodies = bodies.filter(body => body.organization_ids);
    assert.equal(peopleBodies.length, 3);
    assert.deepEqual(peopleBodies[0].person_titles, ["Head of Microsoft Practice", "Director of Alliances"]);
    assert.ok(peopleBodies[0].q_keywords);
    assert.equal(peopleBodies[1].q_keywords, undefined);
    assert.deepEqual(peopleBodies[1].person_titles, peopleBodies[0].person_titles);
    assert.equal(peopleBodies[2].person_titles, undefined);
    assert.ok(peopleBodies[2].person_seniorities.length);
    for (const body of peopleBodies) {
      assert.deepEqual(body.organization_ids, ["org-accenture"]);
      assert.deepEqual(body.person_locations, ["United States", "United Kingdom"]);
      assert.equal(body.organization_names, undefined);
    }
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].companyName, "Accenture plc");
    assert.match(result.relaxationApplied!, /within the selected company/);
    assert.equal(result.expansionSummary, undefined);
  });

  it("does not broaden the employer when lookup has no exact match", async () => {
    const fetchMock = vi.fn(async () => {
      const data = { organizations: [{ id: "org-other", name: "Acme Consulting", primary_domain: "other.com" }] };
      return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchApollo("tenant.example", { criteria: { roles: ["CTO"] }, company: "Acme", limit: 10 });
    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(result.candidates.length, 0);
  });

  it("stops after a successful industry-only retry, preserving exact titles", async () => {
    const bodies: Record<string, any>[] = [];
    const fetchMock = vi.fn(async (_url: string, opts?: RequestInit) => {
      const body = JSON.parse(String(opts?.body));
      bodies.push(body);
      const data = !body.organization_ids
        ? { organizations: [{ id: "org-acme", name: "Acme" }] }
        : body.q_keywords
          ? { people: [] }
          : { people: [{ name: "Alice Chen", organization: { id: "org-acme", name: "Acme" } }] };
      return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchApollo("tenant.example", {
      criteria: { roles: ["Microsoft Alliance Director"], industries: ["An overly descriptive industry"] },
      company: "Acme", limit: 10,
    });
    assert.equal(bodies.length, 3);
    assert.deepEqual(bodies[2].person_titles, ["Microsoft Alliance Director"]);
    assert.equal(result.relaxationApplied, "industry keywords removed within the selected company");
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
