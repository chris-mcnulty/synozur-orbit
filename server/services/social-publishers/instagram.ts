/**
 * InstagramPublisher — Phase 5
 *
 * Posts to an Instagram Business / Creator account via the Meta Graph
 * Instagram Content Publishing API. Reuses the same Facebook App
 * credentials (FACEBOOK_APP_ID/SECRET) — Instagram publishing rides on
 * top of the Facebook OAuth flow with extra scopes:
 *   - instagram_basic
 *   - instagram_content_publish
 *
 * Required setup (operator):
 *  1. Connect a Facebook Page to an Instagram Business/Creator account.
 *  2. Have the user OAuth with `instagram_content_publish` scope.
 *  3. Submit the Facebook App for review for that scope.
 *
 * Posting flow (per Meta docs):
 *  1. POST /{ig-user-id}/media       (creates a container)
 *  2. POST /{ig-user-id}/media_publish  (publishes the container)
 *
 * Image is REQUIRED — Instagram has no text-only post type. We use
 * `post.overrideImageUrl` (publicly reachable URL). Captions can include
 * the post text + hashtags. Carousel/video posts are a follow-up.
 */

import type {
  SocialPublisher,
  PublishContext,
  PublishResult,
  OAuthAuthorizeRequest,
  OAuthCallbackResult,
} from "./index";
import { decryptSecret } from "../../utils/encryption";

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
  // Walk the user's pages and resolve `instagram_business_account` for each.
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

  oauthConfigured(): boolean {
    return !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET);
  }

  getOAuthAuthorizeUrl(req: OAuthAuthorizeRequest): string {
    if (!this.oauthConfigured()) {
      throw new Error("Instagram OAuth not configured: missing FACEBOOK_APP_ID/SECRET (Instagram rides on Facebook).");
    }
    const params = new URLSearchParams({
      client_id: process.env.FACEBOOK_APP_ID!,
      redirect_uri: req.redirectUri,
      state: req.state,
      scope: req.scope ?? DEFAULT_SCOPE,
      response_type: "code",
    });
    return `${AUTH_HOST}/${API_VERSION}/dialog/oauth?${params.toString()}`;
  }

  async exchangeOAuthCode(code: string, redirectUri: string): Promise<OAuthCallbackResult> {
    if (!this.oauthConfigured()) {
      throw new Error("Instagram OAuth not configured");
    }
    // Short-lived → long-lived user token (60 days).
    const tokenResp = await fetch(
      `${GRAPH_HOST}/${API_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID!,
        client_secret: process.env.FACEBOOK_APP_SECRET!,
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
        client_id: process.env.FACEBOOK_APP_ID!,
        client_secret: process.env.FACEBOOK_APP_SECRET!,
        fb_exchange_token: shortTok.access_token,
      }).toString(),
    );
    const longTok = longResp.ok
      ? await longResp.json() as { access_token: string; expires_in?: number }
      : { access_token: shortTok.access_token, expires_in: shortTok.expires_in };

    // Resolve every IG Business account linked to a Page the user manages.
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

    // Step 1 — create media container.
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

    // Step 2 — publish the container. Containers can take a few seconds to
    // be processed; on transient errors the worker retries via its existing
    // backoff.
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

    // To produce a public URL, look up the permalink on the new media item.
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
