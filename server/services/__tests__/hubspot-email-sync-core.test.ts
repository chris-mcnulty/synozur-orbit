import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  normalizeEmail,
  dedupeEmails,
  syncStatusForOutcome,
  isOptedOutFromStatusPayload,
  reconcileSuppression,
} from "../hubspot-email-sync-core";

describe("hubspot-email-sync-core", () => {
  it("normalizeEmail lowercases and trims", () => {
    assert.equal(normalizeEmail("  Foo@Bar.COM "), "foo@bar.com");
  });

  it("dedupeEmails normalizes, drops blanks, preserves first-seen order", () => {
    assert.deepEqual(
      dedupeEmails(["A@x.com", "  ", "a@x.com", "B@x.com", "A@X.com"]),
      ["a@x.com", "b@x.com"],
    );
  });

  it("syncStatusForOutcome maps outcomes to persisted status", () => {
    assert.equal(syncStatusForOutcome("found"), "resolved");
    assert.equal(syncStatusForOutcome("created"), "resolved");
    assert.equal(syncStatusForOutcome("not_found"), "skipped");
    assert.equal(syncStatusForOutcome("error"), "error");
  });

  describe("isOptedOutFromStatusPayload", () => {
    it("is false for empty / malformed payloads (no over-suppression)", () => {
      assert.equal(isOptedOutFromStatusPayload(null), false);
      assert.equal(isOptedOutFromStatusPayload({}), false);
      assert.equal(isOptedOutFromStatusPayload({ subscriptionStatuses: [] }), false);
      assert.equal(isOptedOutFromStatusPayload("nope"), false);
    });

    it("is true only when unsubscribed and nothing still subscribed", () => {
      assert.equal(
        isOptedOutFromStatusPayload({ subscriptionStatuses: [{ status: "UNSUBSCRIBED" }] }),
        true,
      );
      // Still subscribed to another type ⇒ not a full opt-out.
      assert.equal(
        isOptedOutFromStatusPayload({
          subscriptionStatuses: [{ status: "UNSUBSCRIBED" }, { status: "SUBSCRIBED" }],
        }),
        false,
      );
      // Only NOT_SUBSCRIBED (never opted in) is not an opt-out.
      assert.equal(
        isOptedOutFromStatusPayload({ subscriptionStatuses: [{ status: "NOT_SUBSCRIBED" }] }),
        false,
      );
    });

    it("is case-insensitive on status values", () => {
      assert.equal(
        isOptedOutFromStatusPayload({ subscriptionStatuses: [{ status: "unsubscribed" }] }),
        true,
      );
    });
  });

  describe("reconcileSuppression", () => {
    it("unions local suppression and HubSpot opt-outs (HubSpot opt-out wins)", () => {
      const out = reconcileSuppression({
        candidateEmails: ["a@x.com", "b@x.com", "c@x.com", "d@x.com"],
        locallySuppressed: new Map([["a@x.com", "bounce"]]),
        hubspotOptedOut: new Set(["c@x.com"]),
      });
      assert.equal(out.get("a@x.com"), "bounce");
      assert.equal(out.has("b@x.com"), false);
      assert.equal(out.get("c@x.com"), "hubspot_optout");
      assert.equal(out.has("d@x.com"), false);
    });

    it("prefers the local reason when an email is suppressed in both systems", () => {
      const out = reconcileSuppression({
        candidateEmails: ["a@x.com"],
        locallySuppressed: new Map([["a@x.com", "spam"]]),
        hubspotOptedOut: new Set(["a@x.com"]),
      });
      assert.equal(out.get("a@x.com"), "spam");
    });

    it("normalizes candidate emails before matching", () => {
      const out = reconcileSuppression({
        candidateEmails: ["  A@X.com "],
        locallySuppressed: new Map(),
        hubspotOptedOut: new Set(["a@x.com"]),
      });
      assert.equal(out.get("a@x.com"), "hubspot_optout");
    });

    it("never re-enables sending: HubSpot 'subscribed' cannot clear a local suppression", () => {
      // hubspotOptedOut only ever ADDS; a contact absent from it stays whatever
      // local suppression says.
      const out = reconcileSuppression({
        candidateEmails: ["a@x.com"],
        locallySuppressed: new Map([["a@x.com", "unsubscribe"]]),
        hubspotOptedOut: new Set(), // HubSpot considers them subscribed
      });
      assert.equal(out.get("a@x.com"), "unsubscribe");
    });
  });
});
