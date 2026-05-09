/**
 * TwitterPublisher (X / Twitter) — multi-tenant credentials refactor
 *
 * Posts a tweet via the X API v2 `POST /2/tweets`, authorising with OAuth
 * 2.0 Authorization Code + PKCE. Tenants supply their own Twitter
 * client_id (and optional client_secret for confidential clients) via the
 * tenant-credentials UI; env vars are not consulted.
 *
 * Notes:
 *  - Token endpoint requires HTTP Basic auth for confidential clients.
 *  - Tweet text limit is 280 chars (X Premium extends this; we let the API
 *    reject over-long bodies rather than guess plan).
 */

import { randomBytes, createHash } from "crypto";
import type {
  SocialPublisher,
  PublishContext,
  PublishResult,
  OAuthAuthorizeRequest,
  OAuthAuthorizeResult,
  OAuthCallbackResult,
} from "./index";
import { decryptSecret } from "../../utils/encryption";
import { getPlatformCredentials } from "../platform-credentials-service";

const AUTH_HOST = "https://twitter.com";
const API_HOST = "https://api.twitter.com";
// `tweet.write` to post, `tweet.read` + `users.read` to look up the author,
// `offline.access` so we can refresh the access token later.
const DEFAULT_SCOPE = "tweet.read tweet.write users.read offline.access";

function generateCodeVerifier(): string {
  // RFC 7636 §4.1: 43–128 chars, [A-Z a-z 0-9 -._~]. base64url(48 bytes) = 64 chars.
  return randomBytes(48).toString("base64url");
}

function codeChallengeFromVerifier(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function buildBasicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export class TwitterPublisher implements SocialPublisher {
  platform = "twitter";
  supported = true;

  async oauthConfigured(tenantDomain: string): Promise<boolean> {
    const creds = await getPlatformCredentials(tenantDomain, "twitter");
    return !!creds?.clientId;
  }

  async getOAuthAuthorizeUrl(req: OAuthAuthorizeRequest): Promise<OAuthAuthorizeResult> {
    const creds = await getPlatformCredentials(req.tenantDomain, "twitter");
    if (!creds?.clientId) {
      throw new Error("Twitter OAuth is not configured for this tenant. Configure your Twitter (X) client_id in Tenant → Platform Credentials.");
    }
    const codeVerifier = generateCodeVerifier();
    const params = new URLSearchParams({
      response_type: "code",
      client_id: creds.clientId,
      redirect_uri: req.redirectUri,
      scope: req.scope ?? DEFAULT_SCOPE,
      state: req.state,
      code_challenge: codeChallengeFromVerifier(codeVerifier),
      code_challenge_method: "S256",
    });
    return {
      url: `${AUTH_HOST}/i/oauth2/authorize?${params.toString()}`,
      codeVerifier,
    };
  }

  async exchangeOAuthCode(
    code: string,
    redirectUri: string,
    options: { tenantDomain: string; codeVerifier?: string },
  ): Promise<OAuthCallbackResult> {
    const creds = await getPlatformCredentials(options.tenantDomain, "twitter");
    if (!creds?.clientId) {
      throw new Error("Twitter OAuth is not configured for this tenant.");
    }
    if (!options.codeVerifier) {
      throw new Error("Twitter OAuth requires a code_verifier (PKCE) — internal state was lost");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: creds.clientId,
      code_verifier: options.codeVerifier,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    // Confidential clients authenticate with HTTP Basic. Public clients
    // (e.g. native apps) skip this. We treat presence of the secret as the
    // signal that the app is confidential.
    if (creds.clientSecret) {
      headers.Authorization = buildBasicAuthHeader(creds.clientId, creds.clientSecret);
    }

    const tokenResp = await fetch(`${API_HOST}/2/oauth2/token`, {
      method: "POST",
      headers,
      body: body.toString(),
    });
    if (!tokenResp.ok) {
      const txt = await tokenResp.text().catch(() => "");
      throw new Error(`Twitter token exchange failed: ${tokenResp.status} ${txt}`);
    }
    const tok = await tokenResp.json() as {
      token_type?: string;
      expires_in?: number;
      access_token: string;
      scope?: string;
      refresh_token?: string;
    };

    const meResp = await fetch(`${API_HOST}/2/users/me`, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (!meResp.ok) {
      const txt = await meResp.text().catch(() => "");
      throw new Error(`Twitter /users/me failed: ${meResp.status} ${txt}`);
    }
    const me = await meResp.json() as { data?: { id: string; name?: string; username?: string } };
    const userId = me.data?.id;
    const username = me.data?.username;
    const name = me.data?.name ?? username ?? "Twitter user";
    if (!userId) {
      throw new Error("Twitter /users/me did not return a user id");
    }

    const expiresAt = tok.expires_in
      ? new Date(Date.now() + tok.expires_in * 1000)
      : null;

    return {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? null,
      expiresAt,
      scope: tok.scope ?? null,
      authorMode: "person",
      authorUrn: `urn:twitter:user:${userId}`,
      accountId: userId,
      accountName: name,
      profileUrl: username ? `https://twitter.com/${username}` : null,
      availableAuthors: [{
        mode: "person",
        urn: `urn:twitter:user:${userId}`,
        name,
        vanityName: username ?? null,
      }],
    };
  }

  /** Refresh the access token using the stored refresh_token. */
  async refreshToken(
    tenantDomain: string,
    refreshToken: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
  }> {
    const creds = await getPlatformCredentials(tenantDomain, "twitter");
    if (!creds?.clientId) throw new Error("Twitter OAuth is not configured for this tenant.");
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (creds.clientSecret) {
      headers.Authorization = buildBasicAuthHeader(creds.clientId, creds.clientSecret);
    }
    const resp = await fetch(`${API_HOST}/2/oauth2/token`, {
      method: "POST",
      headers,
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: creds.clientId,
      }).toString(),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Twitter token refresh failed: ${resp.status} ${txt}`);
    }
    const tok = await resp.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    return {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? refreshToken,
      expiresAt: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : null,
    };
  }

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const { account, post } = ctx;
    if (!account.encryptedAccessToken) {
      return {
        success: false,
        errorCode: "not_connected",
        errorMessage: "Twitter account is not connected — re-authorize before publishing.",
      };
    }
    let accessToken: string;
    try {
      accessToken = decryptSecret(account.encryptedAccessToken);
    } catch {
      return {
        success: false,
        errorCode: "token_decrypt_failed",
        errorMessage: "Stored Twitter token could not be decrypted — reconnect the account.",
      };
    }

    let refreshedAccessToken: string | null = null;
    let refreshedRefreshToken: string | null = null;
    let refreshedTokenExpiresAt: Date | null = null;
    if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now()) {
      if (!account.encryptedRefreshToken) {
        return {
          success: false,
          errorCode: "token_expired",
          errorMessage: "Twitter token expired and no refresh token is stored — reconnect the account.",
        };
      }
      try {
        const rt = decryptSecret(account.encryptedRefreshToken);
        const refreshed = await this.refreshToken(account.tenantDomain, rt);
        accessToken = refreshed.accessToken;
        refreshedAccessToken = refreshed.accessToken;
        refreshedRefreshToken = refreshed.refreshToken;
        refreshedTokenExpiresAt = refreshed.expiresAt;
      } catch (err: any) {
        return {
          success: false,
          errorCode: "token_refresh_failed",
          errorMessage: `Twitter token refresh failed: ${err.message}`,
        };
      }
    }

    const text = post.editedContent || post.content;
    const hashtags = (post.hashtags as string[] | null) ?? [];
    const finalText = hashtags.length > 0
      ? `${text}\n\n${hashtags.map(h => h.startsWith("#") ? h : `#${h}`).join(" ")}`
      : text;

    const resp = await fetch(`${API_HOST}/2/tweets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: finalText }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      let parsed: any;
      try { parsed = JSON.parse(errText); } catch {}
      return {
        success: false,
        errorCode: parsed?.type ? String(parsed.type).split("/").pop() : `http_${resp.status}`,
        errorMessage: parsed?.detail || parsed?.title || errText || `Twitter create tweet failed: ${resp.status}`,
        responsePayload: parsed ?? errText,
      };
    }

    const payload = await resp.json().catch(() => null) as { data?: { id?: string; text?: string } } | null;
    const tweetId = payload?.data?.id;
    const username = (account.availableAuthors ?? []).find(a => a.urn === account.authorUrn)?.vanityName;
    const publishedUrl = tweetId
      ? `https://twitter.com/${username ?? "i"}/status/${tweetId}`
      : null;

    return {
      success: true,
      publishedUrl,
      responsePayload: payload,
      refreshedAccessToken,
      refreshedRefreshToken,
      refreshedTokenExpiresAt,
    };
  }
}
