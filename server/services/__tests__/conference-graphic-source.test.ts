import { describe, expect, it } from "vitest";
import { normalizeConferenceGraphicSource } from "../conference-promotion-service";

describe("conference graphic source safety", () => {
  it("migrates legacy AI anchors to deterministic branded hero composites", () => {
    expect(normalizeConferenceGraphicSource("ai_generated", "anchor"))
      .toBe("logo_composite");
  });

  it("migrates legacy AI session art to deterministic brand templates", () => {
    expect(normalizeConferenceGraphicSource("ai_generated", "session"))
      .toBe("template_composite");
  });

  it("preserves uploaded and explicitly composited graphics", () => {
    expect(normalizeConferenceGraphicSource("uploaded", "anchor")).toBe("uploaded");
    expect(normalizeConferenceGraphicSource("logo_composite", "anchor")).toBe("logo_composite");
    expect(normalizeConferenceGraphicSource("template_composite", "session")).toBe("template_composite");
  });
});