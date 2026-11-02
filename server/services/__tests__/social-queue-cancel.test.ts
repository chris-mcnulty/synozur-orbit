import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({ rows: [] as any[], filter: null as any, update: null as any, audits: [] as any[] }));
vi.mock("../../db", () => ({
  db: {
    transaction: async (run: any) => run({
      update: () => ({
        set: (values: any) => {
          state.update = values;
          return { where: (filter: any) => {
            state.filter = filter;
            return { returning: async () => state.rows };
          } };
        },
      }),
      insert: () => ({ values: async (audit: any) => { state.audits.push(audit); } }),
    }),
  },
}));
import { cancelQueuedPosts } from "../social-queue-cancel";
const args = { tenantDomain: "tenant.example", userId: "operator", marketId: null, postIds: ["one", "two", "three"] };
beforeEach(() => { state.rows = []; state.filter = null; state.update = null; state.audits = []; });

describe("bulk queue cancellation", () => {
  it("atomically excludes sent, exported, foreign-tenant, and claimed posts", async () => {
    state.rows = [{ id: "one" }];
    const result = await cancelQueuedPosts(args);
    expect(result).toEqual({ cancelled: 1, cancelledIds: ["one"], skipped: 2, skippedIds: ["two", "three"] });
    const query = new PgDialect().sqlToQuery(state.filter);
    expect(query.sql).toContain('"tenant_domain" =');
    expect(query.params).toContain(args.tenantDomain);
    expect(query.sql).toContain('"published_at" is null');
    expect(query.sql).toContain('"publish_claim_token" is null');
    expect(query.params).toEqual(expect.arrayContaining(["draft", "approved", "publish_failed", "missed"]));
    expect(query.params).not.toContain("published");
    expect(query.params).not.toContain("exported");
    expect(state.update).toMatchObject({ status: "deleted", publishNextAttemptAt: null, publishNotBefore: null });
    expect(state.update).not.toHaveProperty("publishedAt");
    expect(state.audits[0]).toMatchObject({ tenantDomain: args.tenantDomain, details: { postIds: ["one"] } });
  });
  it("deduplicates IDs and reports repeated cancellation as skipped", async () => {
    const result = await cancelQueuedPosts({ ...args, postIds: ["one", "one"] });
    expect(result).toEqual({ cancelled: 0, cancelledIds: [], skipped: 1, skippedIds: ["one"] });
    expect(state.audits).toHaveLength(0);
  });
});
