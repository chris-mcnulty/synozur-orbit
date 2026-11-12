import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ context: vi.fn(), feature: vi.fn(), select: vi.fn(), rows: [] as unknown[][], filters: [] as unknown[] }));
vi.mock("../../context", () => ({ getRequestContext: mocks.context, ContextError: class extends Error { status = 401; } }));
vi.mock("../helpers", () => ({ guardFeature: mocks.feature }));
vi.mock("../../db", () => ({ db: { select: mocks.select } }));
import { registerOutreachWorkspaceRoutes } from "../outreach-workspace";
import { ContextError } from "../../context";
let app: ReturnType<typeof express>;
beforeEach(() => {
  vi.clearAllMocks(); mocks.rows.length = 0; mocks.filters.length = 0;
  mocks.context.mockResolvedValue({ tenantDomain: "tenant-a", marketId: "market-a" });
  mocks.feature.mockResolvedValue(true);
  mocks.select.mockImplementation(() => {
    const chain = { from: () => chain, innerJoin: () => chain, where: (filter: unknown) => {
      mocks.filters.push(filter); return Promise.resolve(mocks.rows.shift() ?? []);
    } };
    return chain;
  });
  app = express(); app.use(express.json()); registerOutreachWorkspaceRoutes(app);
});
const campaign = { id: "campaign", tenantDomain: "tenant-a", marketId: "market-a", status: "active", name: "Test campaign", salesGoal: null, conferenceId: null };
describe("campaign workspace routes", () => {
  it.each(["next-steps", "summary"])("scopes every %s query to campaign and tenant", async path => {
    mocks.rows.push([campaign], [], [], []);
    const result = path === "summary"
      ? await request(app).post(`/api/sales-outreach/campaigns/campaign/${path}`).send({})
      : await request(app).get(`/api/sales-outreach/campaigns/campaign/${path}`);
    expect(result.status).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(mocks.filters).toHaveLength(4);
    for (const filter of mocks.filters) {
      const compiled = new PgDialect().sqlToQuery(filter as any);
      expect(compiled.params).toContain("tenant-a");
      expect(compiled.params).toContain("campaign");
    }
    if (path === "summary") expect(result.body.summary).toContain("0 active campaign contacts");
    else expect(result.body.items).toEqual([]);
  });
  it("rejects a campaign in another market before loading its contacts", async () => {
    mocks.rows.push([{ ...campaign, marketId: "other" }]);
    expect((await request(app).get("/api/sales-outreach/campaigns/campaign/next-steps")).status).toBe(404);
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });
  it("rejects missing or foreign-tenant campaigns", async () => {
    mocks.rows.push([]);
    expect((await request(app).post("/api/sales-outreach/campaigns/foreign/summary").send({})).status).toBe(404);
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });
  it("returns an authentication failure without database queries", async () => {
    mocks.context.mockRejectedValue(new ContextError("Sign in", 401));
    expect((await request(app).get("/api/sales-outreach/campaigns/campaign/next-steps")).status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("fails explicitly on a storage error rather than inventing an empty summary", async () => {
    mocks.select.mockImplementation(() => { throw new Error("storage unavailable"); });
    expect((await request(app).post("/api/sales-outreach/campaigns/campaign/summary").send({})).status).toBe(500);
  });
});
