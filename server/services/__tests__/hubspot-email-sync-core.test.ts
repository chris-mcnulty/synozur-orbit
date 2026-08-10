import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import * as hubspotEmailSyncCore from "../hubspot-email-sync-core";
import {
  normalizeEmail,
  dedupeEmails,
  syncStatusForOutcome,
  isOptedOutFromStatusPayload,
  isOptedOutForSubscription,
  reconcileSuppression,
  timelineEventId,
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

  describe("timelineEventId", () => {
    it("is deterministic per (send, recipient, event) for idempotency", () => {
      assert.equal(timelineEventId("s1", "r1", "email_opened"), "s1.r1.email_opened");
      assert.equal(
        timelineEventId("s1", "r1", "email_opened"),
        timelineEventId("s1", "r1", "email_opened"),
      );
    });
    it("differs across event keys and recipients", () => {
      assert.notEqual(
        timelineEventId("s1", "r1", "email_opened"),
        timelineEventId("s1", "r1", "email_clicked"),
      );
      assert.notEqual(
        timelineEventId("s1", "r1", "email_sent"),
        timelineEventId("s1", "r2", "email_sent"),
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

// ─── Font-injection exemption audit ──────────────────────────────────────────
//
// The HubSpot email sync path is intentionally exempt from font injection.
//
// Design rationale:
//   The HubSpot integration in this codebase is a CONSENT + TIMELINE path,
//   not an email-delivery path. It does three things:
//
//     1. Consent/opt-out pull (hubspot-email-sync.ts → pullSubscriptionStatus)
//        Reads each recipient's subscription status from HubSpot BEFORE the
//        send so opted-out contacts are suppressed.  No HTML is involved.
//
//     2. Contact resolution (hubspot-contact-resolver.ts)
//        Maps recipient email → HubSpot contact id.  No HTML is involved.
//
//     3. Timeline event push (hubspot-timeline.ts → pushEmailTimelineEvent)
//        Writes structured engagement tokens (subject, send id, campaign label)
//        to the HubSpot contact timeline.  No HTML document is assembled or
//        transmitted.
//
//   Font injection (buildFontHeadCss + wrapResponsiveDocument +
//   normalizeFontFamily) is applied in email-campaign-sender.ts — specifically
//   in the send function — BEFORE the finished HTML is transmitted via
//   SendGrid.  The HubSpot sync path never reads or transmits that HTML
//   document, so there is no separate injection point to add.
//
// The test below asserts the structural invariant: hubspot-email-sync-core
// must not export any HTML-assembly or font-injection functions.  A future
// change that accidentally adds such a function here without also wiring up
// font injection would break this test and prompt the author to handle fonts
// correctly.
// ─────────────────────────────────────────────────────────────────────────────

describe("hubspot-email-sync-core font-injection exemption (structural invariant)", () => {
  it("exports only consent/timeline helpers — no HTML-assembly or font-injection functions", () => {
    const exportedNames = Object.keys(hubspotEmailSyncCore);

    // These are the known, audited exports of this module.
    const expectedExports = new Set([
      "normalizeEmail",
      "dedupeEmails",
      "timelineEventId",
      "syncStatusForOutcome",
      "isOptedOutFromStatusPayload",
      "isOptedOutForSubscription",
      "reconcileSuppression",
    ]);

    // Any export whose name contains an HTML/font keyword would indicate that
    // HTML assembly was added to this module without pairing it with font
    // injection — a silent-Arial regression vector.
    const htmlOrFontExports = exportedNames.filter((name) =>
      /font|html|wrap|document|stylesheet|css|style/i.test(name),
    );

    assert.deepEqual(
      htmlOrFontExports,
      [],
      `hubspot-email-sync-core must not export HTML-assembly or font-injection ` +
        `functions (found: ${htmlOrFontExports.join(", ")}). ` +
        `If the HubSpot path begins building HTML, wire up buildFontHeadCss + ` +
        `wrapResponsiveDocument from email-campaign-sender.ts first.`,
    );

    // Also verify no new exports were silently added without updating this audit.
    const unknownExports = exportedNames.filter((name) => !expectedExports.has(name));
    assert.deepEqual(
      unknownExports,
      [],
      `New export(s) added to hubspot-email-sync-core without updating the ` +
        `font-exemption audit: ${unknownExports.join(", ")}. ` +
        `Add the name to expectedExports if it is consent/timeline-only, or add ` +
        `font injection if it assembles HTML.`,
    );
  });
});
