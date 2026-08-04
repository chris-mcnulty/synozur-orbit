/**
 * Tests for the LinkedIn token-expiry / needs_reauth sentinel flow.
 *
 * Covers three behaviours:
 *   1. getTenantLinkedInAccessToken writes the "needs_reauth" sentinel to
 *      lastPublishError when the access token is expired and refresh cannot
 *      produce a new token.
 *   2. refreshLinkedInToken on a successful LinkedIn response clears
 *      lastPublishError to null.
 *   3. The "already marked" guard: if lastPublishError is already
 *      "needs_reauth", no redundant DB write is issued.
 *
 * All I/O (DB + fetch) is mocked so the suite runs in-process with no
 * database or network.
 */

import { describe, it, vi, expect, beforeEach } from "vitest";

// ── Shared mutable state surfaced to test bodies ──────────────────────────────
// vi.hoisted runs before vi.mock, so the same objects are available inside
// the mock factory and in the test bodies below.

const mockState = vi.hoisted(() => ({
  /** Queue of account-row arrays returned by db.select()...limit() */
  selectQueue: [] as any[][],
  /** Captured payloads passed to db.update().set() */
  updateSets: [] as any[],
  /** Stub fetch response (null → throw network error) */
  fetchResponse: null as null | { ok: boolean; json?: () => any; text?: () => any },
}));

// ── DB mock ───────────────────────────────────────────────────────────────────

vi.mock("../../db", () => {
  return {
    db: {
      select: (_fields?: any) => ({
        from: (_table: any) => ({
          where: (_cond: any) => ({
            limit: (_n: number) =>
              Promise.resolve(mockState.selectQueue.shift() ?? []),
          }),
        }),
      }),
      update: (_table: any) => ({
        set: (payload: any) => {
          mockState.updateSets.push(payload);
          return { where: (_cond: any) => Promise.resolve([]) };
        },
      }),
    },
  };
});

// ── Encryption mock (identity — encrypt is a no-op prefix, decrypt strips it) ─

vi.mock("../../utils/encryption", () => ({
  encryptSecret: (s: string) => `enc:${s}`,
  decryptSecret: (s: string) => s.replace(/^enc:/, ""),
}));

// ── Platform credentials mock ─────────────────────────────────────────────────

vi.mock("../platform-credentials-service", () => ({
  getGlobalLinkedInCredentials: () => ({
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
  }),
}));

// ── Storage mock (not used by the paths under test but required for import) ───

vi.mock("../../storage", () => ({
  storage: { getTenantByDomain: vi.fn().mockResolvedValue(null) },
}));

// ── Global fetch stub ─────────────────────────────────────────────────────────

vi.stubGlobal(
  "fetch",
  vi.fn(async () => {
    if (!mockState.fetchResponse) throw new Error("Network error (stub)");
    const r = mockState.fetchResponse;
    return {
      ok: r.ok,
      status: r.ok ? 200 : 400,
      json: r.json ?? (() => Promise.resolve({})),
      text: r.text ?? (() => Promise.resolve("")),
    };
  }),
);

// ── Imports (must come after vi.mock calls) ───────────────────────────────────

import {
  getTenantLinkedInAccessToken,
  refreshLinkedInToken,
} from "../linkedin-api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAccount(overrides: Partial<{
  id: string;
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  tokenExpiresAt: Date | null;
  lastPublishError: string | null;
}>): any {
  return {
    id: "acct-test-1",
    encryptedAccessToken: "enc:valid-access-token",
    encryptedRefreshToken: null,
    tokenExpiresAt: null,
    lastPublishError: null,
    ...overrides,
  };
}

const EXPIRED = new Date(Date.now() - 10_000); // 10 s in the past

beforeEach(() => {
  // Reset shared state before each test.
  mockState.selectQueue.length = 0;
  mockState.updateSets.length = 0;
  mockState.fetchResponse = null;
});

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("getTenantLinkedInAccessToken — needs_reauth sentinel", () => {
  it("writes 'needs_reauth' when access token is expired and no refresh token is stored", async () => {
    mockState.selectQueue.push([
      makeAccount({
        tokenExpiresAt: EXPIRED,
        encryptedRefreshToken: null,
        lastPublishError: null,
      }),
    ]);

    const result = await getTenantLinkedInAccessToken("tenant.example.com");

    expect(result).toBeNull();

    const sentinelWrite = mockState.updateSets.find(
      (s) => s.lastPublishError === "needs_reauth",
    );
    expect(sentinelWrite).toBeDefined();
    expect(sentinelWrite.lastPublishError).toBe("needs_reauth");
  });

  it("writes 'needs_reauth' when access token is expired and the refresh call fails (400)", async () => {
    mockState.selectQueue.push([
      makeAccount({
        tokenExpiresAt: EXPIRED,
        encryptedRefreshToken: "enc:some-refresh-token",
        lastPublishError: null,
      }),
    ]);

    // Simulate LinkedIn returning 400 on the refresh attempt.
    mockState.fetchResponse = {
      ok: false,
      text: () => Promise.resolve("invalid_grant"),
    };

    const result = await getTenantLinkedInAccessToken("tenant.example.com");

    expect(result).toBeNull();

    const sentinelWrite = mockState.updateSets.find(
      (s) => s.lastPublishError === "needs_reauth",
    );
    expect(sentinelWrite).toBeDefined();
    expect(sentinelWrite.lastPublishError).toBe("needs_reauth");
  });

  it("does NOT issue a redundant DB write when lastPublishError is already 'needs_reauth'", async () => {
    // Already marked — the guard in getTenantLinkedInAccessToken should skip
    // the update to avoid unnecessary writes on every publish attempt.
    mockState.selectQueue.push([
      makeAccount({
        tokenExpiresAt: EXPIRED,
        encryptedRefreshToken: null,
        lastPublishError: "needs_reauth",
      }),
    ]);

    await getTenantLinkedInAccessToken("tenant.example.com");

    // No new update payload should carry "needs_reauth" (was already set).
    const redundantWrite = mockState.updateSets.find(
      (s) => s.lastPublishError === "needs_reauth",
    );
    expect(redundantWrite).toBeUndefined();
  });

  it("returns the decrypted token and does NOT write sentinel when token is still valid", async () => {
    const futureExpiry = new Date(Date.now() + 3_600_000); // 1 h from now
    mockState.selectQueue.push([
      makeAccount({
        encryptedAccessToken: "enc:my-access-token",
        tokenExpiresAt: futureExpiry,
        lastPublishError: null,
      }),
    ]);

    const result = await getTenantLinkedInAccessToken("tenant.example.com");

    expect(result).toBe("my-access-token");
    const sentinelWrite = mockState.updateSets.find(
      (s) => s.lastPublishError === "needs_reauth",
    );
    expect(sentinelWrite).toBeUndefined();
  });
});

describe("refreshLinkedInToken — clears lastPublishError on success", () => {
  it("sets lastPublishError to null in the DB update when LinkedIn returns a new access_token", async () => {
    mockState.fetchResponse = {
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "new-access-token",
          expires_in: 5184000,
          refresh_token: "new-refresh-token",
        }),
    };

    const result = await refreshLinkedInToken(
      "acct-test-1",
      "enc:old-refresh-token",
      "tenant.example.com",
    );

    expect(result).toBe("new-access-token");

    // The DB update that persists the fresh tokens must clear lastPublishError.
    expect(mockState.updateSets.length).toBeGreaterThanOrEqual(1);
    const tokenUpdate = mockState.updateSets[mockState.updateSets.length - 1];
    expect(tokenUpdate.lastPublishError).toBeNull();
    expect(tokenUpdate.encryptedAccessToken).toBe("enc:new-access-token");
  });

  it("returns null and does not write the cleared flag when LinkedIn returns non-ok", async () => {
    mockState.fetchResponse = {
      ok: false,
      text: () => Promise.resolve("token_expired"),
    };

    const result = await refreshLinkedInToken(
      "acct-test-1",
      "enc:old-refresh-token",
      "tenant.example.com",
    );

    expect(result).toBeNull();
    // No DB update should have been attempted on a failed refresh.
    expect(mockState.updateSets.length).toBe(0);
  });
});
