import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const io = vi.hoisted(() => ({
  events: [] as any[], accounts: [] as any[], posts: [] as any[],
  queries: [] as any[], operations: [] as string[], build: vi.fn(),
}));
vi.mock("../../db", () => {
  const filterRows = (table: string, filter: any) => {
    const query = new PgDialect().sqlToQuery(filter);
    io.queries.push(query);
    const params = query.params;
    if (table === "conferences") return io.events.filter(p => params.includes(p.id));
    if (table === "social_accounts") return io.accounts.filter(p => params.includes(p.id));
    const accountFiltered = io.accounts.some(p => params.includes(p.id));
    return io.posts.filter(p => params.includes(p.conferenceId) && (!accountFiltered || params.includes(p.socialAccountId)));
  };
  const db: any = {
    select: () => ({ from: (table: any) => ({ where: (filter: any) => {
      const rows = filterRows(getTableName(table), filter);
      return Object.assign(Promise.resolve(rows), { for: async (mode: string) => {
        io.operations.push(`lock:${mode}`); return rows;
      } });
    } }) }),
    update: () => ({ set: (patch: any) => ({ where: (filter: any) => ({
      returning: async () => {
        const rows = filterRows("generated_posts", filter);
        const params = io.queries.at(-1).params;
        const selected = rows.filter(p => params.includes(p.id) && p.status === "approved"
          && !p.publishedAt && !p.publishClaimToken
          && (patch.status !== "exported" || p.deliveryMode === "csv"));
        for (const row of selected) Object.assign(row, patch);
        io.operations.push(patch.status === "exported" ? "confirm" : "reserve");
        return selected;
      },
    }) }) }),
    transaction: async (fn: any) => fn(db),
  };
  return { db };
});
vi.mock("../posts-csv-export", () => ({ buildPostsCsv: io.build }));
import { confirmEventExport, eventExportCounts, exportEventPosts, previewEventExport } from "../event-post-export";

const scope = { tenantDomain: "tenant.example", marketId: "market" };
const selection = { conferenceIds: ["event-a", "event-b"], socialAccountIds: ["account-a"] };
const future = new Date(Date.now() + 86400_000);
const post = (id: string, extra = {}) => ({
  id, conferenceId: "event-a", socialAccountId: "account-a", tenantDomain: scope.tenantDomain,
  status: "approved", deliveryMode: null, scheduledDate: future, publishedAt: null,
  publishClaimToken: null, ...extra,
});

describe("event export ownership", () => {
  beforeEach(() => {
    io.events = selection.conferenceIds.map(id => ({ id }));
    io.accounts = [{ id: "account-a" }, { id: "account-b" }];
    io.posts = [];
    io.queries = [];
    io.operations = [];
    io.build.mockReset().mockImplementation(async () => {
      io.operations.push("build");
      return "combined csv";
    });
  });

  it("previews only selected event/account posts and separates draft, dates, delivery and claims", async () => {
    io.posts = [
      post("ready"), post("csv", { conferenceId: "event-b", deliveryMode: "csv" }),
      post("draft", { status: "draft" }), post("past", { scheduledDate: new Date(0) }),
      post("undated", { scheduledDate: null }), post("published", { status: "published", publishedAt: new Date() }),
      post("exported", { status: "exported", deliveryMode: "csv" }),
      post("claimed", { publishClaimToken: "claim" }), post("rejected", { status: "rejected" }),
      post("other-account", { socialAccountId: "account-b" }), post("other-event", { conferenceId: "event-c" }),
    ];
    expect(await previewEventExport(scope, selection)).toMatchObject({
      totalPosts: 8, exportablePosts: 2, automaticPosts: 1, csvPosts: 1,
      draftPosts: 1, undatedOrPastPosts: 2, deliveredPosts: 2, claimedPosts: 1,
    });
    for (const query of io.queries) expect(query.params).toContain(scope.tenantDomain);
    expect(io.queries[0].params).toContain("market");
    expect(io.queries[1].params).toContain("market");
  });

  it("locks and reserves approved future posts across events before building one CSV", async () => {
    io.posts = [post("a"), post("b", { conferenceId: "event-b" }), post("other", { socialAccountId: "account-b" })];
    const result = await exportEventPosts(scope, selection, { format: "socialpilot", tzOffset: 420, imageBaseUrl: "https://orbit.example" });
    expect(result).toEqual({ csv: "combined csv", postIds: ["a", "b"] });
    expect(io.operations).toEqual(["lock:update", "reserve", "build"]);
    expect(io.posts.map(p => p.deliveryMode)).toEqual(["csv", "csv", null]);
    expect(io.build.mock.calls[0][0]).toMatchObject({
      tenantDomain: scope.tenantDomain, format: "socialpilot", tzOffset: 420, imageBaseUrl: "https://orbit.example",
    });
    expect(io.posts[0].status).toBe("approved"); // download != delivery confirmation
  });

  it("leaves safe CSV ownership intact when rendering/downloading fails", async () => {
    io.posts = [post("ready")];
    io.build.mockRejectedValue(new Error("image unavailable"));
    await expect(exportEventPosts(scope, selection, { format: "socialpilot", tzOffset: 0 }))
      .rejects.toThrow("remain export-only");
    expect(io.posts[0].deliveryMode).toBe("csv");
    expect(io.posts[0].status).toBe("approved");
  });

  it("rejects a selection with an in-flight send without transferring any posts", async () => {
    io.posts = [post("ready"), post("sending", { publishClaimToken: "claim" })];
    await expect(exportEventPosts(scope, selection, { format: "generic", tzOffset: 0 })).rejects.toThrow("already being sent");
    expect(io.operations).toEqual(["lock:update"]);
    expect(io.build).not.toHaveBeenCalled();
    expect(io.posts.every(p => p.deliveryMode === null)).toBe(true);
  });

  it("never exports drafts, past dates or delivered posts", async () => {
    io.posts = [post("draft", { status: "draft" }), post("past", { scheduledDate: new Date(0) }),
      post("delivered", { status: "exported" }), post("posted", { status: "approved", publishedAt: new Date() })];
    await expect(exportEventPosts(scope, selection, { format: "generic", tzOffset: 0 })).rejects.toThrow("No approved");
    expect(io.build).not.toHaveBeenCalled();
  });

  it("rejects missing or out-of-market events/accounts before reading posts", async () => {
    io.events = [{ id: "event-a" }];
    await expect(previewEventExport(scope, selection)).rejects.toThrow("events are unavailable");
    expect(io.queries).toHaveLength(1);
    io.events = selection.conferenceIds.map(id => ({ id }));
    io.accounts = [];
    await expect(previewEventExport(scope, selection)).rejects.toThrow("accounts are unavailable");
  });

  it("confirms only the exact reserved IDs and is idempotent", async () => {
    io.posts = [post("a", { deliveryMode: "csv" }), post("b", { deliveryMode: "csv" }),
      post("automatic"), post("posted", { deliveryMode: "csv", publishedAt: new Date() }),
      post("claimed", { deliveryMode: "csv", publishClaimToken: "claim" })];
    expect(await confirmEventExport(scope, selection, ["a", "automatic", "posted", "claimed"])).toEqual({ updated: 1 });
    expect(io.posts.map(p => p.status)).toEqual(["exported", "approved", "approved", "approved", "approved"]);
    expect(await confirmEventExport(scope, selection, ["a"])).toEqual({ updated: 0 });
    const sql = io.queries.at(-1).sql;
    expect(sql).toContain('"publish_claim_token" is null');
    expect(sql).toContain('"published_at" is null');
  });

  it("does not count rejected rows as automatic or export work", () => {
    expect(eventExportCounts([post("rejected", { status: "rejected" })] as any).totalPosts).toBe(0);
  });
});
