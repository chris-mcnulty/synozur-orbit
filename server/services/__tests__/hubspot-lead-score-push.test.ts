/**
 * Service-level tests for _pushLeadScoresWithDeps (HubSpot lead-score push).
 *
 * Uses the DI-based export so tests never touch the database or HubSpot
 * network. Verifies:
 *   1. Only contacts returned by loadContacts (scoped to the tenant by the
 *      caller) are pushed — proving the tenant-isolation contract.
 *   2. Contacts with null hubspotContactId are skipped.
 *   3. HubSpot API errors are counted as errors, not crashes.
 *   4. Score and lifecycle stage values are forwarded correctly.
 *   5. Two separate tenant calls never share contacts.
 */

import { strict as assert } from "node:assert";
import { describe, it, vi } from "vitest";
import {
  _pushLeadScoresWithDeps,
  type LeadScoreContact,
  type PushLeadScoresDeps,
} from "../hubspot-service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContact(
  overrides: Partial<LeadScoreContact> & { hubspotContactId: string | null },
): LeadScoreContact {
  return {
    id: "c-" + Math.random().toString(36).slice(2),
    email: "test@example.com",
    score: 0,
    lifecycleStage: "subscriber",
    ...overrides,
  };
}

function makeDeps(
  contacts: LeadScoreContact[],
  updateOverride?: (...args: any[]) => Promise<void>,
): { deps: PushLeadScoresDeps; updateHubSpotContact: ReturnType<typeof vi.fn> } {
  const updateHubSpotContact = vi.fn(updateOverride ?? (() => Promise.resolve()));
  const deps: PushLeadScoresDeps = {
    loadContacts: vi.fn().mockResolvedValue(contacts),
    updateHubSpotContact,
  };
  return { deps, updateHubSpotContact };
}

// ---------------------------------------------------------------------------
// Core behaviour
// ---------------------------------------------------------------------------

describe("_pushLeadScoresWithDeps", () => {
  it("pushes every contact that has a HubSpot ID", async () => {
    const contacts = [
      makeContact({ hubspotContactId: "HS-1", score: 45, lifecycleStage: "mql" }),
      makeContact({ hubspotContactId: "HS-2", score: 80, lifecycleStage: "sql" }),
    ];
    const { deps, updateHubSpotContact } = makeDeps(contacts);

    const result = await _pushLeadScoresWithDeps("acme.com", 500, deps);

    assert.equal(result.pushed, 2);
    assert.equal(result.skipped, 0);
    assert.equal(result.errors, 0);
    assert.equal(updateHubSpotContact.mock.calls.length, 2);
  });

  it("skips contacts with null hubspotContactId", async () => {
    const contacts = [
      makeContact({ hubspotContactId: null, score: 30, lifecycleStage: "lead" }),
      makeContact({ hubspotContactId: "HS-5", score: 55, lifecycleStage: "mql" }),
    ];
    const { deps, updateHubSpotContact } = makeDeps(contacts);

    const result = await _pushLeadScoresWithDeps("acme.com", 500, deps);

    assert.equal(result.pushed, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.errors, 0);
    assert.equal(updateHubSpotContact.mock.calls.length, 1);
    assert.equal(updateHubSpotContact.mock.calls[0][0], "HS-5");
  });

  it("passes score and lifecycle stage to the update call", async () => {
    const contacts = [
      makeContact({ hubspotContactId: "HS-9", score: 120, lifecycleStage: "opportunity" }),
    ];
    const { deps, updateHubSpotContact } = makeDeps(contacts);

    await _pushLeadScoresWithDeps("acme.com", 500, deps);

    const [hsId, score, stage] = updateHubSpotContact.mock.calls[0];
    assert.equal(hsId, "HS-9");
    assert.equal(score, 120);
    assert.equal(stage, "opportunity");
  });

  it("uses score=0 and stage=subscriber when values are null", async () => {
    const contacts = [
      makeContact({ hubspotContactId: "HS-10", score: null, lifecycleStage: null }),
    ];
    const { deps, updateHubSpotContact } = makeDeps(contacts);

    await _pushLeadScoresWithDeps("acme.com", 500, deps);

    const [, score, stage] = updateHubSpotContact.mock.calls[0];
    assert.equal(score, 0);
    assert.equal(stage, "subscriber");
  });

  it("counts HubSpot API errors without throwing", async () => {
    const contacts = [
      makeContact({ hubspotContactId: "HS-ERR", score: 40, lifecycleStage: "mql" }),
    ];
    const { deps } = makeDeps(contacts, async () => {
      throw new Error("Property not found");
    });

    const result = await _pushLeadScoresWithDeps("acme.com", 500, deps);

    assert.equal(result.pushed, 0);
    assert.equal(result.errors, 1);
    assert.equal(result.skipped, 0);
  });

  it("counts errors per contact and continues pushing remaining contacts", async () => {
    let callCount = 0;
    const contacts = [
      makeContact({ hubspotContactId: "HS-A", score: 10, lifecycleStage: "lead" }),
      makeContact({ hubspotContactId: "HS-B", score: 20, lifecycleStage: "lead" }),
      makeContact({ hubspotContactId: "HS-C", score: 30, lifecycleStage: "mql" }),
    ];
    const { deps } = makeDeps(contacts, async () => {
      callCount++;
      if (callCount === 2) throw new Error("transient error");
    });

    const result = await _pushLeadScoresWithDeps("acme.com", 500, deps);

    assert.equal(result.pushed, 2);
    assert.equal(result.errors, 1);
  });

  // ── Tenant isolation ──────────────────────────────────────────────────────
  //
  // The tenant filter is enforced by loadContacts — this is the contract that
  // pushLeadScoresToHubSpot upholds by scoping its DB query to the given
  // tenantDomain.  These tests verify that _pushLeadScoresWithDeps honours
  // whatever loadContacts returns and does NOT re-filter or mix contacts
  // across tenants when called twice (once per tenant connection).

  it("tenant isolation: loadContacts is called with the correct tenantDomain", async () => {
    const { deps } = makeDeps([]);

    await _pushLeadScoresWithDeps("acme.com", 500, deps);

    const calls = (deps.loadContacts as ReturnType<typeof vi.fn>).mock.calls;
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "acme.com");
  });

  it("tenant isolation: loadContacts is called with the correct limit", async () => {
    const { deps } = makeDeps([]);

    await _pushLeadScoresWithDeps("acme.com", 250, deps);

    const calls = (deps.loadContacts as ReturnType<typeof vi.fn>).mock.calls;
    assert.equal(calls[0][1], 250);
  });

  it("tenant isolation: two separate calls each query their own tenant", async () => {
    const acmeContacts = [
      makeContact({ hubspotContactId: "HS-ACM-1", score: 45, lifecycleStage: "mql" }),
    ];
    const otherContacts = [
      makeContact({ hubspotContactId: "HS-OTH-1", score: 85, lifecycleStage: "sql" }),
    ];

    const acmeUpdate = vi.fn().mockResolvedValue(undefined);
    const otherUpdate = vi.fn().mockResolvedValue(undefined);

    const acrDeps: PushLeadScoresDeps = {
      loadContacts: vi.fn().mockResolvedValue(acmeContacts),
      updateHubSpotContact: acmeUpdate,
    };
    const othDeps: PushLeadScoresDeps = {
      loadContacts: vi.fn().mockResolvedValue(otherContacts),
      updateHubSpotContact: otherUpdate,
    };

    const [acmeResult, otherResult] = await Promise.all([
      _pushLeadScoresWithDeps("acme.com", 500, acrDeps),
      _pushLeadScoresWithDeps("other.com", 500, othDeps),
    ]);

    // Each tenant got exactly its own contact pushed
    assert.equal(acmeResult.pushed, 1);
    assert.equal(otherResult.pushed, 1);

    // Acme's HubSpot client received only acme's contact
    assert.equal(acmeUpdate.mock.calls.length, 1);
    assert.equal(acmeUpdate.mock.calls[0][0], "HS-ACM-1");

    // Other's HubSpot client received only other's contact
    assert.equal(otherUpdate.mock.calls.length, 1);
    assert.equal(otherUpdate.mock.calls[0][0], "HS-OTH-1");

    // Cross-check: acme's updater never received other's contact
    const acmeHsIds = acmeUpdate.mock.calls.map((c: any[]) => c[0]);
    assert.ok(!acmeHsIds.includes("HS-OTH-1"), "acme's HubSpot client must not update other tenant's contact");
  });

  it("empty contact list returns all-zero counters", async () => {
    const { deps } = makeDeps([]);
    const result = await _pushLeadScoresWithDeps("acme.com", 500, deps);
    assert.equal(result.pushed, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.errors, 0);
  });
});
