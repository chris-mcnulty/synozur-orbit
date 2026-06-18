import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import { scanCompliance } from "../compliance-core";


function kinds(r: ReturnType<typeof scanCompliance>) {
  return r.flags.map((f) => f.kind);
}

describe("compliance-core", () => {
  it("clean email passes with no flags", () => {
    const r = scanCompliance({
      channel: "email",
      subject: "Quick question on your AI rollout",
      body: "Hi Jane — saw your team is evaluating Copilot. Worth a 20-minute compare-notes call? Best, Chris",
      recipientEmail: "jane@fund.com",
      ownDomains: ["synozur.com"],
    });
    assert.equal(r.pass, true);
    assert.equal(r.flags.length, 0);
  });

  it("clichés are flagged (advisory, still passes)", () => {
    const r = scanCompliance({
      channel: "email",
      subject: "Touching base",
      body: "I hope this email finds you well. Let's circle back and leverage synergy to move the needle.",
    });
    assert.equal(r.pass, true); // advisory, not a hard block
    const k = kinds(r);
    assert.ok(k.includes("cliche"));
    assert.ok(r.flags.some((f) => /i hope this email finds you well/i.test(f.detail)));
    assert.ok(r.flags.some((f) => /leverage/i.test(f.detail)));
    assert.ok(r.suggestedFixes.length > 0);
  });

  it("'leverage' as a noun is NOT flagged", () => {
    const r = scanCompliance({ channel: "linkedin", body: "You have real leverage in that negotiation." });
    assert.equal(r.flags.some((f) => /leverage/i.test(f.detail)), false);
  });

  it("suppression is a hard block", () => {
    const r = scanCompliance({
      channel: "email",
      subject: "Hello",
      body: "Hi.",
      recipientEmail: "Jane@Fund.com",
      suppressedEmails: ["jane@fund.com"],
    });
    assert.equal(r.pass, false);
    assert.ok(kinds(r).includes("suppression"));
  });

  it("self-email (own domain) is a hard block", () => {
    const r = scanCompliance({
      channel: "email",
      subject: "Hello",
      body: "Hi.",
      recipientEmail: "bob@synozur.com",
      ownDomains: ["synozur.com"],
    });
    assert.equal(r.pass, false);
    assert.ok(kinds(r).includes("self_email"));
  });

  it("voice-profile forbidden phrases flagged as banned_phrase", () => {
    const r = scanCompliance({
      channel: "email",
      subject: "Hi",
      body: "Our robust, best-in-class platform.",
      forbiddenPhrases: ["best-in-class"],
    });
    assert.ok(kinds(r).includes("banned_phrase"));
  });

  it("email with no subject flags can_spam", () => {
    const r = scanCompliance({ channel: "email", subject: "", body: "Hi there." });
    assert.ok(kinds(r).includes("can_spam"));
  });

  it("linkedin without subject does NOT flag can_spam", () => {
    const r = scanCompliance({ channel: "linkedin", body: "Hi there." });
    assert.equal(kinds(r).includes("can_spam"), false);
  });

});
