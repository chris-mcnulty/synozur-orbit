import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import request from "supertest";
const auth = vi.hoisted(() => ({ tenant: "", userId: "", role: "Analyst", marketId: "" }));
vi.mock("../../context", () => ({
  ContextError: class extends Error {},
  getRequestContext: vi.fn(async () => ({ tenantDomain: auth.tenant, userId: auth.userId, userRole: auth.role, marketId: auth.marketId })),
}));
vi.mock("../../routes/helpers", () => ({ guardFeature: vi.fn(async () => true) }));
import { db } from "../../db";
import { users, outreachCampaigns, marketingContacts, prospects } from "@shared/schema";
import { eq } from "drizzle-orm";
import { registerOutreachContextRoutes } from "../../routes/outreach-context";
import { getOutreachContext, outreachCompositionContext, validateOutreachContext } from "../outreach-context-service";

const tenant = `outreach-context-test-${randomUUID()}.invalid`;
let p1: string, p2: string, c1: string;
const app = express(); app.use(express.json()); registerOutreachContextRoutes(app);
const path = () => `/api/sales-outreach/prospects/${p1}`;
const activity = {
  channel: "email", occurredAt: new Date(Date.now() - 3600000).toISOString(), sender: "Test sender",
  message: "Invited contact to a Tuesday meeting.", outcome: "no_reply", reply: "", followUpAt: null,
};

describe.skipIf(!process.env.DATABASE_URL)("external outreach persistence, routes and context isolation", () => {
  beforeAll(async () => {
    auth.tenant = tenant;
    const [user] = await db.select({ id: users.id }).from(users).limit(1); auth.userId = user.id;
    const campaigns = await db.insert(outreachCampaigns).values([
      { tenantDomain: tenant, name: "Fixture A", createdBy: user.id },
      { tenantDomain: tenant, name: "Fixture B", createdBy: user.id },
    ]).returning();
    c1 = campaigns[0].id;
    const [contact] = await db.insert(marketingContacts).values({ tenantDomain: tenant, firstName: "Fixture", email: "fixture@example.invalid" }).returning();
    const members = await db.insert(prospects).values(campaigns.map(c => ({
      tenantDomain: tenant, campaignId: c.id, contactId: contact.id,
    }))).returning();
    p1 = members[0].id; p2 = members[1].id;
  });
  afterAll(async () => {
    await db.delete(outreachCampaigns).where(eq(outreachCampaigns.tenantDomain, tenant));
    await db.delete(marketingContacts).where(eq(marketingContacts.tenantDomain, tenant));
  });
  it("logs, edits and deletes shared history without creating sends, then protects drafts and holds", async () => {
    const blank = await getOutreachContext(tenant, p1);
    expect(blank.activities).toEqual([]);
    const old = await outreachCompositionContext(tenant, p1);
    const logged = await request(app).post(`${path()}/external-activities`).send(activity);
    expect(logged.status).toBe(201);
    const shared = await getOutreachContext(tenant, p2);
    expect(shared.activities[0].message).toBe(activity.message);
    expect(shared.recentActivity).toBe(true);
    await expect(outreachCompositionContext(tenant, p1)).rejects.toThrow(/Review/);
    await expect(validateOutreachContext(tenant, p1, old.snapshot)).rejects.toThrow(/changed/);
    const ctx = await getOutreachContext(tenant, p1);
    const draft = await outreachCompositionContext(tenant, p1, ctx.fingerprint);
    expect(draft.block).toContain(activity.message);
    await expect(validateOutreachContext(tenant, p1, draft.snapshot)).resolves.toBeUndefined();
    const edited = await request(app).patch(`${path()}/external-activities/${logged.body.id}`).send({ ...activity, outcome: "replied", reply: "Tuesday works." });
    expect(edited.status).toBe(200);
    await expect(validateOutreachContext(tenant, p1, draft.snapshot)).rejects.toThrow(/changed/);
    expect((await getOutreachContext(tenant, p2)).activities[0].reply).toBe("Tuesday works.");
    expect((await request(app).patch(`${path()}/outreach-context`).send({ hold: true })).status).toBe(200);
    expect((await getOutreachContext(tenant, p2)).hold).toBe(true);
    await expect(outreachCompositionContext(tenant, p2, shared.fingerprint)).rejects.toThrow(/hold/);
    await expect(validateOutreachContext(tenant, p2)).rejects.toThrow(/hold/);
    expect((await request(app).patch(`${path()}/outreach-context`).send({ hold: false })).status).toBe(200);
    expect((await request(app).delete(`${path()}/external-activities/${logged.body.id}`)).status).toBe(200);
    expect((await getOutreachContext(tenant, p2)).activities).toEqual([]);
    expect((await request(app).delete(`${path()}/external-activities/${logged.body.id}`)).status).toBe(404);
  });
  it("requires explicit group selection and uses only the selected group's saved brief", async () => {
    const briefs = [
      { group: "customer", goal: "Continue current work", guidance: "No cold introduction", ask: "Review current priorities", exclusions: "No prospect pitch" },
      { group: "partner_prospect", goal: "Explore collaboration", guidance: "Do not imply a partnership", ask: "Discuss mutual fit", exclusions: "No existing contract claims" },
    ];
    const url = `/api/sales-outreach/campaigns/${c1}/messaging-briefs`;
    expect((await request(app).put(url).send({ briefs })).status).toBe(200);
    expect((await request(app).get(url)).body).toEqual(briefs);
    expect((await request(app).patch(`${path()}/outreach-context`).send({ messagingGroup: "partner_prospect" })).status).toBe(200);
    const ctx = await getOutreachContext(tenant, p1);
    await expect(outreachCompositionContext(tenant, p1)).rejects.toThrow(/Review/);
    const draft = await outreachCompositionContext(tenant, p1, ctx.fingerprint);
    expect(draft.block).toContain("Discuss mutual fit");
    expect(draft.block).not.toContain("Review current priorities");
    expect((await getOutreachContext(tenant, p2)).messagingGroup).toBeNull();
    expect((await request(app).put(url).send({ briefs: [briefs[0], briefs[0]] })).status).toBe(400);
    expect((await request(app).put(url).send({ briefs: [{ ...briefs[1], goal: "Changed goal" }] })).status).toBe(200);
    await expect(validateOutreachContext(tenant, p1, draft.snapshot)).rejects.toThrow(/changed/);
    expect((await request(app).patch(`${path()}/outreach-context`).send({ messagingGroup: null })).status).toBe(200);
  });
  it("rejects cross-tenant reads/writes, reader writes and invalid future activity", async () => {
    auth.tenant = "other.invalid";
    expect((await request(app).get(`${path()}/outreach-context`)).status).toBe(404);
    expect((await request(app).post(`${path()}/external-activities`).send(activity)).status).toBe(404);
    expect((await request(app).put(`/api/sales-outreach/campaigns/${c1}/messaging-briefs`).send({ briefs: [] })).status).toBe(404);
    auth.tenant = tenant; auth.role = "Viewer";
    expect((await request(app).post(`${path()}/external-activities`).send(activity)).status).toBe(403);
    expect((await request(app).patch(`${path()}/outreach-context`).send({ hold: true })).status).toBe(403);
    auth.role = "Analyst";
    expect((await request(app).post(`${path()}/external-activities`).send({ ...activity, occurredAt: "2100-01-01T00:00:00Z" })).status).toBe(400);
    expect((await request(app).patch(`${path()}/outreach-context`).send({ messagingGroup: "made_up" })).status).toBe(400);
  });
});
