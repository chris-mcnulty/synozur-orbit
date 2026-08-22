import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  selectResults: [] as any[][],
  updates: [] as any[],
  inserts: [] as any[],
  publisherResult: { success: true, publishedUrl: "https://x.com/example/status/1" } as any,
}));

vi.mock("../../db", () => ({
  db: {
    select: () => {
      const result = state.selectResults.shift() ?? [];
      const query: any = {
        from: () => query,
        leftJoin: () => query,
        where: () => Promise.resolve(result),
      };
      return query;
    },
    update: () => ({
      set: (payload: any) => ({
        where: () => {
          state.updates.push(payload);
          const result = [{ id: "updated" }];
          const query: any = {
            returning: async () => result,
            then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
          };
          return query;
        },
      }),
    }),
    insert: () => ({
      values: (payload: any) => {
        state.inserts.push(payload);
        const query: any = {
          onConflictDoNothing: () => ({
            returning: async () => [{ id: "repaired-link" }],
          }),
        };
        query.then = (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject);
        return query;
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
    supported: true,
    publish: async () => state.publisherResult,
  }),
}));

import {
  publishPostNow,
} from "../marketing-publish-worker";

beforeEach(() => {
  const tenantDomain = "recovery.example.com";
  state.selectResults = [
    [{
      post: {
        id: "post-1",
        tenantDomain,
        campaignId: "campaign-1",
        platform: "twitter",
        status: "publish_failed",
        publishAttemptCount: 3,
      },
      account: {
        id: "account-1",
        tenantDomain,
        status: "active",
        encryptedAccessToken: "enc:token",
        marketId: null,
      },
    }],
    [{ id: "campaign-1" }],
    [{ id: "account-1", status: "active" }],
    [],
  ];
  state.updates = [];
  state.inserts = [];
  state.publisherResult = { success: true, publishedUrl: "https://x.com/example/status/1" };
});

describe("manual publish recovery", () => {
  it("repairs the missing campaign link and succeeds after reconnection", async () => {
    const result = await publishPostNow("post-1", "operator-1");

    expect(result).toEqual({
      success: true,
      publishedUrl: "https://x.com/example/status/1",
    });
    expect(state.inserts[0]).toMatchObject({
      campaignId: "campaign-1",
      socialAccountId: "account-1",
      autoPublish: false,
    });
    expect(state.updates).toContainEqual(expect.objectContaining({
      status: "published",
      publishAttemptCount: 4,
    }));
  });
});