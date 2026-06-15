/**
 * Sales Navigator discovery backend (not yet enabled).
 *
 * LinkedIn Sales Navigator people-search has no public REST API; it would
 * be reached through the LinkedIn MCP server. This backend is gated until
 * Sales Navigator is provisioned — `searchSalesNavigator` throws
 * `not_available` so the discovery service falls back to the free web backend.
 */

import { isLinkedInMcpConfigured } from "./linkedin-provider";
import type { DiscoveryCandidate, DiscoverySearchInput } from "./discovery-provider-core";

export class SalesNavDiscoveryError extends Error {
  constructor(message: string, readonly code: "not_available" | "mcp_error") {
    super(message);
    this.name = "SalesNavDiscoveryError";
  }
}

/** Whether Sales Navigator discovery can run. Requires both MCP and a SalesNav subscription. */
export function isSalesNavigatorAvailable(): boolean {
  // Sales Navigator not yet provisioned — keep as false until enabled.
  return false;
}

/** Human-readable note for the UI when Sales Navigator is unavailable. */
export function salesNavigatorReason(): string {
  return "Sales Navigator isn't enabled yet — using free web discovery instead.";
}

/**
 * Search Sales Navigator for ICP-matching people.
 * Throws `not_available` until Sales Navigator is provisioned.
 */
export async function searchSalesNavigator(
  _tenantDomain: string,
  _input: DiscoverySearchInput,
): Promise<DiscoveryCandidate[]> {
  throw new SalesNavDiscoveryError(salesNavigatorReason(), "not_available");
}
