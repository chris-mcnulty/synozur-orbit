import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../ai-provider", () => ({ completeForFeature: vi.fn() }));
import { completeForFeature } from "../ai-provider";
import { generateVerifiedOutreachDraft } from "../outreach-generation-service";

const opts = { tenantDomain: "example.com", channel: "email" as const, prompt: "Original saved brief with confirmed event facts." };
const body = "Hi Alex,\nCan we meet at 10 on Tuesday?\nChris";
function completion(text: string) {
  return { text, usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    model: "test-model", provider: "test-provider", durationMs: 1 };
}
const valid = completion(`===SUBJECT===\nMeet Tuesday?\n===BODY===\n${body}`);
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe("bounded fresh outreach generation", () => {
  it("uses a fresh uncached response and leaves valid copy unchanged", async () => {
    vi.mocked(completeForFeature).mockResolvedValue(valid);
    const result = await generateVerifiedOutreachDraft(opts);
    expect(result.draft.body).toBe(body);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    expect(completeForFeature).toHaveBeenCalledOnce();
    expect(completeForFeature).toHaveBeenCalledWith("outreach_composer", opts.prompt,
      expect.objectContaining({ skipCache: true, maxTokens: 4096 }));
  });
  it.each(["", "===SUBJECT===\nMissing body", "Hi Alex, can we meet Tuesday?"])("recovers an incomplete or malformed response without requesting facts: %s", async text => {
    vi.mocked(completeForFeature).mockResolvedValueOnce(completion(text)).mockResolvedValueOnce(valid);
    const result = await generateVerifiedOutreachDraft(opts);
    expect(result.draft.body).toBe(body);
    expect(completeForFeature).toHaveBeenCalledTimes(2);
    expect(vi.mocked(completeForFeature).mock.calls[1][1]).toContain(opts.prompt);
    expect(vi.mocked(completeForFeature).mock.calls[1][1]).not.toContain("Hi Alex, can we meet Tuesday?");
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 40 });
  });
  it("recovers a still-overlong repaired draft with one fresh generation, without truncating it", async () => {
    const overlong = completion(`===SUBJECT===\nMeet Tuesday?\n===BODY===\n${body}\n${"Long filler wording. ".repeat(100)}`);
    vi.mocked(completeForFeature).mockResolvedValueOnce(overlong).mockResolvedValueOnce(overlong).mockResolvedValueOnce(valid);
    const result = await generateVerifiedOutreachDraft(opts);
    expect(result.draft.body).toBe(body);
    expect(completeForFeature).toHaveBeenCalledTimes(3);
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 60 });
    for (const call of vi.mocked(completeForFeature).mock.calls) expect(call[2]?.skipCache).toBe(true);
    const recoveryPrompt = vi.mocked(completeForFeature).mock.calls[2][1];
    expect(recoveryPrompt).toContain(opts.prompt);
    expect(recoveryPrompt).not.toContain("Long filler wording.");
  });
  it("can repair writing after recovering malformed formatting, within the same three-call bound", async () => {
    vi.mocked(completeForFeature).mockResolvedValueOnce(completion("Missing envelope"))
      .mockResolvedValueOnce(completion(`===SUBJECT===\nMeet Tuesday?\n===BODY===\nI hope this finds you well.\n${body}`))
      .mockResolvedValueOnce(valid);
    expect((await generateVerifiedOutreachDraft(opts)).draft.body).toBe(body);
    expect(completeForFeature).toHaveBeenCalledTimes(3);
  });
  it("fails closed at its attempt limit with a diagnostic reference, not a missing-facts request", async () => {
    const overlong = completion(`===SUBJECT===\nMeet Tuesday?\n===BODY===\n${body}\n${"Too much filler. ".repeat(150)}`);
    vi.mocked(completeForFeature).mockResolvedValue(overlong);
    const error = await generateVerifiedOutreachDraft(opts).catch(error => error);
    expect(error.code).toBe("OUTREACH_INVALID_DRAFT");
    expect(error.questions).toEqual([]);
    expect(error.message).toContain("no additional facts are required");
    expect(error.message).toMatch(/diagnostic reference: [a-f0-9-]{36}/);
    expect(error.message).not.toContain("Add any missing facts");
    expect(completeForFeature).toHaveBeenCalledTimes(3);
  });
  it.each([
    "===NEEDS_INPUT===\nWhich of the two conflicting event dates is correct?",
    "===REFUSED===\nI cannot fulfill this request.",
    "===SUBJECT===\nNot a draft\n===BODY===\nI cannot draft this email.",
    "I cannot write this message.",
  ])("does not regenerate refusals, assistant notes, or genuine clarification requests", async text => {
    vi.mocked(completeForFeature).mockResolvedValue(completion(text));
    await expect(generateVerifiedOutreachDraft(opts)).rejects.toMatchObject({
      code: expect.stringMatching(/^OUTREACH_(NEEDS_INPUT|REFUSED|INVALID_DRAFT)$/),
    });
    expect(completeForFeature).toHaveBeenCalledOnce();
  });
});
