import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../storage", () => ({ storage: {} }));
import { hasCalendarPermission, createConferenceCalendarEvent, cancelConferenceCalendarEvent, findConferenceCalendarEvent } from "../planner-graph-client";

afterEach(() => vi.unstubAllGlobals());
describe("calendar Graph contract", () => {
  it("does not confuse Planner, read-only calendar or email scopes with calendar write permission", () => {
    expect(hasCalendarPermission("Tasks.ReadWrite Mail.ReadWrite Calendars.Read")).toBe(false);
    expect(hasCalendarPermission("Calendars.ReadWrite.Shared")).toBe(false);
    expect(hasCalendarPermission("https://graph.microsoft.com/Calendars.ReadWrite")).toBe(true);
    expect(hasCalendarPermission("calendars.readwrite")).toBe(true);
  });
  it("posts one event with attendees, text agenda, exact DST-adjusted instants and recovery identity", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "event" }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await createConferenceCalendarEvent("token", "transaction", {
      subject: "Meeting", agenda: "<not html>", location: "Lobby", attendees: ["guest@example.com"], durationMinutes: 30,
      start: "2099-07-01T10:00:00-07:00", end: "2099-07-01T17:30:00Z", timezone: "America/Los_Angeles",
      owner: "Owner", organizer: "organizer@example.com", fingerprint: "a",
    });
    const [url, options] = fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/events");
    expect(body.transactionId).toBe("transaction");
    expect(body.start).toEqual({ dateTime: "2099-07-01T10:00:00", timeZone: "America/Los_Angeles" });
    expect(body.end).toEqual({ dateTime: "2099-07-01T10:30:00", timeZone: "America/Los_Angeles" });
    expect(body.body.contentType).toBe("Text");
    expect(body.body.content).toContain("America/Los_Angeles");
    expect(body.attendees[0].emailAddress.address).toBe("guest@example.com");
    expect(body.singleValueExtendedProperties[0].value).toBe("transaction");
    expect(options.signal).toBeDefined();
  });
  it("recovers by a stable extended property without any POST", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ value: [{ id: "recovered" }] })));
    vi.stubGlobal("fetch", fetch);
    expect((await findConferenceCalendarEvent("token", "transaction"))?.id).toBe("recovered");
    expect(decodeURIComponent(fetch.mock.calls[0][0])).toContain("ep/value eq 'transaction'");
    expect(fetch.mock.calls[0][1].method).toBeUndefined();
  });
  it.each([404, 410])("treats already deleted events (%s) as cancelled", async status => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(cancelConferenceCalendarEvent("token", "event/id")).resolves.toBeUndefined();
    expect(fetch.mock.calls[0][0]).toContain("event%2Fid");
    expect(fetch.mock.calls[0][1].method).toBe("DELETE");
  });
});
