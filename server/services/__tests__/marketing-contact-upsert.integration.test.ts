/**
 * Integration regression test: the (tenant_domain, email) unique index on
 * marketing_contacts is PARTIAL (WHERE email IS NOT NULL) since the
 * single-contact-table migration. Postgres can only use it for
 * ON CONFLICT inference when the conflict target carries the same
 * predicate (Drizzle `targetWhere`). These tests run the real upserts
 * against the live migrated database — no mocks — so a regression in the
 * conflict clause fails loudly instead of only surfacing in production.
 *
 * Skipped automatically when DATABASE_URL is not configured.
 */
import { describe, it, expect, afterAll } from "vitest";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const TENANT = `upsert-itest-${Date.now()}.example.com`;

d("marketing_contacts upsert vs partial unique index (integration)", () => {
  afterAll(async () => {
    const { db } = await import("../../db");
    const { marketingContacts } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db.delete(marketingContacts).where(eq(marketingContacts.tenantDomain, TENANT));
  });

  it("upsertContact inserts then updates on the same tenant+email", async () => {
    const { upsertContact } = await import("../marketing-contact-service");

    const first = await upsertContact({
      tenantDomain: TENANT,
      email: "Person@Example.com",
      firstName: "Pat",
      source: "manual",
    });
    expect(first.created).toBe(true);
    expect(first.contact.email).toBe("person@example.com");

    // Second call must take the ON CONFLICT DO UPDATE path (same row id),
    // which only works if the partial-index predicate is inferable.
    const second = await upsertContact({
      tenantDomain: TENANT,
      email: "person@example.com",
      company: "Acme",
      source: "manual",
    });
    expect(second.created).toBe(false);
    expect(second.contact.id).toBe(first.contact.id);
    expect(second.contact.company).toBe("Acme");
    expect(second.contact.firstName).toBe("Pat");
  });

  it("batch upsert with targetWhere (hubspot-list shape) updates instead of erroring", async () => {
    const { db } = await import("../../db");
    const { marketingContacts } = await import("@shared/schema");
    const { sql, and, eq } = await import("drizzle-orm");

    const values = {
      tenantDomain: TENANT,
      email: "list-member@example.com",
      firstName: "Lee",
      lifecycleStage: "subscriber",
      source: "hubspot",
      lastEventAt: new Date(),
    };
    const conflict = {
      target: [marketingContacts.tenantDomain, marketingContacts.email],
      targetWhere: sql`${marketingContacts.email} IS NOT NULL`,
      set: {
        firstName: sql`COALESCE(excluded.first_name, ${marketingContacts.firstName})`,
        updatedAt: new Date(),
      },
    };

    const [a] = await db.insert(marketingContacts).values(values).onConflictDoUpdate(conflict).returning({ id: marketingContacts.id });
    const [b] = await db.insert(marketingContacts).values(values).onConflictDoUpdate(conflict).returning({ id: marketingContacts.id });
    expect(b.id).toBe(a.id);

    const rows = await db
      .select({ id: marketingContacts.id })
      .from(marketingContacts)
      .where(and(eq(marketingContacts.tenantDomain, TENANT), eq(marketingContacts.email, "list-member@example.com")));
    expect(rows).toHaveLength(1);
  });

  it("addCampaignMembership is idempotent per (campaign, contact)", async () => {
    const { db } = await import("../../db");
    const { outreachCampaigns, prospects, users } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { ensureContactForPerson, addCampaignMembership } = await import("../prospect-contact-service");

    const [anyUser] = await db.select({ id: users.id }).from(users).limit(1);
    if (!anyUser) return; // empty database — nothing to anchor created_by on

    const [campaign] = await db
      .insert(outreachCampaigns)
      .values({ tenantDomain: TENANT, name: "itest campaign", createdBy: anyUser.id })
      .returning({ id: outreachCampaigns.id });
    try {
      const { contactId } = await ensureContactForPerson(TENANT, {
        name: "Dup Member",
        email: "dup-member@example.com",
      });
      const base = { campaignId: campaign.id, tenantDomain: TENANT, contactId, source: "manual", status: "new" };
      const first = await addCampaignMembership(base);
      const second = await addCampaignMembership(base);
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.membershipId).toBe(first.membershipId);

      const rows = await db
        .select({ id: prospects.id })
        .from(prospects)
        .where(eq(prospects.campaignId, campaign.id));
      expect(rows).toHaveLength(1);
    } finally {
      await db.delete(outreachCampaigns).where(eq(outreachCampaigns.id, campaign.id));
    }
  });

  it("migration 0098 dedupe keeps the most recently updated membership's state", async () => {
    // Replays the 0098 duplicate-membership reconciliation inside a rolled-back
    // transaction: an older stale "new" row must NOT survive over a newer
    // "replied" membership with an owner and next action.
    const { pool } = await import("../../db");
    const fs = await import("node:fs");
    const migrationSql = fs.readFileSync("migrations/0098_unique_campaign_membership.sql", "utf8");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [user] } = await client.query("SELECT id FROM users LIMIT 1");
      if (!user) { await client.query("ROLLBACK"); return; }

      await client.query("DROP INDEX prospects_campaign_contact_uniq");
      const { rows: [camp] } = await client.query(
        "INSERT INTO outreach_campaigns (tenant_domain, name, created_by) VALUES ($1, 'dedupe itest', $2) RETURNING id",
        [TENANT, user.id],
      );
      const { rows: [contact] } = await client.query(
        "INSERT INTO marketing_contacts (tenant_domain, email, first_name) VALUES ($1, 'dedupe@example.com', 'Dee') RETURNING id",
        [TENANT],
      );
      // Older stale row (has the dossier), newer active row (replied, owned).
      const { rows: [older] } = await client.query(
        `INSERT INTO prospects (campaign_id, tenant_domain, contact_id, source, status, research_dossier, created_at, updated_at)
         VALUES ($1, $2, $3, 'manual', 'new', 'old dossier', now() - interval '10 days', now() - interval '10 days') RETURNING id`,
        [camp.id, TENANT, contact.id],
      );
      const { rows: [newer] } = await client.query(
        `INSERT INTO prospects (campaign_id, tenant_domain, contact_id, source, status, owner_user_id, next_action_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'import', 'replied', $4, now() + interval '1 day', now() - interval '2 days', now()) RETURNING id`,
        [camp.id, TENANT, contact.id, user.id],
      );
      await client.query(
        `INSERT INTO outreach_touches (prospect_id, campaign_id, tenant_domain, channel, step_number, status)
         VALUES ($1, $2, $3, 'email', 1, 'sent'), ($4, $2, $3, 'email', 2, 'replied')`,
        [older.id, camp.id, TENANT, newer.id],
      );

      await client.query(migrationSql);

      const { rows: survivors } = await client.query(
        "SELECT id, status, owner_user_id, next_action_at, research_dossier, created_at FROM prospects WHERE campaign_id = $1",
        [camp.id],
      );
      expect(survivors).toHaveLength(1);
      const s = survivors[0];
      expect(s.id).toBe(newer.id); // most recently updated wins
      expect(s.status).toBe("replied"); // active state preserved
      expect(s.owner_user_id).toBe(user.id);
      expect(s.next_action_at).not.toBeNull();
      expect(s.research_dossier).toBe("old dossier"); // backfilled from dup
      // Earliest membership age preserved.
      expect(new Date(s.created_at).getTime()).toBeLessThan(Date.now() - 9 * 86400_000);

      const { rows: touches } = await client.query(
        "SELECT prospect_id FROM outreach_touches WHERE campaign_id = $1",
        [camp.id],
      );
      expect(touches).toHaveLength(2);
      expect(touches.every((t) => t.prospect_id === newer.id)).toBe(true); // repointed
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("no-email contacts are not blocked by the partial unique index", async () => {
    const { ensureContactForPerson } = await import("../prospect-contact-service");

    const one = await ensureContactForPerson(TENANT, { name: "No Email One" });
    const two = await ensureContactForPerson(TENANT, { name: "No Email Two" });
    expect(one.created).toBe(true);
    expect(two.created).toBe(true);
    expect(one.contactId).not.toBe(two.contactId);
  });
});
