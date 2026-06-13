/**
 * LinkedIn provider — pure backend selector.
 *
 * One seam over two interchangeable backends (see plan §5.2a):
 *   - direct OAuth (the already-built UGC publisher; gated pending LinkedIn app
 *     review) — supports POSTING.
 *   - MCP (works now once the LinkedIn MCP server is connected) — supports
 *     posting AND 1:1 MESSAGING (which the member OAuth API does not expose).
 *
 * Selection prefers direct OAuth for posting once approved, and always routes
 * messaging through MCP. Pure, so it is unit-testable; the live backends live
 * in `linkedin/provider.ts`.
 */

export type LinkedInBackend = "direct_oauth" | "mcp" | "none";

export interface LinkedInCapabilities {
  /** Backend chosen for posting (marketing direct-publish + outreach posts). */
  postBackend: LinkedInBackend;
  /** Backend chosen for 1:1 messaging (outreach). MCP-only. */
  messageBackend: LinkedInBackend;
  canPost: boolean;
  canMessage: boolean;
  /** Human-readable note for the UI when a capability is unavailable. */
  reason: string;
}

export interface LinkedInFlags {
  /** LinkedIn's shared OAuth app is approved + enabled for direct publishing. */
  directPublishEnabled: boolean;
  /** A LinkedIn MCP server is connected/configured for this server. */
  mcpConfigured: boolean;
}

/**
 * Decide which backend serves posting and messaging. Direct OAuth is preferred
 * for posting once approved (no MCP dependency); messaging is always MCP because
 * the member OAuth API can't send 1:1 messages.
 */
export function selectLinkedInCapabilities(flags: LinkedInFlags): LinkedInCapabilities {
  const postBackend: LinkedInBackend = flags.directPublishEnabled
    ? "direct_oauth"
    : flags.mcpConfigured
      ? "mcp"
      : "none";
  const messageBackend: LinkedInBackend = flags.mcpConfigured ? "mcp" : "none";

  const canPost = postBackend !== "none";
  const canMessage = messageBackend !== "none";

  let reason: string;
  if (canMessage) {
    reason = "LinkedIn messaging available via MCP.";
  } else if (flags.directPublishEnabled) {
    reason = "Direct LinkedIn posting is enabled, but 1:1 messaging needs the LinkedIn MCP — using copy-assist for messages.";
  } else if (canPost) {
    reason = "LinkedIn posting available via MCP; messaging not yet — using copy-assist for messages.";
  } else {
    reason = "LinkedIn isn't connected yet — generating copy to paste manually.";
  }

  return { postBackend, messageBackend, canPost, canMessage, reason };
}
