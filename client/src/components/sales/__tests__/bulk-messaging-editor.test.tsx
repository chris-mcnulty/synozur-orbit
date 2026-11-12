// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import BulkMessagingEditor from "../bulk-messaging-editor";
import { bulkOutreachInput, matchesAssignedMessagingGroup, matchesContactFamiliarity, outreachKey, useBulkOutreachActions } from "../use-outreach-context";
import { useCampaignClassification } from "../use-campaign-classification";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/tabContext", () => ({ getTabTenantId: () => "tenant-1", getTabMarketId: () => "market-1" }));
const request = vi.mocked(apiRequest);
function setup(ids = ["one", "two"], canEdit = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const saved = vi.fn();
  const view = render(<QueryClientProvider client={qc}><BulkMessagingEditor campaignId="campaign-1" selectedIds={ids} canEdit={canEdit} onSaved={saved} /></QueryClientProvider>);
  return { qc, saved, ...view };
}
function open() { fireEvent.click(screen.getByTestId("bulk-messaging-open")); }
beforeEach(() => { request.mockResolvedValue({ json: async () => ({ updated: 2 }) } as Response); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("explicit bulk outreach settings", () => {
  it("requires a change and exact-count confirmation and omits unchanged familiarity", async () => {
    const { saved } = setup();
    open();
    expect(screen.getByText(/Only these 2 selected contacts/)).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save for 2 contacts" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Apply these changes to exactly 2 selected contacts." }));
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "Messaging group" }), { target: { value: "partner" } });
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(save);
    await waitFor(() => expect(request).toHaveBeenCalledWith("PATCH", "/api/sales-outreach/campaigns/campaign-1/outreach-context", { prospectIds: ["one", "two"], messagingGroup: "partner" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  });
  it("can change familiarity alone, or explicitly clear the group and reset familiarity", async () => {
    setup();
    open();
    fireEvent.change(screen.getByRole("combobox", { name: "Familiarity with campaign sender" }), { target: { value: "known" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Save for 2 contacts" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("PATCH", expect.any(String), { prospectIds: ["one", "two"], familiarity: "known" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    open();
    fireEvent.change(screen.getByRole("combobox", { name: "Messaging group" }), { target: { value: "unassigned" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Familiarity with campaign sender" }), { target: { value: "unknown" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Save for 2 contacts" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("PATCH", expect.any(String), { prospectIds: ["one", "two"], messagingGroup: null, familiarity: "unknown" }));
  });
  it("keeps choices and exact count on failure, supports retry and cancels without a write", async () => {
    const { saved } = setup();
    request.mockRejectedValueOnce(new Error("403: Cannot update this campaign"));
    open();
    fireEvent.change(screen.getByRole("combobox", { name: "Messaging group" }), { target: { value: "customer" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Save for 2 contacts" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Messaging group" }) as HTMLSelectElement).value).toBe("customer");
    expect(saved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save for 2 contacts" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("disables empty, oversized and read-only actions", () => {
    const first = setup([]);
    expect((screen.getByTestId("bulk-messaging-open") as HTMLButtonElement).disabled).toBe(true);
    first.unmount();
    const second = setup(["one"], false);
    expect((screen.getByTestId("bulk-messaging-open") as HTMLButtonElement).disabled).toBe(true);
    second.unmount();
    setup(Array.from({ length: 201 }, (_, i) => String(i)));
    expect((screen.getByTestId("bulk-messaging-open") as HTMLButtonElement).disabled).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
  it("validates unique capped selections and at least one independent setting", () => {
    expect(() => bulkOutreachInput([], { familiarity: "known" })).toThrow();
    expect(() => bulkOutreachInput(["one", "one"], { familiarity: "cold" })).toThrow();
    expect(() => bulkOutreachInput(Array.from({ length: 201 }, (_, i) => String(i)), { messagingGroup: null })).toThrow();
    expect(() => bulkOutreachInput(["one"], {})).toThrow();
    expect(bulkOutreachInput(["one"], { messagingGroup: null })).toEqual({ prospectIds: ["one"], messagingGroup: null });
    expect(matchesContactFamiliarity({}, "unknown")).toBe(true);
    expect(matchesContactFamiliarity({ familiarity: "known" }, "cold")).toBe(false);
    expect(matchesContactFamiliarity({ familiarity: "cold" }, "all")).toBe(true);
    expect(matchesAssignedMessagingGroup({ messagingGroup: "partner" }, "partner")).toBe(true);
  });
  it("patches only the selected campaign directory and invalidates affected preflight fingerprints", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["/api/sales-outreach/campaigns", "campaign-1", "prospects"];
    const other = ["/api/sales-outreach/campaigns", "campaign-2", "prospects"];
    const rows = [{ id: "one", messagingGroup: "partner", familiarity: "cold", status: "sent" }, { id: "two", familiarity: "unknown" }];
    qc.setQueryData(key, rows); qc.setQueryData(other, rows);
    qc.setQueryData(outreachKey("one"), { fingerprint: "old", familiarity: "cold" });
    qc.setQueryData(outreachKey("two"), { fingerprint: "unaffected" });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useBulkOutreachActions("campaign-1"), { wrapper });
    await act(async () => { await result.current.mutateAsync({ prospectIds: ["one"], patch: { familiarity: "known" } }); });
    expect(qc.getQueryData(key)).toEqual([{ ...rows[0], familiarity: "known" }, rows[1]]);
    expect(qc.getQueryData(other)).toEqual(rows);
    expect(qc.getQueryState(outreachKey("one"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(outreachKey("two"))?.isInvalidated).toBe(false);
  });
  it("reuses the classification selection cap and clears selection when the filter scope changes", () => {
    const people = Array.from({ length: 237 }, (_, i) => ({ id: `p-${i}` }));
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result, rerender } = renderHook(({ scope }) => useCampaignClassification({ campaignId: "campaign", people, role: "Analyst", filterScope: scope }), { wrapper, initialProps: { scope: "all" } });
    act(() => result.current.toggleAll(true));
    expect(result.current.selectedIds).toHaveLength(200);
    expect(result.current.selectedIds).toEqual(people.slice(0, 200).map(person => person.id));
    rerender({ scope: "known" });
    expect(result.current.selectedIds).toEqual([]);
  });
});
