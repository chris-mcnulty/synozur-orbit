/**
 * BlueskyPublisher — Phase 5
 *
 * Bluesky (atproto) doesn't use OAuth in the way LinkedIn/Twitter do.
 * Instead users generate an "App Password" in their Bluesky settings
 * and we authenticate against `com.atproto.server.createSession` with
 * `(identifier, appPassword)` to obtain a short-lived session JWT.
 *
 * For storage we encrypt and persist the *app password itself* as
 * `encryptedAccessToken`. Each publish:
 *  1. Re-creates a session with the stored app password.
 *  2. Posts via `com.atproto.repo.createRecord` (lexicon `app.bsky.feed.post`).
 *
 * No client credentials required at the server level — `oauthConfigured()`
 * returns true unconditionally, and `connectWithAppPassword` is the
 * non-OAuth connect entry point invoked from a dedicated route.
 *
 * Service URL is the user's PDS host. We default to `https://bsky.social`
 * but accept an override on connect for self-hosted servers.
 */

import type {
  SocialPublisher,
  PublishContext,
  PublishResult,
  OAuthCallbackResult,
} from "./index";
import { decryptSecret } from "../../utils/encryption";

const DEFAULT_SERVICE = "https://bsky.social";

interface BlueskySession {
  accessJwt: string;
  refreshJwt: string;
  did: string;
  handle: string;
}

async function createSession(
  service: string,
  identifier: string,
  password: string,
): Promise<BlueskySession> {
  const resp = await fetch(`${service}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Bluesky createSession failed: ${resp.status} ${txt}`);
  }
  return resp.json() as Promise<BlueskySession>;
}

export class BlueskyPublisher implements SocialPublisher {
  platform = "bluesky";
  supported = true;

  // Non-OAuth flow — no server-level credentials required.
  oauthConfigured(): boolean {
    return true;
  }

  // No OAuth flow — dedicated connect route handles credential entry.
  // Intentionally omitting getOAuthAuthorizeUrl / exchangeOAuthCode.

  /**
   * Validate a (handle/email, app-password) pair by creating a session,
   * and return the OAuthCallbackResult shape so the route layer can persist
   * it the same way as OAuth providers. We store the app password (encrypted)
   * as the "access token" because Bluesky sessions are short-lived; the
   * publish path always re-creates a session.
   */
  async connectWithAppPassword(
    identifier: string,
    appPassword: string,
    service: string = DEFAULT_SERVICE,
  ): Promise<OAuthCallbackResult> {
    if (!identifier?.trim() || !appPassword?.trim()) {
      throw new Error("Bluesky requires both an identifier (handle or email) and an app password");
    }
    const session = await createSession(service, identifier.trim(), appPassword.trim());
    return {
      // Store the app password ciphertext under the access-token slot; we
      // never use OAuth refresh on Bluesky.
      accessToken: appPassword.trim(),
      refreshToken: null,
      expiresAt: null,
      scope: null,
      authorMode: "person",
      authorUrn: `at://${session.did}`,
      accountId: session.did,
      accountName: session.handle,
      profileUrl: `https://bsky.app/profile/${session.handle}`,
      availableAuthors: [{
        mode: "person",
        urn: `at://${session.did}`,
        name: session.handle,
        vanityName: session.handle,
      }],
    };
  }

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const { account, post } = ctx;
    if (!account.encryptedAccessToken) {
      return {
        success: false,
        errorCode: "not_connected",
        errorMessage: "Bluesky account is not connected — re-authorize with an app password before publishing.",
      };
    }
    if (!account.accountName) {
      return {
        success: false,
        errorCode: "missing_handle",
        errorMessage: "Bluesky account is missing its handle — reconnect the account.",
      };
    }
    let appPassword: string;
    try {
      appPassword = decryptSecret(account.encryptedAccessToken);
    } catch {
      return {
        success: false,
        errorCode: "token_decrypt_failed",
        errorMessage: "Stored Bluesky app password could not be decrypted — reconnect the account.",
      };
    }

    let session: BlueskySession;
    try {
      session = await createSession(DEFAULT_SERVICE, account.accountName, appPassword);
    } catch (err: any) {
      return {
        success: false,
        errorCode: "session_failed",
        errorMessage: err.message || "Could not create Bluesky session.",
      };
    }

    const text = post.editedContent || post.content;
    const hashtags = (post.hashtags as string[] | null) ?? [];
    const finalText = hashtags.length > 0
      ? `${text}\n\n${hashtags.map(h => h.startsWith("#") ? h : `#${h}`).join(" ")}`
      : text;

    // Bluesky enforces a 300 grapheme limit. Approximate with character
    // length and surface a clear error when over — better than a 400.
    if (finalText.length > 300) {
      return {
        success: false,
        errorCode: "too_long",
        errorMessage: `Bluesky posts are limited to 300 characters; this is ${finalText.length}.`,
      };
    }

    const record = {
      $type: "app.bsky.feed.post",
      text: finalText,
      createdAt: new Date().toISOString(),
      langs: ["en"],
    };

    const resp = await fetch(`${DEFAULT_SERVICE}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.accessJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        repo: session.did,
        collection: "app.bsky.feed.post",
        record,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      let parsed: any;
      try { parsed = JSON.parse(errText); } catch {}
      return {
        success: false,
        errorCode: parsed?.error ? String(parsed.error) : `http_${resp.status}`,
        errorMessage: parsed?.message || errText || `Bluesky createRecord failed: ${resp.status}`,
        responsePayload: parsed ?? errText,
      };
    }

    const payload = await resp.json().catch(() => null) as { uri?: string; cid?: string } | null;
    const uri = payload?.uri;
    // uri shape: at://did:plc:.../app.bsky.feed.post/<rkey>. The public URL
    // uses the handle and the rkey.
    let publishedUrl: string | null = null;
    if (uri) {
      const parts = uri.split("/");
      const rkey = parts[parts.length - 1];
      if (rkey && session.handle) {
        publishedUrl = `https://bsky.app/profile/${session.handle}/post/${rkey}`;
      }
    }

    return { success: true, publishedUrl, responsePayload: payload };
  }
}
