import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  selectResults: [] as any[][],
  insertedRows: [] as any[],
  insertReturning: [] as any[],
}));

vi.mock("../../db", () => ({
  db: {
    select: () => {
      const result = state.selectResults.shift() ?? [];
      const query: any = {
        from: () => query,
        where: () => Promise.resolve(result),
      };
      return query;
    },
    insert: () => ({
      values: (row: any) => {
        state.insertedRows.push(row);
        return {
          onConflictDoNothing: () => ({
            returning: async () => state.insertReturning,
          }),
        };
      },
    }),
  },
}));

import {
  ensureCampaignSocialAccountLink,
} from "../campaign-social-account-link";

beforeEach(() => {
  state.selectResults = [];
  state.insertedRows = [];
  state.insertReturning = [{ id: "new-link" }];
});

describe("ensureCampaignSocialAccountLink", () => {
  it("repairs a missing link with auto-publish off", async () => {
    state.selectResults = [
      [{ id: "campaign-1" }],
      [{ id: "account-1", status: "active" }],
      [],
    ];

    const result = await ensureCampaignSocialAccountLink({
      campaignId: "campaign-1",
      socialAccountId: "account-1",
      tenantDomain: "tenant.example.com",
    });

    expect(result).toEqual({ repaired: true });
    expect(state.insertedRows).toHaveLength(1);
    expect(state.insertedRows[0]).toMatchObject({
      campaignId: "campaign-1",
      socialAccountId: "account-1",
      autoPublish: false,
    });
  });

  it("is idempotent and preserves an existing campaign setting", async () => {
    state.selectResults = [
      [{ id: "campaign-1" }],
      [{ id: "account-1", status: "active" }],
      [{ id: "existing-link", autoPublish: true }],
    ];

    const result = await ensureCampaignSocialAccountLink({
      campaignId: "campaign-1",
      socialAccountId: "account-1",
      tenantDomain: "tenant.example.com",
    });

    expect(result).toEqual({ repaired: false });
    expect(state.insertedRows).toHaveLength(0);
  });
});