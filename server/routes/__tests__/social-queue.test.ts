import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const state = vi.hoisted(() => ({
  rows: [] as any[], allowed: true,
  cancel: vi.fn(), resolve: vi.fn(),
}));
vi.mock("../../db", () => ({
  db: {
    select: () => {
      const chain: any = {};
      for (const method of ["from", "leftJoin", "where", "orderBy", "limit"]) chain[method] = () => chain;
      chain.then = (resolve: any, reject: any) => Promise.resolve(state.rows).then(resolve, reject);
      return chain;
    },
  },
}));
vi.mock("../../context", () => ({
  getRequestContext: async () => ({ tenantDomain: "tenant.example", marketId: "market", userId: "operator" }),
}));
vi.mock("../helpers", () => ({
  guardFeature: async (_req: any, res: any) => {
    if (!state.allowed) res.status(403).json({ error: "Forbidden" });
    return state.allowed;
  },
}));
vi.mock("../../services/social-queue-cancel", () => ({ cancelQueuedPosts: state.cancel }));
vi.mock("../../services/social-post-images", () => ({ resolveSocialPostImages: state.resolve }));
vi.mock("../../storage", () => ({ storage: {} }));
import { registerMarketingPostsRoutes } from "../marketing-posts";

const app = express();
app.use(express.json());
registerMarketingPostsRoutes(app);
beforeEach(() => {
  state.rows = [];
  state.allowed = true;
  state.cancel.mockReset().mockResolvedValue({ cancelled: 1, cancelledIds: ["one"], skipped: 0, skippedIds: [] });
  state.resolve.mockReset().mockImplementation(async rows => rows.map((p: any) => ({ ...p, leadImageUrl: "/public-objects/article.png" })));
});

describe("posting queue API", () => {
  it("passes tenant and operator context to the safe cancellation service", async () => {
    const res = await request(app).post("/api/generated-posts/bulk-cancel").send({ postIds: ["one"] });
    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(1);
    expect(state.cancel).toHaveBeenCalledWith({ postIds: ["one"], tenantDomain: "tenant.example", marketId: "market", userId: "operator" });
  });
  it("requires an explicit bounded list and never treats empty IDs as cancel-all", async () => {
    for (const postIds of [[], null, [4], [""], Array(501).fill("one")]) {
      const res = await request(app).post("/api/generated-posts/bulk-cancel").send({ postIds });
      expect(res.status).toBe(400);
    }
    expect(state.cancel).not.toHaveBeenCalled();
  });
  it("enforces the feature gate before performing changes", async () => {
    state.allowed = false;
    const res = await request(app).post("/api/generated-posts/bulk-cancel").send({ postIds: ["one"] });
    expect(res.status).toBe(403);
    expect(state.cancel).not.toHaveBeenCalled();
  });
  it("exposes partial cancellation without claiming protected posts were cancelled", async () => {
    state.cancel.mockResolvedValueOnce({ cancelled: 1, cancelledIds: ["one"], skipped: 1, skippedIds: ["claimed"] });
    const res = await request(app).post("/api/generated-posts/bulk-cancel").send({ postIds: ["one", "claimed"] });
    expect(res.body).toMatchObject({ cancelled: 1, skipped: 1, skippedIds: ["claimed"] });
  });
  it("returns resolved image and campaign metadata in the queue calendar", async () => {
    state.rows = [{
      id: "one", tenantDomain: "tenant.example", status: "approved",
      campaignId: "campaign", campaignName: "Polaris 065",
      content: "A post", editedContent: null, scheduledDate: new Date(),
    }];
    const res = await request(app).get("/api/generated-posts/calendar");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ campaignId: "campaign", campaignName: "Polaris 065", leadImageUrl: "/public-objects/article.png" });
    expect(state.resolve).toHaveBeenCalledWith(state.rows);
  });
  it("returns the same resolved image in the shared post editor", async () => {
    state.rows = [{ id: "one", tenantDomain: "tenant.example", content: "A post" }];
    const res = await request(app).get("/api/generated-posts/one");
    expect(res.status).toBe(200);
    expect(res.body.leadImageUrl).toBe("/public-objects/article.png");
  });
});
