/**
 * Unit tests for lead scoring pure functions.
 *
 * Covers:
 *   1. deriveStageFromScore — advance-only lifecycle stage transitions
 *   2. evaluatePropertyCondition — property rule matching
 *   3. computeScore — full rule evaluation with event counts
 *   4. filterContactsByTenant — multi-tenant isolation regression
 *      (guards against cross-tenant HubSpot score pushes)
 */

import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  deriveStageFromScore,
  evaluatePropertyCondition,
  computeScore,
  filterContactsByTenant,
  type ScoringThreshold,
  type ScoringRuleLike,
} from "../lead-scoring-core";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const DEFAULT_THRESHOLDS: ScoringThreshold[] = [
  { stage: "lead", minScore: 10 },
  { stage: "mql", minScore: 40 },
  { stage: "sql", minScore: 80 },
  { stage: "opportunity", minScore: 120 },
  { stage: "customer", minScore: 200 },
];

// ---------------------------------------------------------------------------
// 1. deriveStageFromScore
// ---------------------------------------------------------------------------

describe("deriveStageFromScore", () => {
  it("score below all thresholds stays at current stage", () => {
    assert.equal(deriveStageFromScore(5, DEFAULT_THRESHOLDS, "subscriber"), "subscriber");
  });

  it("score at exactly the lead threshold advances to lead", () => {
    assert.equal(deriveStageFromScore(10, DEFAULT_THRESHOLDS, "subscriber"), "lead");
  });

  it("score at exactly the mql threshold advances to mql", () => {
    assert.equal(deriveStageFromScore(40, DEFAULT_THRESHOLDS, "subscriber"), "mql");
  });

  it("score picks the highest qualifying stage", () => {
    assert.equal(deriveStageFromScore(120, DEFAULT_THRESHOLDS, "subscriber"), "opportunity");
  });

  it("score at max threshold advances to customer", () => {
    assert.equal(deriveStageFromScore(200, DEFAULT_THRESHOLDS, "subscriber"), "customer");
  });

  it("stage never downgrades even if score drops", () => {
    // Contact is already an sql; score drops to 15 (only qualifies for lead)
    assert.equal(deriveStageFromScore(15, DEFAULT_THRESHOLDS, "sql"), "sql");
  });

  it("stage never downgrades to the same tier it already holds", () => {
    assert.equal(deriveStageFromScore(40, DEFAULT_THRESHOLDS, "mql"), "mql");
  });

  it("evangelist is preserved even with a very high score", () => {
    // evangelist is above customer in the order — score should not override
    assert.equal(deriveStageFromScore(999, DEFAULT_THRESHOLDS, "evangelist"), "evangelist");
  });

  it("empty thresholds leave stage unchanged", () => {
    assert.equal(deriveStageFromScore(500, [], "lead"), "lead");
  });
});

// ---------------------------------------------------------------------------
// 2. evaluatePropertyCondition
// ---------------------------------------------------------------------------

describe("evaluatePropertyCondition", () => {
  it("not_empty returns true when field has a value", () => {
    assert.equal(
      evaluatePropertyCondition(
        { field: "jobTitle", operator: "not_empty" },
        { jobTitle: "CTO" },
      ),
      true,
    );
  });

  it("not_empty returns false when field is empty string", () => {
    assert.equal(
      evaluatePropertyCondition(
        { field: "jobTitle", operator: "not_empty" },
        { jobTitle: "" },
      ),
      false,
    );
  });

  it("not_empty returns false when field is null", () => {
    assert.equal(
      evaluatePropertyCondition(
        { field: "jobTitle", operator: "not_empty" },
        { jobTitle: null },
      ),
      false,
    );
  });

  it("not_empty returns false when field is missing", () => {
    assert.equal(
      evaluatePropertyCondition(
        { field: "jobTitle", operator: "not_empty" },
        {},
      ),
      false,
    );
  });

  it("contains matches case-insensitively", () => {
    assert.equal(
      evaluatePropertyCondition(
        { field: "jobTitle", operator: "contains", value: "vp" },
        { jobTitle: "VP of Engineering" },
      ),
      true,
    );
  });

  it("contains returns false when value is absent", () => {
    assert.equal(
      evaluatePropertyCondition(
        { field: "jobTitle", operator: "contains", value: "Director" },
        { jobTitle: "Manager" },
      ),
      false,
    );
  });

  it("equals matches exact value case-insensitively", () => {
    assert.equal(
      evaluatePropertyCondition(
        { field: "source", operator: "equals", value: "webbase" },
        { source: "WEBBASE" },
      ),
      true,
    );
  });

  it("equals returns false for a partial match", () => {
    assert.equal(
      evaluatePropertyCondition(
        { field: "source", operator: "equals", value: "web" },
        { source: "webbase" },
      ),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. computeScore
// ---------------------------------------------------------------------------

describe("computeScore", () => {
  const rules: ScoringRuleLike[] = [
    {
      ruleType: "property",
      conditionJson: { field: "jobTitle", operator: "not_empty" },
      points: 5,
      isActive: true,
    },
    {
      ruleType: "property",
      conditionJson: { field: "jobTitle", operator: "contains", value: "VP" },
      points: 20,
      isActive: true,
    },
    {
      ruleType: "event",
      conditionJson: { eventType: "form_submit", minCount: 1 },
      points: 15,
      isActive: true,
    },
    {
      ruleType: "event",
      conditionJson: { eventType: "email_click", minCount: 2 },
      points: 10,
      isActive: true,
    },
    {
      ruleType: "property",
      conditionJson: { field: "company", operator: "not_empty" },
      points: 5,
      isActive: false, // inactive — must be ignored
    },
  ];

  it("all matching rules sum correctly", () => {
    const props = { jobTitle: "VP of Sales" };
    const events = { form_submit: 1, email_click: 3 };
    // 5 (has title) + 20 (VP) + 15 (form_submit) + 10 (email_click ≥ 2) = 50
    assert.equal(computeScore(rules, props, events), 50);
  });

  it("inactive rules are ignored", () => {
    // company is filled but the rule is inactive
    const props = { jobTitle: "VP of Sales", company: "Acme" };
    const events = { form_submit: 1, email_click: 3 };
    assert.equal(computeScore(rules, props, events), 50); // inactive company rule not counted
  });

  it("event rule not triggered when count below minCount", () => {
    const props = { jobTitle: "Manager" }; // no VP match
    const events = { form_submit: 1, email_click: 1 }; // email_click < 2
    // 5 (has title) + 15 (form_submit) = 20
    assert.equal(computeScore(rules, props, events), 20);
  });

  it("no rules match returns 0", () => {
    assert.equal(computeScore(rules, {}, {}), 0);
  });

  it("score is floored at 0 even with negative point rules", () => {
    const negativeRules: ScoringRuleLike[] = [
      {
        ruleType: "event",
        conditionJson: { eventType: "unsubscribe", minCount: 1 },
        points: -50,
        isActive: true,
      },
    ];
    assert.equal(computeScore(negativeRules, {}, { unsubscribe: 1 }), 0);
  });
});

// ---------------------------------------------------------------------------
// 4. filterContactsByTenant — multi-tenant isolation regression
//
// This tests the logical equivalent of the DB-level filter applied in
// pushLeadScoresToHubSpot. Before the fix, that function queried ALL contacts
// with a non-null hubspotContactId regardless of tenantDomain, which allowed
// one tenant's HubSpot client to update another tenant's contact records.
// ---------------------------------------------------------------------------

describe("filterContactsByTenant — cross-tenant isolation", () => {
  const allContacts = [
    { id: "c1", tenantDomain: "acme.com", hubspotContactId: "HS-1", score: 45, lifecycleStage: "mql" },
    { id: "c2", tenantDomain: "acme.com", hubspotContactId: null, score: 10, lifecycleStage: "lead" },
    { id: "c3", tenantDomain: "other.com", hubspotContactId: "HS-2", score: 85, lifecycleStage: "sql" },
    { id: "c4", tenantDomain: "other.com", hubspotContactId: "HS-3", score: 0, lifecycleStage: "subscriber" },
    { id: "c5", tenantDomain: "acme.com", hubspotContactId: "HS-4", score: 20, lifecycleStage: "lead" },
  ];

  it("returns only contacts belonging to the specified tenant", () => {
    const result = filterContactsByTenant(allContacts, "acme.com");
    const ids = result.map((c) => c.id);
    assert.deepEqual(ids.sort(), ["c1", "c5"]);
  });

  it("excludes contacts from other tenants even when they have a HubSpot ID", () => {
    const result = filterContactsByTenant(allContacts, "acme.com");
    assert.ok(
      result.every((c) => c.tenantDomain === "acme.com"),
      "no contact from other.com should appear in acme.com results",
    );
  });

  it("excludes contacts from the same tenant that have no HubSpot ID", () => {
    const result = filterContactsByTenant(allContacts, "acme.com");
    assert.ok(
      result.every((c) => c.hubspotContactId !== null),
      "contacts with null hubspotContactId must be excluded",
    );
  });

  it("returns empty array when tenant has no contacts with a HubSpot ID", () => {
    const result = filterContactsByTenant(allContacts, "nobody.com");
    assert.equal(result.length, 0);
  });

  it("other tenant can independently receive its own contacts", () => {
    const result = filterContactsByTenant(allContacts, "other.com");
    const ids = result.map((c) => c.id);
    assert.deepEqual(ids.sort(), ["c3", "c4"]);
  });

  it("a tenant with contacts from both tenant sets gets exactly its own", () => {
    // Simulates the nightly job calling pushLeadScoresToHubSpot twice: once
    // per tenant connection. Each call must see only its own contacts.
    const acme = filterContactsByTenant(allContacts, "acme.com");
    const other = filterContactsByTenant(allContacts, "other.com");
    const overlap = acme.filter((a) => other.some((o) => o.id === a.id));
    assert.equal(overlap.length, 0, "no contact should appear in both tenant result sets");
  });
});
