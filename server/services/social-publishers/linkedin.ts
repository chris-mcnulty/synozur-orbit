/**
 * LinkedInPublisher
 *
 * Two posting backends:
 *
 *  1. MCP (mcpbundles LinkedIn server) — active interim path.
 *     Available when LINKEDIN_MCP_URL + LINKEDIN_MCP_API_KEY are set.
 *     Uses linkedin_social_create_post / linkedin_create_image_post / etc.
 *     Author is resolved from account.authorUrn; falls back to discovering
 *     the first managed org via linkedin_list_managed_orgs.
 *
 *  2. Direct OAuth — preferred once LinkedIn approves the shared app.
 *     Uses the UGC Posts REST API with a per-user encrypted access token.
 *     Gated by LINKEDIN_DIRECT_PUBLISH_ENABLED=true.
 *
 * LinkedIn uses a single, Synozur-owned OAuth app (Buffer/Hootsuite pattern):
 * credentials come from LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET env vars.
 * Tenants never register their own app — they just click "Connect LinkedIn".
 */

import type {
  SocialPublisher,
  PublishContext,
  PublishResult,
  OAuthAuthorizeRequest,
  OAuthCallbackResult,
} from "./index";
import { decryptSecret } from "../../utils/encryption";
import { getPlatformCredentials, isLinkedInDirectPublishEnabled } from "../platform-credentials-service";
import { isLinkedInMcpConfigured } from "../linkedin-provider";
import { callLinkedInTool, extractText } from "../linkedin-mcp-client";

const NOT_APPROVED_MESSAGE =
  "LinkedIn direct posting isn't available yet — it's pending LinkedIn's app review. " +
  "We'll turn on one-click Connect as soon as it's approved.";

const AUTH_HOST = "https://www.linkedin.com";
const API_HOST = "https://api.linkedin.com";
const DEFAULT_SCOPE =
  "w_member_social w_organization_social rw_organization_admin";

// ---------------------------------------------------------------------------
// MCP helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the author URN for an MCP post.
 * 1. Use account.authorUrn when already stored (happy path).
 * 2. Fall back to the first managed org page (marketing posts almost always
 *    go out as the org, not the personal profile).
 * 3. Fall back to the signed-in member profile.
 */
async function resolveMcpAuthor(accountAuthorUrn: string | null): Promise<string> {
  if (accountAuthorUrn) return accountAuthorUrn;

  // Try managed org pages first.
  try {
    const orgsResult = await callLinkedInTool("linkedin_list_managed_orgs", {});
    const text = extractText(orgsResult);
    // The tool returns structured text; look for a numeric org ID.
    const orgMatch = text.match(/urn:li:organization:(\d+)/i);
    if (orgMatch) return `urn:li:organization:${orgMatch[1]}`;
    // Or a bare numeric ID in the output.
    const idMatch = text.match(/\bid[:\s]+(\d{6,})/i);
    if (idMatch) return `urn:li:organization:${idMatch[1]}`;
  } catch (err) {
    console.warn("[LinkedIn MCP] list_managed_orgs failed:", (err as Error)?.message);
  }

  // Fall back to personal profile.
  try {
    const profileResult = await callLinkedInTool("linkedin_social_get_profile", {});
    const text = extractText(profileResult);
    const personMatch = text.match(/urn:li:person:([A-Za-z0-9_-]+)/i);
    if (personMatch) return `urn:li:person:${personMatch[1]}`;
    const idMatch = text.match(/\bid[:\s]+([A-Za-z0-9_-]{6,})/i);
    if (idMatch) return `urn:li:person:${idMatch[1]}`;
  } catch (err) {
    console.warn("[LinkedIn MCP] get_profile failed:", (err as Error)?.message);
  }

  throw new Error(
    "Could not resolve a LinkedIn author URN from MCP — run linkedin_list_managed_orgs or linkedin_social_get_profile first.",
  );
}

/**
 * Post text (+ optional article link) via the MCP backend.
 * Returns the created post URN on success.
 */
async function mcpCreatePost(opts: {
  author: string;
  commentary: string;
  articleUrl?: string | null;
}): Promise<{ urn: string | null; raw: unknown }> {
  const args: Record<string, unknown> = {
    author: opts.author,
    commentary: opts.commentary,
    visibility: "PUBLIC",
  };
  if (opts.articleUrl) {
    args.article_url = opts.articleUrl;
  }
  const result = await callLinkedInTool("linkedin_social_create_post", args);
  const text = extractText(result);
  const urnMatch =
    text.match(/urn:li:share:([A-Za-z0-9_-]+)/i) ??
    text.match(/urn:li:ugcPost:([A-Za-z0-9_-]+)/i);
  const urn = urnMatch ? urnMatch[0] : null;
  return { urn, raw: result };
}

// ---------------------------------------------------------------------------
// Publisher implementation
// ---------------------------------------------------------------------------

export class LinkedInPublisher implements SocialPublisher {
  platform = "linkedin";
  supported = true;

  async oauthConfigured(tenantDomain: string): Promise<boolean> {
    // MCP counts as configured — no per-user OAuth needed.
    if (isLinkedInMcpConfigured()) return true;
    if (!isLinkedInDirectPublishEnabled()) return false;
    const creds = await getPlatformCredentials(tenantDomain, "linkedin");
    return !!(creds?.clientId && creds.clientSecret);
  }

  async getOAuthAuthorizeUrl(req: OAuthAuthorizeRequest): Promise<string> {
    if (!isLinkedInDirectPublishEnabled()) {
      throw new Error(NOT_APPROVED_MESSAGE);
    }
    const creds = await getPlatformCredentials(req.tenantDomain, "linkedin");
    if (!creds?.clientId || !creds.clientSecret) {
      throw new Error(
        "LinkedIn isn't configured on this platform yet — please contact support.",
      );
    }
    const params = new URLSearchParams({
      response_type: "code",
      client_id: creds.clientId,
      redirect_uri: req.redirectUri,
      state: req.state,
      scope: req.scope ?? DEFAULT_SCOPE,
    });
    return `${AUTH_HOST}/oauth/v2/authorization?${params.toString()}`;
  }

  async exchangeOAuthCode(
    code: string,
    redirectUri: string,
    options: { tenantDomain: string },
  ): Promise<OAuthCallbackResult> {
    const creds = await getPlatformCredentials(options.tenantDomain, "linkedin");
    if (!creds?.clientId || !creds.clientSecret) {
      throw new Error(
        "LinkedIn isn't configured on this platform yet — please contact support.",
      );
    }
    const tokenResp = await fetch(`${AUTH_HOST}/oauth/v2/accessToken`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }).toString(),
    });
    if (!tokenResp.ok) {
      const txt = await tokenResp.text().catch(() => "");
      throw new Error(`LinkedIn token exchange failed: ${tokenResp.status} ${txt}`);
    }
    const tok = (await tokenResp.json()) as {
      access_token: string;
      expires_in?: number;
      refresh_token?: string;
      scope?: string;
    };

    // r_liteprofile and openid/userinfo are not available on posting-only apps.
    // Fetch admin organizations instead — this works with rw_organization_admin
    // and is the identity Synozur needs (company page posting).
    const expiresAt = tok.expires_in
      ? new Date(Date.now() + tok.expires_in * 1000)
      : null;

    let orgs: Array<{ mode: "organization"; urn: string; name: string; vanityName?: string | null }> = [];
    try {
      orgs = await this.fetchAdminOrganizations(tok.access_token);
    } catch (err: unknown) {
      console.warn("[LinkedIn] organizationAcls fetch failed:", (err as Error)?.message ?? err);
    }

    const availableAuthors: Array<{
      mode: "person" | "organization";
      urn: string;
      name: string;
      vanityName?: string | null;
    }> = [...orgs];

    // Primary author: first org page, or a placeholder if none found.
    const primaryOrg = orgs[0] ?? null;
    const authorMode = primaryOrg ? "organization" : "person";
    const authorUrn = primaryOrg?.urn ?? null;
    const accountName = primaryOrg?.name ?? "LinkedIn account";

    return {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? null,
      expiresAt,
      scope: tok.scope ?? null,
      authorMode,
      authorUrn,
      accountName,
      profileUrl: null,
      accountId: primaryOrg?.urn ?? null,
      availableAuthors,
    };
  }

  async fetchAdminOrganizations(accessToken: string): Promise<
    Array<{
      mode: "organization";
      urn: string;
      name: string;
      vanityName?: string | null;
    }>
  > {
    const url = `${API_HOST}/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organization~(id,localizedName,vanityName)))`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });
    if (!resp.ok) return [];
    const json = (await resp.json().catch(() => null)) as any;
    const elements: any[] = Array.isArray(json?.elements) ? json.elements : [];
    const out: Array<{
      mode: "organization";
      urn: string;
      name: string;
      vanityName?: string | null;
    }> = [];
    for (const el of elements) {
      const org = el?.["organization~"];
      const id = org?.id;
      if (!id) continue;
      out.push({
        mode: "organization",
        urn: `urn:li:organization:${id}`,
        name: org.localizedName || `Organization ${id}`,
        vanityName: org.vanityName ?? null,
      });
    }
    return out;
  }

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const { account, post } = ctx;

    const text = post.editedContent || post.content;
    const hashtags = (post.hashtags as string[] | null) ?? [];
    const finalText =
      hashtags.length > 0
        ? `${text}\n\n${hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}`
        : text;

    // ------------------------------------------------------------------
    // Direct OAuth path — preferred when the account has a stored token.
    // Falls through to MCP only when no token is present.
    // ------------------------------------------------------------------
    if (!isLinkedInDirectPublishEnabled()) {
      return {
        success: false,
        errorCode: "not_approved",
        errorMessage: NOT_APPROVED_MESSAGE,
      };
    }
    // No direct token yet — fall back to MCP if available.
    if (!account.encryptedAccessToken) {
      if (isLinkedInMcpConfigured()) {
        try {
          const author = await resolveMcpAuthor(account.authorUrn ?? null);
          const { urn, raw } = await mcpCreatePost({
            author,
            commentary: finalText,
            articleUrl: (post as any).articleUrl ?? null,
          });
          const publishedUrl = urn
            ? `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/`
            : null;
          return { success: true, publishedUrl, responsePayload: raw };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[LinkedIn MCP] publish failed:", msg);
          return {
            success: false,
            errorCode: "mcp_error",
            errorMessage: `LinkedIn MCP publish failed: ${msg}`,
          };
        }
      }
      return {
        success: false,
        errorCode: "not_connected",
        errorMessage:
          "LinkedIn account is not connected — go to Social Accounts and click Connect before publishing.",
      };
    }
    if (!account.authorUrn) {
      return {
        success: false,
        errorCode: "missing_author",
        errorMessage:
          "LinkedIn account is missing author URN — reconnect to refresh identity.",
      };
    }

    let accessToken: string;
    try {
      accessToken = decryptSecret(account.encryptedAccessToken);
    } catch {
      return {
        success: false,
        errorCode: "token_decrypt_failed",
        errorMessage:
          "Stored LinkedIn token could not be decrypted — reconnect the account.",
      };
    }
    if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now()) {
      return {
        success: false,
        errorCode: "token_expired",
        errorMessage: "LinkedIn token expired — reconnect the account.",
      };
    }

    // Upload image if the post has one (overrideImageUrl takes precedence).
    const imageUrl: string | null =
      (post as any).overrideImageUrl ?? (post as any).leadImageUrl ?? null;
    let imageAssetUrn: string | null = null;
    if (imageUrl) {
      imageAssetUrn = await this.uploadImageAsset(accessToken, account.authorUrn, imageUrl);
    }

    const shareContent: Record<string, unknown> = {
      shareCommentary: { text: finalText },
      shareMediaCategory: imageAssetUrn ? "IMAGE" : "NONE",
    };
    if (imageAssetUrn) {
      shareContent.media = [{ status: "READY", media: imageAssetUrn }];
    }

    const body = {
      author: account.authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: { "com.linkedin.ugc.ShareContent": shareContent },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };

    const resp = await fetch(`${API_HOST}/v2/ugcPosts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      let parsed: any;
      try {
        parsed = JSON.parse(errText);
      } catch {}
      return {
        success: false,
        errorCode: parsed?.serviceErrorCode
          ? String(parsed.serviceErrorCode)
          : `http_${resp.status}`,
        errorMessage:
          parsed?.message ||
          errText ||
          `LinkedIn UGC post failed: ${resp.status}`,
        responsePayload: parsed ?? errText,
      };
    }

    const headerUrn = resp.headers.get("x-restli-id");
    let createdUrn: string | null = null;
    let payload: any = null;
    try {
      payload = await resp.json();
      if (payload?.id) createdUrn = payload.id as string;
    } catch {}
    if (!createdUrn && headerUrn) createdUrn = decodeURIComponent(headerUrn);

    const publishedUrl = createdUrn
      ? `https://www.linkedin.com/feed/update/${encodeURIComponent(createdUrn)}/`
      : null;

    return {
      success: true,
      publishedUrl,
      responsePayload: payload ?? { urn: createdUrn },
    };
  }

  /** Upload an image to LinkedIn via the v2/images API, return the image URN or null on failure. */
  private async uploadImageAsset(
    accessToken: string,
    authorUrn: string,
    imageUrl: string,
  ): Promise<string | null> {
    try {
      // Resolve relative URLs — server-side fetch needs an absolute base.
      const absoluteUrl = imageUrl.startsWith("/")
        ? `http://localhost:${process.env.PORT ?? 5000}${imageUrl}`
        : imageUrl;

      // 1. Initialize upload via the current LinkedIn Images API.
      const initResp = await fetch(`${API_HOST}/v2/images?action=initializeUpload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "LinkedIn-Version": "202304",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify({
          initializeUploadRequest: { owner: authorUrn },
        }),
      });
      if (!initResp.ok) {
        const errText = await initResp.text().catch(() => "");
        console.warn("[LinkedIn] initializeUpload failed:", initResp.status, errText);
        return null;
      }
      const initJson = (await initResp.json()) as any;
      const uploadUrl: string | undefined = initJson?.value?.uploadUrl;
      const imageUrn: string | undefined = initJson?.value?.image;
      if (!uploadUrl || !imageUrn) {
        console.warn("[LinkedIn] initializeUpload missing uploadUrl/image:", JSON.stringify(initJson));
        return null;
      }

      // 2. Download the image.
      const imgResp = await fetch(absoluteUrl);
      if (!imgResp.ok) {
        console.warn("[LinkedIn] Failed to fetch image:", absoluteUrl, imgResp.status);
        return null;
      }
      const imageBuffer = await imgResp.arrayBuffer();

      // 3. Upload binary to LinkedIn.
      //    Pre-signed upload URLs MUST NOT receive an Authorization header —
      //    adding one causes a 403 / signature mismatch.
      const uploadResp = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: imageBuffer,
      });
      if (!uploadResp.ok) {
        const errText = await uploadResp.text().catch(() => "");
        console.warn("[LinkedIn] Image PUT failed:", uploadResp.status, errText);
        return null;
      }

      console.log("[LinkedIn] Image uploaded successfully:", imageUrn);
      return imageUrn;
    } catch (err: any) {
      console.warn("[LinkedIn] uploadImageAsset error:", err.message);
      return null;
    }
  }
}
