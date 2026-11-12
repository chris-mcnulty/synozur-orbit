// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import CampaignNextSteps, { CampaignSummary, useCampaignSnapshotInvalidation, type CampaignNextStep } from "../campaign-next-steps";
import NewProspectClassification, { newProspectClassificationPayload, type NewProspectClassificationValue } from "../new-prospect-classification";

vi.mock("@/lib/queryClient", async original => ({ ...await original<typeof import("@/lib/queryClient")>(), apiRequest: vi.fn() }));
vi.mock("@/lib/tabContext", () => ({ getTabTenantId: () => "tenant-1", getTabMarketId: () => "market-1" }));
const request = vi.mocked(apiRequest);
const step: CampaignNextStep = { id: "step-1", prospectId: "person-1", prospectName: "Maya Chen", companyName: "Cedar Systems", priority: "urgent", title: "Review pending outreach", reason: "A draft is waiting for approval.", action: "review_draft", touchId: "draft-7" };
const summary = { generatedAt: "2026-01-03T10:00:00Z", summary: "Maya has a draft awaiting review.", counts: { contacts: 1, pendingDrafts: 1, sent: 0, replied: 0, held: 0, overdue: 0 }, nextSteps: [step] };
function setup(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  return { client, ...view };
}
beforeEach(() => { request.mockResolvedValue({ json: async () => ({ generatedAt: summary.generatedAt, items: [step] }) } as Response); });
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
});

describe("campaign summary", () => {
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
});
