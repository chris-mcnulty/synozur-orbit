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
import { decryptSecret, encryptSecret } from "../../utils/encryption";
import { db } from "../../db";
import { socialAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getPlatformCredentials, isDirectPublishEnabled } from "../platform-credentials-service";
import { GraphClient } from "../sharepoint-graph-client.js";

const AUTH_HOST = "https://twitter.com";
const API_HOST = "https://api.twitter.com";
// `tweet.write` to post, `tweet.read` + `users.read` to look up the author,
// `offline.access` so we can refresh the access token later, `media.write`
// to upload images via the v2 media endpoint (the legacy v1.1
// upload.twitter.com endpoint now returns 403 for OAuth 2.0 apps).
const DEFAULT_SCOPE = "tweet.read tweet.write users.read media.write offline.access";

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
    if (!await isDirectPublishEnabled("twitter")) return false;
    const creds = await getPlatformCredentials(tenantDomain, "twitter");
    return !!creds?.clientId;
  }

  async getOAuthAuthorizeUrl(req: OAuthAuthorizeRequest): Promise<OAuthAuthorizeResult> {
    const creds = await getPlatformCredentials(req.tenantDomain, "twitter");
    if (!creds?.clientId) {
      throw new Error("X / Twitter posting isn't available on Orbit yet — the shared Synozur app hasn't been configured. Please contact Synozur support.");
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
    // Per Twitter's OAuth 2.0 spec: when using HTTP Basic auth (confidential
    // clients that have a client_secret), do NOT also send client_id in the
    // request body — sending both causes a 400 "invalid_request" error.
    // Public clients (PKCE only, no secret) need client_id in the body.
    const refreshBody: Record<string, string> = {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    };
    if (!creds.clientSecret) {
      refreshBody.client_id = creds.clientId;
    }
    const resp = await fetch(`${API_HOST}/2/oauth2/token`, {
      method: "POST",
      headers,
      body: new URLSearchParams(refreshBody).toString(),
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

  /**
   * Per-account serialization: X rotates refresh tokens (single-use), and a
   * concurrent refresh — e.g. worker tick overlapping a manual Retry click —
   * counts as token reuse, which makes X revoke the entire grant. Chain all
   * publishes for the same account so only one token refresh can be in
   * flight at a time within this process.
   */
  private publishChains = new Map<string, Promise<PublishResult>>();

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const key = ctx.account.id;
    const prev = this.publishChains.get(key) ?? Promise.resolve(undefined as unknown as PublishResult);
    const next = prev.catch(() => undefined).then(() => this.publishInner(ctx));
    this.publishChains.set(key, next);
    try {
      return await next;
    } finally {
      if (this.publishChains.get(key) === next) this.publishChains.delete(key);
    }
  }

  private async publishInner(ctx: PublishContext): Promise<PublishResult> {
    const { post } = ctx;
    // Re-read the account row INSIDE the per-account lock. A caller queued
    // behind another publish captured its account object before waiting; if
    // the earlier publish rotated the (single-use) refresh token, that
    // captured copy is stale and reusing it would get the grant revoked by X.
    let account = ctx.account;
    try {
      const [fresh] = await db.select().from(socialAccounts)
        .where(eq(socialAccounts.id, ctx.account.id));
      if (fresh) account = fresh;
    } catch {
      // fall back to the caller-provided row
    }
    if (!account.encryptedAccessToken) {
      return {
        success: false,
        errorCode: "not_connected",
        errorMessage: "Twitter account is not connected — re-authorize before publishing.",
      };
    }
    // A post can still reference an account whose grant was revoked (e.g. the
    // account was reconnected as a NEW row). Don't attempt a refresh that is
    // guaranteed to fail with a cryptic "token was invalid" — tell the user
    // what to actually do.
    if (account.status === "needs_reconnect") {
      return {
        success: false,
        errorCode: "account_disconnected",
        errorMessage: `This post is assigned to a disconnected X account ("${account.accountName ?? account.id}"). Use "Reassign account" on the Social Calendar to move pending posts to the active account, or reconnect this account.`,
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
    // Refresh 60s early so the token can't expire mid-publish (media upload
    // + tweet create can span several seconds).
    if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now() + 60_000) {
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
        // Persist the rotated tokens IMMEDIATELY, inside the per-account
        // lock — before any caller-side persistence. If the process crashes
        // mid-publish or a queued caller starts right after this publish
        // resolves, the DB must already hold the new (unconsumed) refresh
        // token or the old one gets reused and X revokes the grant.
        try {
          await db.update(socialAccounts).set({
            encryptedAccessToken: encryptSecret(refreshed.accessToken),
            encryptedRefreshToken: refreshed.refreshToken
              ? encryptSecret(refreshed.refreshToken)
              : account.encryptedRefreshToken,
            tokenExpiresAt: refreshed.expiresAt ?? account.tokenExpiresAt,
            updatedAt: new Date(),
          }).where(eq(socialAccounts.id, account.id));
        } catch (persistErr) {
          console.error("[Twitter] Failed to persist refreshed tokens:", persistErr);
        }
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

    // Upload image if present — X requires bytes pushed to their media
    // endpoint; it never fetches URLs directly, so private/object-storage
    // URLs work fine as long as the server can reach them.
    const imageUrl: string | null =
      (post as any).overrideImageUrl ?? (post as any).leadImageUrl ?? null;
    let mediaId: string | null = null;
    if (imageUrl) {
      let uploadError: { code: string; message: string } | null = null;
      try {
        mediaId = await this.uploadMedia(accessToken, imageUrl);
      } catch (uploadErr: any) {
        // uploadMedia throws typed errors (token_expired on 401 from X,
        // image_fetch_failed on non-OK storage fetches) so we can surface a
        // targeted message rather than the generic "Orbit storage" one.
        uploadError = { code: uploadErr.code ?? "image_upload_failed", message: uploadErr.message };
      }
      // If the user explicitly set an override image and the upload failed,
      // return an error so the post stays retryable rather than being silently
      // posted as text-only.
      if ((mediaId === null || uploadError) && (post as any).overrideImageUrl) {
        if (uploadError?.code === "token_expired") {
          return {
            success: false,
            errorCode: "token_expired",
            errorMessage: uploadError.message,
          };
        }
        return {
          success: false,
          errorCode: "image_upload_failed",
          errorMessage: uploadError?.message ?? `Image could not be fetched from Orbit storage for upload to X. This is a server-side issue — use the Retry button to try again. If it keeps failing, use the Change Image button (🖼) on the post to replace the graphic.`,
        };
      }
    }

    const tweetBody: Record<string, unknown> = { text: finalText };
    if (mediaId) tweetBody.media = { media_ids: [mediaId] };

    const resp = await fetch(`${API_HOST}/2/tweets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(tweetBody),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      let parsed: any;
      try { parsed = JSON.parse(errText); } catch {}
      // 401 Unauthorized means the token has been revoked (even if not yet
      // locally expired). Normalize to token_expired so AUTH_ERROR_CODES
      // fires the needs_reauth sentinel in the publish worker.
      if (resp.status === 401) {
        return {
          success: false,
          errorCode: "token_expired",
          errorMessage: "X / Twitter access token has been revoked — reconnect the account.",
          responsePayload: parsed ?? errText,
          refreshedAccessToken,
          refreshedRefreshToken,
          refreshedTokenExpiresAt,
        };
      }
      return {
        success: false,
        errorCode: parsed?.type ? String(parsed.type).split("/").pop() : `http_${resp.status}`,
        errorMessage: parsed?.detail || parsed?.title || errText || `Twitter create tweet failed: ${resp.status}`,
        responsePayload: parsed ?? errText,
        // Always return any refreshed tokens so the caller can save them,
        // even when the tweet itself failed — rotating tokens are consumed
        // on use and must not be discarded.
        refreshedAccessToken,
        refreshedRefreshToken,
        refreshedTokenExpiresAt,
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

  /**
   * Download an image from `imageUrl` and upload it to X's media endpoint.
   * Returns the media_id_string on success, null on any failure (tweet will
   * fall back to text-only rather than failing entirely).
   *
   * X media upload lives on v1.1 (upload.twitter.com) even for OAuth 2.0
   * user-context apps. The multipart upload uses the user's Bearer token.
   */
  private async uploadMedia(accessToken: string, imageUrl: string): Promise<string | null> {
    try {
      // 1. Download the image bytes.
      // Three cases in priority order:
      //   a) SharePoint/SPE URL — requires authenticated Graph API access;
      //      plain fetch() returns 403 even though the file exists.
      //   b) /public-objects/ URL — rewrite to localhost to avoid unreliable
      //      self-requests through the public domain in production.
      //   c) Everything else (external article images etc.) — fetch as-is.
      let imageBuffer: Buffer;
      let contentType: string;

      if (/sharepoint\.com\/contentstorage\//i.test(imageUrl)) {
        try {
          const { buffer, mimeType } = await new GraphClient().downloadFileBySharePointUrl(imageUrl);
          imageBuffer = buffer;
          contentType = mimeType;
        } catch (speErr: any) {
          console.warn("[Twitter] SPE image download failed:", speErr.message);
          return null;
        }
      } else {
        const absoluteUrl = (() => {
          if (imageUrl.startsWith("/")) {
            return `http://localhost:${process.env.PORT ?? 5000}${imageUrl}`;
          }
          try {
            const parsed = new URL(imageUrl);
            if (parsed.pathname.startsWith("/public-objects/")) {
              return `http://localhost:${process.env.PORT ?? 5000}${parsed.pathname}${parsed.search}`;
            }
          } catch { /* not a valid URL — fall through */ }
          return imageUrl;
        })();

        const imgResp = await fetch(absoluteUrl);
        if (!imgResp.ok) {
          console.warn("[Twitter] Failed to fetch image for upload:", absoluteUrl, imgResp.status);
          const err: any = new Error(
            `Image fetch from Orbit storage failed with HTTP ${imgResp.status} for ${imageUrl}. ` +
            (imgResp.status === 401 || imgResp.status === 403
              ? "The image lives behind an auth-gated path — use Change Image (🖼) to pick or re-upload the graphic so it lands in public storage."
              : imgResp.status === 404
                ? "The image no longer exists at that path — use Change Image (🖼) to replace the graphic."
                : "Use the Retry button to try again."),
          );
          err.code = "image_fetch_failed";
          throw err;
        }
        imageBuffer = Buffer.from(await imgResp.arrayBuffer());
        contentType = imgResp.headers.get("content-type") ?? "image/jpeg";
      }

      // 2. Upload to X via the v2 media endpoint (multipart/form-data).
      // The legacy v1.1 upload.twitter.com endpoint was retired for
      // OAuth 2.0 apps and now answers 403 regardless of token validity.
      const form = new FormData();
      form.append("media", new Blob([imageBuffer], { type: contentType }), "image");
      form.append("media_category", "tweet_image");

      const uploadResp = await fetch(`${API_HOST}/2/media/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });

      if (!uploadResp.ok) {
        const errText = await uploadResp.text().catch(() => "");
        console.warn("[Twitter] Media upload failed:", uploadResp.status, errText);
        // 401 means the access token is expired/revoked; 403 means the token
        // lacks the media.write scope (connections made before the scope was
        // added). Both need a reconnect — throw typed errors so the caller
        // surfaces that instead of the misleading "Orbit storage" message.
        if (uploadResp.status === 401) {
          const err: any = new Error("X / Twitter access token has been revoked or expired — reconnect the account.");
          err.code = "token_expired";
          throw err;
        }
        if (uploadResp.status === 403) {
          const err: any = new Error(
            "X / Twitter rejected the image upload (missing media permission). " +
            "Reconnect the X account in Settings → Social Accounts to grant the new media upload permission, then retry.",
          );
          err.code = "media_scope_missing";
          throw err;
        }
        return null;
      }

      // v2 responds { data: { id: "..." } }; tolerate the legacy
      // media_id_string shape defensively.
      const uploadJson = await uploadResp.json() as { data?: { id?: string }; media_id_string?: string };
      const mediaId = uploadJson.data?.id ?? uploadJson.media_id_string;
      if (!mediaId) {
        console.warn("[Twitter] Media upload response missing media id:", uploadJson);
        return null;
      }

      return mediaId;
    } catch (err: any) {
      // Re-throw typed errors (e.g. token_expired) so publish() can surface
      // a targeted message instead of the generic "Orbit storage" one.
      if (err?.code) throw err;
      console.warn("[Twitter] uploadMedia error:", err.message);
      return null;
    }
  }
}
