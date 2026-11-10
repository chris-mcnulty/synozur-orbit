import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { defaultMeetingContact } from "@shared/conference-meetings";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), person: vi.fn(), token: vi.fn(), permission: vi.fn(), organizer: vi.fn(),
  create: vi.fn(), find: vi.fn(), cancel: vi.fn(),
}));
vi.mock("../../storage", () => ({ storage: { getUser: mocks.user } }));
vi.mock("../conference-meetings-service", () => ({
  getMeetingPerson: mocks.person,
  MeetingError: class MeetingError extends Error { constructor(message: string, public status = 409) { super(message); } },
}));
vi.mock("../planner-graph-client", () => ({
  getValidGraphToken: mocks.token, hasCalendarPermission: mocks.permission, getCalendarOrganizer: mocks.organizer,
  createConferenceCalendarEvent: mocks.create, findConferenceCalendarEvent: mocks.find, cancelConferenceCalendarEvent: mocks.cancel,
  GraphHttpError: class GraphHttpError extends Error { constructor(message: string, public status: number, public body: unknown) { super(message); } },
}));
import { GraphHttpError } from "../planner-graph-client";
import { db } from "../../db";
import { previewCalendarInvitation, sendCalendarInvitation, getCalendarInvitation, cancelCalendarInvitation } from "../conference-calendar-service";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const tenant = `calendar-test-${randomUUID()}`;
const input = { subject: "Conference meeting", agenda: "Discuss the agreed project", location: "Lobby", durationMinutes: 30, attendees: ["guest@example.invalid"] };
let personId: string;
suite("calendar delivery ledger with mocked Microsoft (no invitations sent)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    personId = randomUUID();
    mocks.user.mockResolvedValue({ graphRefreshToken: "test", graphScopes: "Calendars.ReadWrite" });
    mocks.permission.mockReturnValue(true);
    mocks.token.mockResolvedValue("test-token");
    mocks.organizer.mockResolvedValue("organizer@example.invalid");
    mocks.person.mockResolvedValue({
      workspace: { conference: { presence: { timezone: "America/Los_Angeles" } } },
      person: { meeting: { ...defaultMeetingContact(), stage: "meeting_booked", meetingAt: "2099-07-01T10:00:00-07:00", meetingOwner: "Meeting owner", ownerNotes: "PRIVATE NOTES" } },
    });
    mocks.create.mockResolvedValue({ id: "graph-event", webLink: "https://outlook.office.com/calendar/item/test" });
    mocks.find.mockResolvedValue({ id: "graph-event" });
  });
  afterAll(async () => {
    await db.execute(sql`DELETE FROM conference_calendar_invitations WHERE tenant_domain = ${tenant}`);
  });
  const preview = () => previewCalendarInvitation(tenant, personId, "market", "owner", input);

  it("reviews event zone, instant, owner, participants and agenda without sending or exposing private notes", async () => {
    const p = await preview();
    expect(p).toMatchObject({ timezone: "America/Los_Angeles", start: "2099-07-01T10:00:00-07:00", end: "2099-07-01T17:30:00.000Z", owner: "Meeting owner", organizer: "organizer@example.invalid", ...input });
    expect(JSON.stringify(p)).not.toContain("PRIVATE NOTES");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("requires calendar-specific permission and a saved future booking", async () => {
    mocks.permission.mockReturnValue(false);
    await expect(preview()).rejects.toThrow("Connect Outlook");
    mocks.permission.mockReturnValue(true);
    mocks.person.mockResolvedValue({ workspace: { conference: {} }, person: { meeting: defaultMeetingContact() } });
    await expect(preview()).rejects.toThrow("booked meeting");
  });
  it("blocks repeated DST wall times instead of letting Outlook choose the wrong instant", async () => {
    mocks.person.mockResolvedValue({
      workspace: { conference: { presence: { timezone: "America/Los_Angeles" } } },
      person: { meeting: { ...defaultMeetingContact(), stage: "meeting_booked", meetingAt: "2030-11-03T01:30:00-07:00", meetingOwner: "Owner" } },
    });
    await expect(preview()).rejects.toThrow("repeated daylight-saving hour");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects stale review before recording any delivery intent", async () => {
    await expect(sendCalendarInvitation(tenant, personId, "market", "owner", input, "x".repeat(64))).rejects.toThrow("changed");
    expect(await getCalendarInvitation(tenant, personId)).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("serializes concurrent sends and sends only one event with a stable transaction id", async () => {
    const p = await preview();
    // A reconciliation that wins the row lock before the creator runs must
    // observe no provider event, not a fictitious event from the default mock.
    mocks.find.mockImplementation(async () => mocks.create.mock.calls.length ? { id: "graph-event" } : undefined);
    const results = await Promise.allSettled([
      sendCalendarInvitation(tenant, personId, "market", "owner", input, p.fingerprint),
      sendCalendarInvitation(tenant, personId, "market", "owner", input, p.fingerprint),
    ]);
    expect(results.some(r => r.status === "fulfilled" && r.value.status === "sent")).toBe(true);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason.message).toContain("No invitation was resent");
    }
    expect((await getCalendarInvitation(tenant, personId))?.status).toBe("sent");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][1]).toMatch(/^[a-f0-9-]{36}$/);
    expect(mocks.person).toHaveBeenCalledWith(tenant, personId, "market");
  });
  it("recovers an ambiguous create without posting again, and safely repeats cancellation", async () => {
    const p = await preview();
    mocks.create.mockRejectedValueOnce(new Error("response lost"));
    await expect(sendCalendarInvitation(tenant, personId, "market", "owner", input, p.fingerprint)).rejects.toThrow("response lost");
    expect((await getCalendarInvitation(tenant, personId))?.status).toBe("creating");
    expect((await sendCalendarInvitation(tenant, personId, "market", "owner", input, p.fingerprint)).status).toBe("sent");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.find).toHaveBeenCalledTimes(1);
    await cancelCalendarInvitation(tenant, personId, "owner", p.fingerprint);
    await cancelCalendarInvitation(tenant, personId, "owner", p.fingerprint);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect((await getCalendarInvitation(tenant, personId))?.status).toBe("cancelled");
  });
  it("never resends an uncertain event when reconciliation finds nothing", async () => {
    const p = await preview();
    mocks.create.mockRejectedValueOnce(new Error("timeout"));
    await expect(sendCalendarInvitation(tenant, personId, "market", "owner", input, p.fingerprint)).rejects.toThrow();
    mocks.find.mockResolvedValue(undefined);
    await expect(sendCalendarInvitation(tenant, personId, "market", "owner", input, p.fingerprint)).rejects.toThrow("No invitation was resent");
    await expect(cancelCalendarInvitation(tenant, personId, "owner", p.fingerprint)).rejects.toThrow("uncertain");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("allows a new reviewed attempt after an explicit Microsoft rejection, but not a 5xx", async () => {
    const p = await preview();
    mocks.create.mockRejectedValueOnce(new GraphHttpError("Forbidden", 403, {}));
    await expect(sendCalendarInvitation(tenant, personId, "market", "owner", input, p.fingerprint)).rejects.toThrow("without sending");
    expect(await getCalendarInvitation(tenant, personId)).toBeNull();
    mocks.create.mockRejectedValueOnce(new GraphHttpError("Server error", 503, {}));
    await expect(sendCalendarInvitation(tenant, personId, "market", "owner", input, p.fingerprint)).rejects.toThrow("Server error");
    expect((await getCalendarInvitation(tenant, personId))?.status).toBe("creating");
    await sendCalendarInvitation(tenant, personId, "market", "owner", input, p.fingerprint);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.find).toHaveBeenCalledTimes(1);
  });
  it("isolates tenants and restricts cancellation to the original organizer and mailbox", async () => {
    const p = await preview();
    await sendCalendarInvitation(tenant, personId, "market", "owner", input, p.fingerprint);
    expect(await getCalendarInvitation("another-tenant", personId)).toBeNull();
    await expect(cancelCalendarInvitation("another-tenant", personId, "owner", p.fingerprint)).rejects.toThrow("No invitation");
    await expect(cancelCalendarInvitation(tenant, personId, "other-user", p.fingerprint)).rejects.toThrow("original Outlook organizer");
    mocks.organizer.mockResolvedValue("different@example.invalid");
    await expect(cancelCalendarInvitation(tenant, personId, "owner", p.fingerprint)).rejects.toThrow("mailbox changed");
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("retries a failed cancellation without creating any new event", async () => {
    const p = await preview();
    await sendCalendarInvitation(tenant, personId, "market", "owner", input, p.fingerprint);
    mocks.cancel.mockRejectedValueOnce(new Error("timeout"));
    await expect(cancelCalendarInvitation(tenant, personId, "owner", p.fingerprint)).rejects.toThrow("timeout");
    await cancelCalendarInvitation(tenant, personId, "owner", p.fingerprint);
    expect(mocks.cancel).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
