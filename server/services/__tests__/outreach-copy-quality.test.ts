import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../ai-provider", () => ({ completeForFeature: vi.fn() }));
import { completeForFeature } from "../ai-provider";
import { ensureOutreachCopyQuality } from "../outreach-copy-quality";
import { COMPOSER_SYSTEM_PROMPT } from "../outreach-composer-core";
import { findOutreachWritingViolations } from "../outreach-writing-rules";

const clean = { subject: "Meet Tuesday?", body: "Hi Ben,\nCan we meet at 10 on Tuesday?\nChris" };
const dirty = { ...clean, subject: "Tuesday—meeting", body: "I hope this finds you well.\n" + clean.body };
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
    ["uncorrected generic opener", response(dirty.subject, dirty.body)],
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
  it("can compress an overlong email and remove repeated facts without changing their values", async () => {
    vi.mocked(completeForFeature).mockResolvedValue(response(clean.subject, clean.body));
    const result = await ensureOutreachCopyQuality({ ...options, draft: {
      ...clean, body: `${clean.body}\nCan we meet at 10 on Tuesday?\n${"Additional filler wording. ".repeat(90)}`,
    } });
    expect(result.draft).toEqual(clean);
    expect(completeForFeature).toHaveBeenCalledWith("outreach_composer", expect.stringContaining("compress sentences"),
      expect.objectContaining({ skipCache: true, maxTokens: 4096 }));
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
    expect(completeForFeature).not.toHaveBeenCalled();
  });
  it("cleans subject and body without another AI call or private context", async () => {
    vi.mocked(completeForFeature).mockRejectedValue(new Error("AI unavailable"));
    const result = await ensureOutreachCopyQuality({ ...options, draft: {
      subject: "Tuesday — meeting", body: "Hi Peter—can we meet at 10?\nChris",
    } });
    expect(result.draft).toEqual({ subject: "Tuesday, meeting", body: "Hi Peter, can we meet at 10?\nChris" });
    expect(completeForFeature).not.toHaveBeenCalled();
  });
  it("preserves literal links and quotations", async () => {
    const draft = { subject: "Notes", body: 'See https://example.com/a—b and “A—B” — can we discuss?' };
    const result = await ensureOutreachCopyQuality({ ...options, draft });
    expect(result.draft.body).toBe('See https://example.com/a—b and “A—B”, can we discuss?');
    expect(completeForFeature).not.toHaveBeenCalled();
  });
  it("cleans punctuation introduced by a repair without another call", async () => {
    vi.mocked(completeForFeature).mockResolvedValue(response(clean.subject, clean.body.replace("Hi Ben,", "Hi Ben—")));
    const result = await ensureOutreachCopyQuality({ ...options, draft: dirty });
    expect(result.draft).toEqual(clean);
    expect(completeForFeature).toHaveBeenCalledOnce();
  });
});
