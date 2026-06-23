/**
 * Unit tests for the HubSpot contact resolver priority chain.
 *
 * Uses the DI-based `_resolveContactWithDeps` export so tests never touch
 * the database or HubSpot network. Each dep is a vi.fn() stub that lets us
 * assert exact call counts, call order, and structured outcome for every
 * step of the chain.
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
    hubspotSearch: vi.fn().mockResolvedValue(null),
    hubspotCreate: vi.fn().mockResolvedValue("NEW-1"),
    associateCompany: vi.fn().mockResolvedValue(undefined),
    writeRecipientCache: vi.fn().mockResolvedValue(undefined),
    autoCreateEnabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Priority chain
// ---------------------------------------------------------------------------

describe("_resolveContactWithDeps — priority chain", () => {
  it("returns prospect cache hit without calling downstream lookups", async () => {
    const deps = makeDeps({
      prospectLookup: vi.fn().mockResolvedValue({ contactId: "PROS-1", companyId: null }),
    });

    const { contactId, wasCreated } = await _resolveContactWithDeps("a@b.com", "t.com", {}, deps);

    assert.equal(contactId, "PROS-1");
    assert.equal(wasCreated, false);
    assert.equal((deps.recipientCacheLookup as any).mock.calls.length, 0, "recipient cache should be skipped");
    assert.equal((deps.hubspotSearch as any).mock.calls.length, 0, "HubSpot search should be skipped");
    assert.equal((deps.hubspotCreate as any).mock.calls.length, 0, "create should be skipped");
  });

  it("writes the prospect contact ID to recipient cache", async () => {
    const deps = makeDeps({
      prospectLookup: vi.fn().mockResolvedValue({ contactId: "PROS-2", companyId: null }),
    });

    await _resolveContactWithDeps("a@b.com", "t.com", {}, deps);

    assert.equal((deps.writeRecipientCache as any).mock.calls.length, 1);
    assert.equal((deps.writeRecipientCache as any).mock.calls[0][0], "PROS-2");
  });

  it("falls through to recipient cache when prospect has no contact ID", async () => {
    const deps = makeDeps({
      prospectLookup: vi.fn().mockResolvedValue(null),
      recipientCacheLookup: vi.fn().mockResolvedValue("CACHE-1"),
    });

    const { contactId, wasCreated } = await _resolveContactWithDeps("a@b.com", "t.com", {}, deps);

    assert.equal(contactId, "CACHE-1");
    assert.equal(wasCreated, false);
    assert.equal((deps.hubspotSearch as any).mock.calls.length, 0, "HubSpot search should be skipped");
    assert.equal((deps.hubspotCreate as any).mock.calls.length, 0, "create should be skipped");
  });

  it("falls through to HubSpot search when recipient cache misses", async () => {
    const deps = makeDeps({
      hubspotSearch: vi.fn().mockResolvedValue("HS-1"),
    });

    const { contactId, wasCreated } = await _resolveContactWithDeps("a@b.com", "t.com", {}, deps);

    assert.equal(contactId, "HS-1");
    assert.equal(wasCreated, false, "search hit should NOT set wasCreated");
    assert.equal((deps.hubspotCreate as any).mock.calls.length, 0, "create should be skipped");
    assert.equal((deps.writeRecipientCache as any).mock.calls[0][0], "HS-1");
  });

  it("auto-creates when all lookups return null and autoCreateEnabled is true", async () => {
    const deps = makeDeps({
      hubspotCreate: vi.fn().mockResolvedValue("CREATED-1"),
    });

    const { contactId, wasCreated } = await _resolveContactWithDeps(
      "a@b.com", "t.com", { autoCreate: true }, deps,
    );

    assert.equal(contactId, "CREATED-1");
    assert.equal(wasCreated, true, "auto-create should set wasCreated");
    assert.equal((deps.hubspotCreate as any).mock.calls.length, 1);
    assert.equal((deps.writeRecipientCache as any).mock.calls[0][0], "CREATED-1");
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
  });

  it("associates contact with company when prospect has companyId", async () => {
    // prospectLookup returns companyId but no contactId — prospect is known to
    // sales but hasn't been synced to HubSpot yet. Resolver falls through to
    // auto-create and should associate the new contact with the company.
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

  it("cross-system prewarm: sales-written recipient cache is found by marketing resolve", async () => {
    // Simulates the sales import → preWarmMarketingCache → marketing send flow:
    // After sales writes a contactId to email_recipients, the next marketing
    // resolve for the same email hits the recipient cache without calling
    // HubSpot search or auto-create. wasCreated must be false.
    const recipientCache = new Map<string, string>();
    recipientCache.set("a@b.com", "PREWARM-1");

    const deps = makeDeps({
      prospectLookup: vi.fn().mockResolvedValue(null),
      recipientCacheLookup: vi.fn().mockImplementation(
        async () => recipientCache.get("a@b.com") ?? null,
      ),
    });

    const { contactId, wasCreated } = await _resolveContactWithDeps("a@b.com", "t.com", {}, deps);

    assert.equal(contactId, "PREWARM-1");
    assert.equal(wasCreated, false);
    assert.equal((deps.hubspotSearch as any).mock.calls.length, 0, "should not search HubSpot after prewarm");
    assert.equal((deps.hubspotCreate as any).mock.calls.length, 0, "should not create after prewarm");
  });

  it("create cap: HubSpot search hits do NOT count against the cap", async () => {
    // Simulates 3 emails: the first 2 are found via HubSpot search (wasCreated=false),
    // the 3rd is a genuine miss that should still be auto-created even if we had a
    // cap of 1. This verifies that caps count true creates, not search hits.
    let createCount = 0;
    const cap = 1;

    const emails = ["a@b.com", "b@b.com", "c@b.com"];
    // a@b.com and b@b.com: found via HubSpot search (existing contacts)
    // c@b.com: not found anywhere → should be auto-created
    const searchResults: Record<string, string | null> = {
      "a@b.com": "HS-A",
      "b@b.com": "HS-B",
      "c@b.com": null,
    };

    for (const email of emails) {
      const allowCreate = createCount < cap;
      const deps = makeDeps({
        prospectLookup: vi.fn().mockResolvedValue(null),
        recipientCacheLookup: vi.fn().mockResolvedValue(null),
        hubspotSearch: vi.fn().mockResolvedValue(searchResults[email] ?? null),
        hubspotCreate: vi.fn().mockResolvedValue(`CREATED-${email}`),
      });

      const { contactId, wasCreated } = await _resolveContactWithDeps(
        email, "t.com", { autoCreate: allowCreate }, deps,
      );

      if (wasCreated) createCount += 1;

      if (email === "a@b.com") {
        assert.equal(contactId, "HS-A");
        assert.equal(wasCreated, false, "search hit must not set wasCreated");
        assert.equal(createCount, 0, "cap not consumed by search hit");
      } else if (email === "b@b.com") {
        assert.equal(contactId, "HS-B");
        assert.equal(wasCreated, false, "search hit must not set wasCreated");
        assert.equal(createCount, 0, "cap still not consumed");
      } else {
        // c@b.com: cap=1, createCount=0 → allowCreate=true → should auto-create
        assert.equal(contactId, `CREATED-${email}`);
        assert.equal(wasCreated, true, "genuine miss with cap available should create");
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
