/**
 * Tests for the LinkedIn page-admin health check (Task #790).
 *
 * Covers:
 *  1. checkPageAdminAccess — each meaningful branch:
 *     - no stored token → ok: false
 *     - no authorUrn → ok: true (nothing to validate)
 *     - expired local token → ok: false
 *     - token decryption failure → ok: false
 *     - organizationAcls HTTP 200, authorUrn present → ok: true
 *     - organizationAcls HTTP 200, authorUrn absent (access lost) → ok: false
 *     - organizationAcls throws (429 / 5xx / network error) → ok: true (transient)
 *
 *  2. tickLinkedInAdminHealthCheck — worker-level behavior:
 *     - account with lost access → status set to needs_reconnect, audit-log inserted
 *     - transient fetch error → account NOT flipped, no DB update
 *     - accounts not due for recheck (throttle) → skipped
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── In-process throttle state must be cleared between tests ──────────────────
// The throttle map is module-level in marketing-publish-worker; we reset it by
// re-importing the module after each test through a factory mock reset.

// ── Shared state ─────────────────────────────────────────────────────────────

const mockState = vi.hoisted(() => ({
  /** Accounts returned by the DB select for the health-check worker */
  accounts: [] as any[],
  /** Captured db.update().set() payloads */
  updates: [] as any[],
  /** Captured db.insert().values() payloads */
  inserts: [] as any[],
  /** Controls fetch responses: { status, body } or null (throws) */
  fetchResponse: null as null | { status: number; body?: object | string },
  /** checkPageAdminAccess result override (null → use real impl) */
  adminCheckResult: null as null | { ok: boolean; reason?: string },
}));

// ── DB mock ───────────────────────────────────────────────────────────────────

vi.mock("../../db", () => ({
  db: {
    select: (_fields?: any) => {
      const chain: any = {};
      for (const m of ["from", "innerJoin", "leftJoin"]) {
        chain[m] = () => chain;
      }
      chain.where = (_cond: any) => Promise.resolve(mockState.accounts);
      return chain;
    },
    update: (_table: any) => ({
      set: (payload: any) => ({
        where: async () => {
          mockState.updates.push(payload);
          return [];
        },
      }),
    }),
    insert: (_table: any) => ({
      values: async (payload: any) => {
        mockState.inserts.push(payload);
        return [];
      },
    }),
  },
}));

// ── Encryption mock (identity) ────────────────────────────────────────────────

vi.mock("../../utils/encryption", () => ({
  encryptSecret: (s: string) => `enc:${s}`,
  decryptSecret: (s: string) => {
    if (s === "bad-cipher") throw new Error("Decryption failed");
    return s.replace(/^enc:/, "");
  },
}));

// ── Other transitive dependencies ─────────────────────────────────────────────

vi.mock("../platform-credentials-service", () => ({
  getPlatformCredentials: async () => null,
  isLinkedInDirectPublishEnabled: () => false,
  getGlobalLinkedInCredentials: () => null,
}));

vi.mock("../linkedin-provider", () => ({
  isLinkedInMcpConfigured: () => false,
}));

vi.mock("../linkedin-mcp-client", () => ({
  callLinkedInTool: async () => ({ content: [] }),
  extractText: () => "",
}));

vi.mock("../sharepoint-graph-client.js", () => ({
  GraphClient: class {},
}));

vi.mock("../social-publishers/image-retrieval", () => ({
  fetchImageBytes: async () => ({ buffer: Buffer.alloc(0) }),
  checkImageResolvable: async () => ({ ok: true }),
  ImageRetrievalError: class extends Error {},
}));

vi.mock("../plan-policy", () => ({
  checkFeatureAccessAsync: async () => ({ allowed: true }),
}));

// ── Global fetch stub ─────────────────────────────────────────────────────────

vi.stubGlobal(
  "fetch",
  vi.fn(async (_url: string, _init?: any) => {
    if (!mockState.fetchResponse) {
      throw new Error("Network error (stub)");
    }
    const { status, body } = mockState.fetchResponse;
    const ok = status >= 200 && status < 300;
    const bodyStr =
      typeof body === "string" ? body : body != null ? JSON.stringify(body) : "";
    return {
      ok,
      status,
      headers: { get: () => null },
      json: async () => (body != null && typeof body === "object" ? body : JSON.parse(bodyStr || "{}")),
      text: async () => bodyStr,
    };
  }),
);

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { LinkedInPublisher } from "../social-publishers/linkedin";
import { tickLinkedInAdminHealthCheck } from "../marketing-publish-worker";

// ── Helpers ───────────────────────────────────────────────────────────────────

const FUTURE = new Date(Date.now() + 3_600_000); // 1 hour from now
const PAST = new Date(Date.now() - 10_000);      // 10 seconds ago

function makeAccount(overrides: Partial<{
  id: string;
  tenantDomain: string;
  marketId: string | null;
  platform: string;
  status: string;
  encryptedAccessToken: string | null;
  tokenExpiresAt: Date | null;
  authorUrn: string | null;
  publishingPaused: boolean;
  lastPublishError: string | null;
}>): any {
  return {
    id: "acct-1",
    tenantDomain: "tenant.example.com",
    marketId: null,
    platform: "linkedin",
    status: "active",
    encryptedAccessToken: "enc:valid-token",
    tokenExpiresAt: FUTURE,
    authorUrn: "urn:li:organization:123456",
    publishingPaused: false,
    lastPublishError: null,
    ...overrides,
  };
}

/** Build an organizationAcls 200 response body */
function aclsBody(orgIds: number[]) {
  return {
    elements: orgIds.map((id) => ({
      "organization~": { id, localizedName: `Org ${id}`, vanityName: null },
    })),
  };
}

// ── Reset state between tests ─────────────────────────────────────────────────

beforeEach(() => {
  mockState.accounts.length = 0;
  mockState.updates.length = 0;
  mockState.inserts.length = 0;
  mockState.fetchResponse = null;
  mockState.adminCheckResult = null;
  vi.mocked(globalThis.fetch as any).mockClear();
});

// ── checkPageAdminAccess ──────────────────────────────────────────────────────

describe("LinkedInPublisher.checkPageAdminAccess", () => {
  let publisher: LinkedInPublisher;

  beforeEach(() => {
    publisher = new LinkedInPublisher();
  });

  it("returns ok:false when no encryptedAccessToken is stored", async () => {
    const result = await publisher.checkPageAdminAccess({
      encryptedAccessToken: null,
      tokenExpiresAt: null,
      authorUrn: "urn:li:organization:123456",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no access token/i);
  });

  it("returns ok:true when no authorUrn is configured (nothing to validate)", async () => {
    const result = await publisher.checkPageAdminAccess({
      encryptedAccessToken: "enc:valid-token",
      tokenExpiresAt: FUTURE,
      authorUrn: null,
    });
    expect(result.ok).toBe(true);
  });

  it("returns ok:false when local token expiry has passed", async () => {
    const result = await publisher.checkPageAdminAccess({
      encryptedAccessToken: "enc:valid-token",
      tokenExpiresAt: PAST,
      authorUrn: "urn:li:organization:123456",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/expired/i);
  });

  it("returns ok:false when decryptSecret throws (bad cipher)", async () => {
    const result = await publisher.checkPageAdminAccess({
      encryptedAccessToken: "bad-cipher",
      tokenExpiresAt: FUTURE,
      authorUrn: "urn:li:organization:123456",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/decrypted/i);
  });

  it("returns ok:true when organizationAcls 200 includes the configured authorUrn", async () => {
    mockState.fetchResponse = { status: 200, body: aclsBody([123456]) };

    const result = await publisher.checkPageAdminAccess({
      encryptedAccessToken: "enc:valid-token",
      tokenExpiresAt: FUTURE,
      authorUrn: "urn:li:organization:123456",
    });
    expect(result.ok).toBe(true);
  });

  it("returns ok:false when organizationAcls 200 does not include the configured authorUrn (access lost)", async () => {
    // The account is admin of org 999 but configured to post as org 123456
    mockState.fetchResponse = { status: 200, body: aclsBody([999]) };

    const result = await publisher.checkPageAdminAccess({
      encryptedAccessToken: "enc:valid-token",
      tokenExpiresAt: FUTURE,
      authorUrn: "urn:li:organization:123456",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/page admin access lost/i);
    expect(result.reason).toMatch(/urn:li:organization:123456/);
  });

  it("returns ok:false when organizationAcls 200 returns an empty list (no orgs)", async () => {
    mockState.fetchResponse = { status: 200, body: aclsBody([]) };

    const result = await publisher.checkPageAdminAccess({
      encryptedAccessToken: "enc:valid-token",
      tokenExpiresAt: FUTURE,
      authorUrn: "urn:li:organization:123456",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/page admin access lost/i);
  });

  it("returns ok:true (transient) when organizationAcls returns 429 (rate limit)", async () => {
    mockState.fetchResponse = { status: 429, body: "Too Many Requests" };

    const result = await publisher.checkPageAdminAccess({
      encryptedAccessToken: "enc:valid-token",
      tokenExpiresAt: FUTURE,
      authorUrn: "urn:li:organization:123456",
    });
    expect(result.ok).toBe(true);
  });

  it("returns ok:true (transient) when organizationAcls returns 500 (server error)", async () => {
    mockState.fetchResponse = { status: 500, body: "Internal Server Error" };

    const result = await publisher.checkPageAdminAccess({
      encryptedAccessToken: "enc:valid-token",
      tokenExpiresAt: FUTURE,
      authorUrn: "urn:li:organization:123456",
    });
    expect(result.ok).toBe(true);
  });

  it("returns ok:true (transient) when organizationAcls returns 401 (revoked token)", async () => {
    // A revoked token during the health check is treated as transient — the
    // publish worker will catch the real 401 at publish time and flag it then.
    mockState.fetchResponse = { status: 401, body: "Unauthorized" };

    const result = await publisher.checkPageAdminAccess({
      encryptedAccessToken: "enc:valid-token",
      tokenExpiresAt: FUTURE,
      authorUrn: "urn:li:organization:123456",
    });
    expect(result.ok).toBe(true);
  });

  it("returns ok:true (transient) when fetch throws a network error", async () => {
    // mockState.fetchResponse = null → the stub throws
    mockState.fetchResponse = null;

    const result = await publisher.checkPageAdminAccess({
      encryptedAccessToken: "enc:valid-token",
      tokenExpiresAt: FUTURE,
      authorUrn: "urn:li:organization:123456",
    });
    expect(result.ok).toBe(true);
  });

  it("returns ok:true without calling the API for a personal-profile author (urn:li:person:...)", async () => {
    // Personal-profile URNs never appear in organizationAcls — the check
    // must short-circuit and not attempt a network call.
    const result = await publisher.checkPageAdminAccess({
      encryptedAccessToken: "enc:valid-token",
      tokenExpiresAt: FUTURE,
      authorUrn: "urn:li:person:ABCDE12345",
    });
    expect(result.ok).toBe(true);
    // fetch should not have been called (mockState.fetchResponse is null, which
    // would throw if fetch were invoked)
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });
});

// ── tickLinkedInAdminHealthCheck ──────────────────────────────────────────────

describe("tickLinkedInAdminHealthCheck", () => {
  // The worker has an in-process throttle (linkedInAdminCheckLastRun). To reset
  // it between tests we use a fresh account id each time.
  let acctN = 0;
  const freshId = () => `acct-throttle-${++acctN}`;

  it("sets status=needs_reconnect and inserts an audit-log row when access is lost", async () => {
    const id = freshId();
    mockState.accounts.push(makeAccount({
      id,
      encryptedAccessToken: "enc:valid-token",
      authorUrn: "urn:li:organization:123456",
    }));
    // organizationAcls returns 200 with a different org → access lost
    mockState.fetchResponse = { status: 200, body: aclsBody([999]) };

    const result = await tickLinkedInAdminHealthCheck();

    expect(result.checked).toBe(1);
    expect(result.flagged).toBe(1);

    const update = mockState.updates.find((u) => u.status === "needs_reconnect");
    expect(update).toBeDefined();
    expect(update.lastPublishError).toMatch(/page admin access lost/i);

    expect(mockState.inserts.length).toBeGreaterThanOrEqual(1);
    const logEntry = mockState.inserts.find(
      (i) => i.action === "social_account_health" && i.entityId === id,
    );
    expect(logEntry).toBeDefined();
    expect(logEntry.status).toBe("warning");
  });

  it("does NOT update the account when organizationAcls throws (transient error)", async () => {
    const id = freshId();
    mockState.accounts.push(makeAccount({ id }));
    // null → fetch throws a network error
    mockState.fetchResponse = null;

    const result = await tickLinkedInAdminHealthCheck();

    expect(result.checked).toBe(1);
    expect(result.flagged).toBe(0);
    // No status update should have been written
    const statusUpdate = mockState.updates.find((u) => u.status === "needs_reconnect");
    expect(statusUpdate).toBeUndefined();
  });

  it("does NOT update the account when organizationAcls returns 429 (transient)", async () => {
    const id = freshId();
    mockState.accounts.push(makeAccount({ id }));
    mockState.fetchResponse = { status: 429, body: "Too Many Requests" };

    const result = await tickLinkedInAdminHealthCheck();

    expect(result.checked).toBe(1);
    expect(result.flagged).toBe(0);
    expect(mockState.updates.find((u) => u.status === "needs_reconnect")).toBeUndefined();
  });

  it("does NOT flag a personal-profile author account even when organizationAcls shows no orgs", async () => {
    // Defense-in-depth: the worker filters by authorMode='organization' at the
    // query level, but checkPageAdminAccess also short-circuits on person URNs.
    // This test verifies the guard works even if a person-mode account slips
    // through the query filter (e.g. authorMode column is null).
    const id = freshId();
    mockState.accounts.push(makeAccount({
      id,
      authorUrn: "urn:li:person:ABCDE12345",
    }));
    // organizationAcls returns 200 with no orgs — would flag an org account
    mockState.fetchResponse = { status: 200, body: aclsBody([]) };

    const result = await tickLinkedInAdminHealthCheck();

    expect(result.flagged).toBe(0);
    expect(mockState.updates.find((u) => u.status === "needs_reconnect")).toBeUndefined();
    // The API must not have been called for a person-URN account
    expect(vi.mocked(globalThis.fetch as any)).not.toHaveBeenCalled();
  });

  it("skips accounts already checked within the throttle window", async () => {
    // Same id — throttle map already has this id from the previous test isn't
    // guaranteed. Use a fresh id AND call the worker twice in the same test.
    const id = freshId();
    mockState.accounts.push(makeAccount({ id }));
    mockState.fetchResponse = { status: 200, body: aclsBody([999]) };

    // First call — should check
    await tickLinkedInAdminHealthCheck();
    const firstUpdateCount = mockState.updates.length;

    // Second call in the same in-process run — throttle should skip it
    mockState.accounts.push(makeAccount({ id })); // push the same account again
    const result2 = await tickLinkedInAdminHealthCheck();

    expect(result2.checked).toBe(0);
    expect(mockState.updates.length).toBe(firstUpdateCount); // no new updates
  });
});
