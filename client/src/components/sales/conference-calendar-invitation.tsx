import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CalendarInvitationPreview, CalendarInvitationState, MeetingContact } from "@shared/conference-meetings";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : "Could not confirm the calendar operation.";
}

export default function ConferenceCalendarInvitation({ personId, name, email, eventName, meeting, disabled }: {
  personId: string; name: string; email: string | null; eventName: string; meeting: MeetingContact; disabled: boolean;
}) {
  const path = `/api/sales-outreach/prospects/${personId}/meeting/calendar`;
  const status = useQuery<{ connected: boolean; userId: string; invitation: CalendarInvitationState | null }>({
    queryKey: [path], queryFn: async () => (await apiRequest("GET", path)).json(),
  });
  const [subject, setSubject] = useState(`${eventName} — meeting with ${name}`);
  const [attendees, setAttendees] = useState(email ?? "");
  const [durationMinutes, setDuration] = useState(30);
  const [location, setLocation] = useState(meeting.meetingLocation);
  const [agenda, setAgenda] = useState("");
  const [preview, setPreview] = useState<CalendarInvitationPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [error, setError] = useState("");
  const stored = status.data?.invitation;
  const own = !stored || stored.organizerUserId === status.data?.userId;
  const input = () => ({ subject, agenda, location, durationMinutes, attendees: attendees.split(/[,;\n]/).map(s => s.trim()).filter(Boolean) });
  const review = useMutation({
    mutationFn: async () => {
      if (stored) return stored.preview;
      return (await apiRequest("POST", `${path}/preview`, input())).json() as Promise<CalendarInvitationPreview>;
    },
    onSuccess: data => { setError(""); setConfirmed(false); setPreview(data); },
    onError: e => setError(errorMessage(e)),
  });
  const deliver = useMutation({
    mutationFn: async () => {
      if (!preview || !confirmed) throw new Error("Confirm the reviewed invitation first.");
      const { subject, agenda, location, durationMinutes, attendees } = preview;
      return (await apiRequest("POST", `${path}/send`, {
        invitation: { subject, agenda, location, durationMinutes, attendees }, fingerprint: preview.fingerprint, confirmed: true,
      })).json();
    },
    onSuccess: async () => { setError(""); setPreview(null); await status.refetch(); },
    onError: async e => { setError(errorMessage(e)); setPreview(null); await status.refetch(); },
  });
  const cancel = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${path}/cancel`, { confirmed: true, fingerprint: stored?.preview.fingerprint })).json(),
    onSuccess: async () => { setError(""); setCancelOpen(false); await status.refetch(); },
    onError: async e => { setError(errorMessage(e)); setCancelOpen(false); await status.refetch(); },
  });
  const connect = useMutation({
    mutationFn: async () => {
      const returnTo = window.location.pathname + window.location.search;
      const data = await (await apiRequest("GET", `${path}/consent-url?returnTo=${encodeURIComponent(returnTo)}`)).json();
      window.location.assign(data.url);
    },
    onError: e => setError(errorMessage(e)),
  });
  const busy = review.isPending || deliver.isPending || cancel.isPending || disabled;
  return <div className="space-y-3 rounded-lg border p-4" data-testid="conference-calendar-invitation">
    <h3 className="text-sm font-semibold">Outlook calendar invitation</h3>
    <p className="text-xs text-muted-foreground">Saving meeting prep or a scheduling link does not send invitations. Save prep first, then review here. The connected Outlook account is the organizer; include the meeting owner’s email in participants if different.</p>
    {status.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(status.error)} <Button variant="outline" size="sm" onClick={() => status.refetch()}>Retry status</Button></p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {stored && <div className="space-y-1 text-sm">
      <p role="status">{stored.status === "sent" ? "Invitation created in Outlook." : stored.status === "cancelled" ? "Invitation cancelled. No further invitations will be sent from this booking." : "Delivery not confirmed. Check status; retries never send a second invitation."}</p>
      <p>Organizer: {stored.preview.organizer} · Owner: {stored.preview.owner}</p>
      <p>{stored.preview.attendees.join(", ")}</p>
      {stored.webLink && <a href={stored.webLink} target="_blank" rel="noreferrer" className="underline">Open in Outlook</a>}
      {!own && <p>Only the original organizer can check delivery or cancel this invitation.</p>}
    </div>}
    {status.data && (!status.data.connected || error) && <Button variant="outline" size="sm" disabled={busy || connect.isPending || !own} onClick={() => connect.mutate()}>{status.data.connected ? "Reconnect Outlook calendar" : "Connect Outlook calendar"}</Button>}
    {!stored && <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs">Subject<Input value={subject} onChange={e => setSubject(e.target.value)} /></label>
      <label className="text-xs">Duration (minutes)<Input type="number" min={5} max={480} value={durationMinutes} onChange={e => setDuration(Number(e.target.value))} /></label>
      <label className="text-xs sm:col-span-2">Participant email addresses (comma-separated)<Input value={attendees} onChange={e => setAttendees(e.target.value)} /></label>
      <label className="text-xs sm:col-span-2">Location<Input value={location} onChange={e => setLocation(e.target.value)} /></label>
      <label className="text-xs sm:col-span-2">Agenda shared with participants<Textarea value={agenda} onChange={e => setAgenda(e.target.value)} placeholder="Only include information appropriate for every invitee. Private prep notes are not included." /></label>
    </fieldset>}
    {status.data?.connected && own && stored?.status !== "cancelled" && <div className="flex flex-wrap gap-2">
      {stored?.status !== "sent" && <Button size="sm" variant="outline" disabled={busy || (!stored && meeting.stage !== "meeting_booked")} onClick={() => review.mutate()}>{review.isPending ? "Preparing…" : stored ? "Review and check delivery" : "Review invitation"}</Button>}
      {stored && <Button size="sm" variant="outline" disabled={busy} onClick={() => setCancelOpen(true)}>Cancel invitation…</Button>}
    </div>}
    <Dialog open={!!preview} onOpenChange={open => { if (!deliver.isPending && !open) setPreview(null); }}>
      <DialogContent><DialogHeader><DialogTitle>{stored ? "Check invitation delivery" : "Review calendar invitation"}</DialogTitle></DialogHeader>
        {preview && <div className="space-y-3 text-sm">
          <p className="font-semibold">{preview.subject}</p>
          <p>Organizer: {preview.organizer}<br />Meeting owner: {preview.owner}</p>
          <p>Participants: {preview.attendees.join(", ")}</p>
          <p>{new Date(preview.start).toLocaleString(undefined, { timeZone: preview.timezone })} – {new Date(preview.end).toLocaleString(undefined, { timeZone: preview.timezone })}<br />Timezone: {preview.timezone}</p>
          <p>Location: {preview.location}</p><p className="whitespace-pre-wrap">{preview.agenda}</p>
          <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={deliver.isPending} />{stored ? "Check Outlook for this exact invitation without resending it." : "I have reviewed these details and authorize Outlook to send invitations to every participant listed above."}</label>
          <Button disabled={!confirmed || deliver.isPending} onClick={() => deliver.mutate()}>{deliver.isPending ? "Checking…" : stored ? "Check delivery" : "Send calendar invitation"}</Button>
        </div>}
      </DialogContent>
    </Dialog>
    <Dialog open={cancelOpen} onOpenChange={open => { if (!cancel.isPending) setCancelOpen(open); }}>
      <DialogContent><DialogHeader><DialogTitle>Cancel this Outlook invitation?</DialogTitle></DialogHeader>
        <p className="text-sm">Outlook will remove “{stored?.preview.subject}” and notify {stored?.preview.attendees.join(", ")}. This does not change the manually recorded meeting stage. If delivery is uncertain, Orbit must find the original invitation first.</p>
        <Button variant="destructive" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{cancel.isPending ? "Cancelling…" : "Confirm cancellation and notify participants"}</Button>
      </DialogContent>
    </Dialog>
  </div>;
}
