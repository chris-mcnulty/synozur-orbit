// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ThreadContact, ThreadMeeting } from "@shared/email-thread";
import EmailThreadDialog from "../email-thread-dialog";
import { apiRequest } from "@/lib/queryClient";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
const request = vi.mocked(apiRequest);
const empty: ThreadContact = { name: "", email: "", title: "", companyName: "", linkedinUrl: "", phone: "" };
const maya = { ...empty, name: "Maya Chen", email: "maya@example.com", title: "Operations Director", matchedProspectId: "maya" };
const rae = { ...empty, name: "Rae Morgan", email: "rae@example.com", phone: "+44 20 1234 5678" };
const target = { id: "maya", name: "Maya Chen", email: "maya@example.com", linkedinUrl: "" };
const meeting: ThreadMeeting = { proposal: "Tuesday afternoon", evidence: "Could we talk next Tuesday at 3?", proposer: "Rae Morgan", dateText: "next Tuesday", timeText: "3", timezone: "", status: "proposed", needsConfirmation: true };
const url = "/api/sales-outreach/campaigns/campaign-1/email-thread";
const reviewLabel = "I reviewed the participant, target, fields and selected times";

function mount(fixed = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const props = { open: true, onOpenChange: vi.fn(), campaignId: "campaign-1", scope: "tenant:user:campaign-1", canEdit: true, contacts: [target], target: fixed ? target : undefined };
  const result = render(<QueryClientProvider client={client}><EmailThreadDialog {...props} /></QueryClientProvider>);
  return { ...result, props, client, invalidate };
}
async function analyze() {
  fireEvent.change(screen.getByLabelText("Email thread"), { target: { value: "Maya and Rae: next Tuesday at 3" } });
  fireEvent.click(screen.getByRole("button", { name: "Analyze thread" }));
  await screen.findByLabelText("Participant to review");
}
function choose(index = "0") {
  fireEvent.change(screen.getByLabelText("Participant to review"), { target: { value: index } });
}
function saveButton() { return screen.getByRole("button", { name: "Save selected details" }) as HTMLButtonElement; }
function saveCalls() { return request.mock.calls.filter(([, path]) => path === `${url}/save`); }

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (method, path) => {
    if (method === "GET") return Response.json({ contact: { ...empty, name: "Maya Chen", email: "maya@example.com" }, meetingTimes: [] });
    if (path.endsWith("/parse")) return Response.json({ contacts: [maya, rae], meetingTimes: [meeting, { ...meeting, proposal: "Monday declined", status: "declined" }], warnings: ["Timezone absent in source."] });
    return Response.json({ prospectId: "maya", filledFields: ["title"], skippedFields: [], meetingTimesSaved: 1 });
  });
});
afterEach(cleanup);

describe("email thread evidence review", () => {
  it("requires an explicit participant and destination, even with a suggested exact match", async () => {
    mount();
    await analyze();
    expect((screen.getByLabelText("Participant to review") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Save to campaign contact") as HTMLSelectElement).value).toBe("");
    expect(saveButton().disabled).toBe(true);
    choose();
    expect(screen.getByText(/Exact identity match suggested/)).toBeTruthy();
    expect((screen.getByLabelText("Save to campaign contact") as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Save to campaign contact"), { target: { value: "new" } });
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }));
    expect(saveButton().disabled).toBe(false);
    expect(saveCalls()).toHaveLength(0);
  });

  it("saves only reviewed editable fields and explicitly selected times; keeps known fields intact", async () => {
    const { invalidate } = mount(true);
    await analyze(); choose();
    await screen.findByText("Current: Maya Chen · preserved");
    expect((screen.getByRole("checkbox", { name: "Include Name" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("checkbox", { name: "Save meeting proposal 1" }).getAttribute("data-state")).toBe("unchecked");
    expect(screen.getByRole("checkbox", { name: "Save meeting proposal 2" }).getAttribute("data-state")).toBe("unchecked");
    fireEvent.change(screen.getByLabelText("Proposed Title"), { target: { value: "Chief Operating Officer" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Save meeting proposal 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }));
    fireEvent.click(saveButton());
    await screen.findByText(/Saved reviewed details:/);
    expect(saveCalls()[0]).toEqual(["POST", `${url}/save`, {
      prospectId: "maya", contact: { ...empty, title: "Chief Operating Officer" }, meetingTimes: [meeting], confirmed: true,
    }]);
    expect(invalidate).toHaveBeenCalled();
    expect((screen.getByLabelText("Participant to review") as HTMLSelectElement).value).toBe("");
    expect(saveButton().disabled).toBe(true);
  });

  it("never selects the first identity for an existing contact and warns on mismatch", async () => {
    mount(true); await analyze();
    expect(screen.queryByLabelText("Proposed Email")).toBeNull();
    choose("1");
    await screen.findByText(/Identity mismatch or unverified match/);
    expect((screen.getByLabelText("Proposed Email") as HTMLInputElement).value).toBe("rae@example.com");
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }));
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByRole("checkbox", { name: "Save meeting proposal 2" }).getAttribute("data-disabled")).not.toBeNull();
    choose("0");
    expect(screen.getByRole("checkbox", { name: reviewLabel }).getAttribute("data-state")).toBe("unchecked");
  });

  it("shows prior saved suggestions on opening, before analyzing another thread", async () => {
    request.mockResolvedValueOnce(Response.json({ contact: { ...empty, name: "Maya Chen" }, meetingTimes: [meeting] }));
    mount(true);
    await screen.findByRole("region", { name: "Previously saved meeting suggestions" });
    expect(screen.getByText("Tuesday afternoon")).toBeTruthy();
    expect(screen.getByText(/Timezone: Unresolved/)).toBeTruthy();
    expect(request).toHaveBeenCalledWith("GET", `${url}/contact?prospectId=maya`);
    expect(saveCalls()).toHaveLength(0);
  });

  it("can save only meeting suggestions without filling any contact fields", async () => {
    mount(true); await analyze(); choose("times-only");
    await waitFor(() => expect(screen.queryByLabelText("Loading current contact details")).toBeNull());
    fireEvent.click(screen.getByRole("checkbox", { name: "Save meeting proposal 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }));
    fireEvent.click(saveButton());
    await screen.findByText(/Saved reviewed details:/);
    expect(saveCalls()[0][2]).toEqual({ prospectId: "maya", contact: empty, meetingTimes: [meeting], confirmed: true });
  });

  it("preserves pasted text after a provider error and retries on demand", async () => {
    request.mockRejectedValueOnce(new Error("503: Email analysis provider unavailable"));
    mount();
    fireEvent.change(screen.getByLabelText("Email thread"), { target: { value: "Keep this private source" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze thread" }));
    await screen.findByText("Email analysis provider unavailable");
    expect((screen.getByLabelText("Email thread") as HTMLTextAreaElement).value).toBe("Keep this private source");
    expect(saveCalls()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Retry analysis" }));
    await screen.findByLabelText("Participant to review");
  });

  it("keeps a failed save review for retry and clears confirmation when editing", async () => {
    mount(); await analyze(); choose();
    fireEvent.change(screen.getByLabelText("Save to campaign contact"), { target: { value: "new" } });
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }));
    request.mockRejectedValueOnce(new Error("Save temporarily unavailable"));
    fireEvent.click(saveButton());
    await screen.findByText("Save temporarily unavailable");
    expect((screen.getByLabelText("Proposed Email") as HTMLInputElement).value).toBe(maya.email);
    fireEvent.change(screen.getByLabelText("Proposed Title"), { target: { value: "Director" } });
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }));
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await screen.findByText(/Saved reviewed details:/);
    expect(saveCalls()[1][2]).toEqual({ contact: { ...empty, name: maya.name, email: maya.email, title: "Director" }, meetingTimes: [], confirmed: true });
  });

  it("resets raw text and ignores a pending parse after the scope changes", async () => {
    let finish!: (response: Response) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { rerender, props, client } = mount();
    fireEvent.change(screen.getByLabelText("Email thread"), { target: { value: "Private tenant A source" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze thread" }));
    rerender(<QueryClientProvider client={client}><EmailThreadDialog {...props} scope="tenantB:user:campaign-1" /></QueryClientProvider>);
    finish(Response.json({ contacts: [maya], meetingTimes: [], warnings: [] }));
    await waitFor(() => expect((screen.getByLabelText("Email thread") as HTMLTextAreaElement).value).toBe(""));
    expect(screen.queryByLabelText("Participant to review")).toBeNull();
  });

  it("blocks saving until current contact details load and offers retry after a failure", async () => {
    request.mockRejectedValueOnce(new Error("Current contact unavailable"));
    mount(true);
    await screen.findByText("Current contact unavailable");
    await analyze(); choose();
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry current details" }));
    await screen.findByText("Current: Maya Chen · preserved");
    fireEvent.click(screen.getByRole("checkbox", { name: reviewLabel }));
    expect(saveButton().disabled).toBe(false);
  });

  it("clears the private thread and review when closed and reopened", async () => {
    const { rerender, props, client } = mount();
    await analyze(); choose();
    rerender(<QueryClientProvider client={client}><EmailThreadDialog {...props} open={false} /></QueryClientProvider>);
    rerender(<QueryClientProvider client={client}><EmailThreadDialog {...props} open /></QueryClientProvider>);
    expect((screen.getByLabelText("Email thread") as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByLabelText("Participant to review")).toBeNull();
    expect(saveButton().disabled).toBe(true);
  });
});
