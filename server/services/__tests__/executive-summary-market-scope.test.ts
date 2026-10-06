import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";

const state = vi.hoisted(() => ({
  queries: [] as any[], inserted: [] as any[], updates: [] as any[],
  marketId: "csi", tenant: "tenant-a", invalid: false,
  complete: vi.fn(), lock: vi.fn(),
}));

vi.mock("../../db", () => {
  function query(kind: string, table?: any) {
    const entry: any = { kind, table };
    state.queries.push(entry);
    const result = () => {
      const name = entry.table && getTableName(entry.table);
      if (kind === "insert") return [{ id: "new-run" }];
      if (kind !== "select") return [];
      if (name === "markets") return state.invalid ? [] : [{ id: state.marketId, name: state.marketId, isDefault: false }];
      if (name === "company_profiles") return [{ id: `profile-${state.marketId}`, companyName: state.marketId, websiteUrl: `https://${state.marketId}.example` }];
      if (name === "generated_posts" || name === "generated_emails") return [{ count: 0 }];
      if (name === "outreach_campaigns") return [{ id: "campaign", name: "Market campaign", status: "draft" }];
      return [];
    };
    const q: any = {
      from(t: any) { entry.table = t; return q; },
      innerJoin() { return q; },
      where(predicate: any) { entry.predicate = predicate; return q; },
      orderBy() { return q; }, limit() { return q; }, groupBy() { return q; },
      values(v: any) { state.inserted.push(v); return q; },
      set(v: any) { state.updates.push(v); return q; },
      returning() { return q; },
      then(resolve: any, reject: any) { return Promise.resolve(result()).then(resolve, reject); },
    };
    return q;
  }
  const db: any = {
    select: () => query("select"),
    insert: (t: any) => query("insert", t),
    update: (t: any) => query("update", t),
    execute: state.lock,
    transaction: (fn: any) => fn(db),
  };
  return { db };
});
vi.mock("../ai-provider", () => ({ completeForFeature: state.complete }));
vi.mock("../ai-usage-logger", () => ({ logAiUsage: vi.fn() }));

import { generateExecutiveSummary } from "../unified-exec-summary-service";
import { summaryScope } from "../executive-summary-scope";

const dialect = new PgDialect();
beforeEach(() => {
  state.queries = []; state.inserted = []; state.updates = [];
  state.marketId = "csi"; state.invalid = false;
  state.complete.mockReset().mockResolvedValue({
    text: JSON.stringify({ headline: "Market briefing", sections: [] }),
    usage: { inputTokens: 1, outputTokens: 1 }, provider: "test", model: "test",
  });
});

describe("executive briefing market isolation", () => {
  it("requires explicit scope and never matches legacy unscoped reports", () => {
    expect(() => summaryScope("tenant-a", "")).toThrow();
    const sql = dialect.sqlToQuery(summaryScope("tenant-a", "csi"));
    expect(sql.params).toEqual(["tenant-a", "csi"]);
    expect(sql.sql).toContain("->'scope'->>'marketId'");
    expect(sql.sql).not.toContain(" is null");
  });

  it.each(["csi", "microsoft"])("scopes every collector, claim and previous report to %s", async marketId => {
    state.marketId = marketId;
    await generateExecutiveSummary({ tenantDomain: "tenant-a", marketId, trigger: "manual" });
    const tables = ["intelligence_briefings", "market_segments", "opportunity_matrix_cells", "market_studies",
      "long_form_recommendations", "generated_posts", "generated_emails", "content_briefs", "outreach_campaigns",
      "prospects", "unified_exec_summaries"];
    for (const table of tables) {
      const queries = state.queries.filter(q => q.kind === "select" && getTableName(q.table) === table);
      expect(queries.length, table).toBeGreaterThan(0);
      for (const q of queries) {
        const sql = dialect.sqlToQuery(q.predicate);
        expect(sql.params, table).toContain("tenant-a");
        expect(sql.params, table).toContain(marketId);
      }
    }
    const gtm = state.queries.find(q => q.table && getTableName(q.table) === "long_form_recommendations");
    const gtmSql = dialect.sqlToQuery(gtm.predicate);
    expect(gtmSql.params).toContain(`profile-${marketId}`);
    expect(gtmSql.sql).toContain('"project_id" is null');
    expect(state.inserted[0].summaryData.scope.marketId).toBe(marketId);
    expect(state.updates[0].summaryData.scope.marketId).toBe(marketId);
    const prompt = state.complete.mock.calls[0][1];
    expect(prompt).toContain(`https://${marketId}.example`);
    expect(prompt).toContain('"previousSummary": null');
    expect(prompt).not.toContain(marketId === "csi" ? "microsoft" : "csi");
  });

  it("rejects an invalid or other-tenant market before creating a run or calling AI", async () => {
    state.invalid = true;
    await expect(generateExecutiveSummary({ tenantDomain: "tenant-a", marketId: "foreign" })).rejects.toThrow("Active market not found");
    expect(state.inserted).toEqual([]);
    expect(state.complete).not.toHaveBeenCalled();
  });

  it("scopes all report reads and passes request scope into generation", () => {
    const routes = readFileSync("server/routes/executive-summary.ts", "utf8");
    expect(routes.match(/summaryScope\(ctx.tenantDomain, ctx.marketId\)/g)).toHaveLength(3);
    expect(routes).toContain("marketId: ctx.marketId");
    const page = readFileSync("client/src/pages/app/company-briefing.tsx", "utf8");
    expect(page).toContain('["/api/executive-summary/latest", tenantId, marketId]');
    expect(page).toContain("No summary generated for this market");
  });
});
