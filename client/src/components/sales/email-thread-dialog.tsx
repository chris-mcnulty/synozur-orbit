import { useEffect, useRef, useState } from "react";
import { Mail, ShieldCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { EmailThreadPreview, ThreadContact, ThreadMeeting, ThreadLocationReview } from "@shared/email-thread";
import { isValidLinkedInProfileUrl } from "@shared/linkedin-outreach";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const fields = [
  ["name", "Name", 300], ["email", "Email", 320], ["title", "Title", 300],
  ["companyName", "Company", 300], ["linkedinUrl", "LinkedIn URL", 2000], ["phone", "Phone", 100],
] as const;
const blank: ThreadContact = { name: "", email: "", title: "", companyName: "", linkedinUrl: "", phone: "" };
export interface EmailThreadTarget { id: string; name: string; email: string | null; linkedinUrl: string | null }
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  scope: string;
  canEdit: boolean;
  contacts: EmailThreadTarget[];
  target?: EmailThreadTarget;
}
function message(error: unknown) {
  return error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : "Unable to complete this request. Please retry.";
}
function MeetingEvidence({ meeting }: { meeting: ThreadMeeting }) {
  return <div className="min-w-0 space-y-1 text-xs">
    <p className="break-words text-sm font-medium">{meeting.proposal}</p>
    <p className="text-muted-foreground">{meeting.proposer || "Proposer not identified"} · {meeting.status}</p>
    <p className="break-words">Date: {meeting.dateText || "Unresolved"} · Time: {meeting.timeText || "Unresolved"} · Timezone: {meeting.timezone || "Unresolved"}</p>
    <blockquote className="border-l-2 pl-2 italic text-muted-foreground">“{meeting.evidence}”</blockquote>
    <p className="text-amber-700 dark:text-amber-400">Unconfirmed suggestion, not a booking. Verify the exact date, time and timezone with the contact; relative dates remain unresolved.</p>
  </div>;
}

/** Ephemeral evidence review. No raw thread is put in a query cache or browser storage. */
export default function EmailThreadDialog({ open, onOpenChange, campaignId, scope, canEdit, contacts, target }: Props) {
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<EmailThreadPreview | null>(null);
  const [participant, setParticipant] = useState("");
  const [destination, setDestination] = useState(target?.id ?? "");
  const [proposed, setProposed] = useState<ThreadContact>({ ...blank });
  const [included, setIncluded] = useState<Set<keyof ThreadContact>>(new Set());
  const [times, setTimes] = useState<Set<number>>(new Set());
  const [locationIndex, setLocationIndex] = useState("");
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<"parse" | "save" | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [current, setCurrent] = useState<{ contact: ThreadContact; meetingTimes: ThreadMeeting[]; locationReview?: ThreadLocationReview; locationUnavailable?: string } | null>(null);
  const [currentLoading, setCurrentLoading] = useState(false);
  const [currentError, setCurrentError] = useState("");
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const currentGeneration = useRef(0);
  const session = `${scope}:${campaignId}:${target?.id ?? "campaign"}:${open}:${canEdit}`;
  const liveSession = useRef(session);
  liveSession.current = session;

  useEffect(() => {
    generation.current++;
    setText(""); setPreview(null); setParticipant(""); setDestination(target?.id ?? "");
    setProposed({ ...blank }); setIncluded(new Set()); setTimes(new Set());
    setLocationIndex(""); setLocationConfirmed(false);
    setConfirmed(false); setBusy(null); setError(""); setSuccess(""); setCurrent(null); setCurrentError("");
    return () => { generation.current++; };
  }, [session, target?.id]);

  useEffect(() => {
    const request = ++currentGeneration.current;
    setCurrent(null); setCurrentError(""); setConfirmed(false);
    setLocationIndex(""); setLocationConfirmed(false);
    if (!open || !canEdit || !destination || destination === "new") { setCurrentLoading(false); return; }
    const startedSession = session;
    setCurrentLoading(true);
    void apiRequest("GET", `/api/sales-outreach/campaigns/${encodeURIComponent(campaignId)}/email-thread/contact?prospectId=${encodeURIComponent(destination)}`)
      .then(response => response.json())
      .then(result => { if (request === currentGeneration.current && liveSession.current === startedSession) setCurrent(result); })
      .catch(cause => { if (request === currentGeneration.current && liveSession.current === startedSession) setCurrentError(message(cause)); })
      .finally(() => { if (request === currentGeneration.current && liveSession.current === startedSession) setCurrentLoading(false); });
    return () => { currentGeneration.current++; };
  }, [destination, open, canEdit, campaignId, session, retry]);

  function resetReview() {
    setParticipant(""); setProposed({ ...blank }); setIncluded(new Set()); setTimes(new Set()); setConfirmed(false); setError("");
    setLocationIndex(""); setLocationConfirmed(false);
  }
  function chooseParticipant(value: string) {
    resetReview(); setParticipant(value); setSuccess("");
    const person = preview?.contacts[Number(value)];
    if (value !== "" && value !== "times-only" && person) {
      setProposed(Object.fromEntries(fields.map(([field]) => [field, person[field] ?? ""])) as ThreadContact);
      setIncluded(new Set(fields.filter(([field]) => person[field]?.trim()).map(([field]) => field)));
    }
  }
  async function parse() {
    if (!canEdit || busy || !text.trim() || text.length > 30000) return;
    const request = ++generation.current;
    const startedSession = session;
    setBusy("parse"); setError(""); setSuccess(""); setPreview(null); resetReview();
    try {
      const response = await apiRequest("POST", `/api/sales-outreach/campaigns/${encodeURIComponent(campaignId)}/email-thread/parse`, { text, ...(target ? { prospectId: target.id } : {}) });
      const result = await response.json() as EmailThreadPreview;
      if (request === generation.current && liveSession.current === startedSession) setPreview(result);
    } catch (cause) {
      if (request === generation.current && liveSession.current === startedSession) setError(message(cause));
    } finally {
      if (request === generation.current && liveSession.current === startedSession) setBusy(null);
    }
  }
  const payloadContact = Object.fromEntries(fields.map(([field]) => [field, included.has(field) && !current?.contact[field]?.trim() ? proposed[field].trim() : ""])) as ThreadContact;
  const hasFields = Object.values(payloadContact).some(Boolean);
  const identity = participant !== "" && participant !== "times-only" ? preview?.contacts[Number(participant)] : undefined;
  const suggestion = identity?.matchedProspectId && contacts.find(person => person.id === identity.matchedProspectId);
  const identityKnown = !!(identity?.email || identity?.linkedinUrl);
  const sameIdentity = !!(identity && current && (
    (identity.email && current.contact.email && identity.email.trim().toLowerCase() === current.contact.email.trim().toLowerCase()) ||
    (identity.linkedinUrl && current.contact.linkedinUrl && identity.linkedinUrl.replace(/\/$/, "").toLowerCase() === current.contact.linkedinUrl.replace(/\/$/, "").toLowerCase())
  ));
  const conflictingIdentity = !!(identity && current && (
    (identity.email && current.contact.email && identity.email.trim().toLowerCase() !== current.contact.email.trim().toLowerCase()) ||
    (identity.linkedinUrl && current.contact.linkedinUrl && identity.linkedinUrl.replace(/\/$/, "").toLowerCase() !== current.contact.linkedinUrl.replace(/\/$/, "").toLowerCase())
  ));
  const issue = conflictingIdentity ? "Choose the matching participant or a different destination. To save only meeting proposals, choose Meeting proposals only."
    : payloadContact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payloadContact.email) ? "Enter a valid email address or deselect Email."
    : payloadContact.linkedinUrl && !isValidLinkedInProfileUrl(payloadContact.linkedinUrl) ? "Enter a valid LinkedIn profile URL or deselect LinkedIn URL."
    : destination === "new" && !payloadContact.email && !payloadContact.linkedinUrl ? "Include an email or LinkedIn profile to add a contact, or choose an existing contact." : "";
  const selectedLocation = locationIndex !== "" ? preview?.meetingLocations?.[Number(locationIndex)] : undefined;
  const locationReady = !!(selectedLocation?.token && selectedLocation.status === "current" && current?.locationReview && locationConfirmed);
  const ready = canEdit && !!preview && !!participant && !!destination && (destination === "new" || !!current) &&
    !currentLoading && !currentError && !issue && (hasFields || times.size > 0 || locationReady) && confirmed && !busy;

  async function save() {
    if (!ready) return;
    const request = ++generation.current;
    const startedSession = session;
    setBusy("save"); setError(""); setSuccess("");
    try {
      const response = await apiRequest("POST", `/api/sales-outreach/campaigns/${encodeURIComponent(campaignId)}/email-thread/save`, {
        ...(destination === "new" ? {} : { prospectId: destination }),
        contact: payloadContact, meetingTimes: (preview?.meetingTimes ?? []).filter((_, index) => times.has(index)), confirmed: true,
        ...(locationReady && selectedLocation && current?.locationReview ? { locationUpdate: {
          suggestion: { location: selectedLocation.location, evidence: selectedLocation.evidence, status: selectedLocation.status },
          evidenceToken: selectedLocation.token, reviewToken: current.locationReview.token, expiresAt: current.locationReview.expiresAt, confirmed: true,
        } } : {}),
      });
      const result = await response.json() as { prospectId: string; filledFields: string[]; skippedFields: string[]; meetingTimesSaved: number; meetingLocationSaved?: boolean };
      if (request !== generation.current || liveSession.current !== startedSession) return;
      void client.invalidateQueries({ queryKey: ["/api/sales-outreach/campaigns", campaignId, "prospects"] });
      void client.invalidateQueries({ predicate: query => query.queryKey.some(key => typeof key === "string" &&
        (key.includes("meetings") || key.includes("outreach-context") || key.includes("next-steps"))) });
      setSuccess(`Saved reviewed details: ${result.filledFields.length} fields filled, ${result.skippedFields.length} skipped, ${result.meetingTimesSaved} unconfirmed meeting suggestions saved. Meeting location ${result.meetingLocationSaved ? "updated" : "unchanged"}. No meeting time, status, owner, participants or calendar invitations changed. No messages sent or cadence changes. Choose another participant to review, or close.`);
      resetReview(); setRetry(value => value + 1);
    } catch (cause) {
      if (request === generation.current && liveSession.current === startedSession) {
        setError(message(cause));
        if (locationReady) { setLocationConfirmed(false); setConfirmed(false); setRetry(value => value + 1); }
      }
    } finally {
      if (request === generation.current && liveSession.current === startedSession) setBusy(null);
    }
  }

  return <Dialog open={open && canEdit} onOpenChange={next => { if (!next) onOpenChange(false); }}>
    <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Mail className="h-4 w-4" />Paste email thread</DialogTitle>
        <DialogDescription>Review evidence before saving. Pasted text is analyzed by AI; the raw thread is not saved. Only reviewed fields, selected meeting proposals and separately approved locations are saved. Nothing is sent, booked or enrolled in a cadence.</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Textarea aria-label="Email thread" value={text} maxLength={30000} rows={4} disabled={!!busy} placeholder="Paste the email thread, including signatures and proposed meeting times…" onChange={event => {
          generation.current++; setText(event.target.value); setPreview(null); resetReview(); setSuccess("");
        }} />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{text.length.toLocaleString()} / 30,000 characters</span>
          <Button variant="outline" size="sm" disabled={!!busy || !text.trim()} onClick={parse}>{busy === "parse" ? "Analyzing thread…" : "Analyze thread"}</Button>
        </div>
      </div>
      {busy === "parse" && <div role="status" aria-label="Analyzing thread" className="space-y-2 rounded-md border p-4"><div className="h-3 w-1/3 animate-pulse rounded bg-muted" /><div className="h-3 animate-pulse rounded bg-muted" /></div>}
      {success && <p role="status" className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">{success}</p>}
      {!preview && currentLoading && <div role="status" className="h-16 animate-pulse rounded-md bg-muted" aria-label="Loading current contact details" />}
      {!preview && currentError && <div role="alert" className="text-sm text-destructive">{currentError} <Button size="sm" variant="link" onClick={() => setRetry(value => value + 1)}>Retry current details</Button></div>}
      {!!current?.meetingTimes.length && <section aria-label="Previously saved meeting suggestions" className="space-y-2 rounded-md border bg-muted/20 p-3">
        <h3 className="text-sm font-semibold">Previously saved meeting suggestions</h3>
        <p className="text-xs text-muted-foreground">Already saved for this contact; not selected again or booked.</p>
        {current.meetingTimes.map((meeting, index) => <div key={index} className="border-t pt-2"><MeetingEvidence meeting={meeting} /></div>)}
      </section>}
      {!!preview?.warnings.length && <div className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">{preview.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</div>}
      {preview && <div className="space-y-4">
         {!preview.contacts.length && !preview.meetingTimes.length && !preview.meetingLocations?.length && <div className="rounded-md border border-dashed p-5 text-center text-sm">No contacts or meeting proposals found. Add the signatures or surrounding replies and analyze again.</div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-medium">1. Choose participant to review
            <select aria-label="Participant to review" className="flex h-9 w-full rounded-md border bg-background px-2 text-sm" value={participant} disabled={!!busy} onChange={event => chooseParticipant(event.target.value)}>
              <option value="">Choose a participant</option>
              {preview.contacts.map((person, index) => <option key={index} value={String(index)}>{person.name || person.email || `Participant ${index + 1}`}{person.email ? ` · ${person.email}` : ""}</option>)}
               {(!!preview.meetingTimes.length || !!preview.meetingLocations?.length) && <option value="times-only">Meeting proposals only (no contact updates)</option>}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium">2. Save to campaign contact
            {target ? <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{target.name || target.email} (fixed target)</div> :
              <select aria-label="Save to campaign contact" className="flex h-9 w-full rounded-md border bg-background px-2 text-sm" value={destination} disabled={!!busy} onChange={event => { setDestination(event.target.value); setConfirmed(false); setSuccess(""); }}>
                <option value="">Choose where to save</option><option value="new">Create / add a contact</option>
                {contacts.map(person => <option key={person.id} value={person.id}>{person.name || person.email}{person.email ? ` · ${person.email}` : ""}</option>)}
              </select>}
          </label>
        </div>
        {suggestion && !target && <p className="text-xs text-muted-foreground">Exact identity match suggested: {suggestion.name || suggestion.email}. Explicitly choose this contact above to use it.</p>}
        {currentLoading && <div role="status" className="h-16 animate-pulse rounded-md bg-muted" aria-label="Loading current contact details" />}
        {currentError && <div role="alert" className="text-sm text-destructive">{currentError} <Button size="sm" variant="link" onClick={() => setRetry(value => value + 1)}>Retry current details</Button></div>}
        {identity && current && !sameIdentity && <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">{identityKnown ? "Identity mismatch or unverified match: this participant’s email / LinkedIn does not match the target contact." : "Identity unverified: this participant has no email or LinkedIn to compare with the target."} Check the participant and destination carefully before confirming.</p>}
        {identity && <section className="space-y-2" aria-label="Contact fields to save">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Proposed fields</h3><span className="text-xs text-muted-foreground">Only blank current fields can be filled</span></div>
          <div className="grid gap-2 sm:grid-cols-2">{fields.map(([field, label, max]) => {
            const known = current?.contact[field]?.trim();
            return <div key={field} className="min-w-0 rounded-md border p-2">
              <label className="mb-1 flex items-center gap-2 text-xs font-medium"><Checkbox aria-label={`Include ${label}`} checked={included.has(field) && !known} disabled={!!busy || !!known} onCheckedChange={checked => {
                setIncluded(previous => { const next = new Set(previous); checked ? next.add(field) : next.delete(field); return next; }); setConfirmed(false);
              }} />{label}</label>
              <Input aria-label={`Proposed ${label}`} value={proposed[field]} maxLength={max} disabled={!!busy} className="h-8 text-xs" onChange={event => { setProposed(previous => ({ ...previous, [field]: event.target.value })); setConfirmed(false); }} />
              <p className="mt-1 break-words text-xs text-muted-foreground">Current: {known || (currentLoading ? "Loading…" : destination === "new" ? "New / added contact; known values will be preserved" : current ? "Blank" : "Choose a target")}{known ? " · preserved" : ""}</p>
            </div>;
          })}</div>
        </section>}
        {!!preview.meetingTimes.length && <section className="space-y-2" aria-label="Meeting proposals">
          <h3 className="text-sm font-semibold">Select proposals that apply to this contact</h3>
          <p className="text-xs text-muted-foreground">None selected by default. Declined proposals are historical, not recommended. Literal dates are preserved; missing dates or timezones remain unresolved.</p>
          {preview.meetingTimes.map((meeting, index) => <div key={index} className="flex items-start gap-3 rounded-md border p-3">
            <Checkbox className="mt-1" aria-label={`Save meeting proposal ${index + 1}`} checked={times.has(index)} disabled={!!busy || meeting.status === "declined" || times.size >= 20 && !times.has(index)} onCheckedChange={checked => {
              setTimes(previous => { const next = new Set(previous); checked ? next.add(index) : next.delete(index); return next; }); setConfirmed(false);
            }} />
            <MeetingEvidence meeting={meeting} />
          </div>)}
        </section>}
        {!!preview.meetingLocations?.length && <section aria-label="Meeting location update" className="space-y-2 rounded-md border p-3">
          <h3 className="text-sm font-semibold">Update existing meeting location</h3>
          <p className="text-xs text-muted-foreground">Separate opt-in. Only the location in Orbit changes; time, owner, stage, participants and notes stay unchanged. No calendar invitation is created, sent, changed or cancelled.</p>
          {!current?.locationReview ? <p className="text-sm">{current?.locationUnavailable || "Select an existing campaign contact with a scheduled meeting. No booking will be created."}</p> : <>
            <p className="text-sm">Current location: {current.locationReview.currentLocation || "Blank"}</p>
            <label className="block text-xs">Proposed location
              <select aria-label="Proposed meeting location" className="mt-1 w-full rounded-md border bg-background p-2" value={locationIndex} disabled={!!busy} onChange={event => { setLocationIndex(event.target.value); setLocationConfirmed(false); setConfirmed(false); }}>
                <option value="">Do not update location</option>
                {preview.meetingLocations.map((location, index) => <option key={index} value={String(index)} disabled={location.status !== "current" || !location.token}>{location.location} · {location.status}</option>)}
              </select>
            </label>
            {selectedLocation && <blockquote className="border-l-2 pl-2 text-sm italic">“{selectedLocation.evidence}”</blockquote>}
            <label className="flex items-start gap-2 text-xs"><Checkbox aria-label="Apply reviewed meeting location" checked={locationConfirmed} disabled={!!busy || !selectedLocation?.token} onCheckedChange={value => { setLocationConfirmed(value === true); setConfirmed(false); }} />Apply this reviewed location to this contact's existing campaign meeting</label>
          </>}
          <Button size="sm" variant="link" disabled={!!busy || !destination || destination === "new"} onClick={() => setRetry(value => value + 1)}>Refresh current meeting details</Button>
        </section>}
        {issue && <p role="alert" className="text-xs text-destructive">{issue}</p>}
        <label className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-xs leading-relaxed"><Checkbox className="mt-0.5" aria-label="I reviewed the participant, target, fields and selected times" checked={confirmed} disabled={!!busy || !participant || !destination || currentLoading || !!currentError} onCheckedChange={value => setConfirmed(value === true)} /><span>I reviewed the participant, target, fields, selected times and any separately approved location. I understand known contact values and opt-outs are preserved, and meeting time proposals still require confirmation. This does not authorize outreach or calendar delivery.</span></label>
      </div>}
      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><span>{error}</span><Button size="sm" variant="outline" disabled={preview ? !ready : !!busy || !text.trim()} onClick={preview ? save : parse}>Retry {preview ? "save" : "analysis"}</Button></div>}
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        <Button disabled={!ready} onClick={save}><ShieldCheck className="mr-2 h-4 w-4" />{busy === "save" ? "Saving…" : "Save selected details"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
