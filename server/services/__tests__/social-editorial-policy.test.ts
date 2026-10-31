import { describe, it, expect, vi } from "vitest";
import { accountEditorialGuide, isCascadiaAccount, instagramCaption, socialCaptionForDelivery, INSTAGRAM_EDITORIAL_GUIDE, CASCADIA_CONTENT_ANGLES } from "../social-editorial-policy";
vi.mock("../../db", () => ({ db: {} }));
import { buildSystemPrompt } from "../voice-service";

describe("Instagram editorial rules", () => {
  it("keeps the story while removing product and tracking links", () => {
    expect(instagramCaption("The light divides the frame.\n\nLearn more: https://example.com/print\nhttps://orbit.example/r/abc"))
      .toBe("The light divides the frame.");
  });
  it("cleans markdown, autolinks, www, bare domains and relative redirects", () => {
    expect(instagramCaption("A [detail](https://example.com) worth noticing.\n<https://example.com>\nwww.example.com/print\nexample.com/print\n/r/abc"))
      .toBe("A detail worth noticing.");
  });
  it("preserves an intentional link-free closer, line breaks, and email", () => {
    const text = "A quieter frame.\n\nExplore the collection\nContact artist@example.com";
    expect(instagramCaption(text)).toBe(text);
  });
  it.each(["linkedin", "twitter", "facebook"])("leaves %s delivery unchanged", platform => {
    const text = "Read more: https://example.com";
    expect(socialCaptionForDelivery(platform, text)).toBe(text);
  });
  it("sets a short default, factual boundaries and no unverified bio promise", () => {
    expect(INSTAGRAM_EDITORIAL_GUIDE).toContain("30-80 words");
    expect(INSTAGRAM_EDITORIAL_GUIDE).toContain("has not been verified");
    expect(INSTAGRAM_EDITORIAL_GUIDE).toContain("Never invent");
  });
});

describe("Cascadia profile isolation", () => {
  it.each(["Cascadia Oceanic", "@cascadiaoceanic", "Cascadia Oceanic (Instagram)", "Cascadia"])("recognizes %s", name => {
    expect(isCascadiaAccount(name)).toBe(true);
    expect(accountEditorialGuide(name)).toContain("not as a catalog");
  });
  it.each(["Synozur", "Cascadia competitor analysis", "Other brand"])("does not change %s voice", name => {
    expect(accountEditorialGuide(name)).toBe("");
  });
  it("uses source-supported art angles rather than statistics and industry trends", () => {
    expect(CASCADIA_CONTENT_ANGLES.map(a => a.name)).toContain("documented creative choice");
    expect(CASCADIA_CONTENT_ANGLES.map(a => a.name)).not.toContain("surprising statistic");
  });
  it("applies the profile in the shared voice prompt without replacing existing voice settings", () => {
    const input: any = { account: { accountName: "Cascadia Oceanic" }, profile: { styleGuidance: "Keep my sentences direct" }, platform: "instagram", frameworks: [], persona: null };
    const prompt = buildSystemPrompt(input);
    expect(prompt).toContain("Keep my sentences direct");
    expect(prompt).toContain("Cascadia Oceanic editorial profile");
    expect(prompt).toContain("30-80 words");
    expect(buildSystemPrompt({ ...input, account: { accountName: "Synozur" }, platform: "linkedin" }))
      .not.toContain("Cascadia Oceanic editorial profile");
  });
});
