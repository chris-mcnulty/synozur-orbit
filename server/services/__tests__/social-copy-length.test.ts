import { describe, expect, it } from "vitest";
import { socialCopyLength } from "../social-copy-length";

describe("social delivery length", () => {
  it("matches X's two-newline separator and handles prefixed hashtags", () => {
    expect(socialCopyLength("hello", "twitter", ["one", "#two"])).toBe(16);
  });

  it("counts an HTTP or HTTPS URL as 23 characters", () => {
    expect(socialCopyLength("Read https://example.com/a/very/long/path?q=value", "twitter")).toBe(28);
    expect(socialCopyLength("Read http://example.com/a", "x")).toBe(28);
  });

  it("counts CJK and emoji correctly, rather than JavaScript code units", () => {
    expect(socialCopyLength("界".repeat(140), "twitter")).toBe(280);
    expect(socialCopyLength("👨‍👩‍👧‍👦", "twitter")).toBe(2);
  });

  it("keeps non-X platform behavior unchanged", () => {
    const content = "Read https://example.com/a/long/path";
    expect(socialCopyLength(content, "linkedin", ["separate"])).toBe(content.length);
  });
});
