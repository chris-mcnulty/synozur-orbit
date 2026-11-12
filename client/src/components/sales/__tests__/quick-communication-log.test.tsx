// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import QuickCommunicationLog, { ExternalCommunicationBadge, communicationInput } from "../quick-communication-log";
import { OutreachContextPanel, OutreachHistory } from "../outreach-contact-context";
import type { OutreachContext } from "../use-outreach-context";

vi.mock("@/lib/queryClient", async original => ({
  ...await original<typeof import("@/lib/queryClient")>(), apiRequest: vi.fn(),
}));
vi.mock("@/lib/tabContext", () => ({ getTabTenantId: () => "tenant-1", getTabMarketId: () => "market-1" }));
const request = vi.mocked(apiRequest);
const context: OutreachContext = {
  hold: false, messagingGroup: null, familiarity: "unknown", briefs: [], fingerprint: "version-2", recentActivity: true,
  activities: [{
    id: "activity-1", direction: "inbound", channel: "email", sender: "Maya Chen", message: "Available Tuesday.",
    occurredAt: "2025-01-03T10:00:00Z", outcome: "replied", reply: "", followUpAt: null,
    createdAt: "2025-01-03T10:00:00Z", updatedAt: "2025-01-03T10:00:00Z",
  }],
};
function setup(element: React.ReactNode = <QuickCommunicationLog contact={{ id: "person-1", name: "Maya Chen" }} senderName="Ravi Mehta" />) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}>{element}</QueryClientProvider>);
  return qc;
}
beforeEach(() => { request.mockImplementation(async () => ({ json: async () => context }) as Response); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("quick external communication log", () => {
  it("shows an editable local date outside optional details and preserves its timestamp", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Log communication with/ }));
    const input = screen.getByLabelText("Occurred at (your local time)") as HTMLInputElement;
    expect(input.closest("details")).toBeNull();
    expect(input.max).toBeTruthy();
    fireEvent.change(input, { target: { value: "2025-01-02T15:42" } });
    fireEvent.click(screen.getByRole("button", { name: "Save communication" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("POST", expect.stringContaining("external-activities"), expect.objectContaining({ occurredAt: new Date("2025-01-02T15:42").toISOString() })));
  });
  it("rejects invalid or future local times before conversion can write history", () => {
    const form = { direction: "outbound" as const, channel: "phone" as const, sender: "Ravi", notes: "", outcome: "no_reply" as const };
    expect(() => communicationInput({ ...form, occurredAt: "" })).toThrow();
    expect(() => communicationInput({ ...form, occurredAt: "2099-02-10T12:30" })).toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("does not save or fetch on open or cancel", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Log communication with Maya Chen" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByLabelText("Sent by") as HTMLInputElement).value).toBe("Ravi Mehta");
    expect((screen.getByLabelText("Occurred at (your local time)") as HTMLInputElement).value).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(request).not.toHaveBeenCalled();
  });
  it("records outbound without notes, and invalidates directories, shared history and meeting review", async () => {
    const qc = setup();
    const keys = [
      ["/api/sales-outreach/campaigns", "campaign-1", "prospects"],
      ["/api/sales-outreach/campaigns", "campaign-2", "prospects"],
      ["/api/sales-outreach/campaigns/campaign-1/meetings"],
      ["/api/sales-outreach/prospects/person-2/outreach-context", "tenant-1", "market-1"],
    ];
    keys.forEach(key => { qc.setQueryData<unknown>(key, []); });
    fireEvent.click(screen.getByRole("button", { name: /Log communication with/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save communication" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("POST", "/api/sales-outreach/prospects/person-1/external-activities", expect.objectContaining({
      direction: "outbound", channel: "email", sender: "Ravi Mehta", outcome: "no_reply",
      message: "Message sent outside Orbit; content not recorded.", followUpAt: null,
    })));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    keys.forEach(key => expect(qc.getQueryState(key)?.isInvalidated).toBe(true));
    expect(request.mock.calls.every(([method, url]) => method === "GET" || url.endsWith("/external-activities"))).toBe(true);
  });
  it("logs replies even with no Orbit touch, defaults sender to contact and outcome to replied", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Log communication with/ }));
    fireEvent.change(screen.getByLabelText("Communication"), { target: { value: "inbound" } });
    expect((screen.getByLabelText("Reply from") as HTMLInputElement).value).toBe("Maya Chen");
    expect((screen.getByLabelText("Outcome") as HTMLSelectElement).value).toBe("replied");
    expect(screen.queryByRole("option", { name: "No reply" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save communication" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("POST", expect.stringContaining("external-activities"), expect.objectContaining({
      direction: "inbound", sender: "Maya Chen", outcome: "replied",
      message: "Reply received outside Orbit; content not recorded.",
    })));
  });
  it("saves optional notes, channel and meeting outcome in a single write", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Log communication with/ }));
    fireEvent.change(screen.getByLabelText("Communication"), { target: { value: "inbound" } });
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "phone" } });
    fireEvent.change(screen.getByLabelText("Notes (optional)"), { target: { value: "Confirmed Tuesday." } });
    fireEvent.change(screen.getByLabelText("Outcome"), { target: { value: "meeting_agreed" } });
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save communication" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("POST", expect.stringContaining("external-activities"), expect.objectContaining({
      direction: "inbound", channel: "phone", outcome: "meeting_agreed", message: "Confirmed Tuesday.",
    })));
    expect(request.mock.calls.filter(([method]) => method === "POST")).toHaveLength(1);
  });
  it("keeps the form and notes after failure and allows retry", async () => {
    request.mockRejectedValueOnce(new Error("503: Try again later"));
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Log communication with/ }));
    fireEvent.change(screen.getByLabelText("Notes (optional)"), { target: { value: "Spoke yesterday." } });
    fireEvent.click(screen.getByRole("button", { name: "Save communication" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Try again later");
    expect((screen.getByLabelText("Notes (optional)") as HTMLTextAreaElement).value).toBe("Spoke yesterday.");
    fireEvent.click(screen.getByRole("button", { name: "Save communication" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("validates dates and inbound outcomes before any write", () => {
    const form = { direction: "inbound" as const, channel: "email" as const, sender: "Maya", notes: "", outcome: "no_reply" as const, occurredAt: "2025-01-03T10:00" };
    expect(() => communicationInput(form)).toThrow();
    expect(() => communicationInput({ ...form, outcome: "replied", occurredAt: "2099-01-01T10:00" })).toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("labels inbound as received and legacy activities as outbound", () => {
    setup(<OutreachHistory context={{ ...context, activities: [...context.activities, { ...context.activities[0], id: "legacy", direction: undefined, sender: "Ravi Mehta" }] }} />);
    expect(screen.getByText("Email · Inbound · Reply from Maya Chen")).toBeTruthy();
    expect(screen.getByText("Email · Outbound · Sent by Ravi Mehta")).toBeTruthy();
  });
  it("edits inbound direction and only offers replied or meeting-agreed outcomes", async () => {
    setup(<OutreachContextPanel prospectId="person-1" canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Email activity from Maya Chen" }));
    expect((screen.getByLabelText("Direction") as HTMLSelectElement).value).toBe("inbound");
    expect(screen.getByLabelText("Received reply or conversation notes")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "No reply" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Outcome"), { target: { value: "meeting_agreed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save activity" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("PATCH", expect.stringContaining("/external-activities/activity-1"), expect.objectContaining({ direction: "inbound", outcome: "meeting_agreed" })));
  });
  it("shows dated directory badges from the latest shared activity", () => {
    const view = render(<ExternalCommunicationBadge summary={{ direction: "outbound", outcome: "no_reply", occurredAt: "2025-01-03T10:00:00Z" }} />);
    expect(screen.getByText(/Externally contacted/)).toBeTruthy();
    expect(view.container.querySelector("time")?.getAttribute("dateTime")).toBe("2025-01-03T10:00:00Z");
    view.rerender(<ExternalCommunicationBadge summary={{ direction: "inbound", outcome: "replied", occurredAt: "2025-01-03T10:00:00Z" }} />);
    expect(screen.getByText(/Reply recorded/)).toBeTruthy();
  });
});
