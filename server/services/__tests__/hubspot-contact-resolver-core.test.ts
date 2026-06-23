/**
 * Unit tests for the HubSpot contact resolver priority chain.
 *
 * Uses the DI-based `_resolveContactWithDeps` export so tests never touch
 * the database or HubSpot network. Each dep is a vi.fn() stub that lets us
 * assert exact call counts, call order, and structured outcome (wasCreated)
 * for every step of the five-step chain.
 */

import { strict as assert } from "node:assert";
import { describe, it, vi } from "vitest";
import {
  _resolveContactWithDeps,
  type ContactResolverDeps,
} from "../hubspot-contact-resolver";
import { normalizeEmail, dedupeEmails, syncStatusForOutcome } from "../hubspot-email-sync-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<ContactResolverDeps> = {}): ContactResolverDeps {
  return {
    prospectLookup: vi.fn().mockResolvedValue(null),
    recipientCacheLookup: vi.fn().mockResolvedValue(null),
    sharedCacheLookup: vi.fn().mockResolvedValue(null),
    hubspotSearch: vi.fn().mockResolvedValue(null),
    hubspotCreate: vi.fn().mockResolvedValue("NEW-1"),
    associateCompany: vi.fn().mockResolvedValue(undefined),
    writeCache: vi.fn().mockResolvedValue(undefined),
    autoCreateEnabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Priority chain — five-step
// ---------------------------------------------------------------------------

describe("_resolveContactWithDeps — priority chain", () => {
  it("step 1: prospect hit skips all downstream lookups", async () => {
    const deps = makeDeps({
      prospectLookup: vi.fn().mockResolvedValue({ contactId: "PROS-1", companyId: null }),
    });

    const { contactId, wasCreated } = await _resolveContactWithDeps("a@b.com", "t.com", {}, deps);

    assert.equal(contactId, "PROS-1");
    assert.equal(wasCreated, false);
    assert.equal((deps.recipientCacheLookup as any).mock.calls.length, 0, "recipient cache should be skipped");
    assert.equal((deps.sharedCacheLookup as any).mock.calls.length, 0, "shared cache should be skipped");
    assert.equal((deps.hubspotSearch as any).mock.calls.length, 0, "HubSpot search should be skipped");
    assert.equal((deps.hubspotCreate as any).mock.calls.length, 0, "create should be skipped");
  });

  it("step 1: writes prospect contact ID to cache", async () => {
    const deps = makeDeps({
      prospectLookup: vi.fn().mockResolvedValue({ contactId: "PROS-2", companyId: null }),
    });

    await _resolveContactWithDeps("a@b.com", "t.com", {}, deps);

    assert.equal((deps.writeCache as any).mock.calls.length, 1);
    assert.equal((deps.writeCache as any).mock.calls[0][0], "PROS-2");
  });

  it("step 2: recipient cache hit skips shared cache, HubSpot search, and create", async () => {
    const deps = makeDeps({
      recipientCacheLookup: vi.fn().mockResolvedValue("LIST-1"),
    });

    const { contactId, wasCreated } = await _resolveContactWithDeps("a@b.com", "t.com", {}, deps);

    assert.equal(contactId, "LIST-1");
    assert.equal(wasCreated, false);
    assert.equal((deps.sharedCacheLookup as any).mock.calls.length, 0, "shared cache should be skipped after recipient cache hit");
    assert.equal((deps.hubspotSearch as any).mock.calls.length, 0, "HubSpot search should be skipped");
    assert.equal((deps.hubspotCreate as any).mock.calls.length, 0, "create should be skipped");
  });

  it("step 3: shared cache hit skips HubSpot search and create (cross-system prewarm)", async () => {
    // Simulates sales import → preWarmMarketingCache → marketing send flow:
    // After sales writes to hubspotContactIdCache, marketing resolve finds
    // it at step 3 — no HubSpot API call needed.
    const deps = makeDeps({
      sharedCacheLookup: vi.fn().mockResolvedValue("PREWARM-1"),
    });

    const { contactId, wasCreated } = await _resolveContactWithDeps("a@b.com", "t.com", {}, deps);

    assert.equal(contactId, "PREWARM-1");
    assert.equal(wasCreated, false);
    assert.equal((deps.hubspotSearch as any).mock.calls.length, 0, "no HubSpot search after prewarm");
    assert.equal((deps.hubspotCreate as any).mock.calls.length, 0, "no create after prewarm");
  });

  it("step 4: HubSpot search hit skips create and writes to cache", async () => {
    const deps = makeDeps({
      hubspotSearch: vi.fn().mockResolvedValue("HS-1"),
    });

    const { contactId, wasCreated } = await _resolveContactWithDeps("a@b.com", "t.com", {}, deps);

    assert.equal(contactId, "HS-1");
    assert.equal(wasCreated, false, "search hit must NOT set wasCreated");
    assert.equal((deps.hubspotCreate as any).mock.calls.length, 0, "create should be skipped");
    assert.equal((deps.writeCache as any).mock.calls[0][0], "HS-1");
  });

  it("step 5: auto-creates when all lookups return null and autoCreateEnabled is true", async () => {
    const deps = makeDeps({
      hubspotCreate: vi.fn().mockResolvedValue("CREATED-1"),
    });

    const { contactId, wasCreated } = await _resolveContactWithDeps(
      "a@b.com", "t.com", { autoCreate: true }, deps,
    );

    assert.equal(contactId, "CREATED-1");
    assert.equal(wasCreated, true, "auto-create MUST set wasCreated=true");
    assert.equal((deps.hubspotCreate as any).mock.calls.length, 1);
    assert.equal((deps.writeCache as any).mock.calls[0][0], "CREATED-1");
  });

  it("does NOT create when autoCreate option is false", async () => {
    const deps = makeDeps();

    const { contactId, wasCreated } = await _resolveContactWithDeps(
      "a@b.com", "t.com", { autoCreate: false }, deps,
    );

    assert.equal(contactId, null);
    assert.equal(wasCreated, false);
    assert.equal((deps.hubspotCreate as any).mock.calls.length, 0);
  });

  it("does NOT create when autoCreateEnabled dep is false", async () => {
    const deps = makeDeps({ autoCreateEnabled: false });

    const { contactId, wasCreated } = await _resolveContactWithDeps(
      "a@b.com", "t.com", { autoCreate: true }, deps,
    );

    assert.equal(contactId, null);
    assert.equal(wasCreated, false);
    assert.equal((deps.hubspotCreate as any).mock.calls.length, 0);
  });

  it("returns null for an empty / invalid email without calling any dep", async () => {
    const deps = makeDeps();

    const { contactId, wasCreated } = await _resolveContactWithDeps("", "t.com", {}, deps);

    assert.equal(contactId, null);
    assert.equal(wasCreated, false);
    assert.equal((deps.prospectLookup as any).mock.calls.length, 0);
    assert.equal((deps.recipientCacheLookup as any).mock.calls.length, 0);
    assert.equal((deps.sharedCacheLookup as any).mock.calls.length, 0);
  });

  it("associates new contact with company when prospect has companyId but no contactId", async () => {
    // Prospect is in the sales CRM but hasn't been synced to HubSpot yet.
    // All cache/search lookups miss, so we auto-create and associate.
    const deps = makeDeps({
      prospectLookup: vi.fn().mockResolvedValue({ contactId: null as any, companyId: "CO-1" }),
      hubspotCreate: vi.fn().mockResolvedValue("CREATED-2"),
    });

    await _resolveContactWithDeps("a@b.com", "t.com", { autoCreate: true }, deps);

    assert.equal((deps.associateCompany as any).mock.calls.length, 1);
    assert.equal((deps.associateCompany as any).mock.calls[0][0], "CREATED-2");
    assert.equal((deps.associateCompany as any).mock.calls[0][1], "CO-1");
  });

  it("does not call associateCompany when no companyId is available", async () => {
    const deps = makeDeps({
      hubspotCreate: vi.fn().mockResolvedValue("CREATED-3"),
    });

    await _resolveContactWithDeps("a@b.com", "t.com", { autoCreate: true }, deps);

    assert.equal((deps.associateCompany as any).mock.calls.length, 0);
  });

  it("create cap: search and cache hits do NOT consume the creation budget", async () => {
    // 3 emails: first 2 found via HubSpot search (wasCreated=false), third is a
    // genuine miss. With cap=1, the third should still be auto-created because
    // the two search hits did not burn the cap.
    let createCount = 0;
    const cap = 1;

    const scenario = [
      { email: "a@b.com", searchResult: "HS-A" },
      { email: "b@b.com", searchResult: "HS-B" },
      { email: "c@b.com", searchResult: null },
    ];

    for (const { email, searchResult } of scenario) {
      const allowCreate = createCount < cap;
      const deps = makeDeps({
        prospectLookup: vi.fn().mockResolvedValue(null),
        recipientCacheLookup: vi.fn().mockResolvedValue(null),
        sharedCacheLookup: vi.fn().mockResolvedValue(null),
        hubspotSearch: vi.fn().mockResolvedValue(searchResult),
        hubspotCreate: vi.fn().mockResolvedValue(`CREATED-${email}`),
      });

      const { contactId, wasCreated } = await _resolveContactWithDeps(
        email, "t.com", { autoCreate: allowCreate }, deps,
      );

      if (wasCreated) createCount += 1;

      if (email === "a@b.com") {
        assert.equal(contactId, "HS-A");
        assert.equal(wasCreated, false);
        assert.equal(createCount, 0, "search hit must not consume cap");
      } else if (email === "b@b.com") {
        assert.equal(contactId, "HS-B");
        assert.equal(wasCreated, false);
        assert.equal(createCount, 0, "cap still unused after two search hits");
      } else {
        assert.equal(contactId, `CREATED-${email}`, "genuine miss should auto-create");
        assert.equal(wasCreated, true);
        assert.equal(createCount, 1);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Shared utilities (sanity)
// ---------------------------------------------------------------------------

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    assert.equal(normalizeEmail("  Alice@EXAMPLE.COM  "), "alice@example.com");
  });

  it("returns empty string for empty / whitespace input", () => {
    assert.equal(normalizeEmail(""), "");
    assert.equal(normalizeEmail("   "), "");
  });
});

describe("dedupeEmails", () => {
  it("preserves first-seen order and removes duplicates", () => {
    const result = dedupeEmails(["b@x.com", "A@X.COM", "b@x.com", "c@x.com"]);
    assert.deepEqual(result, ["b@x.com", "a@x.com", "c@x.com"]);
  });

  it("drops empty strings", () => {
    const result = dedupeEmails(["a@x.com", "", "  ", "b@x.com"]);
    assert.deepEqual(result, ["a@x.com", "b@x.com"]);
  });
});

describe("syncStatusForOutcome", () => {
  it("maps found and created → resolved", () => {
    assert.equal(syncStatusForOutcome("found"), "resolved");
    assert.equal(syncStatusForOutcome("created"), "resolved");
  });

  it("maps not_found → skipped", () => {
    assert.equal(syncStatusForOutcome("not_found"), "skipped");
  });

  it("maps error → error", () => {
    assert.equal(syncStatusForOutcome("error"), "error");
  });
});
