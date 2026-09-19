import { loadGroundingContext } from "./content-extraction";
import {
  formatStrategicContextForPrompt,
  loadStrategicContext,
} from "./strategic-context";

export interface CampaignGenerationSupplementalContext {
  groundingContext: string;
  strategicContext: string;
}

/**
 * Loads factual context outside the campaign itself.
 *
 * Campaign-only generation must return before either loader runs. This makes
 * the UI promise an enforceable data boundary rather than prompt wording alone.
 */
export async function loadCampaignGenerationSupplementalContext(
  tenantDomain: string,
  marketId: string,
  campaignOnly: boolean,
): Promise<CampaignGenerationSupplementalContext> {
  if (campaignOnly) {
    return { groundingContext: "", strategicContext: "" };
  }

  const [groundingContext, strategicContextData] = await Promise.all([
    loadGroundingContext(tenantDomain, marketId),
    loadStrategicContext(tenantDomain, marketId),
  ]);
  return {
    groundingContext,
    strategicContext: formatStrategicContextForPrompt(strategicContextData),
  };
}