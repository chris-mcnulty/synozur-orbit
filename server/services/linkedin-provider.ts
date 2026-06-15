/**
 * LinkedIn provider (live backends).
 *
 * Resolves the flexible LinkedIn seam (see `linkedin-provider-core.ts`):
 *   - MCP backend: posting to org pages / personal profiles via the
 *     mcpbundles LinkedIn MCP server. This is the active path while the
 *     shared OAuth app is pending LinkedIn's review.
 *   - Direct OAuth: the already-built UGC publisher (gated behind
 *     LINKEDIN_DIRECT_PUBLISH_ENABLED; preferred once LinkedIn approves).
 *
 * 1:1 LinkedIn messaging is NOT available via any LinkedIn API tier supported
 * here — the Member Social API does not expose direct messaging to third parties.
 */

import { isLinkedInDirectPublishEnabled } from "./platform-credentials-service";
import { selectLinkedInCapabilities, type LinkedInCapabilities } from "./linkedin-provider-core";

export class LinkedInProviderError extends Error {
  constructor(message: string, readonly code: "not_available" | "mcp_error") {
    super(message);
    this.name = "LinkedInProviderError";
  }
}

/** Whether a LinkedIn MCP server URL + API key are both configured. */
export function isLinkedInMcpConfigured(): boolean {
  return !!(process.env.LINKEDIN_MCP_URL?.trim() && process.env.LINKEDIN_MCP_API_KEY?.trim());
}

/** Current LinkedIn capabilities (which backend serves posting). */
export function getLinkedInCapabilities(): LinkedInCapabilities {
  return selectLinkedInCapabilities({
    directPublishEnabled: isLinkedInDirectPublishEnabled(),
    mcpConfigured: isLinkedInMcpConfigured(),
  });
}

export interface SendMessageResult {
  threadRef: string;
}

/**
 * 1:1 LinkedIn messaging is not available via the LinkedIn API.
 * This function always throws `not_available` so callers can fall back to
 * copy-assist (manual send). Kept as a named export so existing call sites
 * compile without changes.
 */
export async function sendLinkedInMessage(
  _tenantDomain: string,
  _opts: { recipientUrl: string; body: string },
): Promise<SendMessageResult> {
  throw new LinkedInProviderError(
    "LinkedIn 1:1 messaging isn't available via the LinkedIn API — compose the message and send it manually from LinkedIn.",
    "not_available",
  );
}
