/**
 * Unit tests for the pure planning core of prospect → marketing-contact
 * promotion: dedupe, opt-out preservation, HubSpot id carry-over, and
 * fill-only-missing-fields linking.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  planProspectPromotions,
  summarizePlan,
  splitName,
  type PromotableProspect,
  type ExistingContactLite,
} from "../prospect-promotion-service";

const NOW = new Date("2026-08-10T12:00:00Z");

function prospect(overrides: Partial<PromotableProspect> = {}): PromotableProspect {
  return {
    id: "p1",
    campaignId: "c1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    title: "CTO",
    companyName: "Analytical Engines",
    hubspotContactId: null,
    status: "dormant",
    ...overrides,
  };
}

function contact(overrides: Partial<ExistingContactLite> = {}): ExistingContactLite {
  return {
    id: "mc1",
    emailOptOut: false,
    hubspotContactId: null,
    sourceProspectId: null,
    firstName: null,
    lastName: null,
    company: null,
    jobTitle: null,
    metadata: null,
    ...overrides,
  };
}

describe("splitName", () => {
  it("splits first/last on first whitespace", () => {
    assert.deepEqual(splitName("Ada Lovelace King"), { firstName: "Ada", lastName: "Lovelace King" });
    assert.deepEqual(splitName("Ada"), { firstName: "Ada", lastName: null });
    assert.deepEqual(splitName("  "), { firstName: null, lastName: null });
  });
});

describe("planProspectPromotions", () => {
  it("creates a new contact with outreach attribution and hubspot id carry-over", () => {
    const actions = planProspectPromotions(
      [prospect({ hubspotContactId: "hs-42" })],
      new Map(),
      NOW,
    );
    assert.equal(actions.length, 1);
    const a = actions[0];
    assert.equal(a.kind, "create");
    if (a.kind !== "create") return;
    assert.equal(a.email, "ada@example.com");
    assert.equal(a.values.firstName, "Ada");
    assert.equal(a.values.lastName, "Lovelace");
    assert.equal(a.values.company, "Analytical Engines");
    assert.equal(a.values.jobTitle, "CTO");
    assert.equal(a.values.hubspotContactId, "hs-42");
    assert.equal(a.values.sourceProspectId, "p1");
    const outreach = a.values.metadata.outreach as any;
    assert.equal(outreach.prospectId, "p1");
    assert.equal(outreach.campaignId, "c1");
    assert.equal(outreach.prospectStatus, "dormant");
  });

  it("skips prospects without an email", () => {
    const actions = planProspectPromotions([prospect({ email: null })], new Map(), NOW);
    assert.deepEqual(actions, [{ kind: "skip_no_email", prospectId: "p1" }]);
  });

  it("links (not duplicates) when the email already exists, filling only missing fields", () => {
    const existing = contact({
      id: "mc9",
      firstName: "Ada",
      company: "Existing Co", // richer data — must NOT be overwritten
      metadata: { foo: "bar" },
    });
    const actions = planProspectPromotions(
      [prospect()],
      new Map([["ada@example.com", existing]]),
      NOW,
    );
    const a = actions[0];
    assert.equal(a.kind, "link");
    if (a.kind !== "link") return;
    assert.equal(a.contactId, "mc9");
    assert.equal(a.set.firstName, undefined); // already set — untouched
    assert.equal(a.set.company, undefined); // already set — untouched
    assert.equal(a.set.lastName, "Lovelace"); // missing — filled
    assert.equal(a.set.jobTitle, "CTO");
    assert.equal(a.set.sourceProspectId, "p1");
    // metadata merged, existing keys preserved
    assert.equal((a.set.metadata as any).foo, "bar");
    assert.equal((a.set.metadata as any).outreach.prospectId, "p1");
  });

  it("never touches an opted-out contact", () => {
    const existing = contact({ id: "mc2", emailOptOut: true });
    const actions = planProspectPromotions(
      [prospect()],
      new Map([["ada@example.com", existing]]),
      NOW,
    );
    assert.deepEqual(actions, [{ kind: "skip_opted_out", prospectId: "p1", contactId: "mc2" }]);
  });

  it("does not overwrite an existing marketing-side hubspot id", () => {
    const existing = contact({ hubspotContactId: "hs-existing" });
    const actions = planProspectPromotions(
      [prospect({ hubspotContactId: "hs-from-prospect" })],
      new Map([["ada@example.com", existing]]),
      NOW,
    );
    const a = actions[0];
    assert.equal(a.kind, "link");
    if (a.kind !== "link") return;
    assert.equal(a.set.hubspotContactId, undefined);
  });

  it("carries the prospect hubspot id onto a linked contact that has none", () => {
    const actions = planProspectPromotions(
      [prospect({ hubspotContactId: "hs-42" })],
      new Map([["ada@example.com", contact()]]),
      NOW,
    );
    const a = actions[0];
    assert.equal(a.kind, "link");
    if (a.kind !== "link") return;
    assert.equal(a.set.hubspotContactId, "hs-42");
  });

  it("dedupes duplicate emails within one batch (case-insensitive)", () => {
    const actions = planProspectPromotions(
      [prospect({ id: "p1" }), prospect({ id: "p2", email: "ADA@Example.com " })],
      new Map(),
      NOW,
    );
    assert.equal(actions[0].kind, "create");
    assert.deepEqual(actions[1], {
      kind: "duplicate_in_batch",
      prospectId: "p2",
      email: "ada@example.com",
    });
  });

  it("summarizes the plan into created/linked/skipped counts", () => {
    const actions = planProspectPromotions(
      [
        prospect({ id: "p1", email: "a@x.com" }),
        prospect({ id: "p2", email: "a@x.com" }), // duplicate → linked
        prospect({ id: "p3", email: "b@x.com" }), // existing → linked
        prospect({ id: "p4", email: "c@x.com" }), // opted out → skipped
        prospect({ id: "p5", email: null }), // no email → skipped
      ],
      new Map([
        ["b@x.com", contact({ id: "mcB" })],
        ["c@x.com", contact({ id: "mcC", emailOptOut: true })],
      ]),
      NOW,
    );
    assert.deepEqual(summarizePlan(actions), {
      total: 5,
      created: 1,
      linked: 2,
      skippedOptedOut: 1,
      skippedNoEmail: 1,
    });
  });
});
