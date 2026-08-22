import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  post: {} as any,
  account: {} as any,
  tenantRow: { plan: "pro", socialPostingJitterEnabled: false },
  updates: [] as any[],
  inserts: [] as any[],
  publishCalls: [] as any[],
  resolvePublish: null as null | ((result: any) => void),
  throwOnPublishedUpdate: false,
}));

vi.mock("../../db", () => ({
  db: {
    select: (fields?: any) => {
      const result =
        fields && "post" in fields
          ? state.post.status === "approved"
            ? [{ post: { ...state.post }, account: { ...state.account } }]
            : []
          : fields
            ? [state.tenantRow]
            : [{ ...state.account }];
      const query: any = {};
      for (const method of ["from", "innerJoin", "leftJoin", "where"]) {
        query[method] = () => query;
      }
      query.limit = () => Promise.resolve(result);
      query.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
      return query;
    },
    update: () => ({
      set: (payload: any) => ({
        where: () => {
          state.updates.push(payload);
          if (payload.status === "published" && state.throwOnPublishedUpdate) {
            throw new Error("simulated completion write failure");
          }
          let result: Array<{ id: string }> = [{ id: state.post.id }];

          if (typeof payload.publishClaimToken === "string") {
            // Atomic acquisition: only the first request can set a token.
            if (state.post.publishClaimToken) {
              result = [];
            } else {
              Object.assign(state.post, payload);
            }
          } else if (
            payload.publishClaimToken === null &&
            typeof payload.publishError === "string" &&
            payload.publishError.includes("previous publish request expired")
          ) {
            // Expiry recovery is conditional on an actually expired live claim.
            const expiresAt = state.post.publishClaimExpiresAt as Date | null;
            if (
              !state.post.publishClaimToken ||
              !expiresAt ||
              expiresAt.getTime() > Date.now()
            ) {
              result = [];
            } else {
              Object.assign(state.post, payload);
            }
          } else if ("publishClaimToken" in payload) {
            // Completion, failure, and release are ownership guarded. Once
            // recovery clears the token, the old request can no longer write.
            if (!state.post.publishClaimToken) {
              result = [];
            } else {
              Object.assign(state.post, payload);
            }
          } else if ("encryptedAccessToken" in payload) {
            Object.assign(state.account, payload);
          }

          const updateQuery: any = {
            returning: async () => result,
            then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
          };
          return updateQuery;
        },
      }),
    }),
    insert: () => ({
      values: async (payload: any) => {
        state.inserts.push(payload);
        return [];
      },
    }),
  },
}));

vi.mock("../../utils/encryption", () => ({
  encryptSecret: (value: string) => `enc:${value}`,
}));

vi.mock("../plan-policy", () => ({
  checkFeatureAccessAsync: async () => ({ allowed: true }),
}));

vi.mock("../social-publishers", () => ({
  getPublisher: () => ({
    platform: "twitter",
    supported: true,
    publish: async (ctx: any) => {
      state.publishCalls.push(ctx);
      return new Promise((resolve) => {
        state.resolvePublish = resolve;
      });
    },
  }),
}));

import {
  PUBLISH_CLAIM_BUSY_MESSAGE,
  PUBLISH_CLAIM_EXPIRED_MESSAGE,
  publishPostNow,
  tickMarketingPublishWorker,
} from "../marketing-publish-worker";

beforeEach(() => {
  const now = Date.now();
  state.post = {
    id: "post-overlap",
    tenantDomain: "claims.example.com",
    platform: "twitter",
    status: "approved",
    content: "claim test",
    editedContent: null,
    hashtags: [],
    socialAccountId: "account-1",
    campaignId: null,
    deliveryMode: null,
    scheduledDate: new Date(now - 60_000),
    publishNotBefore: new Date(now - 60_000),
    publishNextAttemptAt: null,
    publishAttemptCount: 0,
    publishClaimToken: null,
    publishClaimOwner: null,
    publishClaimExpiresAt: null,
    exactSchedule: true,
  };
  state.account = {
    id: "account-1",
    tenantDomain: "claims.example.com",
    platform: "twitter",
    status: "active",
    publishingPaused: false,
    encryptedAccessToken: "enc:access",
    encryptedRefreshToken: "enc:refresh",
    tokenExpiresAt: new Date(now + 60_000),
    marketId: null,
  };
  state.updates = [];
  state.inserts = [];
  state.publishCalls = [];
  state.resolvePublish = null;
  state.throwOnPublishedUpdate = false;
});

async function startBlockedWorkerPublish() {
  const workerResult = tickMarketingPublishWorker();
  await vi.waitFor(() => {
    expect(state.publishCalls).toHaveLength(1);
    expect(state.post.publishClaimToken).toEqual(expect.any(String));
  });
  // Wrap the promise so this async helper does not assimilate/await the
  // intentionally blocked worker result before the test can overlap it.
  return { workerResult };
}

describe("publish claim overlap protection", () => {
  it("allows only the worker provider call when a manual request overlaps", async () => {
    const { workerResult } = await startBlockedWorkerPublish();

    const manualResult = await publishPostNow("post-overlap", "operator-1");

    expect(manualResult).toEqual({
      success: false,
      errorCode: "publish_in_progress",
      errorMessage: PUBLISH_CLAIM_BUSY_MESSAGE,
    });
    expect(state.publishCalls).toHaveLength(1);

    state.resolvePublish?.({
      success: true,
      publishedUrl: "https://x.com/example/status/claim-1",
    });
    await expect(workerResult).resolves.toMatchObject({ published: 1, failed: 0 });
    expect(state.post.status).toBe("published");
  });

  it("recovers an expired in-flight claim on the next worker tick without a second provider call", async () => {
    const { workerResult } = await startBlockedWorkerPublish();
    state.post.publishClaimExpiresAt = new Date(Date.now() - 1);

    const recoveryTick = await tickMarketingPublishWorker();

    expect(recoveryTick).toEqual({ processed: 0, published: 0, failed: 0 });
    expect(state.publishCalls).toHaveLength(1);
    expect(state.post).toMatchObject({
      status: "publish_failed",
      publishError: PUBLISH_CLAIM_EXPIRED_MESSAGE,
      publishClaimToken: null,
      publishClaimOwner: null,
      publishClaimExpiresAt: null,
    });

    state.resolvePublish?.({
      success: true,
      publishedUrl: "https://x.com/example/status/late-success",
    });
    await expect(workerResult).resolves.toMatchObject({ published: 0, failed: 1 });
    expect(state.post.status).toBe("publish_failed");
    expect(state.inserts).not.toContainEqual(expect.objectContaining({ status: "success" }));
  });

  it("drops a late failure update after the expired claim has been recovered", async () => {
    const { workerResult } = await startBlockedWorkerPublish();
    state.post.publishClaimExpiresAt = new Date(Date.now() - 1);

    await publishPostNow("post-overlap", "operator-1");
    state.resolvePublish?.({
      success: false,
      errorCode: "http_500",
      errorMessage: "late provider failure",
    });
    await workerResult;

    expect(state.post.status).toBe("publish_failed");
    expect(state.post.publishError).toBe(PUBLISH_CLAIM_EXPIRED_MESSAGE);
    expect(state.inserts).not.toContainEqual(
      expect.objectContaining({ errorMessage: "late provider failure" }),
    );
  });

  it("never re-queues a confirmed provider success when completion persistence fails", async () => {
    const { workerResult } = await startBlockedWorkerPublish();
    state.throwOnPublishedUpdate = true;

    state.resolvePublish?.({
      success: true,
      publishedUrl: "https://x.com/example/status/confirmed",
    });
    await expect(workerResult).resolves.toMatchObject({ published: 0, failed: 1 });

    expect(state.post.status).toBe("approved");
    expect(state.post.publishClaimToken).toEqual(expect.any(String));
    expect(state.updates).not.toContainEqual(
      expect.objectContaining({
        status: "approved",
        publishError: expect.any(String),
        publishClaimToken: null,
      }),
    );

    state.post.publishClaimExpiresAt = new Date(Date.now() - 1);
    await tickMarketingPublishWorker();
    expect(state.publishCalls).toHaveLength(1);
    expect(state.post.status).toBe("publish_failed");
    expect(state.post.publishError).toBe(PUBLISH_CLAIM_EXPIRED_MESSAGE);
  });
});