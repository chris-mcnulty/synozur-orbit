import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../ai-provider", () => ({ completeForFeature: vi.fn() }));
import { completeForFeature } from "../ai-provider";
import { ensureOutreachCopyQuality } from "../outreach-copy-quality";
import { COMPOSER_SYSTEM_PROMPT } from "../outreach-composer-core";
import { findOutreachWritingViolations } from "../outreach-writing-rules";

const clean = { subject: "Meet Tuesday?", body: "Hi Ben,\nCan we meet at 10 on Tuesday?\nChris" };
const dirty = { ...clean, subject: "Tuesday—meeting", body: clean.body.replace("Hi Ben,", "Hi Ben—") };
const options = { channel: "email" as const, tenantDomain: "example.com" };
function response(subject: string, body: string) {
  return { text: `===SUBJECT===\n${subject}\n===BODY===\n${body}`, usage: { inputTokens: 10, outputTokens: 20 } } as any;
}

describe("outreach generation writing gate", () => {
  beforeEach(() => vi.resetAllMocks());
  it("includes punctuation rules in ordinary Compose", () => {
    expect(COMPOSER_SYSTEM_PROMPT).toContain("No em dashes");
    expect(COMPOSER_SYSTEM_PROMPT).toContain("engagement does not require a sales CTA");
  });
  it("leaves clean copy and genuine recipient questions untouched", async () => {
    const result = await ensureOutreachCopyQuality({ ...options, draft: clean });
    expect(result.draft).toBe(clean);
    expect(completeForFeature).not.toHaveBeenCalled();
  });
  it("repairs both subject and body once, preserving voice guidance", async () => {
    vi.mocked(completeForFeature).mockResolvedValue(response(clean.subject, clean.body));
    const result = await ensureOutreachCopyQuality({ ...options, draft: dirty, voiceBlock: "Tone: direct" });
    expect(result.draft).toEqual(clean);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    expect(completeForFeature).toHaveBeenCalledOnce();
    expect(vi.mocked(completeForFeature).mock.calls[0][1]).toContain("Tone: direct");
    expect(dirty.subject).toContain("—");
  });
  it.each([
    ["uncorrected punctuation", response(dirty.subject, dirty.body)],
    ["changed number", response(clean.subject, clean.body.replace("10", "11"))],
    ["malformed output", { text: "Try again", usage: {} }],
    ["overlong subject", response("x".repeat(81), clean.body)],
    ["overlong body", response(clean.subject, clean.body + "x".repeat(1501))],
  ])("rejects %s without another attempt", async (_, reply) => {
    vi.mocked(completeForFeature).mockResolvedValue(reply as any);
    await expect(ensureOutreachCopyQuality({ ...options, draft: dirty })).rejects.toThrow("Nothing was saved or sent");
    expect(completeForFeature).toHaveBeenCalledOnce();
  });
  it("fails explicitly when repair is unavailable", async () => {
    vi.mocked(completeForFeature).mockRejectedValue(new Error("offline"));
    await expect(ensureOutreachCopyQuality({ ...options, draft: dirty })).rejects.toMatchObject({ code: "OUTREACH_INVALID_DRAFT" });
  });
  it("detects slop after the greeting without banning technical vocabulary", () => {
    expect(findOutreachWritingViolations("Hi Ben,\nWhat if I told you this changes everything?")).toContain("what-if opener");
    expect(findOutreachWritingViolations("Hi Ben,\nWe discussed robust regression. Are you free Tuesday?")).toEqual([]);
  });
  it("rejects a changed URL", async () => {
    vi.mocked(completeForFeature).mockResolvedValue(response(clean.subject, clean.body + "\nhttps://wrong.example"));
    await expect(ensureOutreachCopyQuality({ ...options, draft: { ...dirty, body: dirty.body + "\nhttps://right.example" } })).rejects.toThrow();
  });
  it("supports LinkedIn without introducing a subject or CTA", async () => {
    vi.mocked(completeForFeature).mockResolvedValue({
      text: "===BODY===\nHi Ben, your report clarified the tradeoff.",
      usage: { inputTokens: 1, outputTokens: 2 },
    } as any);
    const result = await ensureOutreachCopyQuality({
      ...options, channel: "linkedin", draft: { subject: null, body: "Hi Ben—your report clarified the tradeoff." },
    });
    expect(result.draft).toEqual({ subject: null, body: "Hi Ben, your report clarified the tradeoff." });
  });
});
