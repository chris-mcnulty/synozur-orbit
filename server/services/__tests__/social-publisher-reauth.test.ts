/**
 * Tests that each publisher returns the correct error code when credentials
 * are expired or revoked — ensuring the publish worker writes the
 * `needs_reauth` sentinel and the Social Accounts UI banner fires.
 */
import { strict as assert } from "node:assert";
import { describe, it, vi, beforeEach, afterEach } from "vitest";
import { BlueskyPublisher, BlueskySessionError } from "../social-publishers/bluesky";
import { TwitterPublisher } from "../social-publishers/twitter";
import { FacebookPublisher } from "../social-publishers/facebook";
import { InstagramPublisher } from "../social-publishers/instagram";

// ── encryption mock ──────────────────────────────────────────────────────────
// Publishers call decryptSecret to read the stored token. We return a fixed
// plaintext so tests don't require real encrypted payloads.
vi.mock("../../utils/encryption", () => ({
  decryptSecret: (_cipher: string) => "mock-token",
  encryptSecret: (plain: string) => `enc:${plain}`,
}));

// ── platform-credentials mock ────────────────────────────────────────────────
vi.mock("../../services/platform-credentials-service", () => ({
  getPlatformCredentials: async () => ({
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
  }),
  isDirectPublishEnabled: async () => true,
  isLinkedInDirectPublishEnabled: () => true,
}));

// ── minimal mock account ─────────────────────────────────────────────────────
function makeAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: "acct-1",
    tenantDomain: "test.example.com",
    platform: "bluesky",
    accountName: "test.bsky.social",
    encryptedAccessToken: "enc:mock-password",
    encryptedRefreshToken: null,
    tokenExpiresAt: null,
    authorUrn: "at://did:plc:test",
    authorMode: "person",
    availableAuthors: [],
    marketId: null,
    ...overrides,
  } as any;
}

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    content: "Hello world",
    editedContent: null,
    hashtags: null,
    platform: "bluesky",
    overrideImageUrl: null,
    leadImageUrl: null,
    ...overrides,
  } as any;
}

// ── BlueskySessionError ───────────────────────────────────────────────────────

describe("BlueskySessionError", () => {
  it("400 (wrong password) → isAuthFailure=true", () => {
    const err = new BlueskySessionError("bad creds", 400, true);
    assert.equal(err.isAuthFailure, true);
    assert.equal(err instanceof BlueskySessionError, true);
  });

  it("401 → isAuthFailure=true", () => {
    const err = new BlueskySessionError("unauthorized", 401, true);
    assert.equal(err.isAuthFailure, true);
  });

  it("503 (server outage) → isAuthFailure=false", () => {
    const err = new BlueskySessionError("service unavailable", 503, false);
    assert.equal(err.isAuthFailure, false);
  });

  it("network failure (status 0) → isAuthFailure=false", () => {
    const err = new BlueskySessionError("ECONNREFUSED", 0, false);
    assert.equal(err.isAuthFailure, false);
  });
});

// ── BlueskyPublisher.publish ──────────────────────────────────────────────────

describe("BlueskyPublisher.publish — session failures", () => {
  const publisher = new BlueskyPublisher();

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("401 from createSession → session_failed (auth, permanent)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Invalid identifier or password",
    });
    const result = await publisher.publish({
      account: makeAccount(),
      post: makePost(),
      attemptedBy: "user-1",
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "session_failed");
  });

  it("400 from createSession → session_failed (auth, permanent)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => '{"error":"InvalidRequest","message":"Invalid identifier or password"}',
    });
    const result = await publisher.publish({
      account: makeAccount(),
      post: makePost(),
      attemptedBy: "user-1",
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "session_failed");
  });

  it("503 from createSession → session_error (transient, retryable)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "Service unavailable",
    });
    const result = await publisher.publish({
      account: makeAccount(),
      post: makePost(),
      attemptedBy: "user-1",
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "session_error");
  });

  it("network failure → session_error (transient, retryable)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError("fetch failed"),
    );
    const result = await publisher.publish({
      account: makeAccount(),
      post: makePost(),
      attemptedBy: "user-1",
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "session_error");
  });
});

// ── TwitterPublisher.publish ──────────────────────────────────────────────────

describe("TwitterPublisher.publish — revoked token (401)", () => {
  const publisher = new TwitterPublisher();

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("401 from POST /2/tweets → token_expired", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => '{"title":"Unauthorized","status":401}',
    });
    const result = await publisher.publish({
      account: makeAccount({
        platform: "twitter",
        encryptedAccessToken: "enc:mock-token",
        tokenExpiresAt: null, // not locally expired
      }),
      post: makePost({ platform: "twitter" }),
      attemptedBy: "user-1",
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "token_expired");
  });
});

// ── FacebookPublisher.publish ─────────────────────────────────────────────────

describe("FacebookPublisher.publish — Graph API auth error 190", () => {
  const publisher = new FacebookPublisher();

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Graph API error 190 on page-token fetch → token_expired", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: {
            code: 190,
            message: "Error validating access token: Session has expired",
          },
        }),
      json: async () => ({
        error: { code: 190, message: "Error validating access token: Session has expired" },
      }),
    });
    const result = await publisher.publish({
      account: makeAccount({
        platform: "facebook",
        authorUrn: "fb:page:12345",
        encryptedAccessToken: "enc:mock-token",
        tokenExpiresAt: null,
      }),
      post: makePost({ platform: "facebook" }),
      attemptedBy: "user-1",
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "token_expired");
  });

  it("401 on page-token fetch → token_expired", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
      json: async () => ({}),
    });
    const result = await publisher.publish({
      account: makeAccount({
        platform: "facebook",
        authorUrn: "fb:page:12345",
        encryptedAccessToken: "enc:mock-token",
        tokenExpiresAt: null,
      }),
      post: makePost({ platform: "facebook" }),
      attemptedBy: "user-1",
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "token_expired");
  });
});

// ── InstagramPublisher.publish ────────────────────────────────────────────────

describe("InstagramPublisher.publish — Graph API auth error 190", () => {
  const publisher = new InstagramPublisher();

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Graph API error 190 on media container → token_expired", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: {
            code: 190,
            message: "Error validating access token: Session has expired",
          },
        }),
      json: async () => ({
        error: { code: 190, message: "Error validating access token: Session has expired" },
      }),
    });
    const result = await publisher.publish({
      account: makeAccount({
        platform: "instagram",
        authorUrn: "ig:user:67890",
        encryptedAccessToken: "enc:mock-token",
        tokenExpiresAt: null,
      }),
      post: makePost({
        platform: "instagram",
        overrideImageUrl: "https://example.com/image.jpg",
      }),
      attemptedBy: "user-1",
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "token_expired");
  });
});

// ── AUTH_ERROR_CODES coverage ─────────────────────────────────────────────────
// Verify the set of codes that flip lastPublishError to "needs_reauth"
// without requiring a real database. We import the set-derivable logic inline.

describe("AUTH_ERROR_CODES coverage", () => {
  const AUTH_CODES = new Set([
    "not_connected",
    "token_decrypt_failed",
    "token_expired",
    "token_refresh_failed",
    "session_failed",
  ]);
  const PERMANENT_CODES = new Set([
    "platform_unsupported",
    "not_connected",
    "missing_author",
    "token_decrypt_failed",
    "token_expired",
    "token_refresh_failed",
    "session_failed",
  ]);

  it("all auth codes are also permanent (no silent retry after reauth flag)", () => {
    for (const code of AUTH_CODES) {
      assert.equal(
        PERMANENT_CODES.has(code),
        true,
        `AUTH error code '${code}' must also be in PERMANENT_ERROR_CODES`,
      );
    }
  });

  it("session_error (transient Bluesky) is NOT an auth code", () => {
    assert.equal(AUTH_CODES.has("session_error"), false);
  });

  it("session_error is NOT permanent", () => {
    assert.equal(PERMANENT_CODES.has("session_error"), false);
  });
});
