/**
 * Prompt-grounding tests for the Quick Generate service layer: prove that
 * no fact-bearing strategic-context content (messaging/positioning, GTM
 * plan, recommendations, personas, competitive intel, briefing action
 * items) can reach the generation prompts. Brand identity is the ONE
 * deliberate inclusion (style/character grounding — user decision, Aug
 * 2026); every prompt must carry it while excluding the rest.
 */

import { describe, it, beforeEach, vi, expect } from "vitest";

// Sentinels: if any of these strings appear in a constructed prompt, tenant
// strategy/facts leaked into supposedly prompt-grounded generation.
const SENTINELS = {
  messagingFramework: "SENTINEL_MESSAGING_POSITIONING",
  competitiveIntelligence: "SENTINEL_COMPETITIVE_INTEL",
  gtmPlanSummary: "SENTINEL_GTM_PLAN",
  briefingActionItems: "SENTINEL_BRIEFING_ITEMS",
  recommendations: "SENTINEL_RECOMMENDATIONS",
  personas: "SENTINEL_PERSONAS",
  brandIdentity: "SENTINEL_BRAND_IDENTITY",
};

vi.mock("../ai-provider", () => ({
  completeForFeature: vi.fn(),
}));

// Keep the real formatters (so the non-grounded regression test exercises the
// genuine formatting path) and mock only the loader.
vi.mock("../strategic-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../strategic-context")>();
  return { ...actual, loadStrategicContext: vi.fn() };
});

vi.mock("../../db", () => ({ db: {} }));

import { completeForFeature } from "../ai-provider";
import { loadStrategicContext } from "../strategic-context";
import {
  generateQuickAngles,
  quickDraftSocialPosts,
  quickDraftNewsletter,
  quickDraftBlog,
} from "../quick-generate-service";
import { draftFromBrief } from "../copywriter-service";

const CTX = { tenantDomain: "acme.com", marketId: "market-1", isDefaultMarket: true };
const PROMPT =
  "I'm showing three pieces at Airfield Estates in Woodinville through September — promote the event and thank the Woodinville Arts Alliance for sponsoring.";

const USAGE = { inputTokens: 1, outputTokens: 1 };

const BLOG_RESPONSE = [
  "===TITLE===",
  "Three pieces at Airfield Estates",
  "===SUBTITLE===",
  "Sub",
  "===OVERVIEW===",
  "Overview",
  "===BODY===",
  "Body",
  "===META===",
  "Meta",
  "===TAGS===",
  "art, events",
].join("\n");

function mockAiResponse(text: string) {
  vi.mocked(completeForFeature).mockResolvedValue({ text, usage: USAGE, model: "test-model" } as any);
}

/** All prompt text (system + user) sent to the AI on the last call. */
function sentPromptText(): string {
  const call = vi.mocked(completeForFeature).mock.calls.at(-1)!;
  return `${call[1]}\n${call[2]?.systemPrompt ?? ""}`;
}

/** Brand identity must be present; every other strategic section must not. */
function expectBrandIdentityOnly(text: string) {
  expect(text).toContain(SENTINELS.brandIdentity);
  for (const [key, s] of Object.entries(SENTINELS)) {
    if (key === "brandIdentity") continue;
    expect(text).not.toContain(s);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadStrategicContext).mockResolvedValue({ ...SENTINELS } as any);
});

describe("quick-generate service prompt grounding", () => {
  it("generateQuickAngles includes brand identity but no other strategic sections", async () => {
    mockAiResponse(JSON.stringify([{ angle: "Hook" }]));
    await generateQuickAngles({ ...CTX, prompt: PROMPT });

    const sent = sentPromptText();
    expect(sent).toContain(PROMPT);
    expect(sent).toContain("style only");
    expectBrandIdentityOnly(sent);
  });

  it("quickDraftSocialPosts includes brand identity but no other strategic sections", async () => {
    mockAiResponse(JSON.stringify([{ platform: "linkedin", content: "Post" }]));
    await quickDraftSocialPosts({ ...CTX, prompt: PROMPT, platforms: ["linkedin"], count: 1 });

    const sent = sentPromptText();
    expect(sent).toContain(PROMPT);
    expectBrandIdentityOnly(sent);
  });

  it("quickDraftNewsletter includes brand identity but no other strategic sections", async () => {
    mockAiResponse("===EMAIL_BODY_START===\nBody\n===EMAIL_BODY_END===");
    await quickDraftNewsletter({ ...CTX, prompt: PROMPT });

    const sent = sentPromptText();
    expect(sent).toContain(PROMPT);
    expectBrandIdentityOnly(sent);
  });

  it("quickDraftBlog drafts prompt-grounded: brand identity only, no strategy fields", async () => {
    mockAiResponse(BLOG_RESPONSE);
    const draft = await quickDraftBlog({ ...CTX, prompt: PROMPT });

    expect(draft.title).toBe("Three pieces at Airfield Estates");
    const sent = sentPromptText();
    expect(sent).toContain(PROMPT);
    expect(sent).toContain("Grounding rules");
    expectBrandIdentityOnly(sent);
    // No strategy fields from the synthetic brief reach the prompt either.
    expect(sent).not.toContain("Demand signal");
    expect(sent).not.toContain("Differentiation angle");
    // And no personal voice profile: quickDraftBlog never passes
    // soundLikeMeInstructions, so the marker it would append is absent.
    expect(sent).not.toContain("Writing instructions (follow exactly)");
  });

  it("angle text appears verbatim in prompts only via the angle block", async () => {
    mockAiResponse(JSON.stringify([{ platform: "linkedin", content: "Post" }]));
    await quickDraftSocialPosts({
      ...CTX,
      prompt: PROMPT,
      platforms: ["linkedin"],
      count: 1,
      angle: {
        title: "T",
        summary: null,
        angle: "The chosen hook",
        keyPoints: ["Three pieces on show"],
        audience: null,
        fitAssessment: { voiceFit: "strong", topicFit: "strong", recommendation: "keep", rationale: "" },
      },
    });
    expect(sentPromptText()).toContain("- Angle: The chosen hook");
  });
});

describe("draftFromBrief promptGrounded regression guard", () => {
  const brief = {
    tenantDomain: "acme.com",
    marketId: "market-1",
    campaignId: null,
    targetPersonaId: null,
    title: "Working title",
    format: "blog_post",
  } as any;

  it("without promptGrounded, source-driven drafts still include voice/positioning grounding (existing behavior)", async () => {
    mockAiResponse(BLOG_RESPONSE);
    await draftFromBrief(brief, { sourceContext: PROMPT });

    expect(loadStrategicContext).toHaveBeenCalled();
    const sent = sentPromptText();
    // Messaging/GTM/personas/brand identity remain for regular source-driven drafts…
    expect(sent).toContain(SENTINELS.messagingFramework);
    expect(sent).toContain(SENTINELS.brandIdentity);
    // …but competitive intel and briefing action items stay stripped.
    expect(sent).not.toContain(SENTINELS.competitiveIntelligence);
    expect(sent).not.toContain(SENTINELS.briefingActionItems);
  });

  it("with promptGrounded, only brand identity survives from the strategic context", async () => {
    mockAiResponse(BLOG_RESPONSE);
    await draftFromBrief(brief, { sourceContext: PROMPT, promptGrounded: true });

    expectBrandIdentityOnly(sentPromptText());
  });
});
