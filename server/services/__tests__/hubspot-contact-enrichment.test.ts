/**
 * Unit tests for _syncHubSpotContactEnrichmentWithDeps (HubSpot contact enrichment).
 *
 * Uses the DI-based export so tests never touch the database or HubSpot
 * network. Verifies the 429 retry-deferral contract:
 *   1. A persistent 429 increments rateLimited, not errors.
 *   2. A persistent 429 leaves enriched = 0 and never calls enrichContact.
 *   3. A successful lookup increments enriched and calls enrichContact.
 *   4. A contact not found in HubSpot increments notFound.
 *   5. A non-rate-limit error increments errors, not rateLimited.
 *   6. An empty contact list returns all-zero counters immediately.
 *   7. Multiple contacts: only rate-limited ones are deferred; others proceed.
 */

import { strict as assert } from "node:assert";
import { describe, it, vi } from "vitest";
import {
  _syncHubSpotContactEnrichmentWithDeps,
  type EnrichmentContact,
  type ContactEnrichmentDeps,
} from "../hubspot-service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContact(overrides: Partial<EnrichmentContact> = {}): EnrichmentContact {
  return {
    id: "mc-" + Math.random().toString(36).slice(2),
    email: `user-${Math.random().toString(36).slice(2)}@example.com`,
    ...overrides,
  };
}

/** A rate-limit error shaped the same way isHubspotRateLimitError recognises */
function makeRateLimitError(): Error {
  const err: any = new Error("Too Many Requests");
  err.code = 429;
  return err;
}

function makeDeps(
  contacts: EnrichmentContact[],
  searchOverride?: (email: string) => Promise<any>,
  enrichOverride?: (...args: any[]) => Promise<void>,
): {
  deps: ContactEnrichmentDeps;
  searchHubSpot: ReturnType<typeof vi.fn>;
  enrichContact: ReturnType<typeof vi.fn>;
} {
  const searchHubSpot = vi.fn(
    searchOverride ??
      (() =>
        Promise.resolve({
          id: "HS-" + Math.random().toString(36).slice(2),
          properties: {
            email: "test@example.com",
            firstname: "Test",
            lastname: "User",
            company: "Acme",
            jobtitle: "Engineer",
            lifecyclestage: "lead",
          },
        })),
  );

  const enrichContact = vi.fn(enrichOverride ?? (() => Promise.resolve()));

  const deps: ContactEnrichmentDeps = {
    loadContacts: vi.fn().mockResolvedValue(contacts),
    searchHubSpot,
    enrichContact,
    isRateLimitError: (err: any) => {
      const status = err?.code ?? err?.status ?? err?.statusCode ?? err?.response?.status;
      if (status === 429) return true;
      const msg = String(err?.message ?? "").toLowerCase();
      return msg.includes("rate limit") || msg.includes("too many requests");
    },
    // Keep tests fast: process all contacts in one batch with no inter-batch delay.
    batchSize: 1000,
    pauseFn: async () => {},
  };

  return { deps, searchHubSpot, enrichContact };
}

// ---------------------------------------------------------------------------
// Core 429 deferral behaviour
// ---------------------------------------------------------------------------

describe("_syncHubSpotContactEnrichmentWithDeps — 429 rate-limit deferral", () => {
  it("counts rateLimited=1, errors=0, enriched=0 when every attempt throws 429", async () => {
    const contact = makeContact({ email: "rl@example.com" });
    const { deps, enrichContact } = makeDeps(
      [contact],
      async () => { throw makeRateLimitError(); },
    );

    const result = await _syncHubSpotContactEnrichmentWithDeps(
      { tenantDomain: "acme.com" },
      deps,
    );

    assert.equal(result.rateLimited, 1, "rateLimited should be 1");
    assert.equal(result.errors, 0, "errors must be 0 for a 429");
    assert.equal(result.enriched, 0, "enriched must be 0");
    assert.equal(result.notFound, 0, "notFound must be 0");
  });

  it("does NOT call enrichContact when search throws 429 — contact row stays un-enriched", async () => {
    const contact = makeContact({ email: "rl@example.com" });
    const { deps, enrichContact } = makeDeps(
      [contact],
      async () => { throw makeRateLimitError(); },
    );

    await _syncHubSpotContactEnrichmentWithDeps({ tenantDomain: "acme.com" }, deps);

    assert.equal(
      enrichContact.mock.calls.length,
      0,
      "enrichContact must not be called — contact row must remain with hubspotContactId=null",
    );
  });

  it("counts rateLimited=N for N rate-limited contacts across one sweep", async () => {
    const contacts = [
      makeContact({ email: "a@example.com" }),
      makeContact({ email: "b@example.com" }),
      makeContact({ email: "c@example.com" }),
    ];
    const { deps, enrichContact } = makeDeps(
      contacts,
      async () => { throw makeRateLimitError(); },
    );

    const result = await _syncHubSpotContactEnrichmentWithDeps(
      { tenantDomain: "acme.com" },
      deps,
    );

    assert.equal(result.rateLimited, 3);
    assert.equal(result.errors, 0);
    assert.equal(result.enriched, 0);
    assert.equal(enrichContact.mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Non-rate-limit error handling
// ---------------------------------------------------------------------------

describe("_syncHubSpotContactEnrichmentWithDeps — non-rate-limit errors", () => {
  it("counts errors=1, rateLimited=0 for a generic API error", async () => {
    const contact = makeContact({ email: "err@example.com" });
    const { deps } = makeDeps(
      [contact],
      async () => { throw new Error("Internal Server Error"); },
    );

    const result = await _syncHubSpotContactEnrichmentWithDeps(
      { tenantDomain: "acme.com" },
      deps,
    );

    assert.equal(result.errors, 1);
    assert.equal(result.rateLimited, 0);
    assert.equal(result.enriched, 0);
  });
});

// ---------------------------------------------------------------------------
// Successful enrichment
// ---------------------------------------------------------------------------

describe("_syncHubSpotContactEnrichmentWithDeps — successful enrichment", () => {
  it("increments enriched=1 and calls enrichContact when HubSpot returns a match", async () => {
    const contact = makeContact({ email: "ok@example.com" });
    const { deps, enrichContact } = makeDeps([contact]);

    const result = await _syncHubSpotContactEnrichmentWithDeps(
      { tenantDomain: "acme.com" },
      deps,
    );

    assert.equal(result.enriched, 1);
    assert.equal(result.errors, 0);
    assert.equal(result.rateLimited, 0);
    assert.equal(enrichContact.mock.calls.length, 1);
    // Verify tenantDomain and email are forwarded correctly
    const call = enrichContact.mock.calls[0][0];
    assert.equal(call.tenantDomain, "acme.com");
    assert.equal(call.email, contact.email);
    assert.ok(call.hubspotContactId, "hubspotContactId must be set");
  });

  it("notFound increments when HubSpot returns no results for the email", async () => {
    const contact = makeContact({ email: "ghost@example.com" });
    const { deps, enrichContact } = makeDeps(
      [contact],
      async () => null,
    );

    const result = await _syncHubSpotContactEnrichmentWithDeps(
      { tenantDomain: "acme.com" },
      deps,
    );

    assert.equal(result.notFound, 1);
    assert.equal(result.enriched, 0);
    assert.equal(enrichContact.mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Mixed contacts: rate-limited + successful in same sweep
// ---------------------------------------------------------------------------

describe("_syncHubSpotContactEnrichmentWithDeps — mixed outcomes", () => {
  it("defers rate-limited contacts while still enriching successful ones", async () => {
    const okContact = makeContact({ email: "ok@example.com" });
    const rlContact = makeContact({ email: "rl@example.com" });

    let callCount = 0;
    const { deps, enrichContact } = makeDeps(
      [okContact, rlContact],
      async (email: string) => {
        callCount++;
        if (email === rlContact.email) throw makeRateLimitError();
        return {
          id: "HS-OK",
          properties: {
            email,
            firstname: "Ok",
            lastname: "User",
            company: null,
            jobtitle: null,
            lifecyclestage: "lead",
          },
        };
      },
    );

    const result = await _syncHubSpotContactEnrichmentWithDeps(
      { tenantDomain: "acme.com" },
      deps,
    );

    assert.equal(result.enriched, 1, "successful contact must be enriched");
    assert.equal(result.rateLimited, 1, "rate-limited contact must be deferred");
    assert.equal(result.errors, 0);
    // enrichContact called only for the successful contact
    assert.equal(enrichContact.mock.calls.length, 1);
    assert.equal(enrichContact.mock.calls[0][0].email, okContact.email);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("_syncHubSpotContactEnrichmentWithDeps — edge cases", () => {
  it("returns all-zero counters immediately when loadContacts returns empty list", async () => {
    const { deps, searchHubSpot, enrichContact } = makeDeps([]);

    const result = await _syncHubSpotContactEnrichmentWithDeps(
      { tenantDomain: "acme.com" },
      deps,
    );

    assert.deepEqual(result, { enriched: 0, notFound: 0, errors: 0, rateLimited: 0 });
    assert.equal(searchHubSpot.mock.calls.length, 0);
    assert.equal(enrichContact.mock.calls.length, 0);
  });

  it("passes forceAll=true through to loadContacts", async () => {
    const { deps } = makeDeps([]);

    await _syncHubSpotContactEnrichmentWithDeps(
      { tenantDomain: "acme.com", forceAll: true },
      deps,
    );

    const loadCalls = (deps.loadContacts as ReturnType<typeof vi.fn>).mock.calls;
    assert.equal(loadCalls.length, 1);
    assert.equal(loadCalls[0][2], true, "forceAll must be forwarded to loadContacts");
  });

  it("passes custom limit through to loadContacts", async () => {
    const { deps } = makeDeps([]);

    await _syncHubSpotContactEnrichmentWithDeps(
      { tenantDomain: "acme.com", limit: 50 },
      deps,
    );

    const loadCalls = (deps.loadContacts as ReturnType<typeof vi.fn>).mock.calls;
    assert.equal(loadCalls[0][1], 50, "custom limit must be forwarded to loadContacts");
  });
});
