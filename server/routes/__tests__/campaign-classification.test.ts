import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), feature: vi.fn(), update: vi.fn(), rescore: vi.fn() }));
vi.mock("../../services/prospect-rescore-service", () => ({ rescoreCampaignProspect: mocks.rescore }));
vi.mock("../../context", () => ({
  getRequestContext: mocks.context,
  ContextError: class extends Error { status = 401; },
}));
vi.mock("../helpers", () => ({ guardFeature: mocks.feature }));
vi.mock("../../services/campaign-classification-service", () => ({
  updateCampaignClassification: mocks.update,
  ClassificationError: class extends Error { constructor(message: string, public status = 400) { super(message); } },
}));
import { registerCampaignClassificationRoutes } from "../campaign-classification";
import { ContextError } from "../../context";
let app: ReturnType<typeof express>;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ tenantDomain: "tenant", marketId: "market", userRole: "Analyst" });
  mocks.feature.mockResolvedValue(true);
  mocks.update.mockResolvedValue({ updated: 1 });
  app = express(); app.use(express.json()); registerCampaignClassificationRoutes(app);
});
const url = "/api/sales-outreach/campaigns/campaign/prospects/classification";
describe("campaign classification permissions", () => {
  it("scopes non-AI rescore and blocks a read-only role", async () => {
    mocks.rescore.mockResolvedValue({ score: 55 });
    const path = "/api/sales-outreach/campaigns/campaign/prospects/person/rescore";
    expect((await request(app).post(path).send({})).status).toBe(200);
    expect(mocks.rescore).toHaveBeenCalledWith("tenant", "market", "campaign", "person", {});
    mocks.context.mockResolvedValue({ userRole: "Standard User" });
    expect((await request(app).post(path).send({})).status).toBe(403);
    expect(mocks.rescore).toHaveBeenCalledTimes(1);
  });
  it("passes only authorized tenant and market to persistence", async () => {
    const body = { prospectIds: ["p"], patch: { relationships: ["partner"] } };
    expect((await request(app).patch(url).send(body)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith("tenant", "market", "campaign", body);
  });
  it.each(["Standard User", "Consultant", "Unknown"])("blocks read-only or unknown role %s", async userRole => {
    mocks.context.mockResolvedValue({ userRole });
    expect((await request(app).patch(url).send({})).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("returns authentication errors without writes", async () => {
    mocks.context.mockRejectedValue(new ContextError("Not authenticated", 401));
    expect((await request(app).patch(url).send({})).status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
