import { createHash, randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { calendarInvitationSchema, type CalendarInvitationPreview, type CalendarInvitationState } from "@shared/conference-meetings";
import { getMeetingPerson, MeetingError } from "./conference-meetings-service";
import { getValidGraphToken, hasCalendarPermission, getCalendarOrganizer, createConferenceCalendarEvent, findConferenceCalendarEvent, cancelConferenceCalendarEvent, GraphHttpError } from "./planner-graph-client";

export async function calendarConnection(userId: string) {
  const user = await storage.getUser(userId);
  return { connected: !!user?.graphRefreshToken && hasCalendarPermission(user?.graphScopes) };
}

async function calendarToken(userId: string) {
  if (!(await calendarConnection(userId)).connected) throw new MeetingError("Connect Outlook calendar access first. Planner or email-draft access is not sufficient.", 403);
  const token = await getValidGraphToken(userId);
  if (!token) throw new MeetingError("Reconnect Outlook calendar access.", 403);
  return token;
}

export async function previewCalendarInvitation(tenant: string, id: string, marketId: string | undefined, userId: string, input: unknown): Promise<CalendarInvitationPreview> {
  const data = calendarInvitationSchema.parse(input);
  const { workspace, person } = await getMeetingPerson(tenant, id, marketId);
  const meeting = person.meeting;
  if (meeting.stage !== "meeting_booked" || !meeting.meetingAt || !meeting.meetingOwner.trim()) {
    throw new MeetingError("Save a booked meeting with a date, time and owner first.", 422);
  }
  if (new Date(meeting.meetingAt).getTime() <= Date.now()) throw new MeetingError("Choose a future meeting time.", 422);
  const timezone = workspace.conference.presence?.timezone;
  if (!timezone) throw new MeetingError("Save the event timezone first.", 422);
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); }
  catch { throw new MeetingError("Save a valid event timezone first.", 422); }
  const end = new Date(Date.parse(meeting.meetingAt) + data.durationMinutes * 60_000).toISOString();
  // Graph receives local wall times with a zone. A repeated fall-back hour
  // cannot identify which offset the operator chose, so never silently shift it.
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (const instant of [meeting.meetingAt, end]) {
    const time = Date.parse(instant);
    if ([-120, -90, -60, -30, 30, 60, 90, 120].some(minutes =>
      local.format(new Date(time + minutes * 60_000)) === local.format(new Date(time)))) {
      throw new MeetingError("The meeting overlaps a repeated daylight-saving hour. Choose an unambiguous start and end time before inviting participants.", 422);
    }
  }
  const organizer = await getCalendarOrganizer(await calendarToken(userId));
  const preview = {
    ...data, start: meeting.meetingAt,
    end,
    timezone, owner: meeting.meetingOwner, organizer,
  };
  return { ...preview, fingerprint: createHash("sha256").update(JSON.stringify({ tenant, id, userId, preview })).digest("hex") };
}

export async function getCalendarInvitation(tenant: string, id: string): Promise<CalendarInvitationState | null> {
  const result = await db.execute(sql`SELECT state FROM conference_calendar_invitations WHERE prospect_id = ${id} AND tenant_domain = ${tenant}`);
  return (result.rows[0]?.state as CalendarInvitationState) ?? null;
}

export async function sendCalendarInvitation(tenant: string, id: string, marketId: string | undefined, userId: string, input: unknown, fingerprint: string) {
  // Replays use the immutable stored payload, not newly edited prep.
  const inserted = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenant}:${id}`}, 0))`);
    const member = await tx.execute(sql`SELECT meeting->>'sharedMeetingId' AS shared_id FROM prospects WHERE id = ${id} AND tenant_domain = ${tenant}`);
    if (member.rows[0]?.shared_id && member.rows[0].shared_id !== id) {
      throw new MeetingError("This contact was linked to a shared meeting. Refresh and review that meeting's invitation before sending.");
    }
    const existing = await tx.execute(sql`SELECT state FROM conference_calendar_invitations WHERE prospect_id = ${id} AND tenant_domain = ${tenant}`);
    if (existing.rows.length) return false;
    const preview = await previewCalendarInvitation(tenant, id, marketId, userId, input);
    if (preview.fingerprint !== fingerprint) throw new MeetingError("Meeting details changed. Review the invitation again.");
    const state: CalendarInvitationState = { status: "creating", organizerUserId: userId, preview };
    const result = await tx.execute(sql`INSERT INTO conference_calendar_invitations (prospect_id, tenant_domain, transaction_id, state)
      VALUES (${id}, ${tenant}, ${randomUUID()}, ${JSON.stringify(state)}::jsonb) ON CONFLICT DO NOTHING RETURNING state`);
    return result.rows.length > 0;
  });
  return operateInvitation(tenant, id, userId, false, inserted, fingerprint);
}

export async function cancelCalendarInvitation(tenant: string, id: string, userId: string, fingerprint: string) {
  return operateInvitation(tenant, id, userId, true, false, fingerprint);
}

async function operateInvitation(tenant: string, id: string, userId: string, cancel: boolean, mayCreate: boolean, fingerprint: string) {
  const token = await calendarToken(userId);
  let rejectedTransaction: string | undefined;
  // Serialize across workers. The creation intent was committed BEFORE Graph:
  // a crash can leave an uncertain outcome, but never authorize a second POST.
  try {
    return await db.transaction(async tx => {
    const result = await tx.execute(sql`SELECT state, transaction_id FROM conference_calendar_invitations
      WHERE prospect_id = ${id} AND tenant_domain = ${tenant} FOR UPDATE`);
    const row = result.rows[0];
    if (!row) throw new MeetingError("No invitation exists.", 404);
    const state = row.state as CalendarInvitationState;
    if (state.organizerUserId !== userId) throw new MeetingError("Only the original Outlook organizer can manage this invitation.", 403);
    if (state.preview.fingerprint !== fingerprint) throw new MeetingError("Review the stored invitation before retrying or cancelling.");
    if (state.status === "cancelled" || (!cancel && state.status === "sent")) return state;
    const organizer = await getCalendarOrganizer(token);
    if (organizer.toLowerCase() !== state.preview.organizer.toLowerCase()) {
      throw new MeetingError("The connected Microsoft mailbox changed. Reconnect the original organizer before managing this invitation.", 409);
    }
    if (!state.eventId) {
      let event;
      if (mayCreate) {
        try {
          event = await createConferenceCalendarEvent(token, String(row.transaction_id), state.preview);
        } catch (error) {
          // Only an explicit rejection proves there was no external delivery.
          // Timeouts, 5xx and lost responses must retain the durable intent.
          if (error instanceof GraphHttpError && [400, 401, 403, 404, 422, 429].includes(error.status)) {
            rejectedTransaction = String(row.transaction_id);
          }
          throw error;
        }
      } else {
        event = await findConferenceCalendarEvent(token, String(row.transaction_id));
      }
      if (!event) throw new MeetingError("Delivery is uncertain. No invitation was resent. Check Outlook and retry checking later; do not create another invitation.", 409);
      state.eventId = event.id;
      state.webLink = event.webLink;
      state.status = event.isCancelled ? "cancelled" : "sent";
    }
    if (cancel && state.status !== "cancelled") {
      await cancelConferenceCalendarEvent(token, state.eventId!);
      state.status = "cancelled";
    }
    await tx.execute(sql`UPDATE conference_calendar_invitations SET state = ${JSON.stringify(state)}::jsonb, updated_at = now()
      WHERE prospect_id = ${id} AND tenant_domain = ${tenant}`);
    return state;
    });
  } catch (error) {
    if (rejectedTransaction) {
      await db.execute(sql`DELETE FROM conference_calendar_invitations WHERE prospect_id = ${id} AND tenant_domain = ${tenant}
        AND transaction_id = ${rejectedTransaction} AND state->>'status' = 'creating'`);
      throw new MeetingError("Microsoft rejected the invitation without sending it. Check calendar permissions and invitation details, then review again.", 422);
    }
    throw error;
  }
}
