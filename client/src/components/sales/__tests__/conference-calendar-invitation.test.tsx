// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ConferenceCalendarInvitation from "../conference-calendar-invitation";
import { apiRequest } from "@/lib/queryClient";
import { defaultMeetingContact, type CalendarInvitationState } from "@shared/conference-meetings";
vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
const request = vi.mocked(apiRequest);
const preview = {
  subject: "Event meeting", agenda: "Public agenda", location: "Lobby", durationMinutes: 30,
  attendees: ["guest@example.com"], start: "2099-07-01T10:00:00-07:00", end: "2099-07-01T17:30:00Z",
  timezone: "America/Los_Angeles", owner: "Owner", organizer: "organizer@example.com", fingerprint: "a".repeat(64),
};
let invitation: CalendarInvitationState | null;
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ConferenceCalendarInvitation
    personId="person" name="Guest" email="guest@example.com" eventName="Event"
    meeting={{ ...defaultMeetingContact(), stage: "meeting_booked", meetingAt: preview.start, meetingOwner: "Owner" }}
    disabled={false}
  /></QueryClientProvider>);
}
beforeEach(() => {
  invitation = null;
  request.mockReset();
  request.mockImplementation(async (method, url) => {
    if (method === "GET") return Response.json({ connected: true, userId: "owner", invitation });
    if (String(url).endsWith("/preview")) return Response.json(preview);
    if (String(url).endsWith("/send")) {
      invitation = { status: "sent", organizerUserId: "owner", preview, eventId: "event" };
      return Response.json(invitation);
    }
    if (String(url).endsWith("/cancel")) {
      invitation = { ...invitation!, status: "cancelled" };
      return Response.json(invitation);
    }
    throw new Error("Unexpected request");
  });
});
afterEach(cleanup);

describe("reviewed Outlook invitation controls", () => {
  it("shows every external detail and requires a checked confirmation before sending", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Review invitation" }));
    await screen.findByRole("heading", { name: "Review calendar invitation" });
    expect(screen.getByText(/Timezone: America\/Los_Angeles/)).toBeTruthy();
    expect(screen.getByText("Public agenda")).toBeTruthy();
    expect(screen.getByText(/Organizer: organizer@example.com/)).toBeTruthy();
    expect(screen.getByText("Participants: guest@example.com")).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send calendar invitation" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(request.mock.calls.some(([, url]) => String(url).endsWith("/send"))).toBe(false);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(send);
    await screen.findByText("Invitation created in Outlook.");
    const calls = request.mock.calls.filter(([, url]) => String(url).endsWith("/send"));
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toMatchObject({ confirmed: true, fingerprint: preview.fingerprint });
  });
  it("requires separate cancellation confirmation and then disables further invitations", async () => {
    invitation = { status: "sent", organizerUserId: "owner", preview, eventId: "event" };
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel invitation…" }));
    await screen.findByRole("heading", { name: "Cancel this Outlook invitation?" });
    expect(request.mock.calls.some(([, url]) => String(url).endsWith("/cancel"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation and notify participants" }));
    await screen.findByText(/Invitation cancelled/);
    expect(screen.queryByRole("button", { name: "Review invitation" })).toBeNull();
    expect(request.mock.calls.find(([, url]) => String(url).endsWith("/cancel"))?.[2]).toEqual({ confirmed: true, fingerprint: preview.fingerprint });
  });
  it("leaves sent invitations untouched when the review is dismissed", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Review invitation" }));
    await screen.findByRole("heading", { name: "Review calendar invitation" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Review calendar invitation" })).toBeNull());
    expect(request.mock.calls.some(([, url]) => String(url).endsWith("/send"))).toBe(false);
  });
});
