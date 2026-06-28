import { crawlDb } from "../db";
import { withRetry } from "../storage";
import { competitors, organizations, companyProfiles } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { Competitor, Organization, CompanyProfile, InsertOrganization } from "@shared/schema";

// Thin wrappers around the crawl-specific pool for the DB writes that happen
// inside background crawl job callbacks.  Complex operations that have
// non-trivial business logic (incrementCrawlFailures, createActivity,
// updateCompetitorAnalysis) are left on storage.* which uses the primary pool
// — they are rare and hold connections for only a few milliseconds.

export const crawlOps = {
  async updateCompetitor(id: string, data: Partial<Competitor>): Promise<Competitor> {
    return withRetry(async () => {
      const [c] = await crawlDb.update(competitors).set(data).where(eq(competitors.id, id)).returning();
      return c;
    });
  },

  async updateCompetitorLastCrawl(id: string, lastCrawl: string): Promise<void> {
    return withRetry(async () => {
      await crawlDb.update(competitors).set({ lastCrawl }).where(eq(competitors.id, id));
    });
  },

  async resetCompetitorCrawlFailures(id: string): Promise<Competitor> {
    return withRetry(async () => {
      const [c] = await crawlDb
        .update(competitors)
        .set({ consecutiveCrawlFailures: 0, crawlFlaggedAt: null })
        .where(eq(competitors.id, id))
        .returning();
      return c;
    });
  },

  async getOrganization(id: string): Promise<Organization | undefined> {
    const [org] = await crawlDb.select().from(organizations).where(eq(organizations.id, id));
    return org;
  },

  async getCompetitorsByOrganizationId(organizationId: string): Promise<Competitor[]> {
    return crawlDb.select().from(competitors).where(eq(competitors.organizationId, organizationId));
  },

  async updateOrganization(id: string, data: Partial<InsertOrganization>): Promise<Organization> {
    return withRetry(async () => {
      const [org] = await crawlDb
        .update(organizations)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(organizations.id, id))
        .returning();
      return org;
    });
  },

  async updateCompanyProfile(id: string, data: Partial<CompanyProfile>): Promise<CompanyProfile> {
    return withRetry(async () => {
      const [profile] = await crawlDb
        .update(companyProfiles)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(companyProfiles.id, id))
        .returning();
      return profile;
    });
  },
};
