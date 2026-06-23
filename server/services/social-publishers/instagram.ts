/**
 * InstagramPublisher — multi-tenant credentials refactor
 *
 * Posts to an Instagram Business / Creator account via the Meta Graph
 * Instagram Content Publishing API. Instagram publishing rides on the
 * Facebook OAuth flow, so we look up *Facebook* credentials in the
 * platform-credentials service. Tenants supply these via the tenant-
 * credentials UI; env vars are not consulted.
 *
 * Required scopes (added to the Facebook defaults):
 *   - instagram_basic
 *   - instagram_content_publish
 *
 * Posting flow:
 *  1. POST /{ig-user-id}/media       (creates a container)
 *  2. POST /{ig-user-id}/media_publish
 *
 * Image is REQUIRED — Instagram has no text-only post type.
 */

import type {
  SocialPublisher,
  PublishContext,
  PublishResult,
  OAuthAuthorizeRequest,
  OAuthCallbackResult,
} from "./index";
import { decryptSecret } from "../../utils/encryption";
import { getPlatformCredentials, isDirectPublishEnabled } from "../platform-credentials-service";

const AUTH_HOST = "https://www.facebook.com";
const GRAPH_HOST = "https://graph.facebook.com";
const API_VERSION = "v19.0";
const DEFAULT_SCOPE = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
].join(",");

interface IgAccountForPage {
  pageId: string;
  pageName: string;
  igUserId: string;
  igUsername?: string | null;
}

async function discoverInstagramAccounts(userAccessToken: string): Promise<IgAccountForPage[]> {
  const pagesUrl = `${GRAPH_HOST}/${API_VERSION}/me/accounts?fields=id,name&limit=100&access_token=${encodeURIComponent(userAccessToken)}`;
  const out: IgAccountForPage[] = [];
  let next: string | null = pagesUrl;
  while (next) {
    const resp: Response = await fetch(next);
    if (!resp.ok) break;
    const json = await resp.json().catch(() => null) as any;
    const pages: any[] = Array.isArray(json?.data) ? json.data : [];
    for (const p of pages) {
      if (!p?.id) continue;
      try {
        const lookup = await fetch(
          `${GRAPH_HOST}/${API_VERSION}/${p.id}?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(userAccessToken)}`,
        );
        if (!lookup.ok) continue;
        const ig = await lookup.json() as any;
        const igId = ig?.instagram_business_account?.id;
        if (igId) {
          out.push({
            pageId: p.id,
            pageName: p.name ?? "Page",
            igUserId: igId,
            igUsername: ig.instagram_business_account.username ?? null,
          });
        }
      } catch { /* skip — unmapped page */ }
    }
    next = (json?.paging?.next as string | undefined) ?? null;
  }
  return out;
}

export class InstagramPublisher implements SocialPublisher {
  platform = "instagram";
  supported = true;

  // Reads "facebook" credentials — Instagram rides on the shared Meta app.
  async oauthConfigured(tenantDomain: string): Promise<boolean> {
    if (!await isDirectPublishEnabled("facebook")) return false;
    const creds = await getPlatformCredentials(tenantDomain, "facebook");
    return !!(creds?.clientId && creds.clientSecret);
  }

  async getOAuthAuthorizeUrl(req: OAuthAuthorizeRequest): Promise<string> {
    const creds = await getPlatformCredentials(req.tenantDomain, "facebook");
    if (!creds?.clientId || !creds.clientSecret) {
      throw new Error("Instagram posting isn't available on Orbit yet — the shared Synozur Meta app hasn't been configured. Please contact Synozur support.");
    }
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: req.redirectUri,
      state: req.state,
      scope: req.scope ?? DEFAULT_SCOPE,
      response_type: "code",
    });
    return `${AUTH_HOST}/${API_VERSION}/dialog/oauth?${params.toString()}`;
  }

  async exchangeOAuthCode(
    code: string,
    redirectUri: string,
    options: { tenantDomain: string },
  ): Promise<OAuthCallbackResult> {
    const creds = await getPlatformCredentials(options.tenantDomain, "facebook");
    if (!creds?.clientId || !creds.clientSecret) {
      throw new Error("Instagram OAuth requires Facebook credentials for this tenant.");
    }
    const tokenResp = await fetch(
      `${GRAPH_HOST}/${API_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: redirectUri,
        code,
      }).toString(),
    );
    if (!tokenResp.ok) {
      const txt = await tokenResp.text().catch(() => "");
      throw new Error(`Instagram (FB) token exchange failed: ${tokenResp.status} ${txt}`);
    }
    const shortTok = await tokenResp.json() as { access_token: string; expires_in?: number };

    const longResp = await fetch(
      `${GRAPH_HOST}/${API_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        fb_exchange_token: shortTok.access_token,
      }).toString(),
    );
    const longTok = longResp.ok
      ? await longResp.json() as { access_token: string; expires_in?: number }
      : { access_token: shortTok.access_token, expires_in: shortTok.expires_in };

    const igAccounts = await discoverInstagramAccounts(longTok.access_token);

    if (igAccounts.length === 0) {
      throw new Error(
        "No Instagram Business or Creator accounts are linked to a Facebook Page you administer. " +
        "Link the IG account to a Page in Meta Business Suite, then reconnect.",
      );
    }

    const availableAuthors: OAuthCallbackResult["availableAuthors"] = igAccounts.map(a => ({
      mode: "organization" as const,
      urn: `ig:user:${a.igUserId}`,
      name: a.igUsername || a.pageName,
      vanityName: a.igUsername ?? null,
    }));
    const defaultAuthor = availableAuthors[0];

    const expiresAt = longTok.expires_in
      ? new Date(Date.now() + longTok.expires_in * 1000)
      : null;

    return {
      accessToken: longTok.access_token,
      refreshToken: null,
      expiresAt,
      scope: null,
      authorMode: "organization",
      authorUrn: defaultAuthor.urn,
      accountId: igAccounts[0].igUserId,
      accountName: defaultAuthor.name,
      profileUrl: igAccounts[0].igUsername
        ? `https://www.instagram.com/${igAccounts[0].igUsername}`
        : null,
      availableAuthors,
    };
  }

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const { account, post } = ctx;
    if (!account.encryptedAccessToken) {
      return {
        success: false,
        errorCode: "not_connected",
        errorMessage: "Instagram account is not connected — re-authorize before publishing.",
      };
    }
    if (!account.authorUrn || !account.authorUrn.startsWith("ig:user:")) {
      return {
        success: false,
        errorCode: "invalid_author",
        errorMessage: "Instagram account is missing or has a malformed author URN — reconnect the account.",
      };
    }
    const igUserId = account.authorUrn.split(":")[2];
    if (!igUserId) {
      return {
        success: false,
        errorCode: "invalid_author",
        errorMessage: "Selected Instagram account id is malformed — reconnect.",
      };
    }
    if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now()) {
      return {
        success: false,
        errorCode: "token_expired",
        errorMessage: "Instagram (Facebook) user token expired — reconnect the account.",
      };
    }

    const imageUrl = post.overrideImageUrl;
    if (!imageUrl) {
      return {
        success: false,
        errorCode: "image_required",
        errorMessage:
          "Instagram requires an image. Set overrideImageUrl (a publicly reachable URL) on the post before publishing.",
      };
    }

    let userAccessToken: string;
    try {
      userAccessToken = decryptSecret(account.encryptedAccessToken);
    } catch {
      return {
        success: false,
        errorCode: "token_decrypt_failed",
        errorMessage: "Stored Instagram token could not be decrypted — reconnect the account.",
      };
    }

    const text = post.editedContent || post.content;
    const hashtags = (post.hashtags as string[] | null) ?? [];
    const caption = hashtags.length > 0
      ? `${text}\n\n${hashtags.map(h => h.startsWith("#") ? h : `#${h}`).join(" ")}`
      : text;

    const containerResp = await fetch(`${GRAPH_HOST}/${API_VERSION}/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: imageUrl,
        caption,
        access_token: userAccessToken,
      }),
    });
    if (!containerResp.ok) {
      const errText = await containerResp.text().catch(() => "");
      let parsed: any;
      try { parsed = JSON.parse(errText); } catch {}
      return {
        success: false,
        errorCode: parsed?.error?.code ? String(parsed.error.code) : `http_${containerResp.status}`,
        errorMessage: parsed?.error?.message || errText || `Instagram media container failed: ${containerResp.status}`,
        responsePayload: parsed ?? errText,
      };
    }
    const container = await containerResp.json() as { id?: string };
    const containerId = container.id;
    if (!containerId) {
      return {
        success: false,
        errorCode: "no_container_id",
        errorMessage: "Instagram did not return a media container id.",
      };
    }

    const publishResp = await fetch(`${GRAPH_HOST}/${API_VERSION}/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: userAccessToken,
      }),
    });
    if (!publishResp.ok) {
      const errText = await publishResp.text().catch(() => "");
      let parsed: any;
      try { parsed = JSON.parse(errText); } catch {}
      return {
        success: false,
        errorCode: parsed?.error?.code ? String(parsed.error.code) : `http_${publishResp.status}`,
        errorMessage: parsed?.error?.message || errText || `Instagram media_publish failed: ${publishResp.status}`,
        responsePayload: parsed ?? errText,
      };
    }
    const published = await publishResp.json() as { id?: string };

    let publishedUrl: string | null = null;
    if (published.id) {
      try {
        const linkResp = await fetch(
          `${GRAPH_HOST}/${API_VERSION}/${published.id}?fields=permalink&access_token=${encodeURIComponent(userAccessToken)}`,
        );
        if (linkResp.ok) {
          const link = await linkResp.json() as { permalink?: string };
          publishedUrl = link.permalink ?? null;
        }
      } catch { /* non-fatal */ }
    }

    return { success: true, publishedUrl, responsePayload: published };
  }
}
