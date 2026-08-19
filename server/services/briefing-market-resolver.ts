import type { CompanyProfile, Market, Tenant } from "@shared/schema";
import { storage, type ContextFilter } from "../storage";

export interface EligibleBriefingMarket {
  market: Market;
  baseline: CompanyProfile;
  context: ContextFilter;
}

/**
 * Resolves the market a background briefing is allowed to use. Legacy jobs have
 * no per-request context, so they may only fall back to the tenant's explicit
 * default market. A missing, archived, foreign, or baseline-less market is not
 * eligible for automated delivery.
 */
export async function resolveEligibleBriefingMarket(
  tenant: Tenant,
  requestedMarketId?: string | null,
): Promise<EligibleBriefingMarket | null> {
  const market = requestedMarketId
    ? await storage.getMarket(requestedMarketId)
    : await storage.getDefaultMarket(tenant.id);

  if (
    !market ||
    market.tenantId !== tenant.id ||
    market.status !== "active"
  ) {
    return null;
  }

  const context: ContextFilter = {
    tenantId: tenant.id,
    tenantDomain: tenant.domain,
    marketId: market.id,
    isDefaultMarket: market.isDefault,
  };
  const baseline = await storage.getCompanyProfileByContext(context);

  if (!baseline) {
    return null;
  }

  return { market, baseline, context };
}