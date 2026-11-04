import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ai-provider", () => ({ completeForFeature: vi.fn() }));
import { completeForFeature } from "../ai-provider";
import { ensureSocialCopyQuality, SocialCopyQualityError } from "../social-copy-quality";

const ai = vi.mocked(completeForFeature);
const opts = { platform: "linkedin", tenantDomain: "test.example" };
const reply = (text: string) => ({ text, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: "test" });

beforeEach(() => vi.resetAllMocks());

describe("bounded social copy repair", () => {
  it("leaves clean copy byte-for-byte unchanged without calling AI", async () => {
    const content = "The team removed one handoff.\n\nReview the release plan.";
    expect(await ensureSocialCopyQuality({ ...opts, content })).toBe(content);
    expect(ai).not.toHaveBeenCalled();
  });

  it("repairs the named pattern once and preserves facts, links and handles", async () => {
    const content = "This isn't a dashboard. It's a plan for 12 teams. Ask @acme: https://example.com/plan";
    const fixed = "The plan covers 12 teams. Ask @acme: https://example.com/plan";
    ai.mockResolvedValue(reply(fixed));
    expect(await ensureSocialCopyQuality({ ...opts, content })).toBe(fixed);
    expect(ai).toHaveBeenCalledTimes(1);
    const [, prompt, config] = ai.mock.calls[0];
    expect(prompt).toContain("binary reframe");
    expect(prompt).toContain("ONLY factual source");
    expect(prompt).toContain("unaffected sentences");
    expect(config?.tenantDomain).toBe(opts.tenantDomain);
    expect(config?.systemPrompt).toContain("Style rules supply NO facts");
  });

  it("rejects a still-bad repair without retrying or returning the original", async () => {
    ai.mockResolvedValue(reply("This isn't a dashboard. It's a plan."));
    await expect(ensureSocialCopyQuality({ ...opts, content: "This isn't a dashboard. It's a plan." }))
      .rejects.toThrow(SocialCopyQualityError);
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it.each([
    "The plan covers 99 teams. https://example.com/plan",
    "The plan covers 12 teams. https://evil.example/plan",
    "The plan covers 12 teams.",
    "The plan covers 12 teams and saves 50%. https://example.com/plan",
  ])("rejects changed or invented protected facts: %s", async (fixed) => {
    ai.mockResolvedValue(reply(fixed));
    await expect(ensureSocialCopyQuality({
      ...opts, content: "This isn't a dashboard. It's a plan for 12 teams. https://example.com/plan",
    })).rejects.toThrow("protected facts or links");
  });

  it("preserves quoted source material", async () => {
    const content = 'The author calls “This isn’t X. It’s Y.” a stock rhetorical setup.';
    expect(await ensureSocialCopyQuality({ ...opts, content })).toBe(content);
    expect(ai).not.toHaveBeenCalled();
  });

  it("repairs length violations and rechecks the platform limit", async () => {
    ai.mockResolvedValue(reply("A".repeat(281)));
    await expect(ensureSocialCopyQuality({
      ...opts, platform: "twitter", content: "B".repeat(290),
    })).rejects.toThrow("platform length limit");
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it("fails visibly if the repair provider fails", async () => {
    ai.mockRejectedValue(new Error("private provider details"));
    await expect(ensureSocialCopyQuality({ ...opts, content: "What if planning worked?" }))
      .rejects.toThrow("repair unavailable");
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it("checks cancellation before and after a repair", async () => {
    let active = true;
    const assertActive = () => { if (!active) throw new Error("cancelled"); };
    ai.mockImplementation(async () => {
      active = false;
      return reply("The plan assigns an owner.");
    });
    await expect(ensureSocialCopyQuality({
      ...opts, content: "What if planning worked?", assertActive,
    })).rejects.toThrow("cancelled");
    expect(ai).toHaveBeenCalledTimes(1);
  });
});
