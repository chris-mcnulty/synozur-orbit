/**
 * Sales Navigator discovery backend (gated).
 *
 * LinkedIn Sales Navigator people-search has no public REST API; the harness
 * reached it through the LinkedIn MCP server. This backend therefore rides the
 * same seam as outreach messaging (`linkedin-provider.ts`): it activates only
 * once a LinkedIn MCP server is connected AND its client is wired. Until then
 * `searchSalesNavigator` throws `not_available` so the discovery service falls
 * back to the free web backend and the UI can show why it's unavailable.
 */

import { isLinkedInMcpConfigured } from "./linkedin-provider";
import type { DiscoveryCandidate, DiscoverySearchInput } from "./discovery-provider-core";

export class SalesNavDiscoveryError extends Error {
  constructor(message: string, readonly code: "not_available" | "mcp_error") {
    super(message);
    this.name = "SalesNavDiscoveryError";
  }
}

/** Whether Sales Navigator discovery can run (needs the LinkedIn MCP backend). */
export function isSalesNavigatorAvailable(): boolean {
  return isLinkedInMcpConfigured();
}

/** Human-readable note for the UI when Sales Navigator is unavailable. */
export function salesNavigatorReason(): string {
  return isSalesNavigatorAvailable()
    ? "Sales Navigator discovery available via the LinkedIn MCP."
    : "Sales Navigator needs the LinkedIn MCP server — using free web discovery instead.";
}

/**
 * Search Sales Navigator for ICP-matching people. Throws `not_available` until
 * the LinkedIn MCP client is wired (mirrors `sendLinkedInMessage`); the
 * integration point is kept explicit so wiring it is a localized change.
 */
export async function searchSalesNavigator(
  _tenantDomain: string,
  _input: DiscoverySearchInput,
): Promise<DiscoveryCandidate[]> {
  if (!isSalesNavigatorAvailable()) {
    throw new SalesNavDiscoveryError(salesNavigatorReason(), "not_available");
  }
  // The MCP people-search call lands when the LinkedIn MCP server is connected.
  // Until then this path is unreachable (isSalesNavigatorAvailable() is false).
  throw new SalesNavDiscoveryError(
    "LinkedIn MCP is configured but the Sales Navigator search client is not yet wired.",
    "mcp_error",
  );
}
