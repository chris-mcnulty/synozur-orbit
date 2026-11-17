// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import CampaignNextSteps, { CampaignSummary, useCampaignSnapshotInvalidation, type CampaignNextStep } from "../campaign-next-steps";
import CampaignOverview from "../campaign-overview";
import NewProspectClassification, { newProspectClassificationPayload, type NewProspectClassificationValue } from "../new-prospect-classification";

vi.mock("@/lib/queryClient", async original => ({ ...await original<typeof import("@/lib/queryClient")>(), apiRequest: vi.fn() }));
vi.mock("@/lib/tabContext", () => ({ getTabTenantId: () => "tenant-1", getTabMarketId: () => "market-1" }));
const request = vi.mocked(apiRequest);
const step: CampaignNextStep = { id: "step-1", version: "ver-1", prospectId: "person-1", prospectName: "Maya Chen", companyName: "Cedar Systems", priority: "urgent", title: "Review pending outreach", reason: "A draft is waiting for approval.", action: "review_draft", touchId: "draft-7" };
const counts = { contacts: 3, pendingDrafts: 1, sent: 2, replied: 1, held: 0, overdue: 0, worked: 2, communicated: 2, externallyContacted: 1, externalCommunications: 3, meetings: 1, bookedMeetings: 1, agreedMeetings: 0 };
const meeting = { id: "shared-1", status: "booked" as const, contacts: [{ prospectId: "person-1", name: "Maya Chen", companyName: "Cedar Systems" }, { prospectId: "person-2", name: "Ravi Shah", companyName: "Northstar Labs" }], meetingAt: "2026-04-07T16:00:00.000Z", location: "Room 4", owner: "Jordan Lee" };
const workspace = { generatedAt: "2026-01-03T10:00:00Z", items: [step], completedItems: [] as CampaignNextStep[], counts, meetings: [meeting], summary: "Maya at Cedar Systems has a draft awaiting review.", nextSteps: [step] };
const summary = workspace;
function setup(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  return { client, ...view };
}
beforeEach(() => { request.mockResolvedValue({ json: async () => workspace } as Response); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("classification during prospect creation", () => {
  it("omits blank fields instead of resetting existing members", () => {
    expect(newProspectClassificationPayload({})).toEqual({});
    expect(newProspectClassificationPayload({ classification: { tags: [" ", ""], relationships: [], eventRoles: [], sourceDetail: " " } })).toEqual({});
    expect(newProspectClassificationPayload({ classification: { relationships: ["partner"], tags: [" personal ", ""] }, familiarity: "known" })).toEqual({ classification: { relationships: ["partner"], tags: ["personal"] }, familiarity: "known" });
  });
  it("requires explicit friendship rather than treating a personal tag as familiarity", () => {
    let latest: NewProspectClassificationValue = {};
    function Form() {
      const [value, setValue] = useState<NewProspectClassificationValue>({});
      return <NewProspectClassification value={value} onChange={next => { latest = next; setValue(next); }} />;
    }
    setup(<Form />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Personal friendship/ }));
    fireEvent.click(screen.getByRole("button", { name: "Partner" }));
    expect(newProspectClassificationPayload(latest)).toEqual({ classification: { relationships: ["partner"] }, familiarity: "personal_friend" });
    fireEvent.click(screen.getByRole("checkbox", { name: /Personal friendship/ }));
    expect(newProspectClassificationPayload(latest)).toEqual({ classification: { relationships: ["partner"] }, familiarity: "unknown" });
  });
});

describe("campaign next steps", () => {
  it("dispatches the original server item for manual review, never sends", async () => {
    const onAction = vi.fn();
    setup(<CampaignNextSteps campaignId="campaign-1" scope="scope-1" canEdit onAction={onAction} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review draft" }));
    expect(onAction).toHaveBeenCalledWith(step);
    expect(request).toHaveBeenCalledWith("GET", "/api/sales-outreach/campaigns/campaign-1/next-steps");
    expect(request.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });
  it("respects read-only permissions", async () => {
    setup(<CampaignNextSteps campaignId="campaign-1" scope="scope-1" canEdit={false} onAction={vi.fn()} />);
    expect((await screen.findByRole("button", { name: "Review draft" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("shows empty and retry states", async () => {
    request.mockRejectedValueOnce(new Error("Unavailable"));
    setup(<CampaignNextSteps campaignId="campaign-1" scope="scope-1" canEdit onAction={vi.fn()} />);
    await screen.findByRole("button", { name: "Retry" });
    request.mockResolvedValue({ json: async () => ({ generatedAt: summary.generatedAt, items: [] }) } as Response);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No next steps right now")).toBeTruthy();
  });
  it("isolates next-step query data by scope", async () => {
    const { client } = setup(<CampaignNextSteps campaignId="campaign-1" scope="tenant-1" canEdit onAction={vi.fn()} />);
    await screen.findByText(step.title);
    expect(client.getQueryData(["campaign-next-steps", "tenant-1", "campaign-1", "tenant-1", "market-1"])).toBeTruthy();
    expect(client.getQueryData(["campaign-next-steps", "tenant-2", "campaign-1", "tenant-1", "market-1"])).toBeUndefined();
  });
  it("marks a reminder done with its current version and keeps the item until the server refreshes", async () => {
    setup(<CampaignNextSteps campaignId="campaign-1" scope="scope-1" canEdit onAction={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark done: Review pending outreach" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("PATCH", "/api/sales-outreach/campaigns/campaign-1/next-steps/completion", {
      prospectId: "person-1", itemId: "step-1", version: "ver-1", completed: true,
    }));
    expect(screen.getByText(step.title)).toBeTruthy();
    expect(screen.getByText(/does not send a message or change outreach holds or meeting status/i)).toBeTruthy();
  });
  it("shows completion failures on the recommendation without removing it", async () => {
    request.mockImplementation(async (method, path) => {
      if (method === "PATCH") throw new Error("409: Recommendation changed. Refresh and try again.");
      return { json: async () => workspace } as Response;
    });
    setup(<CampaignNextSteps campaignId="campaign-1" scope="scope-1" canEdit onAction={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark done: Review pending outreach" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not update reminder: Recommendation changed. Refresh and try again.");
    expect(screen.getByText(step.title)).toBeTruthy();
  });
  it("keeps completion and Undo read-only for viewers", async () => {
    const completedWorkspace = { ...workspace, items: [], completedItems: [step] };
    request.mockResolvedValue({ json: async () => completedWorkspace } as Response);
    setup(<CampaignNextSteps campaignId="campaign-1" scope="scope-1" canEdit={false} onAction={vi.fn()} />);
    const undo = await screen.findByRole("button", { name: "Undo" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(request.mock.calls.some(([method]) => method === "PATCH")).toBe(false);
  });
  it("supports Undo for completed recommendations", async () => {
    const completedWorkspace = { ...workspace, items: [], completedItems: [step] };
    request.mockResolvedValue({ json: async () => completedWorkspace } as Response);
    setup(<CampaignNextSteps campaignId="campaign-1" scope="scope-1" canEdit onAction={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("PATCH", "/api/sales-outreach/campaigns/campaign-1/next-steps/completion", {
      prospectId: "person-1", itemId: "step-1", version: "ver-1", completed: false,
    }));
  });
  it("keeps a completed reminder visible when Undo fails", async () => {
    const completedWorkspace = { ...workspace, items: [], completedItems: [step] };
    request.mockImplementation(async method => {
      if (method === "PATCH") throw new Error("Unavailable");
      return { json: async () => completedWorkspace } as Response;
    });
    setup(<CampaignNextSteps campaignId="campaign-1" scope="scope-1" canEdit onAction={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not update reminder");
    expect(screen.getByText(/Reminder marked done/)).toBeTruthy();
  });
});

describe("campaign summary", () => {
  it("refreshes only this campaign's performance after contacts change without invalidation loops", async () => {
    function Workspace() { useCampaignSnapshotInvalidation("campaign-1", "scope-1"); return null; }
    const { client } = setup(<Workspace />);
    const performanceKey = ["/api/sales-outreach/campaigns", "market-1", "campaign-1", "performance"];
    const otherKey = ["/api/sales-outreach/campaigns", "market-1", "campaign-2", "performance"];
    const peopleKey = ["/api/sales-outreach/campaigns", "campaign-1", "prospects"];
    client.setQueryData(performanceKey, { total: 10 });
    client.setQueryData(otherKey, { total: 5 });
    client.setQueryData(peopleKey, []);
    await client.invalidateQueries({ queryKey: peopleKey });
    expect(client.getQueryState(performanceKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });
  it("generates a factual snapshot on demand, copies, and clears it after contact changes", async () => {
    request.mockResolvedValue({ json: async () => summary } as Response);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    function Workspace() {
      useCampaignSnapshotInvalidation("campaign-1", "scope-1");
      return <CampaignSummary campaignId="campaign-1" scope="scope-1" canGenerate />;
    }
    const { client } = setup(<Workspace />);
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Generate campaign summary" }));
    expect(await screen.findByText(summary.summary)).toBeTruthy();
    expect(request).toHaveBeenCalledWith("POST", "/api/sales-outreach/campaigns/campaign-1/summary", {});
    fireEvent.click(screen.getByRole("button", { name: "Copy summary" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(summary.summary));
    client.setQueryData(["/api/sales-outreach/campaigns", "campaign-1", "prospects"], []);
    await client.invalidateQueries({ queryKey: ["/api/sales-outreach/campaigns", "campaign-1", "prospects"] });
    await waitFor(() => expect(screen.queryByText(summary.summary)).toBeNull());
  });
  it("does not show an old snapshot when campaign scope changes", async () => {
    request.mockResolvedValue({ json: async () => summary } as Response);
    const { client, rerender } = setup(<CampaignSummary key="scope-1" campaignId="campaign-1" scope="scope-1" canGenerate />);
    fireEvent.click(screen.getByRole("button", { name: "Generate campaign summary" }));
    await screen.findByText(summary.summary);
    rerender(<QueryClientProvider client={client}><CampaignSummary key="scope-2" campaignId="campaign-2" scope="scope-2" canGenerate /></QueryClientProvider>);
    expect(screen.queryByText(summary.summary)).toBeNull();
    expect(screen.getByRole("button", { name: "Generate campaign summary" })).toBeTruthy();
  });
  it("shows company names with snapshot priorities and keeps them in the copied facts", async () => {
    request.mockResolvedValue({ json: async () => summary } as Response);
    setup(<CampaignSummary campaignId="campaign-1" scope="scope-1" canGenerate />);
    fireEvent.click(screen.getByRole("button", { name: "Generate campaign summary" }));
    await screen.findByText("Priorities");
    expect(screen.getAllByText(/Maya Chen · Cedar Systems/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Maya Chen.*Cedar Systems, Ravi Shah.*Northstar Labs/)).toBeTruthy();
  });
});

describe("campaign overview", () => {
  it("keeps metrics in Overview without repeating meeting rows", async () => {
    setup(<CampaignOverview campaignId="campaign-1" scope="scope-1" view="metrics" onOpenMeeting={vi.fn()} />);
    expect(await screen.findByText("External logged communications")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Maya Chen/ })).toBeNull();
    expect(screen.queryByText("Room 4")).toBeNull();
  });
  it("shows the meeting list separately and opens the selected attendee", async () => {
    const open = vi.fn();
    setup(<CampaignOverview campaignId="campaign-1" scope="scope-1" view="meetings" onOpenMeeting={open} />);
    const attendee = await screen.findByRole("button", { name: /Maya Chen/ });
    expect(screen.getByRole("region", { name: "Campaign meetings" })).toBeTruthy();
    expect(screen.queryByText("External logged communications")).toBeNull();
    expect(screen.getByText("Room 4")).toBeTruthy();
    fireEvent.click(attendee);
    expect(open).toHaveBeenCalledWith("person-1");
  });
  it("shows campaign-attributed external counts and one shared meeting with every company", async () => {
    const openMeeting = vi.fn();
    const { client } = setup(<CampaignOverview campaignId="campaign-1" scope="scope-1" onOpenMeeting={openMeeting} />);
    expect(await screen.findByText("External logged communications")).toBeTruthy();
    expect(screen.getByText("Orbit messages")).toBeTruthy();
    expect(screen.getByText("Communicated contacts")).toBeTruthy();
    expect(screen.getByText(/not a live mailbox scan/i)).toBeTruthy();
    expect(screen.getByText("1 shared meeting")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Maya Chen.*Cedar Systems/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ravi Shah.*Northstar Labs/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Ravi Shah.*Northstar Labs/ }));
    expect(openMeeting).toHaveBeenCalledWith("person-2");
    expect(client.getQueryData(["campaign-next-steps", "scope-1", "campaign-1", "tenant-1", "market-1"])).toBeTruthy();
    expect(request.mock.calls.filter(([method]) => method === "GET")).toHaveLength(1);
  });
});
