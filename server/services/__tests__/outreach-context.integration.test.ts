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
import { users, outreachCampaigns, marketingContacts, prospects, outreachTouches } from "@shared/schema";
import { listCampaignProspects } from "../prospect-contact-service";
import { eq } from "drizzle-orm";
import { registerOutreachContextRoutes } from "../../routes/outreach-context";
import { getOutreachContext, outreachCompositionContext, validateOutreachContext } from "../outreach-context-service";

const tenant = `outreach-context-test-${randomUUID()}.invalid`;
let p1: string, p2: string, p3: string, c1: string;
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
    const [secondContact] = await db.insert(marketingContacts).values({ tenantDomain: tenant, firstName: "Second fixture" }).returning();
    const [third] = await db.insert(prospects).values({ tenantDomain: tenant, campaignId: c1, contactId: secondContact.id }).returning();
    p3 = third.id;
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
  it("bulk edits atomically, preserves independent fields and leaves shared history untouched", async () => {
    const url = `/api/sales-outreach/campaigns/${c1}/outreach-context`;
    const before = await getOutreachContext(tenant, p1);
    const saved = await request(app).patch(url).send({ prospectIds: [p1, p3], messagingGroup: "customer", familiarity: "known" });
    expect(saved.status).toBe(200); expect(saved.body.updated).toBe(2);
    for (const id of [p1, p3]) {
      const ctx = await getOutreachContext(tenant, id);
      expect(ctx.messagingGroup).toBe("customer"); expect(ctx.familiarity).toBe("known");
    }
    expect((await getOutreachContext(tenant, p2)).familiarity).toBe("unknown");
    expect((await getOutreachContext(tenant, p1)).activities).toEqual(before.activities);
    expect((await getOutreachContext(tenant, p1)).hold).toBe(before.hold);
    expect((await request(app).patch(url).send({ prospectIds: [p1, p3], familiarity: "cold" })).status).toBe(200);
    expect((await getOutreachContext(tenant, p1)).messagingGroup).toBe("customer");
    expect((await request(app).patch(url).send({ prospectIds: [p1], messagingGroup: null })).status).toBe(200);
    expect((await getOutreachContext(tenant, p1)).familiarity).toBe("cold");
    // One valid ID plus another campaign's ID must roll back the valid change too.
    expect((await request(app).patch(url).send({ prospectIds: [p1, p2], familiarity: "known" })).status).toBe(409);
    expect((await getOutreachContext(tenant, p1)).familiarity).toBe("cold");
    expect((await request(app).patch(url).send({ prospectIds: [p1, randomUUID()], familiarity: "known" })).status).toBe(409);
    expect((await getOutreachContext(tenant, p1)).familiarity).toBe("cold");
    auth.role = "Viewer";
    expect((await request(app).patch(url).send({ prospectIds: [p1], familiarity: "known" })).status).toBe(403);
    auth.role = "Analyst"; auth.tenant = "other.invalid";
    expect((await request(app).patch(url).send({ prospectIds: [p1], familiarity: "known" })).status).toBe(404);
    auth.tenant = tenant;
  });
  it("requires reviewed familiarity for drafting and detects changes before persistence or approval", async () => {
    const ctx = await getOutreachContext(tenant, p1);
    await expect(outreachCompositionContext(tenant, p1)).rejects.toThrow(/Review/);
    const draft = await outreachCompositionContext(tenant, p1, ctx.fingerprint);
    expect(draft.block).toContain("introduce the sender briefly");
    expect((await request(app).patch(`${path()}/outreach-context`).send({ familiarity: "known" })).status).toBe(200);
    await expect(validateOutreachContext(tenant, p1, draft.snapshot)).rejects.toThrow(/changed/);
    await expect(validateOutreachContext(tenant, p1)).rejects.toThrow(/changed/);
    const known = await getOutreachContext(tenant, p1);
    expect((await outreachCompositionContext(tenant, p1, known.fingerprint)).block).toContain("skip the sender bio");
    expect((await request(app).patch(`${path()}/outreach-context`).send({ familiarity: "unknown" })).status).toBe(200);
    await expect(validateOutreachContext(tenant, p1, { fingerprint: known.fingerprint, group: null })).rejects.toThrow(/changed/);
  });
  it("removes only campaign memberships from active outreach while retaining history and blocking new drafts", async () => {
    const url = `/api/sales-outreach/campaigns/${c1}/prospects/remove`;
    const ctx = await getOutreachContext(tenant, p1);
    const [touch] = await db.insert(outreachTouches).values({
      tenantDomain: tenant, campaignId: c1, prospectId: p1, channel: "email",
      body: "Historical email", subject: "History", status: "sent", stepNumber: 1,
    }).returning();
    expect((await request(app).post(url).send({ prospectIds: [p1], confirmed: false })).status).toBe(400);
    expect((await request(app).post(url).send({ prospectIds: [p1, p2], confirmed: true })).status).toBe(409);
    expect((await getOutreachContext(tenant, p1)).removed).toBe(false);
    auth.role = "Viewer";
    expect((await request(app).post(url).send({ prospectIds: [p1], confirmed: true })).status).toBe(403);
    auth.role = "Analyst";
    auth.tenant = "other.invalid";
    expect((await request(app).post(url).send({ prospectIds: [p1], confirmed: true })).status).toBe(404);
    auth.tenant = tenant;
    const result = await request(app).post(url).send({ prospectIds: [p1, p3], confirmed: true });
    expect(result.status).toBe(200); expect(result.body.removed).toBe(2);
    expect(await listCampaignProspects(c1)).toHaveLength(0);
    expect(await listCampaignProspects(c1, true)).toHaveLength(2);
    expect((await db.select().from(outreachTouches).where(eq(outreachTouches.id, touch.id)))[0].body).toBe("Historical email");
    expect((await getOutreachContext(tenant, p2)).removed).toBe(false);
    await expect(outreachCompositionContext(tenant, p1, ctx.fingerprint)).rejects.toThrow(/removed/);
    await expect(validateOutreachContext(tenant, p1, {fingerprint:ctx.fingerprint,group:null})).rejects.toThrow(/removed/);
    const removed = (await listCampaignProspects(c1, true))[0];
    expect(removed.nextActionAt).toBeNull();
    expect(removed.status).toBe("dormant");
  });
  it("logs standalone messages and replies without an Orbit touch, preserving other campaign states", async () => {
    const url = `/api/sales-outreach/prospects/${p2}/external-activities`;
    await db.update(prospects).set({ status: "new", nextActionAt: new Date() }).where(eq(prospects.id, p2));
    const outbound = await request(app).post(url).send({ ...activity, direction: "outbound", message: "Message sent outside Orbit; content not recorded." });
    expect(outbound.status).toBe(201);
    expect((await db.select().from(prospects).where(eq(prospects.id, p2)))[0].status).toBe("new");
    expect((await request(app).post(url).send({ ...activity, direction: "inbound", outcome: "no_reply" })).status).toBe(400);
    const inbound = await request(app).post(url).send({
      ...activity, direction: "inbound", sender: "Contact", outcome: "replied",
      message: "Reply received by phone; will follow up later.",
    });
    expect(inbound.status).toBe(201);
    const [person] = await db.select().from(prospects).where(eq(prospects.id, p2));
    expect(person.status).toBe("replied"); expect(person.nextActionAt).toBeNull();
    expect(await db.select().from(outreachTouches).where(eq(outreachTouches.prospectId, p2))).toHaveLength(0);
    const shared = await getOutreachContext(tenant, p1);
    expect(shared.activities.some(a => a.id === inbound.body.id && a.direction === "inbound")).toBe(true);
    expect((await db.select().from(prospects).where(eq(prospects.id, p1)))[0].status).toBe("dormant");
    await request(app).delete(`${url}/${inbound.body.id}`);
    expect((await db.select().from(prospects).where(eq(prospects.id, p2)))[0].status).toBe("replied");
  });
});
