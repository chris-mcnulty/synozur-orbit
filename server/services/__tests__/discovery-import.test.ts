/**
 * Service-level tests for importDiscoveredProspects.
 *
 * Verifies that the discover → import round-trip correctly persists the
 * candidate's `source` (apollo / web / salesnav) and `confidence` flag
 * (verified / reconfirm) into the `signals.discoveryConfidence` column.
 * All DB I/O is mocked so the tests run without a real database.
 */

import { describe, it, vi, expect } from "vitest";

// ── DB mock ───────────────────────────────────────────────────────────────────
//
// importDiscoveredProspects makes three DB calls in order:
//   1. select().from(outreachCampaigns).where()  → returns the campaign row
//   2. select().from(prospects).where()           → returns existing prospects (for dedup)
//   3. insert(prospects).values(rows).returning() → returns inserted rows
//
// The queue-based mock pops one batch per terminal call so the order matters.

const { dbQ, makeMockDb } = vi.hoisted(() => {
  const dbQ: any[][] = [];

  function terminal(): any {
    const val = dbQ.shift() ?? [];
    return {
      then: (resolve: any, reject?: any) => Promise.resolve(val).then(resolve, reject),
      catch: (reject: any) => Promise.resolve(val).catch(reject),
      finally: (cb: any) => Promise.resolve(val).finally(cb),
      returning: () => Promise.resolve(val),
      orderBy: () => Promise.resolve(val),
    };
  }

  function mkChain(): any {
    return {
      from: () => mkChain(),
      where: terminal,
      set: () => mkChain(),
      values: terminal,
      orderBy: () => Promise.resolve(dbQ.shift() ?? []),
      returning: () => Promise.resolve(dbQ.shift() ?? []),
      onConflictDoUpdate: () => ({ returning: () => Promise.resolve(dbQ.shift() ?? []) }),
    };
  }

  function makeMockDb() {
    return {
      select: mkChain,
      insert: mkChain,
      update: mkChain,
      delete: () => ({ where: () => Promise.resolve([]) }),
    };
  }

  return { dbQ, makeMockDb };
});

vi.mock("../../db", () => ({ db: makeMockDb() }));

// ── Import under test AFTER mocks are wired ───────────────────────────────────

import { importDiscoveredProspects } from "../discovery-service";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pushDb(...rows: any[]) {
  dbQ.push(rows);
}

const CAMPAIGN = {
  id: "camp-1",
  tenantDomain: "acme.com",
  name: "Q3 PE Outreach",
};

const CTX = { ownerUserId: "user-1", marketId: "market-1" };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("importDiscoveredProspects — source + confidence persistence", () => {
  it("persists apollo source and verified confidence in signals.discoveryConfidence", async () => {
    // 1. campaign lookup
    pushDb(CAMPAIGN);
    // 2. existing prospects (empty — no dedup)
    pushDb();
    // 3. insert returning
    const inserted = [
      {
        id: "p-1",
        tenantDomain: "acme.com",
        campaignId: "camp-1",
        name: "Alice Chen",
        source: "apollo",
        signals: { discoveryConfidence: "verified" },
        status: "new",
      },
    ];
    pushDb(...inserted);

    const result = await importDiscoveredProspects(
      "acme.com",
      "camp-1",
      [
        {
          name: "Alice Chen",
          title: "CFO",
          companyName: "Apex Capital",
          email: "alice@apex.com",
          source: "apollo",
          confidence: "verified",
        },
      ],
      CTX,
    );

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].source).toBe("apollo");
    expect((result.imported[0].signals as any).discoveryConfidence).toBe("verified");
    expect(result.skipped).toBe(0);
  });

  it("persists web source and reconfirm confidence in signals.discoveryConfidence", async () => {
    pushDb(CAMPAIGN);
    pushDb();
    const inserted = [
      {
        id: "p-2",
        tenantDomain: "acme.com",
        campaignId: "camp-1",
        name: "Bob Ng",
        source: "web",
        signals: { discoveryConfidence: "reconfirm" },
        status: "new",
      },
    ];
    pushDb(...inserted);

    const result = await importDiscoveredProspects(
      "acme.com",
      "camp-1",
      [
        {
          name: "Bob Ng",
          title: "Partner",
          companyName: "Beta Fund",
          linkedinUrl: "https://linkedin.com/in/bobng",
          source: "web",
          confidence: "reconfirm",
        },
      ],
      CTX,
    );

    expect(result.imported[0].source).toBe("web");
    expect((result.imported[0].signals as any).discoveryConfidence).toBe("reconfirm");
  });

  it("persists salesnav source and null confidence when confidence is absent", async () => {
    pushDb(CAMPAIGN);
    pushDb();
    const inserted = [
      {
        id: "p-3",
        tenantDomain: "acme.com",
        campaignId: "camp-1",
        name: "Carol White",
        source: "salesnav",
        signals: {},
        status: "new",
      },
    ];
    pushDb(...inserted);

    const result = await importDiscoveredProspects(
      "acme.com",
      "camp-1",
      [
        {
          name: "Carol White",
          title: "CRO",
          companyName: "Gamma Equity",
          source: "salesnav",
          // confidence intentionally omitted
        },
      ],
      CTX,
    );

    expect(result.imported[0].source).toBe("salesnav");
    // discoveryConfidence should be absent (undefined) when confidence is not set
    expect((result.imported[0].signals as any).discoveryConfidence).toBeUndefined();
  });

  it("imports multiple candidates with mixed sources and confidence levels", async () => {
    pushDb(CAMPAIGN);
    pushDb(); // no existing prospects
    const inserted = [
      {
        id: "p-4",
        tenantDomain: "acme.com",
        campaignId: "camp-1",
        name: "Dave Park",
        source: "apollo",
        signals: { discoveryConfidence: "verified" },
        status: "new",
      },
      {
        id: "p-5",
        tenantDomain: "acme.com",
        campaignId: "camp-1",
        name: "Eve Liu",
        source: "web",
        signals: { discoveryConfidence: "reconfirm" },
        status: "new",
      },
    ];
    pushDb(...inserted);

    const result = await importDiscoveredProspects(
      "acme.com",
      "camp-1",
      [
        { name: "Dave Park", title: "CTO", companyName: "Delta Tech", source: "apollo", confidence: "verified" },
        { name: "Eve Liu", title: "VP Eng", companyName: "Epsilon Labs", source: "web", confidence: "reconfirm" },
      ],
      CTX,
    );

    expect(result.imported).toHaveLength(2);
    expect(result.imported[0].source).toBe("apollo");
    expect((result.imported[0].signals as any).discoveryConfidence).toBe("verified");
    expect(result.imported[1].source).toBe("web");
    expect((result.imported[1].signals as any).discoveryConfidence).toBe("reconfirm");
  });

  it("skips duplicate candidates and reports the count correctly", async () => {
    pushDb(CAMPAIGN);
    // Existing prospect matches "Alice Chen" by email
    pushDb({ email: "alice@apex.com", linkedinUrl: null, name: "Alice Chen", companyName: "Apex Capital" });
    // Only one inserted (the non-duplicate)
    pushDb({ id: "p-6", name: "Frank Torres", source: "apollo", signals: { discoveryConfidence: "verified" }, status: "new" });

    const result = await importDiscoveredProspects(
      "acme.com",
      "camp-1",
      [
        { name: "Alice Chen", email: "alice@apex.com", source: "apollo", confidence: "verified" },
        { name: "Frank Torres", email: "frank@delta.com", source: "apollo", confidence: "verified" },
      ],
      CTX,
    );

    expect(result.skipped).toBe(1);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].source).toBe("apollo");
    expect((result.imported[0].signals as any).discoveryConfidence).toBe("verified");
  });
});
