/**
 * Tests for HubSpot identity reconciliation logic.
 *
 * All tests use the pure DI core (_reconcileWithDeps) so no DB or
 * HubSpot network calls are made.
 */

import { describe, it } from "vitest";
import { strict as assert } from "node:assert";
import {
  _reconcileWithDeps,
  type ReconcilerDeps,
} from "../hubspot-contact-resolver";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<ReconcilerDeps> = {}): ReconcilerDeps & {
  writtenProspect: string | null;
  writtenMarketing: string | null;
  writtenCache: string | null;
} {
  let writtenProspect: string | null = null;
  let writtenMarketing: string | null = null;
  let writtenCache: string | null = null;

  return {
    getProspectId: async () => null,
    getMarketingId: async () => null,
    writeProspect: async (id) => { writtenProspect = id; },
    writeMarketing: async (id) => { writtenMarketing = id; },
    writeCache: async (id) => { writtenCache = id; },
    ...overrides,
    // Expose recorded values as own properties for assertions
    get writtenProspect() { return writtenProspect; },
    get writtenMarketing() { return writtenMarketing; },
    get writtenCache() { return writtenCache; },
  };
}

// ---------------------------------------------------------------------------
// Divergence cases
// ---------------------------------------------------------------------------

describe("_reconcileWithDeps", () => {
  it("skipped: both sides already agree on the same ID", async () => {
    const deps = makeDeps({
      getProspectId: async () => "hs-001",
      getMarketingId: async () => "hs-001",
    });
    const outcome = await _reconcileWithDeps(deps);

    assert.equal(outcome.action, "skipped");
    assert.equal(outcome.canonicalId, "hs-001");
    // Nothing written when IDs already agree
    assert.equal(deps.writtenProspect, null);
    assert.equal(deps.writtenMarketing, null);
  });

  it("aligned: only prospect has ID — propagates to marketing contact", async () => {
    const deps = makeDeps({
      getProspectId: async () => "hs-002",
      getMarketingId: async () => null,
    });
    const outcome = await _reconcileWithDeps(deps);

    assert.equal(outcome.action, "aligned");
    assert.equal(outcome.canonicalId, "hs-002");
    assert.equal(deps.writtenMarketing, "hs-002");
    assert.equal(deps.writtenCache, "hs-002");
    assert.equal(deps.writtenProspect, null); // prospect unchanged
  });

  it("aligned: only marketing contact has ID — propagates to prospect", async () => {
    const deps = makeDeps({
      getProspectId: async () => null,
      getMarketingId: async () => "hs-003",
    });
    const outcome = await _reconcileWithDeps(deps);

    assert.equal(outcome.action, "aligned");
    assert.equal(outcome.canonicalId, "hs-003");
    assert.equal(deps.writtenProspect, "hs-003");
    assert.equal(deps.writtenCache, "hs-003");
    assert.equal(deps.writtenMarketing, null); // marketing unchanged
  });

  it("conflict_resolved: both set but different — prospect wins, marketing updated", async () => {
    const deps = makeDeps({
      getProspectId: async () => "hs-prospect-A",
      getMarketingId: async () => "hs-marketing-B",
    });
    const outcome = await _reconcileWithDeps(deps);

    assert.equal(outcome.action, "conflict_resolved");
    assert.equal(outcome.canonicalId, "hs-prospect-A");
    assert.equal(deps.writtenMarketing, "hs-prospect-A");
    assert.equal(deps.writtenCache, "hs-prospect-A");
    assert.equal(deps.writtenProspect, null); // prospect already had the right ID
    assert.ok(outcome.reason.includes("hs-prospect-A"), "reason should mention canonical ID");
    assert.ok(outcome.reason.includes("hs-marketing-B"), "reason should mention displaced ID");
  });

  it("not_found: neither side has an ID and no hubspotSearch provided", async () => {
    const deps = makeDeps({
      getProspectId: async () => null,
      getMarketingId: async () => null,
    });
    const outcome = await _reconcileWithDeps(deps);

    assert.equal(outcome.action, "not_found");
    assert.equal(outcome.canonicalId, null);
    assert.equal(deps.writtenProspect, null);
    assert.equal(deps.writtenMarketing, null);
  });

  it("aligned: neither has ID but hubspotSearch finds one — writes to both", async () => {
    const deps = makeDeps({
      getProspectId: async () => null,
      getMarketingId: async () => null,
      hubspotSearch: async () => "hs-found-004",
    });
    const outcome = await _reconcileWithDeps(deps);

    assert.equal(outcome.action, "aligned");
    assert.equal(outcome.canonicalId, "hs-found-004");
    assert.equal(deps.writtenProspect, "hs-found-004");
    assert.equal(deps.writtenMarketing, "hs-found-004");
    assert.equal(deps.writtenCache, "hs-found-004");
  });

  it("not_found: neither has ID and hubspotSearch returns null", async () => {
    const deps = makeDeps({
      getProspectId: async () => null,
      getMarketingId: async () => null,
      hubspotSearch: async () => null,
    });
    const outcome = await _reconcileWithDeps(deps);

    assert.equal(outcome.action, "not_found");
    assert.equal(outcome.canonicalId, null);
    assert.equal(deps.writtenProspect, null);
    assert.equal(deps.writtenMarketing, null);
  });

  // ── Idempotency ──

  it("idempotent: running again when IDs agree returns skipped without writes", async () => {
    // Simulate: first run aligned them to "hs-005"; second run should be a no-op.
    const deps = makeDeps({
      getProspectId: async () => "hs-005",
      getMarketingId: async () => "hs-005",
    });
    const first = await _reconcileWithDeps(deps);
    const second = await _reconcileWithDeps(deps);

    assert.equal(first.action, "skipped");
    assert.equal(second.action, "skipped");
    assert.equal(second.canonicalId, "hs-005");
    assert.equal(deps.writtenMarketing, null);
    assert.equal(deps.writtenProspect, null);
  });
});
