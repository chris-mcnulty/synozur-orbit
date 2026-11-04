import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ai-provider", () => ({ completeForFeature: vi.fn() }));
vi.mock("../strategic-context", () => ({
  loadStrategicContext: vi.fn().mockResolvedValue({}),
  formatStrategicContextForPrompt: vi.fn().mockReturnValue("Brand style only."),
  formatPersonaContextForPrompt: vi.fn().mockReturnValue(""),
}));
vi.mock("../db", () => ({ db: {} }));

import { completeForFeature } from "../ai-provider";
import { generateInterviewSocialPosts } from "../brief-interview-service";
import { repurposeAsset, repurposeMultiFormat } from "../repurpose-service";
import type { ContentAsset } from "@shared/schema";

const ai = vi.mocked(completeForFeature);
const reply = (text: string) => ({ text, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: "test" });
const bad = "This isn't a dashboard. It's an approval plan.";
const good = "The approval plan assigns an owner to each review.";
const asset = {
  id: "source", tenantDomain: "test.example", title: "Approval plan", content: good,
} as ContentAsset;

beforeEach(() => ai.mockReset());

describe("social generation quality integration", () => {
  it("repairs interview posts before returning them", async () => {
    ai.mockResolvedValueOnce(reply(JSON.stringify({ posts: [{ platform: "linkedin", content: bad }] })))
      .mockResolvedValueOnce(reply(good));
    const posts = await generateInterviewSocialPosts({
      tenantDomain: asset.tenantDomain, concept: { title: asset.title },
      channels: ["linkedin"], countPerChannel: 1,
    });
    expect(posts).toEqual([{ platform: "linkedin", content: good }]);
    expect(ai).toHaveBeenCalledTimes(2);
    expect(ai.mock.calls[0][2]?.systemPrompt).toContain("binary contrasts");
  });

  it("reports a concept failure instead of returning an empty list", async () => {
    ai.mockResolvedValueOnce(reply(JSON.stringify({ posts: [{ platform: "linkedin", content: bad }] })))
      .mockResolvedValueOnce(reply(bad));
    await expect(generateInterviewSocialPosts({
      tenantDomain: asset.tenantDomain, concept: { title: asset.title },
      channels: ["linkedin"], countPerChannel: 1,
    })).rejects.toThrow("needs review");
    expect(ai).toHaveBeenCalledTimes(2);
  });

  it("repairs repurposed social variants while retaining their metadata", async () => {
    ai.mockResolvedValueOnce(reply(JSON.stringify([
      { platform: "linkedin", content: bad, angle: "Approvals", imagePrompt: "An approval diagram", hashtags: [] },
    ]))).mockResolvedValueOnce(reply(good));
    const result = await repurposeAsset({ asset, platforms: ["linkedin"], count: 3 });
    expect(result.variants[0]).toMatchObject({ platform: "linkedin", content: good, angle: "Approvals" });
    expect(ai).toHaveBeenCalledTimes(2);
    expect(ai.mock.calls[0][2]?.systemPrompt).toContain("binary contrasts");
  });

  it("returns an explicit per-format error when a multi-format repair fails", async () => {
    ai.mockResolvedValueOnce(reply(JSON.stringify([{ content: bad }])))
      .mockResolvedValueOnce(reply(bad));
    const result = await repurposeMultiFormat({
      asset, selections: [{ format: "linkedin_post", count: 1 }],
    });
    expect(result.items).toEqual([]);
    expect(result.errors[0]?.message).toContain("needs review");
    expect(ai).toHaveBeenCalledTimes(2);
  });
});
