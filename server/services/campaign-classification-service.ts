import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { outreachCampaigns, prospects } from "@shared/schema";
import { applyCampaignClassification, campaignClassificationRequestSchema } from "@shared/campaign-classification";

export class ClassificationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Campaign-membership metadata only: never change the shared person or import source. */
export async function updateCampaignClassification(
  tenantDomain: string, marketId: string, campaignId: string, input: unknown,
) {
  const { prospectIds, patch } = campaignClassificationRequestSchema.parse(input);
  const ids = [...new Set(prospectIds)].sort();
  return db.transaction(async tx => {
    const [campaign] = await tx.select().from(outreachCampaigns).where(and(
      eq(outreachCampaigns.id, campaignId), eq(outreachCampaigns.tenantDomain, tenantDomain),
    ));
    if (!campaign || (campaign.marketId && campaign.marketId !== marketId)) {
      throw new ClassificationError("Campaign not found", 404);
    }
    // Lock the full set before merging JSON so concurrent bulk tag edits don't lose tags.
    const rows = await tx.select().from(prospects).where(and(
      eq(prospects.tenantDomain, tenantDomain), eq(prospects.campaignId, campaignId), inArray(prospects.id, ids),
    )).orderBy(prospects.id).for("update");
    if (rows.length !== ids.length || rows.some(row => row.marketId && row.marketId !== marketId)) {
      throw new ClassificationError("One or more contacts are not in this campaign or market.", 404);
    }
    // Validate every merged record before writing any; transaction also protects failures.
    const updates = rows.map(row => {
      try {
        return { id: row.id, values: applyCampaignClassification(row.classification, row.meeting, patch) };
      } catch (error) {
        throw new ClassificationError(error instanceof Error ? error.message : "Invalid classification");
      }
    });
    for (const update of updates) {
      await tx.update(prospects).set({ ...update.values, updatedAt: new Date() }).where(and(
        eq(prospects.id, update.id), eq(prospects.tenantDomain, tenantDomain), eq(prospects.campaignId, campaignId),
      ));
    }
    return { updated: updates.length };
  });
}
