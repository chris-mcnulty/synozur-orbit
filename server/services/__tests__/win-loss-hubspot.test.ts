import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getTenantClient: vi.fn() }));
vi.mock("../hubspot-integration", () => ({ getTenantClient: mocks.getTenantClient, withHubspotRetry: (fn: () => unknown) => fn() }));
import { discoverDeals, hubspotReader, previewDeals } from "../win-loss-hubspot";
import type { ImportMapping } from "@shared/win-loss";

const mapping: ImportMapping = { label: "custom_name", closeDate: "closedate", amount: "amount", currency: "currency", segment: "segment",
  competitor: "explicit_competitor", reason: "reason", stages: { "custom:success": "won", "custom:declined": "lost", "custom:abandoned": "no_decision" }, reasons: { cost: "price" } };
const properties = { results: ["custom_name", "closedate", "amount", "currency", "segment", "explicit_competitor", "reason"].map(name => ({ name, label: name })) };
const pipelines = { results: [{ id: "custom", label: "Custom pipeline", stages: [
  ...["success", "declined", "abandoned", "unmapped"].map(id => ({ id, label: id, metadata: { isClosed: "true" } })),
  { id: "open", label: "Open", metadata: { isClosed: "false" } },
] }] };
const d = (id: string, patch: Record<string, string> = {}) => ({ id, properties: { pipeline: "custom", dealstage: "success", custom_name: `Deal ${id}`, ...patch } });
function reader(pages: unknown[]) {
  let index = 0;
  return vi.fn(async (path: string, _body?: unknown) => {
    if (path === "/crm/v3/properties/deals") return properties;
    if (path === "/crm/v3/pipelines/deals") return pipelines;
    const page = pages[index++]; if (page instanceof Error) throw page;
    return page;
  });
}
beforeEach(() => vi.resetAllMocks());
describe("read-only tenant HubSpot preview", () => {
  it("uses only the existing tenant OAuth client and reports missing scope/disconnection", async () => {
    mocks.getTenantClient.mockRejectedValueOnce(new Error("private SDK details"));
    await expect(hubspotReader("tenant")).rejects.toThrow(/disconnected/);
    mocks.getTenantClient.mockResolvedValueOnce({ client: {}, connection: { scopes: [] } });
    await expect(hubspotReader("tenant")).rejects.toThrow(/scope missing/);
    expect(mocks.getTenantClient).toHaveBeenCalledWith("tenant");
  });
  it("gets discovery and every page without CRM mutations", async () => {
    const read = reader([{ results: [d("1")], paging: { next: { after: "100" } } }, { results: [d("2", { dealstage: "declined" })] }]);
    const result = await previewDeals(read, mapping);
    expect(result.map(r => r.candidate.outcome)).toEqual(["won", "lost"]);
    expect(read.mock.calls[3][1]).toMatchObject({ after: "100", limit: 100 });
    expect(read.mock.calls.every(([path]) => path.includes("search") || path.includes("properties") || path.includes("pipelines"))).toBe(true);
  });
  it("maps custom fields and reasons without inventing missing information", async () => {
    const result = await previewDeals(reader([{ results: [d("1", { explicit_competitor: "Acme", reason: "cost", closedate: "2026-11-21T12:00:00Z", amount: "0", currency: "EUR", segment: "Small" }), d("2")] }]), mapping);
    expect(result[0].candidate).toMatchObject({ competitorId: null, competitorConfirmed: false, reasonCodes: ["price"], closeDate: "2026-11-21", amount: "0", currency: "EUR", segment: "Small" });
    expect(result[0].competitorText).toBe("Acme");
    expect(result[1].candidate).toMatchObject({ reasonCodes: [], amount: null, currency: null, closeDate: null });
  });
  it("flags ambiguous stage and raw unmapped reason rather than claiming loss", async () => {
    const [row] = await previewDeals(reader([{ results: [d("1", { dealstage: "unmapped", reason: "free-form unknown" })] }]), mapping);
    expect(row.warnings).toHaveLength(2);
    expect(row.warnings[0]).toMatch(/Unmapped pipeline outcome/);
    expect(row.candidate.reasonCodes).toEqual([]);
  });
  it("rejects nonexistent properties and open-stage mappings", async () => {
    await expect(previewDeals(reader([]), { ...mapping, competitor: "not_real" })).rejects.toThrow(/Unknown HubSpot property/);
    await expect(previewDeals(reader([]), { ...mapping, stages: { "custom:open": "won" } })).rejects.toThrow(/not a discovered closed/);
    await expect(previewDeals(reader([]), { ...mapping, stages: {} })).rejects.toThrow(/at least one/);
  });
  it("discards partial results after a failed or rate-limited page", async () => {
    await expect(previewDeals(reader([{ results: [d("1")], paging: { next: { after: "100" } } }, Object.assign(new Error("429"), { status: 429 })]), mapping)).rejects.toThrow(/incomplete preview was discarded/);
  });
  it("fails explicitly on broken pagination or malformed payloads", async () => {
    await expect(previewDeals(reader([{ results: [], paging: { next: { after: "100" } } }, { results: [], paging: { next: { after: "100" } } }]), mapping)).rejects.toThrow(/pagination incomplete/);
    await expect(previewDeals(reader([{}]), mapping)).rejects.toThrow(/Invalid HubSpot deal page/);
    await expect(discoverDeals(async () => ({}))).rejects.toThrow(/Invalid HubSpot discovery/);
  });
  it("rejects search truncation even when HubSpot omits the next-page cursor", async () => {
    await expect(previewDeals(reader([{ total: 20000, results: [d("1")] }]), mapping)).rejects.toThrow(/10,000-deal limit/);
  });
});
