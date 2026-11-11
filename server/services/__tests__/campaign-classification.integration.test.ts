import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
const tenant = `classification-test-${randomUUID()}.example.invalid`;
const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite("campaign classifications database isolation", () => {
  afterAll(async () => {
    const { db } = await import("../../db");
    const { outreachCampaigns, marketingContacts } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db.delete(outreachCampaigns).where(eq(outreachCampaigns.tenantDomain, tenant));
    await db.delete(marketingContacts).where(eq(marketingContacts.tenantDomain, tenant));
  });
  it("round-trips tags, protects provenance, and keeps the same person independent across campaigns", async () => {
    const { db } = await import("../../db");
    const { users, outreachCampaigns, prospects } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { ensureContactForPerson, addCampaignMembership, listCampaignProspects } = await import("../prospect-contact-service");
    const { updateCampaignClassification } = await import("../campaign-classification-service");
    const [user] = await db.select({ id: users.id }).from(users).limit(1);
    const campaigns = await db.insert(outreachCampaigns).values(["First", "Second"].map(name => ({
      name: `Test-only ${name}`, tenantDomain: tenant, createdBy: user.id,
    }))).returning();
    const { contactId } = await ensureContactForPerson(tenant, { name: "Test-only contact", email: "classification@example.invalid" }, "manual");
    const a = await addCampaignMembership({ tenantDomain: tenant, campaignId: campaigns[0].id, contactId, source: "hubspot" });
    const b = await addCampaignMembership({ tenantDomain: tenant, campaignId: campaigns[1].id, contactId, source: "manual" });
    await updateCampaignClassification(tenant, "", campaigns[0].id, {
      prospectIds: [a.membershipId],
      patch: { relationships: ["customer", "partner"], attendance: "confirmed", attendanceEvidence: "Test confirmation", tags: ["VIP"], eventRoles: ["speaker"], sourceDetail: "From me" },
    });
    const [saved] = await listCampaignProspects(campaigns[0].id);
    expect(saved.classification).toEqual({ tags: ["VIP"], eventRoles: ["speaker"], sourceDetail: "From me" });
    expect(saved.meeting).toMatchObject({ relationships: ["customer", "partner"], attendance: "confirmed" });
    expect(saved.source).toBe("hubspot");
    const [other] = await listCampaignProspects(campaigns[1].id);
    expect(other.classification).toBeNull();
    expect(other.meeting).toBeNull();
    await expect(updateCampaignClassification("other.example.invalid", "", campaigns[0].id, { prospectIds: [a.membershipId], patch: { tags: [] } })).rejects.toMatchObject({ status: 404 });
    await expect(updateCampaignClassification(tenant, "", campaigns[0].id, { prospectIds: [a.membershipId, b.membershipId], patch: { tags: [] } })).rejects.toMatchObject({ status: 404 });
    // Concurrent tag additions serialize without losing either update.
    await Promise.all(["Breakfast", "Follow up"].map(tag => updateCampaignClassification(tenant, "", campaigns[0].id, {
      prospectIds: [a.membershipId], patch: { tags: [tag], tagsMode: "add" },
    })));
    const [final] = await db.select().from(prospects).where(eq(prospects.id, a.membershipId));
    expect(final.classification?.tags.sort()).toEqual(["Breakfast", "Follow up", "VIP"]);
    const { rescoreCampaignProspect } = await import("../prospect-rescore-service");
    await db.update(outreachCampaigns).set({ targetingFilter: {
      targetRoles: ["Chief Information Officer"], industries: ["IT Services"], geographies: ["United States"], segments: ["Enterprise"],
    } }).where(eq(outreachCampaigns.id, campaigns[0].id));
    const facts = { title: "Chief Information Officer", industry: "IT Services", geography: "US", segment: "Enterprise" };
    const score = await rescoreCampaignProspect(tenant, "", campaigns[0].id, a.membershipId, { facts });
    expect(score.score).toBe(92); // All fit facts + email; no LinkedIn supplied.
    expect((await rescoreCampaignProspect(tenant, "", campaigns[0].id, a.membershipId, {})).score).toBe(92);
    const [afterScore] = await listCampaignProspects(campaigns[0].id);
    expect(afterScore.classification?.scoringFacts).toEqual(facts);
    expect(afterScore.classification?.tags).toContain("VIP");
    expect(afterScore.status).toBe(saved.status);
    expect(afterScore.title).toBe(saved.title); // Campaign scoring override, not shared title.
    await expect(rescoreCampaignProspect(tenant, "", campaigns[1].id, a.membershipId, {})).rejects.toMatchObject({ status: 404 });
    await expect(rescoreCampaignProspect("wrong.example.invalid", "", campaigns[0].id, a.membershipId, {})).rejects.toMatchObject({ status: 404 });
  }, 30000);
});
