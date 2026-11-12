// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useOutreachPreflight } from "../outreach-preflight";
import { OutreachContextPanel } from "../outreach-contact-context";
import CampaignMessagingBriefs from "../campaign-messaging-briefs";
import { useBulkOutreachActions, type OutreachContext } from "../use-outreach-context";

vi.mock("@/lib/queryClient", async (original) => ({
  ...await original<typeof import("@/lib/queryClient")>(),
  apiRequest: vi.fn(),
}));
vi.mock("@/lib/tabContext", () => ({ getTabTenantId: () => "tenant-1", getTabMarketId: () => "market-1" }));
const request = vi.mocked(apiRequest);
const generated = vi.fn();
const context = (): OutreachContext => ({
  activities: [{ id: "activity-1", channel: "linkedin", occurredAt: "2025-01-03T10:00:00Z", sender: "Maya Chen", message: "Discussed the implementation timeline.", outcome: "replied", reply: "Please follow up next quarter.", followUpAt: "2025-04-04T10:00:00Z", createdAt: "2025-01-03T10:00:00Z", updatedAt: "2025-01-03T10:00:00Z" }],
  hold: false, messagingGroup: null, familiarity: "unknown", briefs: [], fingerprint: "version-1", recentActivity: true,
});
let current: OutreachContext;
function response(value: unknown) { return Promise.resolve({ json: async () => value } as Response); }
function setup(element: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{element}</QueryClientProvider>);
}
function Gate({ fingerprint }: { fingerprint?: string }) {
  const gate = useOutreachPreflight("scope");
  return <><button onClick={() => { void gate.confirm({ id: "person-1", name: "Maya Chen" }, fingerprint).then(generated).catch(() => {}); }}>Compose</button>{gate.dialog(true)}</>;
}
beforeEach(() => {
  current = context();
  request.mockImplementation((method, url, input) => {
    if (method === "PATCH" && url.endsWith("outreach-context")) {
      current = { ...current, ...input as object, fingerprint: "version-2" };
      return response(current);
    }
    return response(current);
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("relationship-aware outreach workspace", () => {
  it("requires review of actual history before first generation", async () => {
    setup(<Gate />);
    fireEvent.click(screen.getByText("Compose"));
    await screen.findByText("Discussed the implementation timeline.");
    expect(screen.getByText("Please follow up next quarter.")).toBeTruthy();
    expect(screen.getByText(/Recent outreach recorded/)).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Confirm & generate draft" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(generated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed/ }));
    fireEvent.click(confirm);
    await waitFor(() => expect(generated).toHaveBeenCalledWith("version-1"));
  });
  it("blocks held contacts even with an earlier supplied fingerprint", async () => {
    current.hold = true;
    setup(<Gate fingerprint="version-1" />);
    fireEvent.click(screen.getByText("Compose"));
    await screen.findByText("Outreach is on hold.");
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed/ }));
    expect((screen.getByRole("button", { name: "Confirm & generate draft" }) as HTMLButtonElement).disabled).toBe(true);
    expect(generated).not.toHaveBeenCalled();
  });
  it("reuses a current fingerprint for retries, but reopens review when it changes", async () => {
    const view = setup(<Gate fingerprint="version-1" />);
    fireEvent.click(screen.getByText("Compose"));
    await waitFor(() => expect(generated).toHaveBeenCalledWith("version-1"));
    expect(screen.queryByRole("dialog")).toBeNull();
    current = { ...current, fingerprint: "changed-version" };
    generated.mockClear();
    fireEvent.click(screen.getByText("Compose"));
    await screen.findByRole("dialog");
    await screen.findByText("Discussed the implementation timeline.");
    expect((screen.getByRole("checkbox", { name: /I reviewed/ }) as HTMLInputElement).checked).toBe(false);
    expect(generated).not.toHaveBeenCalled();
    view.unmount();
  });
  it("persists explicit group assignment, including returning to no group", async () => {
    setup(<OutreachContextPanel prospectId="person-1" canEdit />);
    const select = await screen.findByRole("combobox", { name: /^Messaging group/ });
    fireEvent.change(select, { target: { value: "partner_prospect" } });
    await waitFor(() => expect(request).toHaveBeenCalledWith("PATCH", expect.stringContaining("outreach-context"), { messagingGroup: "partner_prospect" }));
    await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() => expect(request).toHaveBeenCalledWith("PATCH", expect.stringContaining("outreach-context"), { messagingGroup: null }));
  });
  it("updates the canonical contact list cache immediately after assigning a messaging group", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["/api/sales-outreach/campaigns", "campaign-1", "prospects"];
    qc.setQueryData(key, [{ id: "person-1", name: "Maya Chen", messagingGroup: null }, { id: "person-2", name: "Ravi Mehta", messagingGroup: "partner" }]);
    render(<QueryClientProvider client={qc}><OutreachContextPanel prospectId="person-1" canEdit /></QueryClientProvider>);
    fireEvent.change(await screen.findByRole("combobox", { name: /^Messaging group/ }), { target: { value: "customer" } });
    await waitFor(() => expect(qc.getQueryData(key)).toEqual([
      { id: "person-1", name: "Maya Chen", messagingGroup: "customer", familiarity: "unknown" },
      { id: "person-2", name: "Ravi Mehta", messagingGroup: "partner" },
    ]));
  });
  it("requires a new acknowledgement after group context changes", async () => {
    setup(<Gate />);
    fireEvent.click(screen.getByText("Compose"));
    await screen.findByText("Discussed the implementation timeline.");
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed/ }));
    fireEvent.change(screen.getByRole("combobox", { name: /^Messaging group/ }), { target: { value: "customer" } });
    await waitFor(() => expect((screen.getByRole("combobox", { name: /^Messaging group/ }) as HTMLSelectElement).value).toBe("customer"));
    expect((screen.getByRole("checkbox", { name: /I reviewed/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "Confirm & generate draft" }) as HTMLButtonElement).disabled).toBe(true);
    expect(generated).not.toHaveBeenCalled();
  });
  it("detects a race at confirmation and shows the newer history instead of generating", async () => {
    setup(<Gate />);
    fireEvent.click(screen.getByText("Compose"));
    await screen.findByText("Discussed the implementation timeline.");
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed/ }));
    current = { ...current, fingerprint: "new-server-version" };
    fireEvent.click(screen.getByRole("button", { name: "Confirm & generate draft" }));
    await screen.findByText("Contact context changed. Review the latest context before drafting.");
    expect(generated).not.toHaveBeenCalled();
    expect((screen.getByRole("checkbox", { name: /I reviewed/ }) as HTMLInputElement).checked).toBe(false);
  });
  it("saves edits with every activity field and confirms global deletion", async () => {
    setup(<OutreachContextPanel prospectId="person-1" canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit LinkedIn activity from Maya Chen" }));
    fireEvent.change(screen.getByLabelText("Reply"), { target: { value: "Agreed to a follow-up call." } });
    fireEvent.click(screen.getByRole("button", { name: "Save activity" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("PATCH", expect.stringContaining("external-activities/activity-1"), expect.objectContaining({
      sender: "Maya Chen", channel: "linkedin", message: "Discussed the implementation timeline.", reply: "Agreed to a follow-up call.", outcome: "replied", occurredAt: expect.any(String), followUpAt: expect.any(String),
    })));
    await waitFor(() => expect(screen.queryByText("Edit activity")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Delete LinkedIn activity from Maya Chen" }));
    await screen.findByRole("alertdialog");
    expect(request.mock.calls.some(([method]) => method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete activity" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("DELETE", expect.stringContaining("external-activities/activity-1"), undefined));
  });
  it("creates external history and keeps reminder-only copy visible", async () => {
    current.activities = [];
    setup(<OutreachContextPanel prospectId="person-1" canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: "Record activity" }));
    fireEvent.change(screen.getByLabelText("Sender"), { target: { value: "Ravi Mehta" } });
    fireEvent.change(screen.getByLabelText("Message or conversation notes"), { target: { value: "Asked about the rollout." } });
    expect(screen.getByText(/A follow-up date is a reminder only/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save activity" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("POST", expect.stringContaining("external-activities"), expect.objectContaining({ sender: "Ravi Mehta", message: "Asked about the rollout.", followUpAt: null })));
  });
  it("keeps read-only users out of contact writes", async () => {
    setup(<OutreachContextPanel prospectId="person-1" canEdit={false} />);
    await screen.findByText("Discussed the implementation timeline.");
    expect(screen.queryByRole("button", { name: "Record activity" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit LinkedIn/ })).toBeNull();
    expect(screen.getAllByRole("combobox").every(select => (select as HTMLSelectElement).disabled)).toBe(true);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  });
  it("saves goal, guidance, ask and exclusions for all four campaign groups", async () => {
    request.mockImplementation((method, _url, input) => response(method === "PUT" ? (input as { briefs: unknown[] }).briefs : []));
    setup(<CampaignMessagingBriefs campaignId="campaign-1" canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Messaging briefs" }));
    await screen.findByLabelText("Goal");
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Plan the next implementation milestone." } });
    fireEvent.change(screen.getByLabelText("The ask"), { target: { value: "A short review with their delivery lead." } });
    fireEvent.click(screen.getByRole("button", { name: "Save all group briefs" }));
    await screen.findByText("All group briefs saved.");
    const saved = request.mock.calls.find(([method]) => method === "PUT")?.[2] as { briefs: { group: string; goal: string }[] };
    expect(saved.briefs).toHaveLength(4);
    expect(saved.briefs.find((brief) => brief.group === "customer")?.goal).toBe("Plan the next implementation milestone.");
    expect(saved.briefs.map((brief) => brief.group).sort()).toEqual(["customer", "partner", "partner_prospect", "prospect"]);
  });
  it("saves familiarity independently in the contact panel", async () => {
    setup(<OutreachContextPanel prospectId="person-1" canEdit />);
    const select = await screen.findByRole("combobox", { name: /^Familiarity with campaign sender/ });
    expect((select as HTMLSelectElement).value).toBe("unknown");
    fireEvent.change(select, { target: { value: "known" } });
    await waitFor(() => expect(request).toHaveBeenCalledWith("PATCH", expect.stringContaining("outreach-context"), { familiarity: "known" }));
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("known"));
    expect(current.messagingGroup).toBeNull();
  });
  it("requires a new history acknowledgement after familiarity changes in preflight", async () => {
    setup(<Gate />);
    fireEvent.click(screen.getByText("Compose"));
    await screen.findByText("Discussed the implementation timeline.");
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed/ }));
    fireEvent.change(screen.getByRole("combobox", { name: /^Familiarity with campaign sender/ }), { target: { value: "cold" } });
    await waitFor(() => expect(request).toHaveBeenCalledWith("PATCH", expect.stringContaining("outreach-context"), { familiarity: "cold" }));
    await waitFor(() => expect((screen.getByRole("combobox", { name: /^Familiarity with campaign sender/ }) as HTMLSelectElement).value).toBe("cold"));
    expect((screen.getByRole("checkbox", { name: /I reviewed/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "Confirm & generate draft" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm & generate draft" }));
    await waitFor(() => expect(generated).toHaveBeenCalledWith("version-2"));
  });
  it("refreshes an open preflight after a bulk context edit and invalidates its prior acknowledgement", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    render(<Gate />, { wrapper });
    const bulk = renderHook(() => useBulkOutreachActions("campaign-1"), { wrapper });
    fireEvent.click(screen.getByText("Compose"));
    await screen.findByText("Discussed the implementation timeline.");
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed/ }));
    request.mockImplementation((method, url, input) => {
      if (method === "PATCH" && url.includes("/campaigns/")) {
        current = { ...current, familiarity: (input as { familiarity: "known" }).familiarity, fingerprint: "bulk-version" };
        return response({ updated: 1 });
      }
      return response(current);
    });
    await act(async () => { await bulk.result.current.mutateAsync({ prospectIds: ["person-1"], patch: { familiarity: "known" } }); });
    await waitFor(() => expect((screen.getByRole("combobox", { name: /^Familiarity with campaign sender/ }) as HTMLSelectElement).value).toBe("known"));
    expect((screen.getByRole("checkbox", { name: /I reviewed/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "Confirm & generate draft" }) as HTMLButtonElement).disabled).toBe(true);
    expect(generated).not.toHaveBeenCalled();
  });
});
