import { randomUUID } from "crypto";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  campaignSocialAccounts,
  campaigns,
  generatedPosts,
  marketingAuditLog,
  socialAccounts,
  type SocialAccount,
} from "@shared/schema";
import { db } from "../db";
import { encryptSecret } from "../utils/encryption";
import type { OAuthCallbackResult } from "./social-publishers";

export const RECOVERABLE_POST_STATUSES = ["draft", "approved", "publish_failed"] as const;
const RECOVERABLE_PREVIOUS_STATUSES = ["inactive", "needs_reconnect"] as const;

type ConnectionFields = Pick<
  SocialAccount,
  | "encryptedAccessToken"
  | "encryptedRefreshToken"
  | "tokenExpiresAt"
  | "tokenScope"
  | "authorMode"
  | "authorUrn"
  | "availableAuthors"
  | "accountId"
  | "accountName"
  | "profileUrl"
  | "connectedAt"
  | "connectedBy"
>;

export function isRecoverablePostStatus(status: string): boolean {
  return (RECOVERABLE_POST_STATUSES as readonly string[]).includes(status);
}

export function isRecoverablePreviousConnectionStatus(status: string): boolean {
  return (RECOVERABLE_PREVIOUS_STATUSES as readonly string[]).includes(status);
}

export function canRestoreFromReplacement(
  account: Pick<SocialAccount, "status" | "encryptedAccessToken">,
): boolean {
  // A token on needs_reconnect has already been rejected by the provider and
  // must not reactivate another record or make queued posts publishable.
  return account.status === "active" && Boolean(account.encryptedAccessToken);
}

export function linkedinIdentityMatches(
  account: Pick<SocialAccount, "accountId" | "authorUrn">,
  oauthResult: Pick<OAuthCallbackResult, "accountId" | "authorUrn">,
): boolean {
  return socialIdentityMatches(account, oauthResult, "linkedin");
}

function providerIdentifiers(
  identity: Pick<SocialAccount, "accountId" | "authorUrn"> | Pick<OAuthCallbackResult, "accountId" | "authorUrn">,
): Set<string> {
  return new Set([identity.accountId, identity.authorUrn]
    .filter((identifier): identifier is string => Boolean(identifier?.trim())));
}

function linkedinOrganizationUrn(
  identity: Pick<SocialAccount, "accountId" | "authorUrn"> | Pick<OAuthCallbackResult, "accountId" | "authorUrn">,
): string | null {
  return [identity.authorUrn, identity.accountId]
    .find(identifier => identifier?.startsWith("urn:li:organization:")) ?? null;
}

export function socialIdentityMatches(
  account: Pick<SocialAccount, "accountId" | "authorUrn">,
  oauthResult: Pick<OAuthCallbackResult, "accountId" | "authorUrn">,
  platform?: string,
): boolean {
  if (platform === "linkedin") {
    // Different LinkedIn pages can share the same human administrator. An
    // organization URN, whether stored in accountId or authorUrn by an older
    // row, is authoritative and must match on both sides.
    const accountOrganization = linkedinOrganizationUrn(account);
    const oauthOrganization = linkedinOrganizationUrn(oauthResult);
    if (accountOrganization || oauthOrganization) {
      return Boolean(
        accountOrganization &&
        oauthOrganization &&
        accountOrganization === oauthOrganization,
      );
    }
    if (account.authorUrn || oauthResult.authorUrn) {
      return Boolean(
        account.authorUrn &&
        oauthResult.authorUrn &&
        account.authorUrn === oauthResult.authorUrn,
      );
    }
  }
  const accountIdentifiers = providerIdentifiers(account);
  const oauthIdentifiers = providerIdentifiers(oauthResult);
  if (!accountIdentifiers.size || !oauthIdentifiers.size) return false;
  return [...oauthIdentifiers].some(identifier => accountIdentifiers.has(identifier));
}

export function alignOAuthResultToExistingIdentity(
  account: Pick<
    SocialAccount,
    "platform" | "accountId" | "authorUrn" | "authorMode" | "connectedAt"
  >,
  result: OAuthCallbackResult,
): OAuthCallbackResult {
  let aligned = result;

  if (account.platform === "linkedin" && account.authorUrn) {
    if (result.authorUrn !== account.authorUrn) {
      const priorAuthor = result.availableAuthors?.find(author => author.urn === account.authorUrn);
      if (!priorAuthor) {
        throw new Error(
          "This LinkedIn authorization no longer includes the page previously selected for this account. " +
          "Restore page-admin access or connect it as a separate social account.",
        );
      }
      aligned = {
        ...result,
        authorMode: priorAuthor.mode,
        authorUrn: priorAuthor.urn,
        accountName: priorAuthor.name,
      };
    }
  }

  const hasEstablishedIdentity = Boolean(
    account.connectedAt && (account.accountId || account.authorUrn),
  );
  if (
    hasEstablishedIdentity &&
    !socialIdentityMatches(account, aligned, account.platform)
  ) {
    throw new Error(
      "The authorized provider account does not match this existing social account. " +
      "Reconnect the original account or create a separate social account.",
    );
  }

  return aligned;
}

export function chooseCanonicalSocialConnection<T extends Pick<SocialAccount, "id" | "createdAt">>(
  accounts: T[],
): T {
  if (!accounts.length) throw new Error("At least one social account is required.");
  return [...accounts].sort((a, b) => {
    const createdDelta = a.createdAt.getTime() - b.createdAt.getTime();
    return createdDelta || a.id.localeCompare(b.id);
  })[0];
}

export function mergedAutoPublish(previous: boolean, replacement: boolean): boolean {
  // A user may have re-enabled auto-publish on the newly-created row before
  // restoring it. Keep either explicit enablement while reattaching the link.
  return previous || replacement;
}

/**
 * Scheduler configuration is unrelated to provider identity. During a safe
 * account consolidation, retain the canonical account's deliberate value; if
 * it has none, carry forward the replacement's configured SocialPilot ID.
 * This must never participate in identity matching or canonical selection.
 */
export function preservedSocialPilotAccountId(
  canonicalId: string | null | undefined,
  replacementId: string | null | undefined,
): string | null {
  return canonicalId?.trim() || replacementId?.trim() || null;
}

function sameMarketCondition(account: Pick<SocialAccount, "marketId">) {
  return account.marketId
    ? eq(socialAccounts.marketId, account.marketId)
    : isNull(socialAccounts.marketId);
}

function oauthConnectionFields(
  result: OAuthCallbackResult,
  connectedBy: string,
  fallback: Pick<SocialAccount, "accountId" | "accountName" | "profileUrl">,
): ConnectionFields {
  return {
    encryptedAccessToken: encryptSecret(result.accessToken),
    encryptedRefreshToken: result.refreshToken ? encryptSecret(result.refreshToken) : null,
    tokenExpiresAt: result.expiresAt ?? null,
    tokenScope: result.scope ?? null,
    authorMode: result.authorMode,
    authorUrn: result.authorUrn,
    availableAuthors: result.availableAuthors ?? null,
    accountId: result.accountId ?? fallback.accountId,
    accountName: result.accountName ?? fallback.accountName,
    profileUrl: result.profileUrl ?? fallback.profileUrl,
    connectedAt: new Date(),
    connectedBy,
  };
}

function copiedConnectionFields(replacement: SocialAccount, connectedBy: string): ConnectionFields {
  return {
    encryptedAccessToken: replacement.encryptedAccessToken,
    encryptedRefreshToken: replacement.encryptedRefreshToken,
    tokenExpiresAt: replacement.tokenExpiresAt,
    tokenScope: replacement.tokenScope,
    authorMode: replacement.authorMode,
    authorUrn: replacement.authorUrn,
    availableAuthors: replacement.availableAuthors,
    accountId: replacement.accountId,
    accountName: replacement.accountName,
    profileUrl: replacement.profileUrl,
    connectedAt: replacement.connectedAt ?? new Date(),
    connectedBy,
  };
}

export async function findSafePreviousLinkedInConnection(
  replacement: SocialAccount,
  result: OAuthCallbackResult,
): Promise<SocialAccount | null> {
  if (replacement.platform !== "linkedin") return null;
  if (!result.accountId && !result.authorUrn) return null;

  const possiblePrevious = await db.select().from(socialAccounts).where(and(
    eq(socialAccounts.tenantDomain, replacement.tenantDomain),
    eq(socialAccounts.platform, replacement.platform),
    sameMarketCondition(replacement),
    inArray(socialAccounts.status, [...RECOVERABLE_PREVIOUS_STATUSES]),
  ));
  const matches = possiblePrevious.filter(account =>
    account.id !== replacement.id && linkedinIdentityMatches(account, result),
  );
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Collapse every Orbit row that represents the same provider identity into one
 * canonical connection. Provider IDs/URNs are the proof of sameness; display
 * names and row age are never used to decide whether records may be merged.
 *
 * Published/exported history remains attached to the row that performed it.
 * Pending posts and campaign settings move to the canonical row so future
 * delete/recreate/reconnect cycles cannot strand work or multiply choices.
 */
export async function consolidateDuplicateConnectionsFromOAuth(
  replacement: SocialAccount,
  result: OAuthCallbackResult,
  recoveredBy: string,
) {
  if (!result.accountId && !result.authorUrn) return null;

  const possibleDuplicates = await db.select().from(socialAccounts).where(and(
    eq(socialAccounts.tenantDomain, replacement.tenantDomain),
    eq(socialAccounts.platform, replacement.platform),
    sameMarketCondition(replacement),
    inArray(socialAccounts.status, ["active", ...RECOVERABLE_PREVIOUS_STATUSES]),
  ));
  const matchingAccounts = possibleDuplicates.filter(account =>
    account.id === replacement.id || socialIdentityMatches(account, result, replacement.platform),
  );
  const uniqueAccounts = [...new Map(
    [replacement, ...matchingAccounts].map(account => [account.id, account]),
  ).values()];
  if (uniqueAccounts.length <= 1) return null;

  const canonical = chooseCanonicalSocialConnection(uniqueAccounts);
  const duplicateIds = uniqueAccounts
    .filter(account => account.id !== canonical.id)
    .map(account => account.id);
  const allIds = [canonical.id, ...duplicateIds];
  const connection = oauthConnectionFields(result, recoveredBy, replacement);

  return db.transaction(async (tx) => {
    // Claim every row using the status observed before the transaction. If an
    // overlapping callback already consolidated the identity, at least one
    // conditional claim fails and this transaction exits without moving data
    // or overwriting the winning callback's fresh credentials.
    for (const account of uniqueAccounts) {
      const [claimed] = await tx.update(socialAccounts).set({
        status: "recovering",
        updatedAt: new Date(),
      }).where(and(
        eq(socialAccounts.id, account.id),
        eq(socialAccounts.tenantDomain, replacement.tenantDomain),
        eq(socialAccounts.status, account.status),
      )).returning({ id: socialAccounts.id });
      if (!claimed) {
        throw new Error("This provider identity was already consolidated by another authorization.");
      }
    }

    // campaign_social_accounts has no tenant column, so join through campaigns
    // before consolidating links to preserve the tenant boundary.
    const links = (await tx.select({ link: campaignSocialAccounts })
      .from(campaignSocialAccounts)
      .innerJoin(campaigns, eq(campaigns.id, campaignSocialAccounts.campaignId))
      .where(and(
        inArray(campaignSocialAccounts.socialAccountId, allIds),
        eq(campaigns.tenantDomain, replacement.tenantDomain),
      ))).map(row => row.link);

    const linksByCampaign = new Map<string, typeof links>();
    for (const link of links) {
      const campaignLinks = linksByCampaign.get(link.campaignId) ?? [];
      campaignLinks.push(link);
      linksByCampaign.set(link.campaignId, campaignLinks);
    }

    for (const [campaignId, campaignLinks] of linksByCampaign) {
      const canonicalLink = campaignLinks.find(link => link.socialAccountId === canonical.id);
      const autoPublish = campaignLinks.some(link => Boolean(link.autoPublish));
      if (canonicalLink) {
        if (Boolean(canonicalLink.autoPublish) !== autoPublish) {
          await tx.update(campaignSocialAccounts)
            .set({ autoPublish })
            .where(eq(campaignSocialAccounts.id, canonicalLink.id));
        }
      } else {
        await tx.insert(campaignSocialAccounts).values({
          id: randomUUID(),
          campaignId,
          socialAccountId: canonical.id,
          autoPublish,
        }).onConflictDoNothing();
      }
    }

    const duplicateLinkIds = links
      .filter(link => link.socialAccountId !== canonical.id)
      .map(link => link.id);
    if (duplicateLinkIds.length) {
      await tx.delete(campaignSocialAccounts)
        .where(inArray(campaignSocialAccounts.id, duplicateLinkIds));
    }

    const movedPosts = await tx.update(generatedPosts)
      .set({ socialAccountId: canonical.id, updatedAt: new Date() })
      .where(and(
        eq(generatedPosts.tenantDomain, replacement.tenantDomain),
        inArray(generatedPosts.socialAccountId, duplicateIds),
        inArray(generatedPosts.status, [...RECOVERABLE_POST_STATUSES]),
      ))
      .returning({ id: generatedPosts.id });

    await tx.update(socialAccounts).set({
      ...connection,
      socialPilotAccountId: uniqueAccounts
        .map(account => account.id === canonical.id ? account.socialPilotAccountId : null)
        .concat(uniqueAccounts.filter(account => account.id !== canonical.id).map(account => account.socialPilotAccountId))
        .reduce((savedId, candidateId) => preservedSocialPilotAccountId(savedId, candidateId), null),
      status: "active",
      lastPublishError: null,
      updatedAt: new Date(),
    }).where(and(
      eq(socialAccounts.id, canonical.id),
      eq(socialAccounts.tenantDomain, replacement.tenantDomain),
    ));

    await tx.update(socialAccounts).set({
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      tokenExpiresAt: null,
      tokenScope: null,
      status: "inactive",
      lastPublishError: "Duplicate provider identity consolidated into the active account.",
      updatedAt: new Date(),
    }).where(and(
      inArray(socialAccounts.id, duplicateIds),
      eq(socialAccounts.tenantDomain, replacement.tenantDomain),
    ));

    await tx.insert(marketingAuditLog).values({
      tenantDomain: replacement.tenantDomain,
      marketId: replacement.marketId ?? null,
      userId: recoveredBy,
      action: "social_connection_recovered",
      entityType: "social_account",
      entityId: canonical.id,
      status: "ok",
      message: `Consolidated ${replacement.platform} records for one provider identity.`,
      details: {
        duplicateAccountIds: duplicateIds,
        movedPendingPosts: movedPosts.length,
        mergedCampaignLinks: duplicateLinkIds.length,
      },
    });

    return {
      recoveredAccountId: canonical.id,
      movedPendingPosts: movedPosts.length,
      mergedCampaignLinks: duplicateLinkIds.length,
      duplicateAccountsMerged: duplicateIds.length,
    };
  });
}

async function restorePreviousConnection(
  previous: SocialAccount,
  replacement: SocialAccount,
  connection: ConnectionFields,
  recoveredBy: string,
  hasFreshOAuthCredential = false,
) {
  if (
    previous.id === replacement.id ||
    previous.tenantDomain !== replacement.tenantDomain ||
    previous.marketId !== replacement.marketId ||
    previous.platform !== replacement.platform
  ) {
    throw new Error("The selected social accounts cannot be recovered together.");
  }
  if (!isRecoverablePreviousConnectionStatus(previous.status)) {
    throw new Error("The previous social account must be inactive or require reconnection.");
  }

  return db.transaction(async (tx) => {
    // Claim the replacement and previous rows inside the transaction. The
    // conditional updates serialize simultaneous recovery attempts: once one
    // transaction claims the replacement, another tab or OAuth callback sees
    // it as inactive and exits before it can move any posts or campaign links.
    const [claimedReplacement] = await tx.update(socialAccounts).set({
      status: "inactive",
      updatedAt: new Date(),
    }).where(and(
      eq(socialAccounts.id, replacement.id),
      eq(socialAccounts.tenantDomain, replacement.tenantDomain),
      eq(socialAccounts.platform, replacement.platform),
      sameMarketCondition(replacement),
      eq(socialAccounts.status, "active"),
      hasFreshOAuthCredential ? undefined : isNotNull(socialAccounts.encryptedAccessToken),
    )).returning();
    if (!claimedReplacement) {
      throw new Error("This replacement connection is already being restored or is no longer connected.");
    }

    const [claimedPrevious] = await tx.update(socialAccounts).set({
      // Temporary state is never visible outside this transaction, but makes
      // the claim durable so a different replacement cannot revive this same
      // prior record in a concurrent transaction.
      status: "recovering",
      updatedAt: new Date(),
    }).where(and(
      eq(socialAccounts.id, previous.id),
      eq(socialAccounts.tenantDomain, previous.tenantDomain),
      eq(socialAccounts.platform, previous.platform),
      sameMarketCondition(previous),
      inArray(socialAccounts.status, [...RECOVERABLE_PREVIOUS_STATUSES]),
    )).returning({ id: socialAccounts.id });
    if (!claimedPrevious) {
      throw new Error("This previous connection is already being restored or is no longer recoverable.");
    }

    // campaign_social_accounts does not have its own tenant column. Join back
    // to campaigns so a malformed legacy link cannot cross a workspace boundary.
    const previousLinks = (await tx.select({ link: campaignSocialAccounts })
      .from(campaignSocialAccounts)
      .innerJoin(campaigns, eq(campaigns.id, campaignSocialAccounts.campaignId))
      .where(and(
        eq(campaignSocialAccounts.socialAccountId, previous.id),
        eq(campaigns.tenantDomain, previous.tenantDomain),
      ))).map(row => row.link);
    const replacementLinks = (await tx.select({ link: campaignSocialAccounts })
      .from(campaignSocialAccounts)
      .innerJoin(campaigns, eq(campaigns.id, campaignSocialAccounts.campaignId))
      .where(and(
        eq(campaignSocialAccounts.socialAccountId, replacement.id),
        eq(campaigns.tenantDomain, previous.tenantDomain),
      ))).map(row => row.link);
    const previousLinksByCampaign = new Map(previousLinks.map(link => [link.campaignId, link]));

    for (const replacementLink of replacementLinks) {
      const existing = previousLinksByCampaign.get(replacementLink.campaignId);
      if (existing) {
        const autoPublish = mergedAutoPublish(
          Boolean(existing.autoPublish),
          Boolean(replacementLink.autoPublish),
        );
        if (autoPublish !== Boolean(existing.autoPublish)) {
          await tx.update(campaignSocialAccounts)
            .set({ autoPublish })
            .where(eq(campaignSocialAccounts.id, existing.id));
        }
      } else {
        await tx.insert(campaignSocialAccounts).values({
          id: randomUUID(),
          campaignId: replacementLink.campaignId,
          socialAccountId: previous.id,
          autoPublish: Boolean(replacementLink.autoPublish),
        });
      }
    }

    const replacementLinkIds = replacementLinks.map(link => link.id);
    if (replacementLinkIds.length) {
      await tx.delete(campaignSocialAccounts)
        .where(inArray(campaignSocialAccounts.id, replacementLinkIds));
    }

    const movedPosts = await tx.update(generatedPosts)
      .set({ socialAccountId: previous.id, updatedAt: new Date() })
      .where(and(
        eq(generatedPosts.tenantDomain, previous.tenantDomain),
        eq(generatedPosts.socialAccountId, replacement.id),
        inArray(generatedPosts.status, [...RECOVERABLE_POST_STATUSES]),
      ))
      .returning({ id: generatedPosts.id });

    const connectionToRestore = hasFreshOAuthCredential
      ? connection
      // A normal OAuth reconnect may have completed immediately before this
      // transaction claimed the row. Copy the claimed row's current token,
      // never the pre-transaction snapshot.
      : copiedConnectionFields(claimedReplacement, recoveredBy);
    await tx.update(socialAccounts).set({
      ...connectionToRestore,
      socialPilotAccountId: preservedSocialPilotAccountId(
        previous.socialPilotAccountId,
        replacement.socialPilotAccountId,
      ),
      status: "active",
      lastPublishError: null,
      updatedAt: new Date(),
    }).where(eq(socialAccounts.id, previous.id));

    await tx.update(socialAccounts).set({
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      tokenExpiresAt: null,
      tokenScope: null,
      status: "inactive",
      lastPublishError: "Connection restored to the previous account record.",
      updatedAt: new Date(),
    }).where(eq(socialAccounts.id, replacement.id));

    await tx.insert(marketingAuditLog).values({
      tenantDomain: previous.tenantDomain,
      marketId: previous.marketId ?? null,
      userId: recoveredBy,
      action: "social_connection_recovered",
      entityType: "social_account",
      entityId: previous.id,
      status: "ok",
      message: `Restored ${previous.platform} connection to its previous account record.`,
      details: {
        replacementAccountId: replacement.id,
        movedPendingPosts: movedPosts.length,
        mergedCampaignLinks: replacementLinks.length,
      },
    });

    return {
      recoveredAccountId: previous.id,
      movedPendingPosts: movedPosts.length,
      mergedCampaignLinks: replacementLinks.length,
    };
  });
}

export async function recoverPreviousConnectionFromOAuth(
  replacement: SocialAccount,
  previous: SocialAccount,
  result: OAuthCallbackResult,
  recoveredBy: string,
) {
  return restorePreviousConnection(
    previous,
    replacement,
    oauthConnectionFields(result, recoveredBy, replacement),
    recoveredBy,
    true,
  );
}

export async function recoverPreviousConnectionManually(
  replacement: SocialAccount,
  previous: SocialAccount,
  recoveredBy: string,
) {
  if (!canRestoreFromReplacement(replacement)) {
    throw new Error("Reconnect the replacement account successfully before restoring the previous connection.");
  }
  return restorePreviousConnection(
    previous,
    replacement,
    copiedConnectionFields(replacement, recoveredBy),
    recoveredBy,
  );
}