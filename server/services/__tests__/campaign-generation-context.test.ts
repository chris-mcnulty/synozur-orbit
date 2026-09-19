import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadGroundingContext: vi.fn(),
  loadStrategicContext: vi.fn(),
  formatStrategicContextForPrompt: vi.fn(),
}));

vi.mock("../content-extraction", () => ({
  loadGroundingContext: mocks.loadGroundingContext,
}));

vi.mock("../strategic-context", () => ({
  loadStrategicContext: mocks.loadStrategicContext,
  formatStrategicContextForPrompt: mocks.formatStrategicContextForPrompt,
}));

import { loadCampaignGenerationSupplementalContext } from "../campaign-generation-context";

describe("campaign generation context boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not load grounding or strategic intelligence in campaign-only mode", async () => {
    const result = await loadCampaignGenerationSupplementalContext(
      "cascadia.example",
      "cascadia-market",
      true,
    );

    expect(result).toEqual({ groundingContext: "", strategicContext: "" });
    expect(mocks.loadGroundingContext).not.toHaveBeenCalled();
    expect(mocks.loadStrategicContext).not.toHaveBeenCalled();
    expect(mocks.formatStrategicContextForPrompt).not.toHaveBeenCalled();
  });

  it("loads tenant-scoped supplemental context when campaign-only mode is off", async () => {
    mocks.loadGroundingContext.mockResolvedValue("Cascadia grounding");
    mocks.loadStrategicContext.mockResolvedValue({ tenant: "Cascadia" });
    mocks.formatStrategicContextForPrompt.mockReturnValue("Cascadia strategy");

    const result = await loadCampaignGenerationSupplementalContext(
      "cascadia.example",
      "cascadia-market",
      false,
    );

    expect(mocks.loadGroundingContext).toHaveBeenCalledWith(
      "cascadia.example",
      "cascadia-market",
    );
    expect(mocks.loadStrategicContext).toHaveBeenCalledWith(
      "cascadia.example",
      "cascadia-market",
    );
    expect(result).toEqual({
      groundingContext: "Cascadia grounding",
      strategicContext: "Cascadia strategy",
    });
  });
});