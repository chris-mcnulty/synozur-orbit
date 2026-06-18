import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  buildIdeationPrompt,
  parseCampaignIdeas,
  formatNewsForPrompt,
} from "../campaign-ideation-core";


describe("campaign-ideation-core", () => {
  it("formatNewsForPrompt skips empty subjects and lists headlines", () => {
    const block = formatNewsForPrompt([
      { subject: "Acme AI", headlines: [{ title: "Acme raises $50M", source: "techcrunch.com", snippet: "Funding round" }] },
      { subject: "Quiet Co", headlines: [] },
    ]);
    assert.ok(block.includes("Acme AI"));
    assert.ok(block.includes("Acme raises $50M"));
    assert.ok(block.includes("techcrunch.com"));
    assert.ok(!block.includes("Quiet Co"), "subjects with no headlines are omitted");
  });

  it("formatNewsForPrompt returns empty string when no headlines anywhere", () => {
    assert.equal(formatNewsForPrompt([{ subject: "X", headlines: [] }]), "");
  });

  it("buildIdeationPrompt weaves message, grounding, intel, news, and count", () => {
    const prompt = buildIdeationPrompt({
      message: "Push our zero-trust angle",
      strategicBlock: "## Messaging & Positioning Framework\nWe lead on trust.",
      intelBlock: "## Latest intelligence report indicators\n- competitor X launched Y",
      news: [{ subject: "zero trust", headlines: [{ title: "ZT adoption surges", source: "csoonline.com", snippet: "" }] }],
      count: 3,
    });
    assert.ok(prompt.includes("Propose 3 distinct"));
    assert.ok(prompt.includes("Push our zero-trust angle"));
    assert.ok(prompt.includes("We lead on trust"));
    assert.ok(prompt.includes("competitor X launched Y"));
    assert.ok(prompt.includes("ZT adoption surges"));
    assert.ok(prompt.includes("theme | event | offering"));
  });

  it("buildIdeationPrompt omits the message block when none given", () => {
    const prompt = buildIdeationPrompt({ strategicBlock: "S", intelBlock: "", news: [], count: 4 });
    assert.ok(!prompt.includes("intended message"));
    assert.ok(prompt.includes("Propose 4 distinct"));
  });

  it("parseCampaignIdeas parses {ideas:[...]}, coerces type, drops invalid", () => {
    const text = "```json\n" + JSON.stringify({
      ideas: [
        { title: "Trust Launch", campaignType: "Offering", objective: "Promote the trust suite", suggestedAudience: ["CISO at mid-market SaaS"], rationale: "ZT surge", signals: ["ZT adoption surges"] },
        { title: "", objective: "no title -> dropped" },
        { objective: "no title -> dropped too" },
        { title: "Webinar", type: "event", objective: "Drive registrations", audience: "Security leaders" },
      ],
    }) + "\n```";
    const ideas = parseCampaignIdeas(text);
    assert.equal(ideas.length, 2);
    assert.equal(ideas[0].campaignType, "offering"); // coerced from "Offering"
    assert.deepEqual(ideas[0].suggestedAudience, ["CISO at mid-market SaaS"]);
    assert.equal(ideas[1].campaignType, "event"); // from "type"
    assert.deepEqual(ideas[1].suggestedAudience, ["Security leaders"]); // string -> array
  });

  it("parseCampaignIdeas falls back to bare array and unknown type -> theme", () => {
    const ideas = parseCampaignIdeas(JSON.stringify([
      { title: "Idea", campaignType: "newsletter", objective: "Do a thing" },
    ]));
    assert.equal(ideas.length, 1);
    assert.equal(ideas[0].campaignType, "theme");
  });

});
