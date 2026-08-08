/**
 * Twitter (X) token-rotation safety tests — Task #661
 *
 * X refresh tokens are single-use: reusing one makes X revoke the whole
 * account grant. These tests pin the three defenses in TwitterPublisher:
 *   1. Concurrent publish() calls for the same account serialize — only ONE
 *      token refresh ever hits the OAuth endpoint.
 *   2. Rotated tokens are persisted to social_accounts BEFORE the queued
 *      publish re-reads the account row.
 *   3. Refresh fires when the token expires within 60s (early refresh), and
 *      does NOT fire when the token is still comfortably valid.
 *
 * All I/O (DB + fetch) is mocked; no network or database required.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Shared mutable state (hoisted so mock factories can see it) ──────────────
const state = vi.hoisted(() => ({
  /** The single social_accounts row, mutated by db.update mocks. */
  accountRow: {} as any,
  /** Ordered event log: select / refresh / persist / tweet. */
  events: [] as string[],
  refreshCount: 0,
  /** Authorization headers seen by POST /2/tweets, in order. */
  tweetTokens: [] as string[],
  /** refresh_token values sent to the OAuth endpoint, in order. */
  refreshTokensSent: [] as string[],
}));

// ── DB mock: one in-memory account row ───────────────────────────────────────
vi.mock("../../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          state.events.push("select");
          return [{ ...state.accountRow }];
        },
      }),
    }),
    update: () => ({
      set: (payload: any) => ({
        where: async () => {
          state.events.push("persist");
          Object.assign(state.accountRow, payload);
          return [];
        },
      }),
    }),
  },
}));

// ── Encryption mock (reversible prefix) ──────────────────────────────────────
vi.mock("../../utils/encryption", () => ({
  encryptSecret: (s: string) => `enc:${s}`,
  decryptSecret: (s: string) => {
    if (!s.startsWith("enc:")) throw new Error("bad ciphertext");
    return s.slice(4);
  },
}));

// ── Platform credentials mock (public client — PKCE only) ────────────────────
vi.mock("../platform-credentials-service", () => ({
  getPlatformCredentials: async () => ({ clientId: "test-client-id" }),
  isDirectPublishEnabled: async () => true,
}));

import { TwitterPublisher } from "../social-publishers/twitter";

function resetAccount(overrides: Record<string, unknown> = {}) {
  state.accountRow = {
    id: "acct-1",
    tenantDomain: "test.example.com",
    platform: "twitter",
    encryptedAccessToken: "enc:old-access",
    encryptedRefreshToken: "enc:old-refresh",
    tokenExpiresAt: new Date(Date.now() + 3600_000),
    authorUrn: "urn:twitter:user:123",
    authorMode: "person",
    availableAuthors: [],
    marketId: null,
    ...overrides,
  };
}

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    content: "Hello world",
    editedContent: null,
    hashtags: null,
    platform: "twitter",
    overrideImageUrl: null,
    leadImageUrl: null,
    ...overrides,
  } as any;
}

beforeEach(() => {
  state.events.length = 0;
  state.tweetTokens.length = 0;
  state.refreshTokensSent.length = 0;
  state.refreshCount = 0;
  resetAccount();

  vi.stubGlobal("fetch", vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    if (u.includes("/2/oauth2/token")) {
      state.events.push("refresh");
      state.refreshCount += 1;
      const n = state.refreshCount;
      const body = new URLSearchParams(String(init?.body ?? ""));
      state.refreshTokensSent.push(body.get("refresh_token") ?? "");
      return {
        ok: true,
        json: async () => ({
          access_token: `access-${n}`,
          refresh_token: `refresh-${n}`,
          expires_in: 7200,
        }),
      };
    }
    if (u.includes("/2/tweets")) {
      state.events.push("tweet");
      state.tweetTokens.push(init?.headers?.Authorization ?? "");
      return {
        ok: true,
        json: async () => ({ data: { id: "111" } }),
      };
    }
    throw new Error(`unexpected fetch: ${u}`);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TwitterPublisher — 60s early token refresh", () => {
  it("refreshes when the token expires within 60s and persists rotated tokens immediately", async () => {
    resetAccount({ tokenExpiresAt: new Date(Date.now() + 30_000) });
    const publisher = new TwitterPublisher();

    const result = await publisher.publish({ account: { ...state.accountRow }, post: makePost() });

    expect(result.success).toBe(true);
    expect(state.refreshCount).toBe(1);
    expect(state.refreshTokensSent).toEqual(["old-refresh"]);
    // Tweet used the freshly-issued access token.
    expect(state.tweetTokens).toEqual(["Bearer access-1"]);
    // Rotated tokens were persisted to the account row BEFORE publish resolved.
    expect(state.accountRow.encryptedAccessToken).toBe("enc:access-1");
    expect(state.accountRow.encryptedRefreshToken).toBe("enc:refresh-1");
    expect(state.accountRow.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now() + 3600_000);
    // And persistence happened before the tweet was sent.
    expect(state.events.indexOf("persist")).toBeLessThan(state.events.indexOf("tweet"));
    // Refreshed tokens are also surfaced on the result for the caller.
    expect(result.refreshedAccessToken).toBe("access-1");
    expect(result.refreshedRefreshToken).toBe("refresh-1");
  });

  it("does NOT refresh when the token is valid for more than 60s", async () => {
    resetAccount({ tokenExpiresAt: new Date(Date.now() + 120_000) });
    const publisher = new TwitterPublisher();

    const result = await publisher.publish({ account: { ...state.accountRow }, post: makePost() });

    expect(result.success).toBe(true);
    expect(state.refreshCount).toBe(0);
    expect(state.tweetTokens).toEqual(["Bearer old-access"]);
    // Stored tokens untouched.
    expect(state.accountRow.encryptedAccessToken).toBe("enc:old-access");
    expect(state.accountRow.encryptedRefreshToken).toBe("enc:old-refresh");
  });
});

describe("TwitterPublisher — per-account serialization under concurrency", () => {
  it("two concurrent publishes for the same account trigger exactly ONE refresh", async () => {
    resetAccount({ tokenExpiresAt: new Date(Date.now() + 30_000) });
    const publisher = new TwitterPublisher();
    // Both callers captured the SAME stale account snapshot (expired token,
    // old refresh token) — exactly the scenario that used to burn the grant.
    const staleSnapshot = { ...state.accountRow };

    const [r1, r2] = await Promise.all([
      publisher.publish({ account: { ...staleSnapshot }, post: makePost({ id: "post-1" }) }),
      publisher.publish({ account: { ...staleSnapshot }, post: makePost({ id: "post-2" }) }),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    // The single-use refresh token was consumed exactly once.
    expect(state.refreshCount).toBe(1);
    expect(state.refreshTokensSent).toEqual(["old-refresh"]);
    // Both tweets went out with the rotated access token — the second
    // publish re-read the persisted row instead of reusing its stale copy.
    expect(state.tweetTokens).toEqual(["Bearer access-1", "Bearer access-1"]);
  });

  it("persists rotated tokens before the queued publish re-reads the account row", async () => {
    resetAccount({ tokenExpiresAt: new Date(Date.now() + 30_000) });
    const publisher = new TwitterPublisher();
    const staleSnapshot = { ...state.accountRow };

    await Promise.all([
      publisher.publish({ account: { ...staleSnapshot }, post: makePost({ id: "post-1" }) }),
      publisher.publish({ account: { ...staleSnapshot }, post: makePost({ id: "post-2" }) }),
    ]);

    // Event order: the 2nd publish's account re-read ("select") must come
    // AFTER the rotated tokens were persisted ("persist").
    const selects = state.events
      .map((e, i) => (e === "select" ? i : -1))
      .filter((i) => i >= 0);
    expect(selects.length).toBe(2);
    const persistIdx = state.events.indexOf("persist");
    expect(persistIdx).toBeGreaterThan(selects[0]);
    expect(persistIdx).toBeLessThan(selects[1]);
    // Fully serialized: the first tweet completes before the 2nd select.
    expect(state.events.indexOf("tweet")).toBeLessThan(selects[1]);
  });

  it("publishes for DIFFERENT accounts are not serialized against each other", async () => {
    resetAccount({ tokenExpiresAt: new Date(Date.now() + 3600_000) });
    const publisher = new TwitterPublisher();
    const a1 = { ...state.accountRow, id: "acct-1" };
    const a2 = { ...state.accountRow, id: "acct-2" };

    const [r1, r2] = await Promise.all([
      publisher.publish({ account: a1, post: makePost({ id: "post-1" }) }),
      publisher.publish({ account: a2, post: makePost({ id: "post-2" }) }),
    ]);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(state.tweetTokens.length).toBe(2);
  });
});
