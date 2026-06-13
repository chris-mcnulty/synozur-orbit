import { strict as assert } from "node:assert";
import {
  buildComposePrompt,
  parseComposeResponse,
  enforceLength,
  purposeGuidance,
  CHANNEL_LIMITS,
} from "../outreach-composer-core";

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

(async () => {
  await test("email prompt asks for subject + body and includes dossier", () => {
    const p = buildComposePrompt({
      channel: "email",
      stepNumber: 1,
      purpose: "intro",
      prospect: { name: "Jane Doe", title: "CIO", companyName: "Acme PE" },
      dossier: "Jane runs IT for a mid-market PE firm.",
      salesGoal: "Book a discovery call",
      callToAction: "20-minute call",
    });
    assert.ok(p.includes("===SUBJECT==="));
    assert.ok(p.includes("===BODY==="));
    assert.ok(p.includes("Jane Doe"));
    assert.ok(p.includes("mid-market PE firm"));
    assert.ok(p.includes("Book a discovery call"));
  });

  await test("linkedin prompt omits subject and uses the shorter limit", () => {
    const p = buildComposePrompt({
      channel: "linkedin",
      stepNumber: 2,
      purpose: "value",
      prospect: { name: "Sam" },
    });
    assert.equal(p.includes("===SUBJECT==="), false);
    assert.ok(p.includes("===BODY==="));
    assert.ok(p.includes(String(CHANNEL_LIMITS.linkedin.maxChars)));
  });

  await test("resource is woven into the prompt when present", () => {
    const p = buildComposePrompt({
      channel: "email",
      stepNumber: 1,
      purpose: "invite",
      prospect: { name: "Jane" },
      resource: { label: "Seattle dinner details", resourceType: "event_details", url: "https://x.co/rsvp" },
    });
    assert.ok(p.includes("Seattle dinner details"));
    assert.ok(p.includes("https://x.co/rsvp"));
  });

  await test("parseComposeResponse splits subject/body for email", () => {
    const r = parseComposeResponse("===SUBJECT===\nQuick question\n===BODY===\nHi Jane — worth a call?", "email");
    assert.equal(r.subject, "Quick question");
    assert.equal(r.body, "Hi Jane — worth a call?");
  });

  await test("parseComposeResponse forces null subject for linkedin", () => {
    const r = parseComposeResponse("===BODY===\nHey Sam, saw your post.", "linkedin");
    assert.equal(r.subject, null);
    assert.equal(r.body, "Hey Sam, saw your post.");
  });

  await test("parse falls back to whole text as body when unformatted", () => {
    const r = parseComposeResponse("Just a plain draft.", "email");
    assert.equal(r.body, "Just a plain draft.");
  });

  await test("enforceLength trims linkedin body to the cap on a word boundary", () => {
    const long = "word ".repeat(300); // 1500 chars
    const out = enforceLength(long, "linkedin");
    assert.ok(out.length <= CHANNEL_LIMITS.linkedin.maxChars + 1);
    assert.ok(out.endsWith("…"));
  });

  await test("enforceLength leaves short bodies untouched", () => {
    assert.equal(enforceLength("short", "email"), "short");
  });

  await test("purposeGuidance returns intro guidance for unknown purpose", () => {
    assert.equal(purposeGuidance("mystery"), purposeGuidance("intro"));
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll outreach-composer-core tests passed");
})();
