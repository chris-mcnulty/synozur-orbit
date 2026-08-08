/**
 * Marketing publish worker — token-rotation safety (Task #661)
 *
 * When two queued posts for the SAME X account are processed in a single
 * worker tick, the first publish may rotate the (single-use) refresh token.
 * The worker must:
 *   - persist the refreshed tokens to social_accounts immediately, and
 *   - re-fetch the account row before the second publish so it uses the
 *     rotated token instead of the stale snapshot captured at tick start.
 *
 * DB and publisher are fully mocked; the 12s inter-post pacing is driven
 * with fake timers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  /** Rows returned by the candidates query ({post, account} pairs). */
  candidates: [] as any[],
  /** Live social_accounts row — mutated by db.update mocks. */
  accountRow: {} as any,
  tenantRow: { plan: "pro", socialPostingJitterEnabled: false },
  /** Every payload passed to db.update().set(). */
  updates: [] as any[],
  /** Snapshot of ctx.account seen by each publisher.publish call. */
  publishCalls: [] as Array<{ encryptedAccessToken: string; encryptedRefreshToken: string }>,
  /** When true, the first publish fails but still returns rotated tokens. */
  failFirst: false,
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
// Distinguish queries by their select() shape:
//   select({post, account})  → candidates query
//   select({plan}) / select({socialPostingJitterEnabled}) → tenants lookups
//   select()                 → the pre-publish account re-fetch
vi.mock("../../db", () => ({
  db: {
    select: (fields?: any) => {
      const result =
        fields && "post" in fields
          ? state.candidates
          : fields
            ? [state.tenantRow]
            : [{ ...state.accountRow }];
      const c: any = {};
      for (const m of ["from", "innerJoin", "leftJoin", "where"]) c[m] = () => c;
      c.limit = () => Promise.resolve(result);
      c.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
      return c;
    },
    update: () => ({
      set: (payload: any) => ({
        where: async () => {
          state.updates.push(payload);
          // Token persistence targets social_accounts — mirror it into the
          // live row so the next account re-fetch sees the rotated tokens.
          if ("encryptedAccessToken" in payload) {
            Object.assign(state.accountRow, payload);
          }
          return [];
        },
      }),
    }),
    insert: () => ({ values: async () => [] }),
  },
}));

vi.mock("../../utils/encryption", () => ({
  encryptSecret: (s: string) => `enc:${s}`,
  decryptSecret: (s: string) => s.replace(/^enc:/, ""),
}));

vi.mock("../plan-policy", () => ({
  checkFeatureAccessAsync: async () => ({ allowed: true }),
}));

// ── Publisher mock ────────────────────────────────────────────────────────────
// First publish rotates the token (returns refreshed* fields); second doesn't.
vi.mock("../social-publishers", () => ({
  getPublisher: () => ({
    platform: "twitter",
    supported: true,
    publish: async (ctx: any) => {
      state.publishCalls.push({
        encryptedAccessToken: ctx.account.encryptedAccessToken,
        encryptedRefreshToken: ctx.account.encryptedRefreshToken,
      });
      if (state.publishCalls.length === 1) {
        const refreshed = {
          refreshedAccessToken: "new-access",
          refreshedRefreshToken: "new-refresh",
          refreshedTokenExpiresAt: new Date(Date.now() + 7200_000),
        };
        if (state.failFirst) {
          // X consumed the refresh token before the tweet itself failed —
          // the rotated tokens MUST still be returned and saved.
          return { success: false, errorCode: "http_500", errorMessage: "boom", ...refreshed };
        }
        return { success: true, publishedUrl: "https://twitter.com/i/status/1", ...refreshed };
      }
      return { success: true, publishedUrl: "https://twitter.com/i/status/2" };
    },
  }),
}));

import { tickMarketingPublishWorker } from "../marketing-publish-worker";

beforeEach(() => {
  vi.useFakeTimers();
  state.updates.length = 0;
  state.publishCalls.length = 0;
  state.failFirst = false;
  state.accountRow = {
    id: "acct-1",
    tenantDomain: "test.example.com",
    platform: "twitter",
    status: "active",
    publishingPaused: false,
    encryptedAccessToken: "enc:old-access",
    encryptedRefreshToken: "enc:old-refresh",
    tokenExpiresAt: new Date(Date.now() + 30_000),
    marketId: null,
  };
  const now = Date.now();
  const makePost = (id: string, minsAgo: number) => ({
    id,
    tenantDomain: "test.example.com",
    platform: "twitter",
    status: "approved",
    content: `post ${id}`,
    editedContent: null,
    hashtags: null,
    socialAccountId: "acct-1",
    campaignId: null,
    deliveryMode: null,
    // Distinct minutes → no same-minute stagger; publishNotBefore set and in
    // the past → jitter assignment is skipped.
    scheduledDate: new Date(now - minsAgo * 60_000),
    publishNotBefore: new Date(now - 60_000),
    publishNextAttemptAt: null,
    publishAttemptCount: 0,
    exactSchedule: false,
  });
  // Both candidate rows carry the SAME stale account snapshot captured at
  // tick start — exactly what the worker must not trust after post #1.
  const staleAccount = { ...state.accountRow };
  state.candidates = [
    { post: makePost("post-1", 5), account: staleAccount },
    { post: makePost("post-2", 3), account: staleAccount },
  ];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("publish worker — two posts, one account, one tick", () => {
  it("second post uses the refreshed token persisted by the first publish", async () => {
    const tick = tickMarketingPublishWorker();
    // Drive the 12s inter-post pacing sleep.
    await vi.advanceTimersByTimeAsync(30_000);
    const res = await tick;

    expect(res.processed).toBe(2);
    expect(res.published).toBe(2);
    expect(res.failed).toBe(0);
    expect(state.publishCalls.length).toBe(2);

    // First publish saw the original tokens.
    expect(state.publishCalls[0].encryptedAccessToken).toBe("enc:old-access");
    expect(state.publishCalls[0].encryptedRefreshToken).toBe("enc:old-refresh");

    // The rotated tokens were persisted to social_accounts...
    const tokenUpdate = state.updates.find((u) => "encryptedAccessToken" in u);
    expect(tokenUpdate).toBeDefined();
    expect(tokenUpdate.encryptedAccessToken).toBe("enc:new-access");
    expect(tokenUpdate.encryptedRefreshToken).toBe("enc:new-refresh");

    // ...and the second publish read the FRESH row, not the stale snapshot.
    expect(state.publishCalls[1].encryptedAccessToken).toBe("enc:new-access");
    expect(state.publishCalls[1].encryptedRefreshToken).toBe("enc:new-refresh");
  });

  it("persists refreshed tokens even when the publish itself fails", async () => {
    state.failFirst = true;

    const tick = tickMarketingPublishWorker();
    await vi.advanceTimersByTimeAsync(30_000);
    const res = await tick;

    expect(res.processed).toBe(2);
    // Tokens rotated during the FAILED first publish must still be saved
    // before the second publish runs.
    const tokenUpdate = state.updates.find((u) => "encryptedAccessToken" in u);
    expect(tokenUpdate?.encryptedAccessToken).toBe("enc:new-access");
    expect(state.publishCalls[1].encryptedAccessToken).toBe("enc:new-access");
  });
});
