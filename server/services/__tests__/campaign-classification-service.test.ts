import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultMeetingContact } from "@shared/conference-meetings";
const mocks = vi.hoisted(() => ({
  campaign: {} as any, rows: [] as any[], writes: vi.fn(), filters: [] as any[],
}));
vi.mock("../../db", () => ({
  db: { transaction: async (fn: any) => {
    let reads = 0;
    return fn({
      select: () => ({ from: () => ({ where: (filter: any) => {
        mocks.filters.push(filter);
        if (reads++ === 0) return Promise.resolve([mocks.campaign]);
        return { orderBy: () => ({ for: () => Promise.resolve(mocks.rows) }) };
      } }) }),
      update: () => ({ set: (data: any) => ({ where: async (filter: any) => { mocks.writes(data, filter); } }) }),
    });
  } },
}));
import { updateCampaignClassification } from "../campaign-classification-service";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.filters.length = 0;
  mocks.campaign = { id: "campaign", marketId: "market" };
  mocks.rows = [{ id: "p", marketId: "market", meeting: { ...defaultMeetingContact(), ownerNotes: "Keep" }, classification: null }];
});
describe("classification updates", () => {
  it("persists canonical prep and membership tags without modifying source or contact identity", async () => {
    await expect(updateCampaignClassification("tenant", "market", "campaign", { prospectIds: ["p", "p"], patch: { tags: ["VIP"], attendance: "confirmed" } })).resolves.toEqual({ updated: 1 });
    expect(mocks.writes.mock.calls[0][0]).toMatchObject({ classification: { tags: ["VIP"] }, meeting: { attendance: "confirmed", ownerNotes: "Keep" } });
    expect(mocks.writes.mock.calls[0][0]).not.toHaveProperty("source");
    expect(mocks.writes.mock.calls[0][0]).not.toHaveProperty("contactId");
  });
  it.each(["missing", "market", "contactMarket", "partial"])("rejects inaccessible scopes %s without writes", async mode => {
    if (mode === "missing") mocks.campaign = undefined;
    if (mode === "market") mocks.campaign.marketId = "other";
    if (mode === "contactMarket") mocks.rows[0].marketId = "other";
    if (mode === "partial") mocks.rows = [];
    await expect(updateCampaignClassification("tenant", "market", "campaign", { prospectIds: ["p"], patch: { tags: ["VIP"] } })).rejects.toMatchObject({ status: 404 });
    expect(mocks.writes).not.toHaveBeenCalled();
  });
});
