/**
 * LinkedIn provider (live backends).
 *
 * Resolves the flexible LinkedIn seam (see `linkedin-provider-core.ts`): an
 * MCP backend (messaging + posting, via the mcpbundles LinkedIn MCP server)
 * and the already-built direct-OAuth publisher (posting, gated pending
 * LinkedIn app review). Outreach 1:1 messaging always routes through MCP.
 */

import { isLinkedInDirectPublishEnabled } from "./platform-credentials-service";
import { selectLinkedInCapabilities, type LinkedInCapabilities } from "./linkedin-provider-core";
import { callLinkedInTool, findTool, extractText } from "./linkedin-mcp-client";

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
 * Send a 1:1 LinkedIn message via the MCP backend. Throws `not_available`
 * when no MCP server is connected so the caller can fall back to copy-assist.
 */
export async function sendLinkedInMessage(
  _tenantDomain: string,
  opts: { recipientUrl: string; body: string },
): Promise<SendMessageResult> {
  const caps = getLinkedInCapabilities();
  if (caps.messageBackend !== "mcp") {
    throw new LinkedInProviderError(caps.reason, "not_available");
  }

  // Discover the send-message tool (handles minor naming variations across versions).
  const toolName = await findTool("send_message", "message");
  if (!toolName) {
    throw new LinkedInProviderError(
      "LinkedIn MCP server is connected but no messaging tool was found. Check mcpbundles tool list.",
      "mcp_error",
    );
  }

  try {
    const result = await callLinkedInTool(toolName, {
      profile_url: opts.recipientUrl,
      message: opts.body,
    });
    // Extract a thread reference from the text response if provided.
    const text = extractText(result);
    const threadRef = text.match(/thread[_-]?id[:\s]+([^\s,]+)/i)?.[1] ?? `mcp-${Date.now()}`;
    return { threadRef };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new LinkedInProviderError(`LinkedIn MCP send failed: ${msg}`, "mcp_error");
  }
}
