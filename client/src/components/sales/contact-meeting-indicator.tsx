import { CalendarDays } from "lucide-react";
import type { MeetingContact, CalendarInvitationState } from "@shared/conference-meetings";
import { Button } from "@/components/ui/button";

export type DirectoryMeeting = MeetingContact & {
  meetingTimezone?: string | null;
  calendarInvitation?: Pick<CalendarInvitationState, "status"> | null;
};
export function scheduledMeetingLabel(meeting?: DirectoryMeeting | null, timezone?: string | null, calendarStatus?: string | null) {
  if (!meeting) return null;
  if ((calendarStatus ?? meeting.calendarInvitation?.status) === "cancelled") return "Calendar invitation cancelled · review meeting";
  if (meeting.stage !== "meeting_booked") return null;
  if (!meeting.meetingAt || !Number.isFinite(Date.parse(meeting.meetingAt))) return "Meeting booked · date needed";
  const zone = timezone || meeting.meetingTimezone;
  const date = new Date(meeting.meetingAt);
  try {
    const stamp = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", ...(zone ? { timeZone: zone } : {}) }).format(date);
    return `Meeting booked · ${stamp} · ${zone || "your local time"}`;
  } catch {
    return `Meeting booked · ${date.toLocaleString()} · your local time (meeting timezone unavailable)`;
  }
}
export default function ContactMeetingIndicator({ meeting, timezone, calendarStatus, onOpen }: {
  meeting?: DirectoryMeeting | null; timezone?: string | null; calendarStatus?: string | null; onOpen: () => void;
}) {
  const label = scheduledMeetingLabel(meeting, timezone, calendarStatus);
  if (!label) return null;
  return <Button type="button" variant="outline" size="sm" className="mt-1 h-auto max-w-full justify-start gap-1.5 border-primary/20 bg-primary/5 px-2 py-1 text-left text-[11px] font-medium leading-snug whitespace-normal" onClick={onOpen}><CalendarDays className="h-3 w-3 shrink-0" /><span>{label}</span></Button>;
}
