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
  it.each(["next-steps", "summary"])("scopes empty-campaign %s queries and skips shared history", async path => {
    mocks.rows.push([campaign], [], [], []);
    const result = path === "summary"
      ? await request(app).post(`/api/sales-outreach/campaigns/campaign/${path}`).send({})
      : await request(app).get(`/api/sales-outreach/campaigns/campaign/${path}`);
    expect(result.status).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(mocks.filters).toHaveLength(3);
    for (const filter of mocks.filters) {
      const compiled = new PgDialect().sqlToQuery(filter as any);
      expect(compiled.params).toContain("tenant-a");
      expect(compiled.params).toContain("campaign");
    }
    if (path === "summary") expect(result.body.summary).toContain("0 active campaign contacts");
    else expect(result.body.items).toEqual([]);
  });
  it.each(["next-steps", "summary"])("%s considers campaign A history for a shared contact in campaign B without changing counts", async path => {
    const person = { id: "prospect-b", contactId: "shared-contact", status: "researched",
      researchDossier: "Research", nextActionAt: null, classification: null, meeting: null, removedAt: null };
    mocks.rows.push([campaign], [{ person, firstName: "Shared", lastName: "Contact",
      companyName: null, outreachHold: false, emailOptOut: false }], [], [{
      campaignId: "campaign-a", contactId: "shared-contact", direction: "inbound",
      outcome: "replied", occurredAt: new Date("2026-01-01"), followUpAt: new Date("2026-01-02"),
    }]);
    const result = path === "summary"
      ? await request(app).post("/api/sales-outreach/campaigns/campaign/summary").send({})
      : await request(app).get("/api/sales-outreach/campaigns/campaign/next-steps");
    expect(result.status).toBe(200);
    expect(result.body.items.length).toBeGreaterThan(0);
    expect(result.body.items.every((item: any) => item.action === "review_history")).toBe(true);
    expect(result.body.items.some((item: any) => item.title === "Review contact response")).toBe(true);
    if (path === "summary") {
      expect(result.body.counts).toMatchObject({ contacts: 1, pendingDrafts: 0, sent: 0, replied: 0, overdue: 0 });
    }
    const compiled = mocks.filters.map(filter => new PgDialect().sqlToQuery(filter as any));
    for (const query of compiled) expect(query.params).toContain("tenant-a");
    for (const query of compiled.slice(0, 3)) expect(query.params).toContain("campaign");
    // The actual SQL must exclude foreign tenants and unrelated contacts, without
    // restricting shared conversation history to the campaign being viewed.
    expect(compiled[3].sql).toContain('"external_outreach_activities"."tenant_domain" =');
    expect(compiled[3].sql).toContain('"external_outreach_activities"."contact_id" in');
    expect(compiled[3].params).toEqual(["shared-contact", "tenant-a"]);
    expect(compiled[3].sql).not.toContain('"campaign_id"');
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
