import type { MeetingContact } from "./conference-meetings";

export function sharedBookingFields(meeting: Pick<MeetingContact, "meetingAt" | "meetingLocation" | "meetingOwner" | "participants">) {
  return { meetingAt: meeting.meetingAt, meetingLocation: meeting.meetingLocation,
    meetingOwner: meeting.meetingOwner, participants: meeting.participants };
}

export function bookedMeetingCount(contacts: { id: string; meeting: MeetingContact }[]) {
  return new Set(contacts.filter(c => c.meeting.stage === "meeting_booked"
    && c.meeting.meetingAt && c.meeting.meetingOwner.trim())
    .map(c => c.meeting.sharedMeetingId || c.id)).size;
}
