import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { outreachCampaigns, prospects, marketingContacts, personas } from "@shared/schema";
import { effectiveScoringFacts, rescoreRequestSchema } from "@shared/prospect-scoring";
import { emptyCampaignClassification } from "@shared/campaign-classification";
import { ClassificationError } from "./campaign-classification-service";
import { scoreProspectAgainstAll } from "./prospector-core";

export async function rescoreCampaignProspect(tenant: string, market: string, campaignId: string, prospectId: string, input: unknown) {
  const { facts } = rescoreRequestSchema.parse(input);
  return db.transaction(async tx => {
    const [campaign] = await tx.select().from(outreachCampaigns).where(and(eq(outreachCampaigns.id, campaignId), eq(outreachCampaigns.tenantDomain, tenant)));
    if (!campaign || (campaign.marketId && campaign.marketId !== market)) throw new ClassificationError("Campaign not found", 404);
    const [person] = await tx.select().from(prospects).where(and(eq(prospects.id, prospectId), eq(prospects.campaignId, campaignId), eq(prospects.tenantDomain, tenant))).for("update");
    if (!person || (person.marketId && person.marketId !== market)) throw new ClassificationError("Contact not found", 404);
    const [contact] = await tx.select().from(marketingContacts).where(and(eq(marketingContacts.id, person.contactId), eq(marketingContacts.tenantDomain, tenant)));
    if (!contact) throw new ClassificationError("Contact not found", 404);
    const targets = campaign.targetPersonaIds?.length ? await tx.select().from(personas).where(and(eq(personas.tenantDomain, tenant), inArray(personas.id, campaign.targetPersonaIds))) : [];
    const classification = facts ? { ...emptyCampaignClassification(), ...person.classification, scoringFacts: facts } : person.classification;
    const scored = scoreProspectAgainstAll(targets, campaign.targetingFilter ?? undefined, {
      ...effectiveScoringFacts({ title: contact.jobTitle, signals: person.signals, classification }),
      companyName: contact.company, email: contact.email, linkedinUrl: contact.linkedinUrl,
    });
    const breakdown = { ...scored.breakdown, matchedPersonaName: scored.matchedPersonaName };
    await tx.update(prospects).set({
      ...(facts ? { classification } : {}), icpScore: scored.score, scoreBreakdown: breakdown, updatedAt: new Date(),
    }).where(and(eq(prospects.id, person.id), eq(prospects.tenantDomain, tenant)));
    return { score: scored.score, breakdown, facts: effectiveScoringFacts({ title: contact.jobTitle, signals: person.signals, classification }) };
  });
}
