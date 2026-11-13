import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ rows: [] as any[][], filters: [] as any[] }));
vi.mock("../../db", () => ({ db: { select: () => ({ from: () => ({ where: (filter: unknown) => {
  mocks.filters.push(filter);
  return Promise.resolve(mocks.rows.shift() ?? []);
} }) }) } }));
import { getCampaignPerformance } from "../outreach-performance-service";
beforeEach(() => { mocks.rows.length = 0; mocks.filters.length = 0; });
describe("campaign performance active membership scope", () => {
  it("filters removed memberships in SQL before calculating the report", async () => {
    mocks.rows.push([{ id: "campaign", tenantDomain: "tenant" }], [{ status: "replied", icpScore: null, scoreBreakdown: null }]);
    const result = await getCampaignPerformance("tenant", "campaign");
    expect(result).toMatchObject({ total: 1, replied: 1, contacted: 1, replyRate: 1 });
    const compiled = mocks.filters.map(filter => new PgDialect().sqlToQuery(filter));
    for (const query of compiled) {
      expect(query.params).toContain("tenant");
      expect(query.params).toContain("campaign");
    }
    expect(compiled[1].sql).toContain('"prospects"."removed_at" is null');
    expect(compiled[1].params).toEqual(expect.arrayContaining(["archived", "deleted", "removed"]));
  });
  it("does not read contacts for an inaccessible campaign", async () => {
    mocks.rows.push([]);
    await expect(getCampaignPerformance("tenant", "foreign")).rejects.toThrow("Campaign not found");
    expect(mocks.filters).toHaveLength(1);
  });
});
