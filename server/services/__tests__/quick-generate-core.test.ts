/**
 * Unit tests for the pure Quick Generate helpers: angle parsing/normalization
 * (SignalAI ideation shape), fit-assessment coercion, prompt grounding rules,
 * social/newsletter response parsing, and campaign-name derivation.
 */

import { describe, it, expect } from "vitest";
import {
  coerceDeliverables,
  signQuickAngle,
  verifyQuickAngleToken,
  QUICK_GROUNDING_RULES,
  normalizeQuickAngle,
  parseQuickAngles,
  parseJsonArrayLoose,
  buildAngleBlock,
  buildQuickAnglesPrompt,
  buildQuickSocialPrompt,
  buildQuickNewsletterPrompt,
  buildQuickBlogInstructions,
  parseQuickSocialPosts,
  parseQuickNewsletter,
  deriveCampaignNameFromPrompt,
  MAX_QUICK_ANGLES,
  type QuickAngle,
} from "../quick-generate-core";

const PROMPT =
  "I'm showing three pieces at Airfield Estates in Woodinville through September — promote the event and thank the Woodinville Arts Alliance for sponsoring.";

function mkAngle(overrides: Partial<QuickAngle> = {}): QuickAngle {
  return {
    title: "Meet the pieces",
    summary: "Focus on the three works on show.",
    angle: "Three pieces, one tasting room — an invitation to see them in person.",
    keyPoints: ["Three pieces on show", "At Airfield Estates in Woodinville", "Through September"],
    audience: "Local art lovers",
    fitAssessment: { voiceFit: "strong", topicFit: "strong", recommendation: "keep", rationale: "On topic." },
    ...overrides,
  };
}

describe("coerceDeliverables", () => {
  it("dedupes, lowercases, and drops unknown values", () => {
    expect(coerceDeliverables(["Social", "social", "BLOG", "junk", 42])).toEqual(["social", "blog"]);
  });

  it("returns [] for non-arrays", () => {
    expect(coerceDeliverables("social")).toEqual([]);
    expect(coerceDeliverables(undefined)).toEqual([]);
  });
});

describe("normalizeQuickAngle", () => {
  it("normalizes a full SignalAI-shaped angle", () => {
    const a = normalizeQuickAngle({
      title: "T",
      summary: "S",
      angle: "The hook",
      keyPoints: ["one", "two", "three"],
      audience: "Collectors",
      fitAssessment: { voiceFit: "strong", topicFit: "moderate", recommendation: "keep", rationale: "Fine" },
    });
    expect(a).toMatchObject({ title: "T", angle: "The hook", audience: "Collectors" });
    expect(a!.keyPoints).toEqual(["one", "two", "three"]);
    expect(a!.fitAssessment.recommendation).toBe("keep");
  });

  it("falls back angle → title and title → angle", () => {
    expect(normalizeQuickAngle({ title: "Only a title" })!.angle).toBe("Only a title");
    expect(normalizeQuickAngle({ angle: "Only a hook" })!.title).toBe("Only a hook");
  });

  it("returns null when there is no usable hook", () => {
    expect(normalizeQuickAngle({ summary: "no hook here" })).toBeNull();
    expect(normalizeQuickAngle(null)).toBeNull();
  });

  it("accepts snake_case key_points / fit_assessment and caps key points at 5", () => {
    const a = normalizeQuickAngle({
      angle: "Hook",
      key_points: ["1", "2", "3", "4", "5", "6", "7"],
      fit_assessment: { voice_fit: "weak", topic_fit: "strong" },
    });
    expect(a!.keyPoints).toHaveLength(5);
    expect(a!.fitAssessment.voiceFit).toBe("weak");
  });

  it("defaults recommendation to reject when a fit dimension is weak (weak angles kept, not hidden)", () => {
    const a = normalizeQuickAngle({
      angle: "A stretch",
      fitAssessment: { voiceFit: "weak", topicFit: "moderate", rationale: "Off-voice" },
    });
    expect(a).not.toBeNull();
    expect(a!.fitAssessment.recommendation).toBe("reject");
    expect(a!.fitAssessment.rationale).toBe("Off-voice");
  });
});

describe("parseQuickAngles", () => {
  it("parses a fenced JSON array and drops unusable entries", () => {
    const text =
      "```json\n" +
      JSON.stringify([
        { title: "A", angle: "Hook A", keyPoints: ["k"] },
        { summary: "no hook" },
        { angle: "Hook B" },
      ]) +
      "\n```";
    const angles = parseQuickAngles(text);
    expect(angles.map((a) => a.angle)).toEqual(["Hook A", "Hook B"]);
  });

  it("caps at MAX_QUICK_ANGLES", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ angle: `Hook ${i}` }));
    expect(parseQuickAngles(JSON.stringify(many))).toHaveLength(MAX_QUICK_ANGLES);
  });

  it("extracts an array embedded in prose", () => {
    const text = `Here you go:\n[{"angle": "Embedded hook"}]\nHope that helps!`;
    expect(parseQuickAngles(text)).toHaveLength(1);
  });

  it("returns [] for garbage", () => {
    expect(parseQuickAngles("not json at all")).toEqual([]);
    expect(parseJsonArrayLoose('{"an": "object"}')).toEqual([]);
  });
});

describe("buildAngleBlock", () => {
  it("carries the angle VERBATIM as '- Angle: <angle>' plus key points", () => {
    const a = mkAngle();
    const block = buildAngleBlock(a);
    expect(block).toContain(`- Angle: ${a.angle}`);
    for (const p of a.keyPoints) expect(block).toContain(p);
    expect(block).toContain("Audience: Local art lovers");
  });

  it("is empty when no angle is selected", () => {
    expect(buildAngleBlock(null)).toBe("");
    expect(buildAngleBlock(undefined)).toBe("");
  });
});

describe("prompt builders (fact grounding)", () => {
  it("angles prompt embeds the raw prompt verbatim, asks for 6-8, and forbids invented facts", () => {
    const p = buildQuickAnglesPrompt({ prompt: PROMPT, voiceBlock: "## Brand voice\nCalm." });
    expect(p).toContain(PROMPT);
    expect(p).toContain("6-8");
    expect(p).toContain("ONLY source of facts");
    expect(p).toContain('recommendation "reject"');
    expect(p).toContain("Do NOT invent products, collections");
    expect(p).toContain("## Brand voice");
  });

  it("social prompt embeds the raw prompt, grounding rules, typo-fix rule, and the angle block", () => {
    const p = buildQuickSocialPrompt({
      prompt: PROMPT,
      platforms: ["linkedin", "twitter"],
      count: 3,
      angleBlock: buildAngleBlock(mkAngle()),
    });
    expect(p).toContain(PROMPT);
    expect(p).toContain("linkedin, twitter");
    expect(p).toContain("- Angle: Three pieces, one tasting room");
    expect(p).toContain("Plam Springs");
    expect(p).toContain("Do NOT invent products, collections");
    expect(p).toContain("No hashtags");
  });

  it("social prompt has no angle block when none was chosen", () => {
    const p = buildQuickSocialPrompt({ prompt: PROMPT, platforms: ["linkedin"], count: 2 });
    expect(p).not.toContain("- Angle:");
  });

  it("newsletter prompt embeds the raw prompt, delimiters, and grounding rules", () => {
    const p = buildQuickNewsletterPrompt({ prompt: PROMPT });
    expect(p).toContain(PROMPT);
    expect(p).toContain("===EMAIL_BODY_START===");
    expect(p).toContain("===SUBJECT_LINES_START===");
    expect(p).toContain("Do NOT invent products, collections");
  });

  it("blog instructions = grounding rules + verbatim angle", () => {
    const withAngle = buildQuickBlogInstructions(mkAngle());
    expect(withAngle).toContain(QUICK_GROUNDING_RULES);
    expect(withAngle).toContain("- Angle: Three pieces, one tasting room");
    expect(buildQuickBlogInstructions(null)).toBe(QUICK_GROUNDING_RULES);
  });
});

describe("parseQuickSocialPosts", () => {
  it("keeps valid posts and re-homes platforms outside the allowed set", () => {
    const text = JSON.stringify([
      { platform: "linkedin", content: "Post A", imagePrompt: "gallery wall", scheduledDate: null },
      { platform: "instagram", content: "Post B" },
      { platform: "made-up", content: "Post C" },
    ]);
    const posts = parseQuickSocialPosts(text, ["linkedin", "twitter"]);
    expect(posts).toHaveLength(3);
    expect(posts[0]).toMatchObject({ platform: "linkedin", content: "Post A", imagePrompt: "gallery wall" });
    // instagram not allowed → first allowed platform
    expect(posts[1].platform).toBe("linkedin");
    // unknown coerces to linkedin, which is allowed
    expect(posts[2].platform).toBe("linkedin");
  });

  it("drops entries with empty content", () => {
    const posts = parseQuickSocialPosts(
      JSON.stringify([{ platform: "linkedin", content: "  " }, { platform: "linkedin" }]),
      ["linkedin"],
    );
    expect(posts).toEqual([]);
  });

  it("keeps a valid future scheduledDate and nulls past/invalid ones", () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const posts = parseQuickSocialPosts(
      JSON.stringify([
        { platform: "linkedin", content: "Dated", scheduledDate: future },
        { platform: "linkedin", content: "Past", scheduledDate: "2001-01-01" },
        { platform: "linkedin", content: "Junk", scheduledDate: "soonish" },
      ]),
      ["linkedin"],
    );
    expect(posts[0].scheduledDate).toBeInstanceOf(Date);
    expect(posts[1].scheduledDate).toBeNull();
    expect(posts[2].scheduledDate).toBeNull();
  });
});

describe("parseQuickNewsletter", () => {
  it("parses delimited body and subject suggestions", () => {
    const text = `===EMAIL_BODY_START===
Hi there,

Come see the show.
===EMAIL_BODY_END===

===SUBJECT_LINES_START===
1. Three pieces at Airfield Estates
2. See the show in Woodinville
3. Art at the winery through September
===SUBJECT_LINES_END===`;
    const parsed = parseQuickNewsletter(text);
    expect(parsed.body).toContain("Come see the show.");
    expect(parsed.body).not.toContain("===");
    expect(parsed.subjectSuggestions).toHaveLength(3);
    expect(parsed.subject).toBe("Three pieces at Airfield Estates");
  });

  it("falls back to the whole text and a default subject when delimiters are missing", () => {
    const parsed = parseQuickNewsletter("Just a body with no markers.");
    expect(parsed.body).toBe("Just a body with no markers.");
    expect(parsed.subject).toBe("Newsletter draft");
    expect(parsed.subjectSuggestions).toEqual([]);
  });
});

describe("angle tokens (server-bound angles)", () => {
  const SCOPE = { prompt: PROMPT, tenantDomain: "acme.com", secret: "test-secret" };

  it("round-trips: a signed angle verifies in the same scope", () => {
    const a = mkAngle();
    const token = signQuickAngle(a, SCOPE);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyQuickAngleToken(a, token, SCOPE)).toBe(true);
  });

  it("rejects any tampered angle field (fact injection)", () => {
    const a = mkAngle();
    const token = signQuickAngle(a, SCOPE);
    expect(verifyQuickAngleToken(mkAngle({ angle: "We won a major award" }), token, SCOPE)).toBe(false);
    expect(
      verifyQuickAngleToken(mkAngle({ keyPoints: [...a.keyPoints, "Featured in the NYT"] }), token, SCOPE),
    ).toBe(false);
    expect(verifyQuickAngleToken(mkAngle({ audience: "Fortune 500 CEOs" }), token, SCOPE)).toBe(false);
    expect(verifyQuickAngleToken(mkAngle({ summary: "New collection launch" }), token, SCOPE)).toBe(false);
  });

  it("binds the token to the prompt and tenant", () => {
    const a = mkAngle();
    const token = signQuickAngle(a, SCOPE);
    expect(verifyQuickAngleToken(a, token, { ...SCOPE, prompt: "a different prompt entirely" })).toBe(false);
    expect(verifyQuickAngleToken(a, token, { ...SCOPE, tenantDomain: "other.com" })).toBe(false);
    expect(verifyQuickAngleToken(a, token, { ...SCOPE, secret: "other-secret" })).toBe(false);
  });

  it("rejects malformed tokens without throwing", () => {
    const a = mkAngle();
    expect(verifyQuickAngleToken(a, undefined, SCOPE)).toBe(false);
    expect(verifyQuickAngleToken(a, "", SCOPE)).toBe(false);
    expect(verifyQuickAngleToken(a, "not-hex", SCOPE)).toBe(false);
    expect(verifyQuickAngleToken(a, "ab".repeat(16), SCOPE)).toBe(false); // wrong length
  });
});

describe("deriveCampaignNameFromPrompt", () => {
  it("uses the first sentence without trailing punctuation", () => {
    expect(deriveCampaignNameFromPrompt("Show at Airfield Estates. More details follow later.")).toBe(
      "Show at Airfield Estates",
    );
  });

  it("cuts long prompts at a word boundary with an ellipsis", () => {
    const name = deriveCampaignNameFromPrompt(
      "I am showing three of my favorite pieces at Airfield Estates in Woodinville through the end of September",
    );
    expect(name.length).toBeLessThanOrEqual(61);
    expect(name.endsWith("…")).toBe(true);
    expect(name).not.toMatch(/\s…$/);
  });

  it("collapses whitespace and has a fallback", () => {
    expect(deriveCampaignNameFromPrompt("  Art \n show  ")).toBe("Art show");
    expect(deriveCampaignNameFromPrompt("   ")).toBe("Quick campaign");
  });
});
