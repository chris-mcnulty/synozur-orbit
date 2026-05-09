/**
 * TwitterPublisher (X / Twitter) — Phase 5
 *
 * Posts a tweet via the X API v2 `POST /2/tweets` endpoint, authorising
 * with OAuth 2.0 Authorization Code + PKCE. Text-only; image attachments
 * are a follow-up (would require chunked v1.1 media upload).
 *
 * Required env vars:
 *   - TWITTER_CLIENT_ID
 *   - TWITTER_CLIENT_SECRET     (only used for confidential clients;
 *                               public-client apps may omit it)
 *
 * Notes:
 *  - Token endpoint requires HTTP Basic auth for confidential clients.
 *  - Tweet text limit is 280 chars (Twitter Blue extends this; we don't
 *    try to detect plan, we just let the API reject over-long bodies).
 *  - The /2/users/me lookup gives us the user id + handle for the URN
 *    and the published tweet URL.
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

export class TwitterPublisher implements SocialPublisher {
  platform = "twitter";
  supported = true;

  oauthConfigured(): boolean {
    return !!process.env.TWITTER_CLIENT_ID;
  }

  getOAuthAuthorizeUrl(req: OAuthAuthorizeRequest): OAuthAuthorizeResult {
    if (!this.oauthConfigured()) {
      throw new Error("Twitter OAuth not configured: missing TWITTER_CLIENT_ID");
    }
    const codeVerifier = generateCodeVerifier();
    const params = new URLSearchParams({
      response_type: "code",
      client_id: process.env.TWITTER_CLIENT_ID!,
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
    codeVerifier?: string,
  ): Promise<OAuthCallbackResult> {
    if (!this.oauthConfigured()) {
      throw new Error("Twitter OAuth not configured");
    }
    if (!codeVerifier) {
      throw new Error("Twitter OAuth requires a code_verifier (PKCE) — internal state was lost");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: process.env.TWITTER_CLIENT_ID!,
      code_verifier: codeVerifier,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    // Confidential clients authenticate with HTTP Basic. Public clients
    // (e.g. native apps) skip this. We treat presence of the secret as the
    // signal that the app is confidential.
    if (process.env.TWITTER_CLIENT_SECRET) {
      const basic = Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString("base64");
      headers.Authorization = `Basic ${basic}`;
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

    // Look up the authenticated user to capture id/username for URN + URL.
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

  /** Refresh the access token using the stored refresh_token. Returns the
   *  refreshed token bundle so the worker can persist it. Throws on failure. */
  async refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
  }> {
    if (!this.oauthConfigured()) throw new Error("Twitter OAuth not configured");
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (process.env.TWITTER_CLIENT_SECRET) {
      const basic = Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString("base64");
      headers.Authorization = `Basic ${basic}`;
    }
    const resp = await fetch(`${API_HOST}/2/oauth2/token`, {
      method: "POST",
      headers,
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: process.env.TWITTER_CLIENT_ID!,
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

    // If the access token is expired and we have a refresh token, refresh
    // proactively. The worker persists `refreshedAccessToken` etc. when set
    // on the result so subsequent publishes don't keep refreshing.
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
        const refreshed = await this.refreshToken(rt);
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
