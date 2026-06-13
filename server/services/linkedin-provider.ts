/**
 * LinkedIn provider (live backends).
 *
 * Resolves the flexible LinkedIn seam (see `linkedin-provider-core.ts`): a new
 * MCP backend (messaging + posting, works once the LinkedIn MCP server is
 * connected) and the already-built direct-OAuth publisher (posting, gated
 * pending LinkedIn app review). Outreach 1:1 messaging routes through MCP;
 * until it's connected, callers fall back to copy-assist.
 */

import { isLinkedInDirectPublishEnabled } from "./platform-credentials-service";
import { selectLinkedInCapabilities, type LinkedInCapabilities } from "./linkedin-provider-core";

export class LinkedInProviderError extends Error {
  constructor(message: string, readonly code: "not_available" | "mcp_error") {
    super(message);
    this.name = "LinkedInProviderError";
  }
}

/** Whether a LinkedIn MCP server is configured for this server. */
export function isLinkedInMcpConfigured(): boolean {
  return !!process.env.LINKEDIN_MCP_URL?.trim();
}

/** Current LinkedIn capabilities (which backend serves posting vs messaging). */
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
 * Send a 1:1 LinkedIn message via the MCP backend. Throws `not_available` when
 * no MCP server is connected so the caller can fall back to copy-assist (the
 * draft stays approved and the seller sends it manually).
 */
export async function sendLinkedInMessage(
  tenantDomain: string,
  opts: { recipientUrl: string; body: string },
): Promise<SendMessageResult> {
  const caps = getLinkedInCapabilities();
  if (caps.messageBackend !== "mcp") {
    throw new LinkedInProviderError(caps.reason, "not_available");
  }
  // MCP backend wiring lands when the LinkedIn MCP server is connected. Until
  // then this path is unreachable (messageBackend is "none"); kept explicit so
  // the integration point is obvious.
  throw new LinkedInProviderError("LinkedIn MCP client is configured but not yet wired.", "mcp_error");
}
