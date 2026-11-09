import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  buildComposePrompt,
  parseComposeResponse,
  enforceLength,
  purposeGuidance,
  CHANNEL_LIMITS,
} from "../outreach-composer-core";


describe("outreach-composer-core", () => {
  it("email prompt asks for subject + body and includes dossier", () => {
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

  it("linkedin prompt omits subject and uses the shorter limit", () => {
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

  it("resource is woven into the prompt when present", () => {
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

  it("parseComposeResponse splits subject/body for email", () => {
    const r = parseComposeResponse("===SUBJECT===\nQuick question\n===BODY===\nHi Jane — worth a call?", "email");
    assert.equal(r.subject, "Quick question");
    assert.equal(r.body, "Hi Jane — worth a call?");
  });

  it("parseComposeResponse forces null subject for linkedin", () => {
    const r = parseComposeResponse("===BODY===\nHey Sam, saw your post.", "linkedin");
    assert.equal(r.subject, null);
    assert.equal(r.body, "Hey Sam, saw your post.");
  });

  it("rejects unformatted text rather than saving it as a recipient email", () => {
    assert.throws(() => parseComposeResponse("Just a plain draft.", "email"));
  });

  it.each([
    "I can't draft this. Could you confirm the event date?",
    "===SUBJECT===\nDraft\n===BODY===\nI cannot write this email. What is the event date?",
    "===NEEDS_INPUT===\nPlease clarify:\n1. What is the event date?\n2. Who is the sender?",
    "===REFUSED===\nI cannot help with this request.",
    "===SUBJECT===\nOnly a subject",
    "===SUBJECT===\n\n===BODY===\nHi Jane",
    "===BODY===\n",
    "",
  ])("rejects assistant/non-draft output: %s", (text) => {
    assert.throws(() => parseComposeResponse(text, "email"));
  });

  it("returns operator questions without any recipient draft", () => {
    try {
      parseComposeResponse("===NEEDS_INPUT===\n1. What is the event date?\n2. Who is the sender?", "email");
      assert.fail("Expected operator-only outcome");
    } catch (err: any) {
      assert.equal(err.code, "OUTREACH_NEEDS_INPUT");
      assert.deepEqual(err.questions, ["What is the event date?", "Who is the sender?"]);
    }
  });

  it("does not mistake a real recipient question or scheduling decline for a refusal", () => {
    const text = "===SUBJECT===\nTuesday\n===BODY===\nHi Jane, I can't make Tuesday. Would Thursday work?";
    assert.equal(parseComposeResponse(text, "email").body, "Hi Jane, I can't make Tuesday. Would Thursday work?");
  });

  it("includes sender answers separately from recipient copy and offers operator-only outcomes", () => {
    const prompt = buildComposePrompt({
      channel: "email", stepNumber: 1, purpose: "invite", prospect: { name: "Jane" },
      additionalContext: "The event is November 18.",
    });
    assert.ok(prompt.includes("Sender clarification"));
    assert.ok(prompt.includes("November 18"));
    assert.ok(prompt.includes("===NEEDS_INPUT==="));
    assert.ok(prompt.includes("===REFUSED==="));
  });

  it("enforceLength trims linkedin body to the cap on a word boundary", () => {
    const long = "word ".repeat(300); // 1500 chars
    const out = enforceLength(long, "linkedin");
    assert.ok(out.length <= CHANNEL_LIMITS.linkedin.maxChars + 1);
    assert.ok(out.endsWith("…"));
  });

  it("enforceLength leaves short bodies untouched", () => {
    assert.equal(enforceLength("short", "email"), "short");
  });

  it("purposeGuidance returns intro guidance for unknown purpose", () => {
    assert.equal(purposeGuidance("mystery"), purposeGuidance("intro"));
  });

});
