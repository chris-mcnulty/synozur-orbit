/**
 * Sales Outreach Readiness
 *
 * Reports how ready a tenant — and the current seller — is to run outreach:
 * ICP personas, messaging framework, products, objection material, an outbound
 * voice, a connected CRM, and the seller's own mailbox. Mirrors the marketing
 * readiness loader; pure scoring lives in `sales-outreach-readiness-core.ts`.
 */

import { storage, type ContextFilter } from "../storage";
import { db } from "../db";
import { socialAccountVoiceProfiles } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { deriveSalesReadiness } from "./sales-outreach-readiness-core";

export {
  deriveSalesReadiness,
  type SalesReadinessInputs,
} from "./sales-outreach-readiness-core";
export {
  type ReadinessStatus,
  type ReadinessItem,
  type ReadinessReport,
} from "./marketing-context-readiness-core";

/**
 * Loads the raw signals for a tenant+market (and the current seller) and
 * returns a readiness report. Each signal loads independently; a failed load
 * degrades to "absent" so the report never throws.
 */
export async function assessSalesOutreachReadiness(
  tenantDomain: string,
  userId?: string,
  marketId?: string,
  isDefaultMarket?: boolean,
) {
  const tenant = await storage.getTenantByDomain(tenantDomain);
  const tenantId = tenant?.id || "";
  const resolvedIsDefaultMarket =
    typeof isDefaultMarket === "boolean" ? isDefaultMarket : !marketId;
  const ctx: ContextFilter = {
    tenantId,
    tenantDomain,
    marketId: marketId || "",
    isDefaultMarket: resolvedIsDefaultMarket,
  };

  const companyProfile = await storage.getCompanyProfileByContext(ctx);

  const [
    personasR,
    productsR,
    battlecardsR,
    messagingR,
    voiceProfilesR,
    hubspotR,
    userR,
    personalVoiceR,
  ] = await Promise.allSettled([
    storage.getPersonasByContext(ctx),
    storage.getProductsByContext(ctx),
    storage.getBattlecardsByContext(ctx),
    companyProfile
      ? storage.getLongFormRecommendationByType("messaging_framework", undefined, companyProfile.id)
      : Promise.resolve(undefined),
    db
      .select({ id: socialAccountVoiceProfiles.id })
      .from(socialAccountVoiceProfiles)
      .where(eq(socialAccountVoiceProfiles.tenantDomain, tenantDomain)),
    storage.getHubspotConnection(tenantDomain),
    userId ? storage.getUser(userId) : Promise.resolve(undefined),
    userId
      ? db
          .select({ id: socialAccountVoiceProfiles.id })
          .from(socialAccountVoiceProfiles)
          .where(and(eq(socialAccountVoiceProfiles.ownerUserId, userId), isNull(socialAccountVoiceProfiles.socialAccountId)))
      : Promise.resolve([]),
  ]);

  const personas = personasR.status === "fulfilled" ? personasR.value : [];
  const products = productsR.status === "fulfilled" ? productsR.value : [];
  const battlecards = battlecardsR.status === "fulfilled" ? battlecardsR.value : [];
  const messaging = messagingR.status === "fulfilled" ? messagingR.value : undefined;
  const voiceProfiles = voiceProfilesR.status === "fulfilled" ? voiceProfilesR.value : [];
  const hubspot = hubspotR.status === "fulfilled" ? hubspotR.value : undefined;
  const user = userR.status === "fulfilled" ? userR.value : undefined;
  const personalVoice = personalVoiceR.status === "fulfilled" ? personalVoiceR.value : [];

  const isGenerated = (rec: any) => Boolean(rec && rec.status === "generated" && rec.content);

  const hasObjections = (bc: any): boolean => {
    const o = bc?.objections;
    return Array.isArray(o) ? o.length > 0 : Boolean(o);
  };

  const graphScopes = (user?.graphScopes || "").toLowerCase();
  const mailboxConnected = Boolean(user?.graphAccessToken);
  const mailboxCanDraft = mailboxConnected && graphScopes.includes("mail.");

  return deriveSalesReadiness({
    personaCount: personas.length,
    icpPersonaCount: personas.filter((p: any) => p.isIcp).length,
    messagingFrameworkGenerated: isGenerated(messaging),
    productCount: products.length,
    battlecardWithObjectionsCount: battlecards.filter(hasObjections).length,
    voiceProfileCount: voiceProfiles.length,
    hasPersonalVoiceProfile: personalVoice.length > 0,
    hubspotConnected: Boolean(hubspot),
    mailboxConnected,
    mailboxCanDraft,
  });
}
