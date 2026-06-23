/**
 * FacebookPublisher — multi-tenant credentials refactor
 *
 * Posts to a Facebook Page via the Meta Graph API. Tenants supply their
 * own Facebook app_id + app_secret via the tenant-credentials UI; env
 * vars are not consulted.
 *
 * Notes:
 *  - We exchange the short-lived user token for a long-lived (~60-day)
 *    one immediately so the connection survives a typical sprint.
 *  - On every publish we re-fetch the Page access token via
 *    `GET /{page-id}?fields=access_token`. Page tokens derived from a
 *    long-lived user token are non-expiring as long as the user account
 *    remains valid; re-fetching avoids us having to store many secrets.
 *  - Personal-profile posts are not supported by the Graph API for new
 *    apps; we surface a clear error if no Page is selected.
 *
 * Posting requires the tenant's app to have been reviewed for
 * `pages_manage_posts`.
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
  "pages_manage_posts",
].join(",");

interface FbPage {
  id: string;
  name: string;
  category?: string;
}

async function fetchManagedPages(userAccessToken: string): Promise<FbPage[]> {
  const url = `${GRAPH_HOST}/${API_VERSION}/me/accounts?fields=id,name,category&limit=100&access_token=${encodeURIComponent(userAccessToken)}`;
  const out: FbPage[] = [];
  let next: string | null = url;
  while (next) {
    const resp: Response = await fetch(next);
    if (!resp.ok) break;
    const json = await resp.json().catch(() => null) as any;
    const pages: any[] = Array.isArray(json?.data) ? json.data : [];
    for (const p of pages) {
      if (p?.id && p?.name) out.push({ id: p.id, name: p.name, category: p.category });
    }
    next = (json?.paging?.next as string | undefined) ?? null;
  }
  return out;
}

export class FacebookPublisher implements SocialPublisher {
  platform = "facebook";
  supported = true;

  async oauthConfigured(tenantDomain: string): Promise<boolean> {
    if (!await isDirectPublishEnabled("facebook")) return false;
    const creds = await getPlatformCredentials(tenantDomain, "facebook");
    return !!(creds?.clientId && creds.clientSecret);
  }

  async getOAuthAuthorizeUrl(req: OAuthAuthorizeRequest): Promise<string> {
    const creds = await getPlatformCredentials(req.tenantDomain, "facebook");
    if (!creds?.clientId || !creds.clientSecret) {
      throw new Error("Facebook posting isn't available on Orbit yet — the shared Synozur app hasn't been configured. Please contact Synozur support.");
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
      throw new Error("Facebook OAuth is not configured for this tenant.");
    }
    // 1. Short-lived user token.
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
      throw new Error(`Facebook token exchange failed: ${tokenResp.status} ${txt}`);
    }
    const shortTok = await tokenResp.json() as { access_token: string; expires_in?: number };

    // 2. Exchange for long-lived user token (~60 days).
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
      ? await longResp.json() as { access_token: string; expires_in?: number; token_type?: string }
      : { access_token: shortTok.access_token, expires_in: shortTok.expires_in };

    // 3. Identify the user and list managed pages for the picker.
    const meResp = await fetch(
      `${GRAPH_HOST}/${API_VERSION}/me?fields=id,name&access_token=${encodeURIComponent(longTok.access_token)}`,
    );
    if (!meResp.ok) {
      const txt = await meResp.text().catch(() => "");
      throw new Error(`Facebook /me failed: ${meResp.status} ${txt}`);
    }
    const me = await meResp.json() as { id: string; name?: string };

    const pages = await fetchManagedPages(longTok.access_token);

    const availableAuthors: OAuthCallbackResult["availableAuthors"] = pages.map(p => ({
      mode: "organization" as const,
      urn: `fb:page:${p.id}`,
      name: p.name,
      vanityName: null,
    }));

    const defaultAuthor = availableAuthors[0]
      ?? { mode: "person" as const, urn: `fb:user:${me.id}`, name: me.name ?? "Personal account", vanityName: null };

    const expiresAt = longTok.expires_in
      ? new Date(Date.now() + longTok.expires_in * 1000)
      : null;

    return {
      accessToken: longTok.access_token,
      refreshToken: null,
      expiresAt,
      scope: null,
      authorMode: defaultAuthor.mode,
      authorUrn: defaultAuthor.urn,
      accountId: me.id,
      accountName: defaultAuthor.name,
      profileUrl: defaultAuthor.urn.startsWith("fb:page:")
        ? `https://www.facebook.com/${defaultAuthor.urn.split(":")[2]}`
        : null,
      availableAuthors: availableAuthors.length > 0 ? availableAuthors : [defaultAuthor],
    };
  }

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const { account, post } = ctx;
    if (!account.encryptedAccessToken) {
      return {
        success: false,
        errorCode: "not_connected",
        errorMessage: "Facebook account is not connected — re-authorize before publishing.",
      };
    }
    if (!account.authorUrn || !account.authorUrn.startsWith("fb:page:")) {
      return {
        success: false,
        errorCode: "no_page_selected",
        errorMessage: "Pick a Facebook Page to publish as. Personal-profile posting is not supported.",
      };
    }
    const pageId = account.authorUrn.split(":")[2];
    if (!pageId) {
      return {
        success: false,
        errorCode: "invalid_author",
        errorMessage: "Selected Facebook Page id is malformed — reconnect the account.",
      };
    }
    if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now()) {
      return {
        success: false,
        errorCode: "token_expired",
        errorMessage: "Facebook user token expired — reconnect the account.",
      };
    }

    let userAccessToken: string;
    try {
      userAccessToken = decryptSecret(account.encryptedAccessToken);
    } catch {
      return {
        success: false,
        errorCode: "token_decrypt_failed",
        errorMessage: "Stored Facebook token could not be decrypted — reconnect the account.",
      };
    }

    const pageTokenResp = await fetch(
      `${GRAPH_HOST}/${API_VERSION}/${pageId}?fields=access_token&access_token=${encodeURIComponent(userAccessToken)}`,
    );
    if (!pageTokenResp.ok) {
      const txt = await pageTokenResp.text().catch(() => "");
      return {
        success: false,
        errorCode: `http_${pageTokenResp.status}`,
        errorMessage: `Could not fetch Facebook Page access token: ${txt}`,
      };
    }
    const pageTokenJson = await pageTokenResp.json() as { access_token?: string };
    const pageAccessToken = pageTokenJson.access_token;
    if (!pageAccessToken) {
      return {
        success: false,
        errorCode: "no_page_token",
        errorMessage: "Facebook did not return a Page access token. Re-authorize and re-select the Page.",
      };
    }

    const text = post.editedContent || post.content;
    const hashtags = (post.hashtags as string[] | null) ?? [];
    const finalText = hashtags.length > 0
      ? `${text}\n\n${hashtags.map(h => h.startsWith("#") ? h : `#${h}`).join(" ")}`
      : text;

    const resp = await fetch(`${GRAPH_HOST}/${API_VERSION}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: finalText,
        access_token: pageAccessToken,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      let parsed: any;
      try { parsed = JSON.parse(errText); } catch {}
      return {
        success: false,
        errorCode: parsed?.error?.code ? String(parsed.error.code) : `http_${resp.status}`,
        errorMessage: parsed?.error?.message || errText || `Facebook page post failed: ${resp.status}`,
        responsePayload: parsed ?? errText,
      };
    }

    const payload = await resp.json().catch(() => null) as { id?: string } | null;
    const postId = payload?.id;
    const publishedUrl = postId
      ? `https://www.facebook.com/${postId.includes("_") ? postId.replace("_", "/posts/") : `${pageId}/posts/${postId}`}`
      : null;

    return { success: true, publishedUrl, responsePayload: payload };
  }
}
