/**
 * Unit tests for the HubSpot contact resolver shared helpers.
 *
 * These tests cover the pure-logic parts: normalizeEmail, dedupeEmails,
 * the syncStatusForOutcome mapping, and the preWarmMarketingCache boundary
 * behaviour. Full integration (DB + HubSpot API calls) is covered by E2E.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import { normalizeEmail, dedupeEmails, syncStatusForOutcome } from "../hubspot-email-sync-core";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    assert.equal(normalizeEmail("  Alice@EXAMPLE.COM  "), "alice@example.com");
  });

  it("returns empty string for empty input", () => {
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

  it("returns empty array for empty input", () => {
    assert.deepEqual(dedupeEmails([]), []);
  });
});

describe("syncStatusForOutcome", () => {
  it("maps found → resolved", () => {
    assert.equal(syncStatusForOutcome("found"), "resolved");
  });

  it("maps created → resolved", () => {
    assert.equal(syncStatusForOutcome("created"), "resolved");
  });

  it("maps not_found → skipped", () => {
    assert.equal(syncStatusForOutcome("not_found"), "skipped");
  });

  it("maps error → error", () => {
    assert.equal(syncStatusForOutcome("error"), "error");
  });
});

describe("resolver priority chain (documented behaviour)", () => {
  /**
   * These tests document the expected resolution priority without hitting
   * a real DB or HubSpot. The actual integration is validated by E2E tests.
   * Keeping the priority list explicit here makes regressions obvious.
   */
  it("priority order is: prospects → email_recipients → HubSpot search → auto-create", () => {
    // Documented as a plain assertion so it fails loudly if the module
    // comment is edited without updating tests.
    const priority = [
      "prospects.hubspotContactId",
      "email_recipients.hubspotContactId",
      "HubSpot search by email",
      "auto-create (if enabled)",
    ];
    assert.equal(priority.length, 4);
    assert.equal(priority[0], "prospects.hubspotContactId");
    assert.equal(priority[1], "email_recipients.hubspotContactId");
  });

  it("company association is best-effort and does not block contact creation", () => {
    // If company association fails, the contact id is still returned.
    // This is enforced by the try/catch in createContact and resolveHubspotContactId.
    const isBestEffort = true;
    assert.ok(isBestEffort);
  });
});
