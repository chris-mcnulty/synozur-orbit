/**
 * Unit tests for the HubSpot contact resolver priority chain.
 *
 * Uses the DI-based `_resolveContactWithDeps` export so tests never touch
 * the database or HubSpot network. Each dep is a vi.fn() stub that lets us
 * assert exact call counts and call order for every step of the chain.
 */

import { strict as assert } from "node:assert";
import { describe, it, vi, beforeEach } from "vitest";
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
    cacheLookup: vi.fn().mockResolvedValue(null),
    hubspotSearch: vi.fn().mockResolvedValue(null),
    hubspotCreate: vi.fn().mockResolvedValue("NEW-1"),
    associateCompany: vi.fn().mockResolvedValue(undefined),
    writeCache: vi.fn().mockResolvedValue(undefined),
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

    const result = await _resolveContactWithDeps("a@b.com", "t.com", {}, deps);

    assert.equal(result, "PROS-1");
    assert.equal((deps.cacheLookup as any).mock.calls.length, 0, "cache should be skipped");
    assert.equal((deps.hubspotSearch as any).mock.calls.length, 0, "HubSpot search should be skipped");
    assert.equal((deps.hubspotCreate as any).mock.calls.length, 0, "create should be skipped");
  });

  it("writes the prospect contact ID to cache", async () => {
    const deps = makeDeps({
      prospectLookup: vi.fn().mockResolvedValue({ contactId: "PROS-2", companyId: null }),
    });

    await _resolveContactWithDeps("a@b.com", "t.com", {}, deps);

    assert.equal((deps.writeCache as any).mock.calls.length, 1);
    assert.equal((deps.writeCache as any).mock.calls[0][0], "PROS-2");
  });

  it("falls through to cache when prospect has no contact ID", async () => {
    const deps = makeDeps({
      prospectLookup: vi.fn().mockResolvedValue(null),
      cacheLookup: vi.fn().mockResolvedValue("CACHE-1"),
    });

    const result = await _resolveContactWithDeps("a@b.com", "t.com", {}, deps);

    assert.equal(result, "CACHE-1");
    assert.equal((deps.hubspotSearch as any).mock.calls.length, 0, "HubSpot search should be skipped");
    assert.equal((deps.hubspotCreate as any).mock.calls.length, 0, "create should be skipped");
  });

  it("falls through to HubSpot search when cache misses", async () => {
    const deps = makeDeps({
      hubspotSearch: vi.fn().mockResolvedValue("HS-1"),
    });

    const result = await _resolveContactWithDeps("a@b.com", "t.com", {}, deps);

    assert.equal(result, "HS-1");
    assert.equal((deps.hubspotCreate as any).mock.calls.length, 0, "create should be skipped");
    assert.equal((deps.writeCache as any).mock.calls[0][0], "HS-1");
  });

  it("auto-creates when all lookups return null and autoCreateEnabled is true", async () => {
    const deps = makeDeps({
      hubspotCreate: vi.fn().mockResolvedValue("CREATED-1"),
    });

    const result = await _resolveContactWithDeps("a@b.com", "t.com", { autoCreate: true }, deps);

    assert.equal(result, "CREATED-1");
    assert.equal((deps.hubspotCreate as any).mock.calls.length, 1);
    assert.equal((deps.writeCache as any).mock.calls[0][0], "CREATED-1");
  });

  it("does NOT create when autoCreate option is false", async () => {
    const deps = makeDeps();

    const result = await _resolveContactWithDeps("a@b.com", "t.com", { autoCreate: false }, deps);

    assert.equal(result, null);
    assert.equal((deps.hubspotCreate as any).mock.calls.length, 0);
  });

  it("does NOT create when autoCreateEnabled dep is false", async () => {
    const deps = makeDeps({ autoCreateEnabled: false });

    const result = await _resolveContactWithDeps("a@b.com", "t.com", { autoCreate: true }, deps);

    assert.equal(result, null);
    assert.equal((deps.hubspotCreate as any).mock.calls.length, 0);
  });

  it("returns null for an empty / invalid email without calling any dep", async () => {
    const deps = makeDeps();

    const result = await _resolveContactWithDeps("", "t.com", {}, deps);

    assert.equal(result, null);
    assert.equal((deps.prospectLookup as any).mock.calls.length, 0);
    assert.equal((deps.cacheLookup as any).mock.calls.length, 0);
  });

  it("associates contact with company when prospect has companyId", async () => {
    // prospectLookup returns a row with companyId but no contactId (sales
    // knows the company but hasn't resolved the contact yet). The resolver
    // falls through to auto-create and then associates with the company.
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
