import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { campaignSocialAccounts, campaigns, socialAccounts } from "@shared/schema";
import { db } from "../db";

export class CampaignAccountLinkError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 = 400,
  ) {
    super(message);
    this.name = "CampaignAccountLinkError";
  }
}

/**
 * Restore a campaign ↔ account relationship when an operator explicitly uses
 * an eligible account for a campaign post. Repaired links intentionally start
 * with auto-publish off: assigning one post (or sending one manually) must not
 * authorize unrelated campaign posts for automatic delivery.
 */
export async function ensureCampaignSocialAccountLink(input: {
  campaignId: string | null;
  socialAccountId: string;
  tenantDomain: string;
}): Promise<{ repaired: boolean }> {
  if (!input.campaignId) return { repaired: false };

  const [campaign] = await db.select({ id: campaigns.id })
    .from(campaigns)
    .where(and(
      eq(campaigns.id, input.campaignId),
      eq(campaigns.tenantDomain, input.tenantDomain),
    ));
  if (!campaign) {
    throw new CampaignAccountLinkError("Campaign not found", 404);
  }

  const [account] = await db.select({
    id: socialAccounts.id,
    status: socialAccounts.status,
  }).from(socialAccounts)
    .where(and(
      eq(socialAccounts.id, input.socialAccountId),
      eq(socialAccounts.tenantDomain, input.tenantDomain),
    ));
  if (!account) {
    throw new CampaignAccountLinkError("Social account not found", 404);
  }
  if (account.status !== "active") {
    throw new CampaignAccountLinkError(
      "Reconnect this social account before assigning it to a campaign post.",
    );
  }

  const [existing] = await db.select({ id: campaignSocialAccounts.id })
    .from(campaignSocialAccounts)
    .where(and(
      eq(campaignSocialAccounts.campaignId, campaign.id),
      eq(campaignSocialAccounts.socialAccountId, account.id),
    ));
  if (existing) return { repaired: false };

  // The unique campaign/account constraint also makes this safe when two
  // editors repair the same missing relationship at once.
  const inserted = await db.insert(campaignSocialAccounts).values({
    id: randomUUID(),
    campaignId: campaign.id,
    socialAccountId: account.id,
    autoPublish: false,
  }).onConflictDoNothing().returning({ id: campaignSocialAccounts.id });

  return { repaired: inserted.length > 0 };
}