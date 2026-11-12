// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import BulkCampaignRemoval from "../bulk-campaign-removal";
import RemovedCampaignContacts from "../removed-campaign-contacts";
import { campaignRemovalInput } from "../use-campaign-removal";
import { canClassifyCampaign } from "../campaign-classification-helpers";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/tabContext", () => ({ getTabTenantId: () => "tenant-1", getTabMarketId: () => "market-1" }));
const request = vi.mocked(apiRequest);
const removed = [{ id: "one", name: "Leila Romero", companyName: "Juniper Labs", removedAt: "2026-06-01T10:00:00Z" }];
const response = (data: unknown) => ({ json: async () => data }) as Response;
function setup(ids = ["one", "two"], role = "Analyst") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const saved = vi.fn();
  const view = (scope: string, selectedIds = ids, currentRole = role) => <QueryClientProvider client={qc}>
    <BulkCampaignRemoval campaignId="campaign-1" selectedIds={selectedIds} selectionScope={scope}
      canEdit={canClassifyCampaign(currentRole)} onRemoved={saved} />
  </QueryClientProvider>;
  return { qc, saved, view, ...render(view("scope-1")) };
}
function open() { fireEvent.click(screen.getByTestId("bulk-campaign-removal-open")); }
function confirm() { fireEvent.click(screen.getByRole("checkbox")); }
function submit() { fireEvent.click(screen.getByRole("button", { name: "Remove 2 contacts from campaign" })); }
function setupHistory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><RemovedCampaignContacts campaignId="campaign-1" scope="tenant-user" /></QueryClientProvider>);
}
beforeEach(() => { request.mockResolvedValue(response({ removed: 2 })); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("remove selected campaign contacts without deleting history", () => {
  it("requires exact-count confirmation, posts only selected IDs, clears selection and invalidates affected queries", async () => {
    const { saved, qc } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    open();
    expect(screen.getByRole("heading", { name: "Remove exactly 2 contacts from this campaign?" })).toBeTruthy();
    expect(screen.getByText(/Shared contacts, other campaigns and HubSpot records are kept/)).toBeTruthy();
    expect(screen.getByText(/does not recall messages, delete drafts already in Outlook, or cancel an external operation already in progress/)).toBeTruthy();
    expect(screen.getByText(/Active outreach to them in this campaign will stop/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Remove 2 contacts from campaign" }) as HTMLButtonElement).disabled).toBe(true);
    submit();
    expect(request).not.toHaveBeenCalled();
    confirm();
    submit();
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledExactlyOnceWith("POST", "/api/sales-outreach/campaigns/campaign-1/prospects/remove", { prospectIds: ["one", "two"], confirmed: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/sales-outreach/campaigns", "campaign-1", "prospects"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/sales-outreach/campaigns", "market-1", "campaign-1", "performance"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/sales-outreach/campaigns/campaign-1/meetings"] });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("cancels without writes and requires fresh confirmation when reopened", () => {
    setup();
    open(); confirm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(request).not.toHaveBeenCalled();
    open();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });
  it("keeps exact selection on errors and supports retry without clearing selection prematurely", async () => {
    const { saved } = setup();
    request.mockRejectedValueOnce(new Error("403: Removal is not allowed"));
    open(); confirm(); submit();
    expect((await screen.findByRole("alert")).textContent).toContain("Removal is not allowed");
    expect(saved).not.toHaveBeenCalled();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    submit();
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each(["Standard User", "Viewer", ""])("blocks the %s role", role => {
    setup(["one"], role);
    expect((screen.getByTestId("bulk-campaign-removal-open") as HTMLButtonElement).disabled).toBe(true);
    expect(() => campaignRemovalInput(["one"], canClassifyCampaign(role))).toThrow(/role/);
    expect(request).not.toHaveBeenCalled();
  });
  it.each(["Analyst", "Domain Admin", "Global Admin"])("permits the %s role with a valid selection", role => {
    setup(["one"], role); open();
    expect(screen.getByRole("heading", { name: "Remove exactly 1 contact from this campaign?" })).toBeTruthy();
  });
  it.each([{ ids: [] }, { ids: ["one", "one"] }, { ids: Array.from({ length: 201 }, (_, i) => String(i)) }])("blocks invalid selections", ({ ids }) => {
    setup(ids);
    expect((screen.getByTestId("bulk-campaign-removal-open") as HTMLButtonElement).disabled).toBe(true);
    expect(() => campaignRemovalInput(ids, true)).toThrow();
  });
  it("closes and discards confirmation when filters, selection or role scope change", () => {
    const { rerender, view } = setup();
    open(); confirm();
    rerender(view("scope-2"));
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(view("scope-1"));
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    rerender(view("scope-1", ["one"]));
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    rerender(view("scope-1", ["one"], "Standard User"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});

describe("removed campaign contacts are read-only", () => {
  it("fetches removed-only contacts on demand and shows existing touch history with no mutation controls", async () => {
    request.mockImplementation(async (_method, path) => response(path.endsWith("/touches")
      ? [{ id: "touch-1", stepNumber: 2, channel: "email", status: "sent", subject: "Conference follow-up", body: "Thanks for your time." }]
      : removed));
    setupHistory();
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Removed contacts" }));
    expect(await screen.findByText("Leila Romero")).toBeTruthy();
    expect(screen.getByText("Juniper Labs")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("GET", "/api/sales-outreach/campaigns/campaign-1/prospects?removed=true");
    fireEvent.click(screen.getByRole("button", { name: "View campaign touch history for Leila Romero" }));
    expect(await screen.findByText("Conference follow-up")).toBeTruthy();
    expect(screen.getByText("Thanks for your time.")).toBeTruthy();
    expect(screen.getByText("Read-only")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("GET", "/api/sales-outreach/prospects/one/touches");
    expect(screen.queryByRole("button", { name: /compose|approve|delete|restore|send|remove.*campaign/i })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(request.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });
  it("provides a retry for failed directory loads", async () => {
    request.mockRejectedValueOnce(new Error("503: Temporarily unavailable")).mockResolvedValue(response(removed));
    setupHistory();
    fireEvent.click(screen.getByRole("button", { name: "Removed contacts" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading contacts" }));
    expect(await screen.findByText("Leila Romero")).toBeTruthy();
  });
  it("provides touch-history retry and a composed empty state", async () => {
    request.mockResolvedValueOnce(response(removed)).mockRejectedValueOnce(new Error("503: History unavailable")).mockResolvedValue(response([]));
    setupHistory();
    fireEvent.click(screen.getByRole("button", { name: "Removed contacts" }));
    fireEvent.click(await screen.findByRole("button", { name: "View campaign touch history for Leila Romero" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading history" }));
    expect(await screen.findByText("No campaign touches were recorded for this contact.")).toBeTruthy();
  });
  it("shows a meaningful empty directory", async () => {
    request.mockResolvedValue(response([]));
    setupHistory();
    fireEvent.click(screen.getByRole("button", { name: "Removed contacts" }));
    expect(await screen.findByText("No removed contacts")).toBeTruthy();
  });
});
