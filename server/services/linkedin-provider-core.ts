/**
 * LinkedIn provider — pure backend selector.
 *
 * One seam over two interchangeable backends:
 *   - MCP (mcpbundles LinkedIn server) — supports POSTING to org pages and
 *     personal profiles. 1:1 messaging is NOT available via any LinkedIn API.
 *   - direct OAuth (the already-built UGC publisher; gated pending LinkedIn
 *     app review) — also supports posting; preferred once approved because it
 *     lets tenants connect their own accounts rather than using the shared MCP
 *     credential.
 *
 * Pure, so it is unit-testable; the live backends live in
 * `linkedin-provider.ts` (capability query) and
 * `social-publishers/linkedin.ts` (actual publish call).
 */

export type LinkedInBackend = "direct_oauth" | "mcp" | "none";

export interface LinkedInCapabilities {
  /** Backend chosen for posting (marketing direct-publish + outreach posts). */
  postBackend: LinkedInBackend;
  /**
   * Messaging is NOT available via the LinkedIn API — always "none".
   * Kept in the interface so callers can surface a consistent reason string
   * instead of each building their own message.
   */
  messageBackend: "none";
  canPost: boolean;
  canMessage: false;
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
 * Decide which backend serves posting. Direct OAuth is preferred once
 * approved (lets tenants connect their own accounts). MCP is the interim
 * path while the app is under review. Messaging is never available — the
 * LinkedIn Member Social API does not expose 1:1 messaging to third parties.
 */
export function selectLinkedInCapabilities(flags: LinkedInFlags): LinkedInCapabilities {
  const postBackend: LinkedInBackend = flags.directPublishEnabled
    ? "direct_oauth"
    : flags.mcpConfigured
      ? "mcp"
      : "none";

  const canPost = postBackend !== "none";

  let reason: string;
  if (flags.directPublishEnabled) {
    reason = "LinkedIn posting available via direct OAuth.";
  } else if (flags.mcpConfigured) {
    reason = "LinkedIn posting available via MCP.";
  } else {
    reason = "LinkedIn isn't connected yet — generating copy to paste manually.";
  }

  return {
    postBackend,
    messageBackend: "none",
    canPost,
    canMessage: false,
    reason,
  };
}
