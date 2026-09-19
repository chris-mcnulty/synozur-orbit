import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  where: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: {
    select: vi.fn(() => ({ from: mocks.from })),
  },
}));

vi.mock("../ai-provider", () => ({ completeForFeature: vi.fn() }));
vi.mock("../headless-crawler", () => ({
  fetchPageHeadless: vi.fn(),
  isHeadlessAvailable: vi.fn(),
}));

import { groundingDocuments } from "@shared/schema";
import { loadGroundingContext } from "../content-extraction";

describe("master grounding tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue({ where: mocks.where });
    mocks.where.mockResolvedValue([
      {
        tenantDomain: "cascadia.example",
        marketId: null,
        name: "Cascadia voice",
        extractedText: "Photography guidance",
      },
      {
        tenantDomain: "cascadia.example",
        marketId: "cascadia-market",
        name: "Cascadia market",
        extractedText: "Fine-art photography",
      },
    ]);
  });

  it("queries only tenant-owned grounding documents, never global documents", async () => {
    const context = await loadGroundingContext(
      "cascadia.example",
      "cascadia-market",
    );

    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith(groundingDocuments);
    expect(context).toContain("Photography guidance");
    expect(context).toContain("Fine-art photography");
  });
});