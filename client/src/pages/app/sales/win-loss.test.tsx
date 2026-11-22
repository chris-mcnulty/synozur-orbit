// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { summarizeOutcomes, type OutcomeRecord } from "@shared/win-loss";
const state = vi.hoisted(() => ({ role: "Analyst", tenant: "tenant", market: "market", records: [] as any[], reviews: [] as any[], call: vi.fn() }));
vi.mock("@/components/layout/AppLayout", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/UpgradePrompt", () => ({ PageFeatureGate: ({ children }: any) => <>{children}</> }));
vi.mock("@/lib/userContext", () => ({ useUser: () => ({ user: { role: state.role } }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: state.call }));
import WinLossPage from "./win-loss";
import { setTabMarketId, setTabTenantId } from "@/lib/tabContext";
const record: OutcomeRecord = { id: "deal1", version: 2, source: "manual", externalId: null, sourceSnapshot: null,
  createdAt: "2026-11-21T00:00:00Z", updatedAt: "2026-11-21T00:00:00Z", dealLabel: "Example deal",
  outcome: "lost", closeDate: "2026-11-21", amount: "12", currency: "USD", segment: "Enterprise",
  competitorId: "competitor", competitorConfirmed: true, reasonCodes: ["price"], notes: "Manually corrected notes" };
const discovery = { portalId: "portal", properties: ["dealname", "closedate", "amount"].map(name => ({ name, label: name, options: [] })),
  pipelines: [{ id: "p", label: "Pipeline", stages: [{ id: "s", label: "Closed", closed: true }] }] };
beforeEach(() => {
  sessionStorage.clear();
  setTabTenantId("tenant"); setTabMarketId("market");
  state.role = "Analyst"; state.tenant = "tenant"; state.market = "market"; state.records = [{ ...record }]; state.reviews = [];
  state.call.mockReset().mockImplementation(async (method: string, url: string, body: any) => {
    let result: any = {};
    if (method === "GET" && url.includes("/summary")) result = { ...summarizeOutcomes(state.records), scope: { from: null, to: null, dateBasis: "closeDate", undatedExcluded: false } };
    else if (method === "GET" && url.endsWith("/hubspot/discovery")) result = discovery;
    else if (method === "GET") result = { records: state.records, canEdit: state.role === "Analyst", competitors: [{ id: "competitor", name: "Named competitor" }], battlecards: [{ id: "card", competitorId: "competitor", customNotes: "Old notes" }], reviews: state.reviews };
    else if (method === "POST" && url.endsWith("/hubspot/preview")) {
      result = { id: "preview", portalId: "portal", expiresAt: "2026-11-22T00:00:00Z", rows: [{
        externalId: "123", candidate: {
          dealLabel: "CRM deal", outcome: "no_decision", closeDate: "2026-11-21", amount: "12", currency: "USD",
          segment: "Enterprise", competitorId: null, competitorConfirmed: false, reasonCodes: [], notes: "CRM notes",
        },
        existing: record, raw: { reason: "Unknown" }, competitorMatches: [{ id: "competitor", name: "Named competitor" }],
        competitorText: "Named competitor", reasonText: null, warnings: ["Unmapped pipeline outcome: choose explicitly before importing"],
      }] };
    } else if (method === "POST" && url.endsWith("/hubspot/import")) result = { imported: body.selected.length };
    else if (method === "POST" && url === "/api/sales/win-loss") {
      result = { ...body, id: "new", version: 1, source: "manual", externalId: null, sourceSnapshot: null, createdAt: record.createdAt, updatedAt: record.updatedAt };
      state.records = [...state.records, result];
    } else if (method === "PATCH") { result = { ...record, ...body.data, version: 3 }; state.records = [result]; }
    else if (method === "DELETE") { state.records = []; result = { deleted: true }; }
    else if (method === "POST" && url.endsWith("/approve")) result = { approved: true };
    return { json: async () => result };
  });
});
afterEach(() => cleanup());
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const rendered = render(<QueryClientProvider client={client}><WinLossPage /></QueryClientProvider>);
  return { ...rendered, client };
}
const calls = (method: string) => state.call.mock.calls.filter(([m]) => m === method);
describe("win/loss workspace interactions", () => {
  it.each(["tenant", "market"])("dismisses an open draft on an actual %s switch without manual rerender", async scope => {
    mount(); await screen.findByRole("button", { name: "Example deal" });
    fireEvent.click(screen.getByRole("button", { name: "Log outcome" }));
    const dialog = screen.getByRole("dialog", { name: "Log a closed outcome" });
    fireEvent.change(within(dialog).getByLabelText("Deal label"), { target: { value: "Old-scope draft" } });
    const submit = within(dialog).getByRole("button", { name: "Save outcome" });
    act(() => { if (scope === "tenant") setTabTenantId("other-tenant"); else setTabMarketId("other-market"); });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(submit);
    expect(calls("POST")).toHaveLength(0);
    await screen.findByRole("button", { name: "Log outcome" });
    fireEvent.click(screen.getByRole("button", { name: "Log outcome" }));
    expect((screen.getByLabelText("Deal label") as HTMLInputElement).value).toBe("");
  });
  it("blocks a queued old-scope mutation before it can pick up the new context headers", async () => {
    mount(); await screen.findByRole("button", { name: "Example deal" });
    fireEvent.click(screen.getByRole("button", { name: "Log outcome" }));
    fireEvent.change(screen.getByLabelText("Deal label"), { target: { value: "Queued draft" } });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Save outcome" }));
      setTabMarketId("other-market");
    });
    await act(async () => { await Promise.resolve(); });
    expect(calls("POST")).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Outcome saved.")).toBeNull();
  });
  it("ignores a late response from the old scope instead of restoring action state", async () => {
    let finish!: (value: any) => void;
    const original = state.call.getMockImplementation()!;
    state.call.mockImplementation((method: string, ...args: any[]) => method === "POST"
      ? new Promise(resolve => { finish = resolve; }) : original(method, ...args));
    mount(); await screen.findByRole("button", { name: "Example deal" });
    fireEvent.click(screen.getByRole("button", { name: "Log outcome" }));
    fireEvent.change(screen.getByLabelText("Deal label"), { target: { value: "Pending draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save outcome" }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    act(() => setTabMarketId("other-market"));
    await screen.findByRole("button", { name: "Log outcome" });
    await act(async () => { finish({ json: async () => record }); await Promise.resolve(); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Outcome saved.")).toBeNull();
  });
  it("logs a manual outcome without HubSpot and requires explicit competitor confirmation", async () => {
    mount(); await screen.findByRole("button", { name: "Example deal" });
    fireEvent.click(screen.getByRole("button", { name: "Log outcome" }));
    const dialog = screen.getByRole("dialog", { name: "Log a closed outcome" });
    fireEvent.change(within(dialog).getByLabelText("Deal label"), { target: { value: "New decision" } });
    fireEvent.change(within(dialog).getByLabelText("Competitor"), { target: { value: "competitor" } });
    expect((within(dialog).getByRole("button", { name: "Save outcome" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByLabelText(/I confirm this competitor/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save outcome" }));
    await waitFor(() => expect(calls("POST")).toHaveLength(1));
    expect(calls("POST")[0]).toEqual(["POST", "/api/sales/win-loss", expect.objectContaining({ dealLabel: "New decision", competitorId: "competitor", competitorConfirmed: true })]);
    expect(state.call.mock.calls.some(([, url]) => url.includes("hubspot"))).toBe(false);
    await screen.findByText("Outcome saved.");
  });
  it("edits and deletes with versioned requests and exact deletion confirmation", async () => {
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Example deal" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit outcome" }));
    const edit = screen.getByRole("dialog", { name: "Edit outcome" });
    fireEvent.change(within(edit).getByLabelText("Notes"), { target: { value: "New notes" } });
    fireEvent.click(within(edit).getByRole("button", { name: "Save outcome" }));
    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    expect(calls("PATCH")[0][2]).toMatchObject({ version: 2, data: { notes: "New notes" } });
    await screen.findByText("Outcome saved.");
    fireEvent.click(await screen.findByRole("button", { name: "Example deal" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete record" }));
    expect((screen.getByRole("button", { name: "Confirm delete" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type deal label to confirm deletion"), { target: { value: "Example deal" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(calls("DELETE")[0]).toEqual(["DELETE", "/api/sales/win-loss/deal1", { version: 3, confirmLabel: "Example deal" }]));
  });
  it("shows read-only inspection, suppresses authoring and never requests CRM discovery", async () => {
    state.role = "Standard User"; mount();
    fireEvent.click(await screen.findByRole("button", { name: "Example deal" }));
    expect(screen.queryByRole("button", { name: "Edit outcome" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete record" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByRole("button", { name: "Log outcome" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "HubSpot review" }));
    await screen.findByText("HubSpot review is unavailable in read-only mode.");
    expect(state.call.mock.calls.some(([, url]) => url.includes("hubspot"))).toBe(false);
  });
  it("shows named competitor analytics, denominators, coverage and exact currency totals", async () => {
    mount(); await screen.findByRole("button", { name: "Example deal" });
    fireEvent.click(screen.getByRole("button", { name: "Analytics" }));
    await screen.findByText("By competitor");
    expect(screen.getAllByText("Named competitor").length).toBeGreaterThan(0);
    expect(screen.getByText(/Win rate = won/)).toBeTruthy();
    expect(screen.getByText("Deal value by currency")).toBeTruthy();
    expect(screen.getAllByText("USD 12").length).toBeGreaterThan(0);
    expect(screen.getByText("Evidence coverage")).toBeTruthy();
  });
  it("requires an explicit unmapped outcome, selected rows and reviewed replacement before CRM import", async () => {
    mount(); await screen.findByRole("button", { name: "Example deal" });
    fireEvent.click(screen.getByRole("button", { name: "HubSpot review" }));
    await screen.findByText("1. Map HubSpot fields");
    fireEvent.change(screen.getByLabelText(/Deal label/), { target: { value: "dealname" } });
    fireEvent.change(screen.getByLabelText(/Close date/), { target: { value: "closedate" } });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "amount" } });
    fireEvent.change(screen.getByLabelText("Outcome for Pipeline Closed"), { target: { value: "won" } });
    fireEvent.click(screen.getByRole("button", { name: "Build complete preview" }));
    await screen.findByText("2. Preview and review each record");
    const select = screen.getByLabelText("Select CRM deal") as HTMLInputElement;
    expect(select.checked).toBe(false); expect(select.disabled).toBe(true);
    const outcome = screen.getByLabelText(/Outcome is unmapped/);
    fireEvent.change(outcome, { target: { value: "lost" } });
    fireEvent.click(select);
    expect((screen.getByRole("button", { name: "Import selected outcomes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Manually corrected notes")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/I reviewed the full comparison/));
    fireEvent.click(screen.getByRole("button", { name: "Import selected outcomes" }));
    await waitFor(() => expect(calls("POST").find(([, url]) => url.endsWith("/hubspot/import"))).toBeTruthy());
    const imported = calls("POST").find(([, url]) => url.endsWith("/hubspot/import"))![2];
    expect(imported.selected).toHaveLength(1);
    expect(imported.selected[0]).toMatchObject({ expectedVersion: 2, replace: true, reviewed: true, outcomeConfirmed: true,
      data: { outcome: "lost", competitorId: null, competitorConfirmed: false } });
  });
  it("does not apply a saved battlecard proposal until approval is clicked", async () => {
    state.reviews = [{ id: "proposal", kind: "battlecard", approvedAt: null, createdAt: record.createdAt, payload: {
      scope: { recordIds: [record.id] }, evidence: [record], warnings: ["Small sample"], themes: [{ title: "Cited theme", summary: "Evidence", evidenceIds: [record.id] }],
      proposal: { battlecardId: "card", beforeNotes: "Old notes", addition: "Reviewed addition [deal1]" },
    } }];
    mount(); await screen.findByRole("button", { name: "Example deal" });
    fireEvent.click(screen.getByRole("button", { name: "AI evidence" }));
    await screen.findByText("Reviewed addition [deal1]");
    expect(calls("POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Example deal · deal1" }));
    const snapshot = screen.getByRole("dialog", { name: "Example deal" });
    expect(within(snapshot).queryByRole("button", { name: "Edit outcome" })).toBeNull();
    expect(within(snapshot).queryByRole("button", { name: "Delete record" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve addition" }));
    await waitFor(() => expect(calls("POST")[0]).toEqual(["POST", "/api/sales/win-loss/reviews/proposal/approve", { approve: true }]));
  });
});
