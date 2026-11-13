import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { marketingContacts, outreachCampaigns, prospects } from "@shared/schema";
import { applyCampaignClassification } from "@shared/campaign-classification";
import { newProspectMetadataSchema } from "@shared/outreach-campaign-workspace";
import { ClassificationError } from "./campaign-classification-service";
import { updateContactPersonFields, type ContactPersonPatch } from "./prospect-contact-service";
import { messagingGroupPatch } from "./messaging-group-patch";

/** One reviewed edit, one transaction: shared identity and campaign-specific settings. */
export async function editCampaignContact(
  tenantDomain: string, marketId: string, prospectId: string, personPatch: ContactPersonPatch, input: unknown,
) {
  const metadata = newProspectMetadataSchema.parse(input);
  await db.transaction(async tx => {
    const [row] = await tx.select().from(prospects).where(and(eq(prospects.id, prospectId), eq(prospects.tenantDomain, tenantDomain))).for("update");
    if (!row || row.removedAt) throw new ClassificationError("Contact not found.", 404);
    const [campaign] = await tx.select().from(outreachCampaigns).where(and(eq(outreachCampaigns.id, row.campaignId), eq(outreachCampaigns.tenantDomain, tenantDomain)));
    if (!campaign || (campaign.marketId && campaign.marketId !== marketId)) throw new ClassificationError("Campaign not found.", 404);
    const [contact] = await tx.select().from(marketingContacts).where(and(eq(marketingContacts.id, row.contactId), eq(marketingContacts.tenantDomain, tenantDomain))).for("update");
    if (!contact) throw new ClassificationError("Contact not found.", 404);
    const settings = {
      ...(metadata.classification ? applyCampaignClassification(row.classification, row.meeting, metadata.classification) : {}),
      ...(metadata.messagingGroup !== undefined ? messagingGroupPatch(metadata.messagingGroup) : {}),
      ...(metadata.familiarity !== undefined ? { familiarity: metadata.familiarity } : {}),
    };
    await updateContactPersonFields(contact.id, personPatch, tx);
    await tx.update(prospects).set({ ...settings, updatedAt: new Date() })
      .where(and(eq(prospects.id, row.id), eq(prospects.tenantDomain, tenantDomain)));
  });
}
