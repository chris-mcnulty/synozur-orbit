// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WarmConferenceShortlist } from "@shared/conference-meetings";
import ConferenceWarmContacts from "../conference-warm-contacts";
import { apiRequest } from "@/lib/queryClient";
vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
const request = vi.mocked(apiRequest);
const data: WarmConferenceShortlist = {
  checkedAt: "2026-11-10T10:00:00Z", candidateCount: 100, limitations: ["Bounded CRM sample"],
  contacts: [{
    hubspotContactId: "123", name: "Example Person", email: "person@example.invalid", company: "Acme", jobTitle: "Director",
    linkedinUrl: null, crmOwnerId: "crm-owner", ownerUserIds: ["orbit-owner"], relatedCampaigns: ["Other campaign"],
    relationships: ["customer"], score: 60, reasons: ["Company appears in saved target accounts."],
    activities: [], limitations: ["HubSpot emails history is unavailable."], attendance: "unknown",
  }],
};
function mount(planSaved = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(<QueryClientProvider client={client}><ConferenceWarmContacts campaignId="campaign" planSaved={planSaved} /></QueryClientProvider>);
  return { invalidate };
}
beforeEach(() => { request.mockReset(); request.mockImplementation(async () => Response.json(data)); });
afterEach(cleanup);

describe("warm conference shortlist selection", () => {
  it("requires a saved plan and never fetches or imports automatically", () => {
    mount(false);
    expect((screen.getByRole("button", { name: "Find warm contacts" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Save the event plan first/)).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });
  it("shows reasons, ownership, unknown attendance and missing history without preselection", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Find warm contacts" }));
    const checkbox = await screen.findByRole("checkbox", { name: "Select Example Person for import" });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "Import 0 selected" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Attendance unknown")).toBeTruthy();
    expect(screen.getByText(/HubSpot emails history is unavailable/)).toBeTruthy();
    expect(screen.getByText(/This is not evidence that no relationship exists/)).toBeTruthy();
    expect(screen.getByText(/Company appears in saved target accounts/)).toBeTruthy();
    expect(screen.getByText("crm-owner")).toBeTruthy();
    expect(screen.getByText("orbit-owner")).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("imports only explicitly selected ids, refreshes both views and clears stale recommendations", async () => {
    const { invalidate } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Find warm contacts" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Example Person for import" }));
    request.mockResolvedValueOnce(Response.json({ imported: 1, skipped: 0 }));
    fireEvent.click(screen.getByRole("button", { name: "Import 1 selected" }));
    await screen.findByRole("status");
    expect(request).toHaveBeenLastCalledWith("POST", "/api/sales-outreach/campaigns/campaign/meetings/recommendations/import", { contactIds: ["123"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/sales-outreach/campaigns/campaign/meetings"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/sales-outreach/campaigns", "campaign", "prospects"] });
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("clears selections on refresh", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Find warm contacts" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Example Person for import" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh shortlist" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect((await screen.findByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });
  it("shows an empty result with sampling limits rather than implying no relationships", async () => {
    request.mockResolvedValueOnce(Response.json({ ...data, contacts: [] }));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Find warm contacts" }));
    expect(await screen.findByText("No warm contacts in this pool")).toBeTruthy();
    expect(screen.getByText("Bounded CRM sample")).toBeTruthy();
  });
  it("shows errors and lets users retry without importing", async () => {
    request.mockRejectedValueOnce(new Error("HubSpot is unavailable"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Find warm contacts" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("checkbox")).toBeTruthy();
    expect(request.mock.calls.every(c => c[1].endsWith("/recommendations"))).toBe(true);
  });
});
