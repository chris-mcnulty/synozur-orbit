// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultMeetingContact, meetingBriefSchema } from "@shared/conference-meetings";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/queryClient")>(), apiRequest: api }));
vi.mock("@/components/sales/conference-calendar-invitation", () => ({ default: () => null }));
vi.mock("@/components/sales/conference-warm-contacts", () => ({ default: () => null }));
import ConferenceMeetings from "../conference-meetings";
const inherited = "Build joint customer projects with alliance partners.";
const fixture = {
  campaignId: "campaign", fingerprint: "facts",
  conference: { id: "event", name: "Partner conference", presence: null },
  sessions: [], brief: null, suggestedBrief: meetingBriefSchema.parse({ goals: inherited, targetAccounts: "Avanade" }),
  sourceContext: { eventBrief: "Original event brief", eventDescription: "Original description", eventGoals: inherited, campaignBrief: "Original campaign brief", campaignGoal: inherited, sourceCampaignName: "Promotion plan" },
  contacts: [{ id: "person", name: "Test Partner", meeting: defaultMeetingContact(), meetingFingerprint: "facts" }],
};
function setup(data: any = fixture, selectedContactId: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["/api/sales-outreach/campaigns/campaign/meetings"], data);
  const change = vi.fn();
  const view = render(<QueryClientProvider client={client}><ConferenceMeetings campaignId="campaign" selectedContactId={selectedContactId} onSelectedContactChange={change} /></QueryClientProvider>);
  return { client, change, ...view };
}
beforeEach(() => { api.mockResolvedValue({ json: async () => fixture }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("compact shared event workspace", () => {
  it("separates Setup from meeting tools and keeps unsaved setup when switching presentations", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["/api/sales-outreach/campaigns/campaign/meetings"], fixture);
    const change = vi.fn();
    const show = (presentation: "setup" | "meetings") => <QueryClientProvider client={client}>
      <ConferenceMeetings campaignId="campaign" selectedContactId={null} onSelectedContactChange={change} presentation={presentation} />
    </QueryClientProvider>;
    const { rerender } = render(show("setup"));
    expect(screen.getByRole("button", { name: "Save event plan" })).toBeTruthy();
    expect(screen.getByLabelText("Scheduling URL")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Preview contacts" })).toBeNull();
    await waitFor(() => expect((screen.getByLabelText(/^Conversation goals/) as HTMLTextAreaElement).value).toBe(inherited));
    fireEvent.change(screen.getByLabelText("Availability"), { target: { value: "Thursday afternoon or after the event" } });
    rerender(show("meetings"));
    expect(screen.queryByRole("button", { name: "Save event plan" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Scheduling URL" })).toBeNull();
    expect(screen.getByRole("button", { name: "Preview contacts" })).toBeTruthy();
    rerender(show("setup"));
    expect((screen.getByLabelText("Availability") as HTMLTextAreaElement).value).toBe("Thursday afternoon or after the event");
    expect(api).not.toHaveBeenCalled();
  });
  it("starts collapsed without a second people directory or an automatically opened editor", () => {
    setup();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("People", { exact: true })).toBeNull();
    expect(screen.queryByText("Test Partner", { exact: true })).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });
  it("shows the original event context and starts from inherited goals and accounts", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /context.*setup/i }));
    expect(screen.getByText("Original event brief")).toBeTruthy();
    expect(screen.getByText("Original campaign brief")).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText(/^Conversation goals/) as HTMLTextAreaElement).value).toBe(inherited));
    expect((screen.getByLabelText("Target accounts") as HTMLTextAreaElement).value).toBe("Avanade");
  });
  it("preserves an explicit saved brief instead of replacing it with event defaults", () => {
    setup({ ...fixture, brief: meetingBriefSchema.parse({ goals: "My customer renewal goal", targetAccounts: "Existing accounts" }) });
    fireEvent.click(screen.getByRole("button", { name: /context.*setup/i }));
    expect((screen.getByLabelText(/^Conversation goals/) as HTMLTextAreaElement).value).toBe("My customer renewal goal");
    expect((screen.getByLabelText("Target accounts") as HTMLTextAreaElement).value).toBe("Existing accounts");
  });
  it("retains unsaved changes after collapsing and reopening setup", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /context.*setup/i }));
    fireEvent.change(screen.getByLabelText(/^Conversation goals/), { target: { value: "My private update" } });
    fireEvent.click(screen.getByRole("button", { name: /context.*setup/i }));
    fireEvent.click(screen.getByRole("button", { name: /context.*setup/i }));
    expect((screen.getByLabelText(/^Conversation goals/) as HTMLTextAreaElement).value).toBe("My private update");
    expect(api).not.toHaveBeenCalled();
  });
  it("opens only the contact selected by the campaign table", async () => {
    setup(fixture, "person");
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Meeting prep · Test Partner" })).toBeTruthy();
    expect(screen.queryByText("People", { exact: true })).toBeNull();
    expect(screen.getByRole("button", { name: "Save prep" })).toBeTruthy();
  });
});
