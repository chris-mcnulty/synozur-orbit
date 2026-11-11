import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CalendarClock, Check, ChevronDown, ExternalLink, FileUp, Loader2, MessageSquareText, RefreshCw, Save, ShieldAlert } from "lucide-react";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Conference, ConferenceSession } from "@shared/schema";
import type { EventPresence, MeetingAngle, MeetingBrief, MeetingContact, RelationshipReview } from "@shared/conference-meetings";
import type { ReactNode } from "react";
import { isValidLinkedInProfileUrl } from "@shared/linkedin-outreach";
import PasteContactsDialog, { type ParsedContact } from "@/components/sales/paste-contacts-dialog";
import ConferenceWarmContacts from "@/components/sales/conference-warm-contacts";
import ConferenceCalendarInvitation from "@/components/sales/conference-calendar-invitation";
import { formatClarificationText } from "@/components/sales/compose-clarification";

type Workspace = {
  campaignId: string;
  conference: Conference & { presence: EventPresence | null };
  sessions: ConferenceSession[];
  brief: MeetingBrief | null;
  suggestedBrief?: MeetingBrief;
  sourceContext?: {
    eventBrief: string; eventDescription: string; eventGoals: string;
    campaignBrief: string; campaignGoal: string; sourceCampaignName: string | null;
  };
  fingerprint: string;
  contacts: {
    id: string; name: string; email: string | null; title: string | null; companyName: string | null;
    linkedinUrl: string | null; hubspotContactId: string | null; ownerUserId: string | null; status: string;
    meetingFingerprint: string;
    meeting: MeetingContact;
  }[];
};
type ExternalRow = {
  name: string; email: string; companyName: string; title: string; linkedinUrl: string;
  valid: boolean; issue: string;
};

const relationshipOptions = ["customer", "prospect", "partner", "former_customer", "industry_peer", "unknown"] as const;
const attendanceOptions = ["confirmed", "suggested", "unknown", "not_attending"] as const;
const stages = ["shortlisted", "researched", "ready_for_review", "contacted", "replied", "meeting_booked", "follow_up", "declined", "unavailable", "do_not_contact"] as const;
const blankPresence: EventPresence = { timezone: "UTC", confirmation: "proposed", team: "", attendanceDates: "", meetingLocations: "", activities: "" };
const blankBrief: MeetingBrief = { enabled: true, goals: "", targetAccounts: "", availability: "", schedulingUrl: "", lookbackDays: 90 };
const endpoint = (campaignId: string) => `/api/sales-outreach/campaigns/${campaignId}/meetings`;

function dateInZone(iso: string, zone: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  let timezone = zone;
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { timezone = "UTC"; }
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

// Interpret a wall-clock time in the selected event zone, then emit an ISO string
// with an explicit offset (the contract rejects timezone-less datetime values).
export function wallTimeToIso(value: string, zone: string): string {
  if (!value) return "";
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) throw new Error("Enter a valid local date and time.");
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  } catch {
    throw new Error(`“${zone}” is not a valid event timezone.`);
  }
  for (let i = 0; i < 4; i++) {
    const parts = formatter.formatToParts(new Date(guess));
    const p = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += target - represented;
  }
  const instant = new Date(guess);
  const actual = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, Number(part.value)]));
  if (actual.year !== year || actual.month !== month || actual.day !== day || actual.hour !== hour || actual.minute !== minute) {
    throw new Error(`That local time does not exist in ${zone} because of a daylight-saving transition. Choose another time.`);
  }
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(instant);
  const label = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = label.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const offset = match ? `${match[1]}${match[2].padStart(2, "0")}:${match[3] ?? "00"}` : "+00:00";
  return `${datePart}T${timePart}:00${offset}`;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : "Something went wrong. Try again.";
}

export function parseExternal(text: string) {
  const matrix: { cells: string[]; issue: string }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let malformed = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === '"') malformed ||= "Unexpected quote in an unquoted field.";
    else if (char === ",") { cells.push(cell.trim()); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      cells.push(cell.trim());
      if (cells.some(Boolean) || malformed) matrix.push({ cells, issue: malformed });
      cells = []; cell = ""; malformed = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  if (cells.some(Boolean) || malformed || quoted) matrix.push({ cells, issue: quoted ? "Quoted field is not closed." : malformed });
  if (matrix.length < 2) return [];
  const headers = matrix[0].cells.map((header) => header.trim());
  return matrix.slice(1).map(({ cells: values, issue: parseIssue }): ExternalRow => {
    const byKey: Record<string, string> = {};
    headers.forEach((key, i) => { byKey[key.toLowerCase().replace(/[^a-z]/g, "")] = String(values[i] ?? "").trim(); });
    const contact = {
      name: byKey.name || [byKey.firstname, byKey.lastname].filter(Boolean).join(" "),
      email: byKey.email || byKey.workemail || byKey.businessemail || byKey.businessworkemail || "",
      companyName: byKey.companyname || byKey.currentcompany || byKey.company || "",
      title: byKey.title || byKey.jobtitle || "",
      linkedinUrl: byKey.linkedinprofileurl || byKey.linkedinurl || byKey.linkedinprofile || byKey.linkedin || byKey.personlinkedinurl || "",
    };
    let issue = parseIssue;
    if (!issue && values.length > headers.length) issue = "This row has more columns than the header.";
    if (!issue && !contact.name && !contact.email && !contact.linkedinUrl) issue = "Add a name and at least an email or LinkedIn profile URL.";
    if (!issue && !contact.email && !contact.linkedinUrl) issue = "Add either an email or a LinkedIn profile URL.";
    if (!issue && contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) issue = "Email address is not valid.";
    if (!issue && contact.linkedinUrl && !isValidLinkedInProfileUrl(contact.linkedinUrl)) issue = "Enter a valid LinkedIn person profile URL (linkedin.com/in/… or /pub/…).";
    return { ...contact, valid: !issue, issue };
  });
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;
}

export default function ConferenceMeetings({ campaignId, selectedContactId, onSelectedContactChange, onDraftCreated }: {
  campaignId: string;
  selectedContactId: string | null;
  onSelectedContactChange: (id: string | null) => void;
  onDraftCreated?: (result: unknown) => void;
}) {
  const qc = useQueryClient();
  const key = [endpoint(campaignId)];
  const query = useQuery<Workspace>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", endpoint(campaignId))).json(),
  });
  const workspace = query.data;
  const activeId = selectedContactId ?? "";
  const [presence, setPresence] = useState<EventPresence>(blankPresence);
  const [brief, setBrief] = useState<MeetingBrief>(blankBrief);
  const [draftContact, setDraftContact] = useState<MeetingContact | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [externalText, setExternalText] = useState("");
  const [externalRows, setExternalRows] = useState<ExternalRow[]>([]);
  const [externalSelected, setExternalSelected] = useState<Set<number>>(new Set());
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [importSource, setImportSource] = useState<"manual" | "wiza" | "salesnav">("manual");
  const [pasteContactsOpen, setPasteContactsOpen] = useState(false);
  const [draftChannel, setDraftChannel] = useState<"email" | "linkedin">("email");
  const [additionalContext, setAdditionalContext] = useState("");
  const [draftError, setDraftError] = useState<{ message: string; questions: string[] } | null>(null);
  const [draftSuccess, setDraftSuccess] = useState(false);
  const [meetingTimeError, setMeetingTimeError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const initialized = useRef<string | null>(null);

  useEffect(() => {
    if (!workspace || initialized.current === campaignId) return;
    initialized.current = campaignId;
    setPresence(workspace.conference.presence ?? blankPresence);
    const suggested = workspace.suggestedBrief ?? blankBrief;
    setBrief(workspace.brief
      ? { ...workspace.brief,
          goals: workspace.brief.goals?.trim() ? workspace.brief.goals : suggested.goals,
          targetAccounts: workspace.brief.targetAccounts?.trim() ? workspace.brief.targetAccounts : suggested.targetAccounts }
      : { ...suggested });
  }, [workspace, campaignId]);

  const selectedContact = workspace?.contacts.find((contact) => contact.id === activeId);
  useEffect(() => { setDraftContact(selectedContact?.meeting ?? null); setDraftError(null); setDraftSuccess(false); setMeetingTimeError(""); }, [selectedContact?.id]);
  const bookedCount = workspace?.contacts.filter((contact) => contact.meeting.stage === "meeting_booked" && !!contact.meeting.meetingAt && !!contact.meeting.meetingOwner.trim()).length ?? 0;
  const contactPath = (suffix: string) => `/api/sales-outreach/prospects/${activeId}/meeting${suffix}`;
  function contactPayload(contact: MeetingContact) {
    const { relationships, attendance, attendanceEvidence, relationshipNotes, ownerNotes, stage, selectedAngleId, selectedHook, selectedAsk, meetingAt, meetingLocation, participants, meetingOwner, followUp } = contact;
    return { relationships, attendance, attendanceEvidence, relationshipNotes, ownerNotes, stage, selectedAngleId, selectedHook, selectedAsk, meetingAt, meetingLocation, participants, meetingOwner, followUp };
  }

  const saveWorkspace = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", endpoint(campaignId), { brief, presence })).json(),
    onSuccess: (data: Workspace) => { qc.setQueryData(key, data); setError(""); },
    onError: (e) => setError(`Could not save event prep: ${messageOf(e)}`),
  });
  const saveContact = useMutation({
    mutationFn: async () => {
      if (!draftContact) throw new Error("Choose a contact first.");
      if (meetingTimeError) throw new Error(meetingTimeError);
      if (draftContact.stage === "meeting_booked" && (!draftContact.meetingAt || !draftContact.meetingOwner.trim())) {
        throw new Error("A booked meeting needs a date and time plus a meeting owner.");
      }
      return (await apiRequest("PATCH", contactPath(""), contactPayload(draftContact))).json();
    },
    onSuccess: async (saved: MeetingContact) => {
      qc.setQueryData<Workspace>(key, (old) => old ? { ...old, contacts: old.contacts.map((contact) => contact.id === activeId ? { ...contact, meeting: { ...contact.meeting, ...saved } } : contact) } : old);
      await Promise.all([
        qc.invalidateQueries({ queryKey: key }),
        qc.invalidateQueries({ queryKey: ["/api/sales-outreach/campaigns", campaignId, "prospects"] }),
      ]);
      setError("");
    },
    onError: (e) => setError(`Could not save contact prep: ${messageOf(e)}`),
  });
  const review = useMutation({
    mutationFn: async () => (await apiRequest("POST", contactPath("/review"), {})).json() as Promise<RelationshipReview>,
    onSuccess: async (result: RelationshipReview) => {
      qc.setQueryData<Workspace>(key, (old) => old ? { ...old, contacts: old.contacts.map((contact) => contact.id === activeId ? { ...contact, meeting: { ...contact.meeting, review: result } } : contact) } : old);
      await qc.invalidateQueries({ queryKey: key });
      setError("");
    },
    onError: (e) => setError(`Relationship review failed: ${messageOf(e)}`),
  });
  const generateAngles = useMutation({
    mutationFn: async () => (await apiRequest("POST", contactPath("/angles"), {})).json() as Promise<{ angles: MeetingAngle[]; fingerprint: string }>,
    onSuccess: async (result: { angles: MeetingAngle[]; fingerprint: string }) => {
      qc.setQueryData<Workspace>(key, (old) => old ? { ...old, contacts: old.contacts.map((contact) => contact.id === activeId ? { ...contact, meeting: { ...contact.meeting, angles: result.angles, anglesFingerprint: result.fingerprint } } : contact) } : old);
      await qc.invalidateQueries({ queryKey: key });
      setError("");
    },
    onError: (e) => setError(`Angle generation failed: ${messageOf(e)}`),
  });
  const createDraft = useMutation({
    mutationFn: async () => {
      if (!draftContact) throw new Error("Choose a contact first.");
      if (meetingTimeError) throw new Error(meetingTimeError);
      if (draftContact.stage === "meeting_booked" && (!draftContact.meetingAt || !draftContact.meetingOwner.trim())) {
        throw new Error("A booked meeting needs a date and time plus a meeting owner.");
      }
      await apiRequest("PATCH", contactPath(""), contactPayload(draftContact));
      const res = await apiRequest("POST", contactPath("/draft"), { channel: draftChannel, additionalContext });
      return res.json();
    },
    onSuccess: async (result: unknown) => { await qc.invalidateQueries({ queryKey: key }); setDraftSuccess(true); setDraftError(null); onDraftCreated?.(result); },
    onError: (e) => {
      const questions = e instanceof ApiError ? e.questions ?? [] : [];
      setDraftError({ message: messageOf(e), questions });
    },
  });
  const importContacts = useMutation({
    mutationFn: async (rows?: ExternalRow[]) => {
      const contacts = (rows ?? externalRows.filter((row, i) => row.valid && externalSelected.has(i))).slice(0, 100).map(({ name, email, companyName, title, linkedinUrl }) => ({ name, email, companyName, title, linkedinUrl }));
      return (await apiRequest("POST", `${endpoint(campaignId)}/import`, { source: importSource, contacts })).json() as Promise<{ imported: number; skipped: number }>;
    },
    onSuccess: async (result) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: key }),
        qc.invalidateQueries({ queryKey: ["/api/sales-outreach/campaigns", campaignId, "prospects"] }),
      ]);
      setImportResult(result);
      setExternalRows([]);
      setExternalText("");
      setExternalSelected(new Set());
      setError("");
    },
    onError: (e) => setError(`Import failed: ${messageOf(e)}`),
  });

  function updateContact<K extends keyof MeetingContact>(field: K, value: MeetingContact[K]) {
    setDraftContact((current) => current ? { ...current, [field]: value } : current);
  }
  const personBusy = saveContact.isPending || review.isPending || generateAngles.isPending || createDraft.isPending;
  function closePrep() {
    if (personBusy) return;
    if (draftContact && selectedContact && JSON.stringify(contactPayload(draftContact)) !== JSON.stringify(contactPayload(selectedContact.meeting))
      && !window.confirm("Close meeting prep without saving your changes?")) return;
    onSelectedContactChange(null);
  }
  function loadPreview(text: string, source: "manual" | "wiza" | "salesnav") {
    const rows = parseExternal(text);
    setExternalText(text);
    setExternalRows(rows);
    setImportResult(null);
    setExternalSelected(new Set(rows.map((row, i) => row.valid && i < 100 ? i : -1).filter((i) => i >= 0)));
    setImportSource(source);
    setError(rows.length ? "" : "No data rows were found. Include a header row and try again.");
  }

  function changeExternalText(text: string) {
    setExternalText(text);
    setExternalRows([]);
    setExternalSelected(new Set());
    setImportResult(null);
    setError("");
  }

  async function importPastedContacts(contacts: ParsedContact[]) {
    const rows: ExternalRow[] = contacts.map((contact) => ({ ...contact, valid: true, issue: "" }));
    await importContacts.mutateAsync(rows);
  }

  if (query.isLoading) return <Card className="border-border bg-card"><CardContent className="space-y-3 p-6"><div className="h-5 w-48 animate-pulse rounded bg-muted" /><div className="h-24 animate-pulse rounded bg-muted/70" /></CardContent></Card>;
  if (query.isError) return <Card className="border-destructive/30 bg-destructive/10"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-5"><p role="alert" className="text-sm text-destructive">Meeting workspace could not load: {messageOf(query.error)}</p><Button variant="outline" size="sm" onClick={() => query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button></CardContent></Card>;
  if (!workspace) return null;
  const event = workspace.conference;
  const staleAngles = !!selectedContact?.meeting.angles?.length && selectedContact.meeting.anglesFingerprint !== selectedContact.meetingFingerprint;

  return <section className="min-w-0 space-y-3" data-testid="conference-meetings">
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><CalendarClock className="h-4 w-4 shrink-0 text-primary" /><span className="break-words">{event.name}</span></h2>
          <p className="mt-1 text-xs text-muted-foreground">Shared event context reused · Open meeting prep from a contact below.</p>
          {brief.goals.trim() && <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground"><span className="font-medium text-foreground">{workspace.brief?.goals?.trim() ? "Saved conversation goals: " : "Inherited goals: "}</span>{brief.goals}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{bookedCount} meetings booked</Badge>
          <Button asChild variant="outline" size="sm">
              <a href={`/app/marketing/conferences/${encodeURIComponent(event.id)}`}><ExternalLink className="mr-2 h-3.5 w-3.5" />Shared event</a>
          </Button>
          <Button variant="outline" size="sm" aria-expanded={expanded} aria-controls="event-context-setup" onClick={() => setExpanded((v) => !v)}>Context & setup<ChevronDown className={`ml-1.5 h-4 w-4 ${expanded ? "rotate-180" : ""}`} /></Button>
        </div>
      </div>
      {error && <p role="alert" className="px-4 pb-3 text-sm text-destructive">{error}</p>}
      <div id="event-context-setup" hidden={!expanded} className="space-y-4 border-t border-border p-4">
        {workspace.sourceContext && <div className="rounded-lg border border-primary/20 bg-primary/5 p-3" data-testid="meeting-inherited-context">
          <h3 className="text-sm font-semibold">Inherited source context <Badge variant="outline" className="ml-1 text-[10px]">Read only</Badge></h3>
          <p className="mt-1 text-xs text-muted-foreground">Reused from the shared event{workspace.sourceContext.sourceCampaignName ? ` and ${workspace.sourceContext.sourceCampaignName}` : ""}. Edit the originals in their source; use the private brief below for outreach-specific overrides.</p>
          <dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
            {([
              ["Event brief", workspace.sourceContext.eventBrief],
              ["Event description", workspace.sourceContext.eventDescription],
              ["Event goals", workspace.sourceContext.eventGoals],
              ["Source campaign brief", workspace.sourceContext.campaignBrief],
              ["Source campaign goal", workspace.sourceContext.campaignGoal],
            ] as const).filter(([, value]) => value?.trim()).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">{label} · inherited</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{value}</dd></div>)}
          </dl>
        </div>}
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]">
          <Card className="border-border bg-card shadow-none">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Shared event plan</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Event timezone"><Input value={presence.timezone} placeholder="America/Chicago" onChange={(e) => setPresence({ ...presence, timezone: e.target.value })} /></Field>
                <Field label="Presence status"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={presence.confirmation} onChange={(e) => setPresence({ ...presence, confirmation: e.target.value as EventPresence["confirmation"] })}><option value="proposed">Proposed</option><option value="confirmed">Confirmed</option></select></Field>
              </div>
              <Field label="Attending team"><Input value={presence.team} onChange={(e) => setPresence({ ...presence, team: e.target.value })} placeholder="People attending or representing us" /></Field>
              <Field label="Attendance dates"><Textarea value={presence.attendanceDates} onChange={(e) => setPresence({ ...presence, attendanceDates: e.target.value })} rows={2} placeholder="Which days the team will be there" /></Field>
              <Field label="Meeting locations"><Textarea value={presence.meetingLocations} onChange={(e) => setPresence({ ...presence, meetingLocations: e.target.value })} rows={2} placeholder="Venue, booth, nearby meeting spots" /></Field>
              <Field label="Planned activities"><Textarea value={presence.activities} onChange={(e) => setPresence({ ...presence, activities: e.target.value })} rows={2} placeholder="Talks, dinners, partner sessions…" /></Field>
              <div className="border-t border-border pt-4">
                <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-foreground">Private campaign brief</h3><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={brief.enabled} onChange={(e) => setBrief({ ...brief, enabled: e.target.checked })} />Active</label></div>
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">{workspace.brief ? "Saved private overrides are kept. Blank goals start from the shared source." : "Suggested from the shared event plan. Changes stay local until you save."}</p>
                  <Field label="Conversation goals (private override)"><Textarea rows={2} value={brief.goals} onChange={(e) => setBrief({ ...brief, goals: e.target.value })} placeholder="What would make these conversations worthwhile?" /></Field>
                  <Field label="Target accounts"><Textarea rows={2} value={brief.targetAccounts} onChange={(e) => setBrief({ ...brief, targetAccounts: e.target.value })} placeholder="Accounts and why they matter" /></Field>
                  <Field label="Availability"><Textarea rows={2} value={brief.availability} onChange={(e) => setBrief({ ...brief, availability: e.target.value })} placeholder="Windows, constraints, preferred days" /></Field>
                  <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                    <Field label="Scheduling URL"><Input value={brief.schedulingUrl} onChange={(e) => setBrief({ ...brief, schedulingUrl: e.target.value })} placeholder="https://" /></Field>
                    <Field label="History lookback (days)"><Input type="number" min={7} max={365} value={brief.lookbackDays} onChange={(e) => setBrief({ ...brief, lookbackDays: Number(e.target.value) })} /></Field>
                  </div>
                </div>
              </div>
              <Button size="sm" onClick={() => saveWorkspace.mutate()} disabled={saveWorkspace.isPending}><Save className="mr-2 h-4 w-4" />{saveWorkspace.isPending ? "Saving…" : "Save event plan"}</Button>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <ConferenceWarmContacts key={`${campaignId}:${workspace.fingerprint}`} campaignId={campaignId}
              planSaved={!!workspace.brief?.enabled && JSON.stringify(brief) === JSON.stringify(workspace.brief) && (!!brief.goals.trim() || !!brief.targetAccounts.trim())} />
            <Card className="border-border bg-card shadow-none">
              <CardHeader className="pb-2"><CardTitle className="text-lg">Event facts</CardTitle></CardHeader>
              <CardContent>
                <div className="grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">
                  <p><span className="block text-[11px] uppercase tracking-wider text-muted-foreground">Dates</span>{event.startDate ? new Date(event.startDate).toLocaleDateString() : "Not set"}{event.endDate ? ` – ${new Date(event.endDate).toLocaleDateString()}` : ""}</p>
                  <p><span className="block text-[11px] uppercase tracking-wider text-muted-foreground">Location</span>{event.location || "Not listed"}</p>
                  <p className="min-w-0 sm:col-span-2"><span className="block text-[11px] uppercase tracking-wider text-muted-foreground">Website</span>{event.website ? <a className="inline-flex max-w-full items-center gap-1 break-all text-primary underline" href={event.website} target="_blank" rel="noreferrer">{event.website}<ExternalLink className="h-3 w-3 shrink-0" /></a> : "Not listed"}</p>
                </div>
                <div className="mt-4 border-t border-border pt-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sessions · {workspace.sessions.length}</h3>
                  {workspace.sessions.length ? <div className="grid gap-2 sm:grid-cols-2">{workspace.sessions.map((session) => <div key={session.id} className="rounded-lg border border-border bg-muted/30 p-3"><p className="text-sm font-medium text-foreground">{session.title}</p><p className="mt-1 text-xs text-muted-foreground">{[session.sessionType, session.track, session.room].filter(Boolean).join(" · ") || "Session details pending"}{session.sessionStart ? ` · ${dateInZone(new Date(session.sessionStart).toISOString(), presence.timezone)}` : ""}</p>{session.speaker && <p className="mt-1 text-xs text-muted-foreground">Featuring {session.speaker}</p>}</div>)}</div> : <p className="text-sm text-muted-foreground">No sessions are listed for this event yet.</p>}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card shadow-none">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-lg"><FileUp className="h-4 w-4" />Reviewed external import</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs leading-relaxed text-muted-foreground">If Apollo finds no usable event contacts, research in Wiza or Sales Navigator outside Orbit, then paste or upload your chosen rows. Nothing is fetched from those services. Preview and select up to 100 people before importing.</p>
                <div className="flex flex-wrap gap-2">
                  <select value={importSource} onChange={(e) => setImportSource(e.target.value as typeof importSource)} className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"><option value="manual">Manual paste</option><option value="wiza">Wiza export</option><option value="salesnav">Sales Navigator export</option></select>
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>Upload CSV</Button>
                  <Button variant="outline" size="sm" onClick={() => setPasteContactsOpen(true)}><MessageSquareText className="mr-1.5 h-3.5 w-3.5" />Paste contacts</Button>
                  <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((text) => loadPreview(text, importSource)); e.target.value = ""; }} />
                </div>
                <Textarea value={externalText} onChange={(e) => changeExternalText(e.target.value)} rows={3} placeholder={"Paste CSV rows with headers: Name, Email, Company, Title, LinkedIn URL"} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => loadPreview(externalText, importSource)} disabled={!externalText.trim()}>Preview contacts</Button>
                  {externalRows.length > 0 && <span className="text-xs text-muted-foreground">{externalSelected.size} of {externalRows.length} selected</span>}
                </div>
                {importResult && <p role="status" className="text-xs font-medium text-primary">Imported {importResult.imported}; skipped {importResult.skipped} existing or ineligible rows.</p>}
                {externalRows.length > 0 && <div className="max-h-48 space-y-1 overflow-auto rounded-lg border border-border p-2">
                  <button className="mb-1 text-xs font-medium text-primary underline" onClick={() => setExternalSelected(externalSelected.size === externalRows.filter((row, i) => row.valid && i < 100).length ? new Set() : new Set(externalRows.map((row, i) => row.valid && i < 100 ? i : -1).filter((i) => i >= 0)))}>{externalSelected.size === externalRows.filter((row, i) => row.valid && i < 100).length ? "Clear selection" : "Select first 100 valid"}</button>
                  {externalRows.map((row, i) => <label key={`${row.email}-${i}`} className={`flex items-start gap-2 rounded px-1.5 py-1 text-xs ${row.valid ? "cursor-pointer hover:bg-muted" : "bg-destructive/10 text-destructive"}`}><input type="checkbox" checked={externalSelected.has(i)} disabled={!row.valid || i >= 100 || (!externalSelected.has(i) && externalSelected.size >= 100)} onChange={(e) => setExternalSelected((old) => { const next = new Set(old); if (e.target.checked) next.add(i); else next.delete(i); return next; })} /><span><strong>{row.name || row.email || `Row ${i + 2}`}</strong>{row.issue ? <span className="block font-medium text-destructive">Invalid: {row.issue}</span> : <span className="block text-muted-foreground">{[row.title, row.companyName, row.email].filter(Boolean).join(" · ") || "No additional details"}</span>}</span></label>)}
                </div>}
                {externalRows.length > 100 && <p className="text-xs text-amber-950 dark:text-amber-100">Showing all {externalRows.length} rows; only the first 100 valid rows can be selected per import. Use a smaller batch for later rows.</p>}
                <Button size="sm" onClick={() => importContacts.mutate(undefined)} disabled={!externalSelected.size || importContacts.isPending}>{importContacts.isPending ? "Importing…" : `Import ${externalSelected.size} selected`}</Button>
              </CardContent>
            </Card>
          </div>
        </div>

      </div>
      <Dialog open={!!activeId} onOpenChange={(open) => { if (!open) closePrep(); }}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto overflow-x-hidden">
          <DialogHeader className="pr-6">
            <DialogTitle>Meeting prep · {selectedContact?.name || "Selected contact"}</DialogTitle>
            <DialogDescription>{event.name} · Review relationships, prepare an approach, and plan the meeting. Nothing is sent automatically.</DialogDescription>
          </DialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {selectedContact && draftContact ? <div className="min-w-0 space-y-4 [&_fieldset]:min-w-0 [&_p]:break-words">
            <ConferenceCalendarInvitation key={selectedContact.id} personId={selectedContact.id} name={selectedContact.name} email={selectedContact.email} eventName={event.name} meeting={selectedContact.meeting} disabled={personBusy} />
            <Card className="min-w-0 border-border bg-card shadow-none">
              <CardHeader className="flex flex-col items-start justify-between gap-3 pb-3 sm:flex-row">
                <div><CardTitle className="text-xl">{selectedContact.name}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{[selectedContact.title, selectedContact.companyName].filter(Boolean).join(" · ")}{selectedContact.email ? ` · ${selectedContact.email}` : ""}</p>{selectedContact.linkedinUrl && <a href={selectedContact.linkedinUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline">LinkedIn profile <ExternalLink className="h-3 w-3" /></a>}</div>
                <Button size="sm" onClick={() => saveContact.mutate()} disabled={personBusy || !!meetingTimeError} className="shrink-0"><Save className="mr-1.5 h-4 w-4" />{saveContact.isPending ? "Saving…" : "Save prep"}</Button>
              </CardHeader>
              <CardContent><fieldset disabled={personBusy} className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <Field label="Relationship (select all that apply)"><div className="flex flex-wrap gap-1.5">{relationshipOptions.map((role) => <button type="button" key={role} onClick={() => { const next = draftContact.relationships.includes(role) ? draftContact.relationships.filter((v) => v !== role) : [...draftContact.relationships, role]; if (next.length) updateContact("relationships", next); }} className={`rounded-full border px-2.5 py-1 text-xs capitalize ${draftContact.relationships.includes(role) ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}>{role.replaceAll("_", " ")}</button>)}</div></Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Attendance"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={draftContact.attendance} onChange={(e) => updateContact("attendance", e.target.value as MeetingContact["attendance"])}>{attendanceOptions.map((v) => <option key={v} value={v}>{v.replaceAll("_", " ")}</option>)}</select></Field>
                    <Field label="Meeting stage"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={draftContact.stage} onChange={(e) => updateContact("stage", e.target.value as MeetingContact["stage"])}>{stages.map((v) => <option key={v} value={v}>{v.replaceAll("_", " ")}</option>)}</select></Field>
                  </div>
                  <Field label="Attendance evidence"><Textarea rows={2} value={draftContact.attendanceEvidence} onChange={(e) => updateContact("attendanceEvidence", e.target.value)} placeholder="Source or reason for attendance confidence" /></Field>
                  <Field label="Relationship notes"><Textarea rows={3} value={draftContact.relationshipNotes} onChange={(e) => updateContact("relationshipNotes", e.target.value)} /></Field>
                  <Field label="Owner notes"><Textarea rows={2} value={draftContact.ownerNotes} onChange={(e) => updateContact("ownerNotes", e.target.value)} placeholder="Private context for the account owner" /></Field>
                </div>
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={`Meeting date & time (${presence.timezone})`}><Input type="datetime-local" aria-invalid={!!meetingTimeError} value={dateInZone(draftContact.meetingAt, presence.timezone)} onChange={(e) => { setMeetingTimeError(""); try { updateContact("meetingAt", wallTimeToIso(e.target.value, presence.timezone)); } catch (err) { updateContact("meetingAt", ""); setMeetingTimeError(messageOf(err)); } }} />{meetingTimeError && <span role="alert" className="block text-xs text-destructive">{meetingTimeError}</span>}</Field>
                    <Field label="Meeting owner"><Input value={draftContact.meetingOwner} onChange={(e) => updateContact("meetingOwner", e.target.value)} /></Field>
                  </div>
                  <Field label="Location"><Input value={draftContact.meetingLocation} onChange={(e) => updateContact("meetingLocation", e.target.value)} /></Field>
                  <Field label="Participants"><Input value={draftContact.participants} onChange={(e) => updateContact("participants", e.target.value)} placeholder="Names or roles attending" /></Field>
                  <Field label="Follow-up"><Textarea rows={3} value={draftContact.followUp} onChange={(e) => updateContact("followUp", e.target.value)} placeholder="Agreed next steps and timing" /></Field>
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><ShieldAlert className="h-4 w-4" />Relationship history</h3><p className="mt-1 text-xs text-muted-foreground">{selectedContact.meeting.review ? `Checked ${new Date(selectedContact.meeting.review.checkedAt).toLocaleString()} · ${selectedContact.meeting.review.coverage} coverage` : "Not reviewed yet"}</p></div><Button variant="outline" size="sm" onClick={() => review.mutate()} disabled={review.isPending}>{review.isPending ? "Checking…" : "Review history"}</Button></div>
                    {selectedContact.meeting.review && <ReviewDetails review={selectedContact.meeting.review} />}
                  </div>
                </div>
              </fieldset></CardContent>
            </Card>

            <Card className="border-border bg-card shadow-none">
              <CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-lg">Conversation angles</CardTitle><p className="mt-1 text-xs text-muted-foreground">Structured suggestions grounded in returned relationship evidence—not a separate AI research call. Select and save an angle to persist your hook and ask.</p></div><Button variant="outline" size="sm" onClick={() => generateAngles.mutate()} disabled={personBusy}>{generateAngles.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Building angles…</> : "Generate 3 angles"}</Button></div></CardHeader>
              <CardContent><fieldset disabled={personBusy} className="space-y-3">
                {staleAngles && <div className="flex items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><AlertCircle className="h-4 w-4 shrink-0" />These angles were generated from an earlier event or relationship snapshot. Review history and regenerate before using.</div>}
                {!!selectedContact.meeting.angles?.length ? <div className="grid gap-3 lg:grid-cols-3">{selectedContact.meeting.angles.map((angle) => <article key={angle.id} className={`rounded-xl border p-4 ${draftContact.selectedAngleId === angle.id ? "border-primary/50 bg-primary/10 ring-1 ring-primary/20" : "border-border bg-muted/30"}`}>
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><input type="radio" name="selected-angle" checked={draftContact.selectedAngleId === angle.id} onChange={() => { updateContact("selectedAngleId", angle.id); updateContact("selectedHook", angle.hook); updateContact("selectedAsk", angle.ask); }} />Select angle</label>
                  <label className="mt-3 block text-xs font-medium text-muted-foreground">Hook<Input className="mt-1" value={draftContact.selectedAngleId === angle.id ? draftContact.selectedHook : angle.hook} onChange={(e) => { const updated = selectedContact.meeting.angles?.map((a) => a.id === angle.id ? { ...a, hook: e.target.value } : a) ?? []; qc.setQueryData<Workspace>(key, (old) => old ? { ...old, contacts: old.contacts.map((c) => c.id === activeId ? { ...c, meeting: { ...c.meeting, angles: updated } } : c) } : old); if (draftContact.selectedAngleId === angle.id) updateContact("selectedHook", e.target.value); }} /></label>
                  <div className="mt-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Evidence</p>{angle.evidence.map((line, i) => <p key={i} className="mt-1 text-xs leading-relaxed text-foreground">{line}</p>)}</div>
                  <label className="mt-3 block text-xs font-medium text-muted-foreground">Ask<Input className="mt-1" value={draftContact.selectedAngleId === angle.id ? draftContact.selectedAsk : angle.ask} onChange={(e) => { const updated = selectedContact.meeting.angles?.map((a) => a.id === angle.id ? { ...a, ask: e.target.value } : a) ?? []; qc.setQueryData<Workspace>(key, (old) => old ? { ...old, contacts: old.contacts.map((c) => c.id === activeId ? { ...c, meeting: { ...c.meeting, angles: updated } } : c) } : old); if (draftContact.selectedAngleId === angle.id) updateContact("selectedAsk", e.target.value); }} /></label>
                  {angle.cautions.length > 0 && <p className="mt-3 border-t border-amber-300/60 pt-2 text-xs text-amber-950 dark:border-amber-800 dark:text-amber-100">Caution: {angle.cautions.join(" · ")}</p>}
                </article>)}</div> : <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"><MessageSquareText className="mx-auto mb-2 h-5 w-5" />Review relationship history, then generate three grounded approaches.</div>}
                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  <div className="flex flex-wrap items-center gap-2"><select value={draftChannel} onChange={(e) => { setDraftChannel(e.target.value as "email" | "linkedin"); setDraftSuccess(false); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="email">Email</option><option value="linkedin">LinkedIn</option></select><Button onClick={() => createDraft.mutate()} disabled={personBusy || !!meetingTimeError}>{createDraft.isPending ? "Preparing draft…" : `Create ${draftChannel === "email" ? "email" : "LinkedIn"} draft`}</Button><span className="text-xs text-muted-foreground">Creates a pending draft only. It will not be approved or sent.</span></div>
                  <Field label="Additional context (optional)"><Textarea rows={2} maxLength={6000} value={additionalContext} onChange={(e) => setAdditionalContext(e.target.value)} placeholder="Optional direction beyond the saved event and campaign brief." /></Field>
                  <p className="mt-2 text-xs text-muted-foreground">Drafting uses the saved event and campaign brief and checks relationship history automatically. Private context and generated angles are optional. Suppression checks and separate send approval still apply.</p>
                  {draftError && <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"><p className="whitespace-pre-wrap font-medium">{formatClarificationText(draftError.message)}</p>{draftError.questions.length > 0 && <div className="mt-2 border-t border-destructive/30 pt-2"><p className="text-xs font-semibold uppercase tracking-wide">A few details would help</p><ul className="mt-1 list-disc pl-5 text-xs">{draftError.questions.map((question, i) => <li key={i}>{formatClarificationText(question)}</li>)}</ul><p className="mt-2 text-xs">Your added context is retained. Update it if useful, then retry.</p></div>}<Button className="mt-2" size="sm" variant="outline" onClick={() => createDraft.mutate()} disabled={createDraft.isPending}>Retry draft</Button></div>}
                  {draftSuccess && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm text-foreground"><Check className="h-4 w-4" /><span>Pending draft opened in the campaign’s existing review dialog. Review it there; no approval or send happened.</span></div>}
                </div>
              </fieldset></CardContent>
            </Card>
          </div> : <div className="rounded-lg border border-dashed p-5"><p className="text-sm text-muted-foreground">Meeting prep for this contact is not available yet. Refresh the workspace to load recently added contacts.</p><Button className="mt-3" variant="outline" size="sm" onClick={() => query.refetch()}>Refresh workspace</Button></div>}
        </DialogContent>
      </Dialog>
      <PasteContactsDialog
        open={pasteContactsOpen}
        onOpenChange={setPasteContactsOpen}
        campaignId={campaignId}
        heading="Paste event contacts"
        requireEmailOrLinkedin
        onImport={importPastedContacts}
      />
    </div>
  </section>;
}

function ReviewDetails({ review }: { review: RelationshipReview }) {
  return <div className="mt-3 space-y-2">
    {review.suppressed && <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive"><ShieldAlert className="h-3.5 w-3.5" />Suppression blocker — do not contact</p>}
    {review.limitations.length > 0 && <div className="rounded-md border border-amber-300/60 bg-amber-50 px-2.5 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><strong>Coverage limitations</strong><ul className="mt-1 list-disc pl-4">{review.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
    {review.relatedCampaigns.length > 0 && <p className="text-xs text-foreground"><strong>Overlapping campaigns:</strong> {review.relatedCampaigns.join(", ")}</p>}
    {review.activities.length > 0 ? <div className="space-y-1.5">{review.activities.map((activity) => <div key={activity.id} className="border-l-2 border-border pl-2.5 text-xs"><p className="font-medium text-foreground">{activity.summary}</p><p className="text-muted-foreground">{activity.source} · {activity.kind} · {new Date(activity.at).toLocaleString()}{activity.url ? <> · <a className="underline" href={activity.url} target="_blank" rel="noreferrer">source</a></> : null}</p></div>)}</div> : <p className="text-xs text-muted-foreground">No dated relationship activity returned.</p>}
  </div>;
}
