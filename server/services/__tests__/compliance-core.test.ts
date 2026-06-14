import { strict as assert } from "node:assert";
import { scanCompliance } from "../compliance-core";

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`[ok]   ${name}`);
  } catch (err) {
    failures++;
    console.error(`[FAIL] ${name}`);
    console.error(err);
  }
}

function kinds(r: ReturnType<typeof scanCompliance>) {
  return r.flags.map((f) => f.kind);
}

(async () => {
  await test("clean email passes with no flags", () => {
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

  await test("clichés are flagged (advisory, still passes)", () => {
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

  await test("'leverage' as a noun is NOT flagged", () => {
    const r = scanCompliance({ channel: "linkedin", body: "You have real leverage in that negotiation." });
    assert.equal(r.flags.some((f) => /leverage/i.test(f.detail)), false);
  });

  await test("suppression is a hard block", () => {
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

  await test("self-email (own domain) is a hard block", () => {
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

  await test("voice-profile forbidden phrases flagged as banned_phrase", () => {
    const r = scanCompliance({
      channel: "email",
      subject: "Hi",
      body: "Our robust, best-in-class platform.",
      forbiddenPhrases: ["best-in-class"],
    });
    assert.ok(kinds(r).includes("banned_phrase"));
  });

  await test("email with no subject flags can_spam", () => {
    const r = scanCompliance({ channel: "email", subject: "", body: "Hi there." });
    assert.ok(kinds(r).includes("can_spam"));
  });

  await test("linkedin without subject does NOT flag can_spam", () => {
    const r = scanCompliance({ channel: "linkedin", body: "Hi there." });
    assert.equal(kinds(r).includes("can_spam"), false);
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll compliance-core tests passed");
})();
