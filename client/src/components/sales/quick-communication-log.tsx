import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { externalActivitySchema, type ExternalActivityInput } from "@shared/outreach-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { outreachError, useOutreachActions } from "./use-outreach-context";
import { PauseOutreachChoice } from "./pause-outreach-choice";

type Direction = "outbound" | "inbound";
export type ExternalActivitySummary = { direction: string; outcome: string; occurredAt: string };
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const localNow = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function communicationInput(form: {
  direction: Direction; channel: ExternalActivityInput["channel"]; occurredAt: string;
  sender: string; notes: string; outcome: ExternalActivityInput["outcome"];
  pauseOutreach?: boolean;
}) {
  return externalActivitySchema.parse({
    direction: form.direction, channel: form.channel,
    occurredAt: new Date(form.occurredAt).toISOString(), sender: form.sender.trim(),
    message: form.notes.trim() || (form.direction === "inbound"
      ? "Reply received outside Orbit; content not recorded."
      : "Message sent outside Orbit; content not recorded."),
    outcome: form.outcome, reply: "", followUpAt: null,
    pauseOutreach: form.direction === "outbound" && form.pauseOutreach === true,
  });
}

export function ExternalCommunicationBadge({ summary }: { summary?: ExternalActivitySummary }) {
  if (!summary) return null;
  const replied = summary.direction === "inbound" || ["replied", "meeting_agreed"].includes(summary.outcome);
  return <Badge variant="outline" className="mt-1 block w-fit text-[10px] font-normal">
    {replied ? "Reply recorded" : "Externally contacted"} · <time dateTime={summary.occurredAt}>{new Date(summary.occurredAt).toLocaleDateString()}</time>
  </Badge>;
}

function CommunicationForm({ contact, senderName, onClose }: {
  contact: { id: string; name: string }; senderName: string; onClose: () => void;
}) {
  const { activity } = useOutreachActions(contact.id);
  const [direction, setDirection] = useState<Direction>("outbound");
  const [channel, setChannel] = useState<ExternalActivityInput["channel"]>("email");
  const [occurredAt, setOccurredAt] = useState(localNow);
  const [sender, setSender] = useState(senderName);
  const [notes, setNotes] = useState("");
  const [pauseOutreach, setPauseOutreach] = useState(false);
  const [outcome, setOutcome] = useState<ExternalActivityInput["outcome"]>("no_reply");
  const [error, setError] = useState("");
  return <form className="space-y-4" onSubmit={async event => {
    event.preventDefault();
    setError("");
    try {
      const input = communicationInput({ direction, channel, occurredAt, sender, notes, outcome, pauseOutreach });
      await activity.mutateAsync({ type: "save", input });
      onClose();
    } catch (err) {
      setError(err instanceof Error && ("issues" in err || err instanceof RangeError)
        ? "Check the date and sender. Communication must be in the past."
        : outreachError(err));
    }
  }}>
    <fieldset disabled={activity.isPending} className="space-y-4">
      <label className="block space-y-1.5 text-sm font-medium">Communication
        <select className={selectClass} value={direction} onChange={event => {
          const next = event.target.value as Direction;
          setDirection(next);
          setPauseOutreach(false);
          setSender(next === "inbound" ? contact.name : senderName);
          setOutcome(next === "inbound" ? "replied" : "no_reply");
        }}>
          <option value="outbound">Contacted outside Orbit</option>
          <option value="inbound">Reply received</option>
        </select>
      </label>
      <label className="block space-y-1.5 text-sm font-medium">Channel
        <select className={selectClass} value={channel} onChange={event => setChannel(event.target.value as ExternalActivityInput["channel"])}>
          <option value="email">Email</option><option value="linkedin">LinkedIn</option><option value="phone">Phone</option><option value="meeting">Meeting</option><option value="other">Other</option>
        </select>
      </label>
      <label className="block space-y-1.5 text-sm font-medium">Notes (optional)
        <Textarea rows={3} maxLength={12000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Add context if useful. No need to paste the conversation." />
      </label>
      <div className="space-y-1"><label className="block space-y-1 text-sm font-medium">Occurred at (your local time)<Input required type="datetime-local" max={localNow()} value={occurredAt} onChange={event => setOccurredAt(event.target.value)} /></label><p className="text-xs text-muted-foreground">Choose when the conversation happened. Future dates are not allowed.</p></div>
      <details className="rounded-md border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">Optional details</summary>
        <div className="mt-3 space-y-3">
          <label className="block space-y-1 text-sm">{direction === "inbound" ? "Reply from" : "Sent by"}<Input required maxLength={300} value={sender} onChange={event => setSender(event.target.value)} /></label>
          <label className="block space-y-1 text-sm">Outcome<select className={selectClass} value={outcome} onChange={event => setOutcome(event.target.value as ExternalActivityInput["outcome"])}>
            {direction === "outbound" && <option value="no_reply">No reply</option>}
            <option value="replied">Replied</option><option value="meeting_agreed">Meeting agreed</option>
            {direction === "outbound" && <option value="other">Other</option>}
          </select></label>
        </div>
      </details>
      {direction === "outbound" && <PauseOutreachChoice checked={pauseOutreach} onChange={setPauseOutreach} />}
      <p className="text-xs leading-relaxed text-muted-foreground">{direction === "inbound" || ["replied", "meeting_agreed"].includes(outcome)
        ? "Records a reply and stops this contact’s cadence in this campaign."
        : pauseOutreach ? "Records contact history and places the shared contact on hold across campaigns."
        : "Records contact history only. Does not start a cadence or mark an Orbit touch as sent."} Nothing is sent.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit">{activity.isPending ? "Saving…" : "Save communication"}</Button></div>
    </fieldset>
  </form>;
}

export default function QuickCommunicationLog({ contact, senderName, compact = false }: { contact: { id: string; name: string }; senderName: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" size="sm" className={compact ? "h-8 w-8 p-0" : undefined} title="Log communication" aria-label={`Log communication with ${contact.name}`} data-testid={`log-communication-${contact.id}`} onClick={() => setOpen(true)}><MessageSquarePlus className={compact ? "h-3.5 w-3.5" : "mr-1 h-3.5 w-3.5"} />{!compact && "Log communication"}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md"><DialogHeader><DialogTitle>Log communication</DialogTitle><DialogDescription>{contact.name} · Record a conversation that happened outside Orbit. No Orbit message is required.</DialogDescription></DialogHeader>{open && <CommunicationForm contact={contact} senderName={senderName} onClose={() => setOpen(false)} />}</DialogContent></Dialog>
  </>;
}
