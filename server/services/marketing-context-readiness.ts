/**
 * Marketing Context Readiness
 *
 * Reports how complete a tenant's *intrinsic* marketing data is — the Orbit
 * equivalent of the Cowork `variables.md` (company, ICP, messaging framework /
 * MPF, GTM plan, products, competitors, brand kit). Downstream content-
 * development features (positioning dossier, editorial calendar, copywriter,
 * SEO/AEO) all ground on this data, so a thin field here means generic output.
 *
 * Instead of an onboarding interview, Orbit derives readiness from data that
 * already exists and surfaces fix hints for whatever is missing or thin.
 *
 * The pure scoring logic lives in `marketing-context-readiness-core.ts` so it
 * can be unit-tested without a database.
 */

import { storage, type ContextFilter } from "../storage";
import { db } from "../db";
import { brandAssets, tenantFonts } from "@shared/schema";
import { and, eq, ne } from "drizzle-orm";
import { deriveReadiness } from "./marketing-context-readiness-core";

export {
  deriveReadiness,
  type ReadinessStatus,
  type ReadinessItem,
  type ReadinessReport,
  type ReadinessInputs,
} from "./marketing-context-readiness-core";

const DEFAULT_PRIMARY = "#810FFB";

/**
 * Loads the raw signals for a tenant+market and returns a readiness report.
 * Each signal is loaded independently; a failed load degrades to "absent".
 */
export async function assessMarketingContextReadiness(
  tenantDomain: string,
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
    competitorsR,
    messagingR,
    gtmR,
    logoAssetsR,
    fontsR,
  ] = await Promise.allSettled([
    storage.getPersonasByContext(ctx),
    storage.getProductsByContext(ctx),
    storage.getCompetitorsByContext(ctx),
    companyProfile
      ? storage.getLongFormRecommendationByType("messaging_framework", undefined, companyProfile.id)
      : Promise.resolve(undefined),
    companyProfile
      ? storage.getLongFormRecommendationByType("gtm_plan", undefined, companyProfile.id)
      : Promise.resolve(undefined),
    db
      .select({ id: brandAssets.id })
      .from(brandAssets)
      .where(
        and(
          eq(brandAssets.tenantDomain, ctx.tenantDomain),
          eq(brandAssets.marketId, ctx.marketId),
          eq(brandAssets.assetType, "logo"),
          ne(brandAssets.status, "archived"),
        ),
      ),
    db
      .select({ id: tenantFonts.id })
      .from(tenantFonts)
      .where(eq(tenantFonts.tenantDomain, ctx.tenantDomain)),
  ]);

  const personas = personasR.status === "fulfilled" ? personasR.value : [];
  const products = productsR.status === "fulfilled" ? productsR.value : [];
  const competitors = competitorsR.status === "fulfilled" ? competitorsR.value : [];
  const messaging = messagingR.status === "fulfilled" ? messagingR.value : undefined;
  const gtm = gtmR.status === "fulfilled" ? gtmR.value : undefined;
  const logoAssets = logoAssetsR.status === "fulfilled" ? logoAssetsR.value : [];
  const fonts = fontsR.status === "fulfilled" ? fontsR.value : [];

  const isGenerated = (rec: any) =>
    Boolean(rec && rec.status === "generated" && rec.content);

  const primaryColorCustomised = Boolean(
    tenant?.primaryColor && tenant.primaryColor.toUpperCase() !== DEFAULT_PRIMARY,
  );

  return deriveReadiness({
    hasCompanyProfile: Boolean(companyProfile),
    companyHasDescription: Boolean(companyProfile?.description?.trim()),
    personaCount: personas.length,
    icpPersonaCount: personas.filter((p: any) => p.isIcp).length,
    messagingFrameworkGenerated: isGenerated(messaging),
    gtmPlanGenerated: isGenerated(gtm),
    productCount: products.length,
    competitorCount: competitors.length,
    brand: {
      primaryColorCustomised,
      hasLogo: Boolean(tenant?.logoUrl) || logoAssets.length > 0,
      fontCount: fonts.length,
    },
  });
}
