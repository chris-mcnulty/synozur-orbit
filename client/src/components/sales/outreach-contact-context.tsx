import { useState } from "react";
import { History, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { messagingGroups, messagingGroupLabels, contactFamiliarities, familiarityLabels, externalActivitySchema, type ContactFamiliarity, type ExternalActivityInput } from "@shared/outreach-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { outreachError, useOutreachActions, useOutreachContext, type ExternalActivity, type MessagingGroup, type OutreachContext } from "./use-outreach-context";

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const channelLabels = { email: "Email", linkedin: "LinkedIn", phone: "Phone", meeting: "Meeting", other: "Other" };
const outcomeLabels = { no_reply: "No reply", replied: "Replied", meeting_agreed: "Meeting agreed", other: "Other" };
function localDate(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function MessagingGroupSelect({ value, onChange, disabled = false }: {
  value: MessagingGroup | null; onChange: (group: MessagingGroup | null) => void; disabled?: boolean;
}) {
  return <label className="block space-y-1.5 text-sm font-medium">Messaging group
    <select className={selectClass} value={value ?? ""} disabled={disabled} onChange={(e) => onChange((e.target.value || null) as MessagingGroup | null)}>
      <option value="">Shared campaign brief / no group</option>
      {messagingGroups.map((group) => <option key={group} value={group}>{messagingGroupLabels[group]}</option>)}
    </select>
    <span className="block text-xs font-normal text-muted-foreground">Choose explicitly. Orbit never infers a messaging group from a title or role.</span>
  </label>;
}
export function FamiliaritySelect({ value, onChange, disabled = false }: {
  value?: ContactFamiliarity; onChange: (value: ContactFamiliarity) => void; disabled?: boolean;
}) {
  return <label className="block space-y-1.5 text-sm font-medium">Familiarity with campaign sender
    <select className={selectClass} value={value ?? "unknown"} disabled={disabled} onChange={e => onChange(e.target.value as ContactFamiliarity)}>
      {contactFamiliarities.map(item => <option key={item} value={item}>{familiarityLabels[item]}</option>)}
    </select>
    <span className="block text-xs font-normal text-muted-foreground">Specific to this campaign’s sender, not a global person trait. Unknown is the default. Neither familiarity nor messaging group implies consent or communication status.</span>
  </label>;
}
export function OutreachHistory({ context, onEdit, onDelete }: {
  context: OutreachContext; onEdit?: (activity: ExternalActivity) => void; onDelete?: (activity: ExternalActivity) => void;
}) {
  if (!context.activities.length) return <div className="rounded-lg border border-dashed p-5 text-sm"><History className="mb-2 h-5 w-5 text-muted-foreground" /><p className="font-medium">No external outreach recorded</p><p className="mt-1 text-xs text-muted-foreground">Add the actual conversation before writing the next message. An empty history is not proof of no prior contact.</p></div>;
  return <ol aria-label="Global contact outreach history" className="space-y-3">
    {[...context.activities].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).map((item) => <li key={item.id} className="rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="text-sm font-medium">{channelLabels[item.channel]} · {item.sender}</p><p className="mt-0.5 text-xs text-muted-foreground"><time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString()}</time> · {outcomeLabels[item.outcome]}</p></div>
        {onEdit && onDelete && <div className="flex gap-1"><Button size="icon" variant="ghost" aria-label={`Edit ${channelLabels[item.channel]} activity from ${item.sender}`} onClick={() => onEdit(item)}><Pencil className="h-3.5 w-3.5" /></Button><Button size="icon" variant="ghost" aria-label={`Delete ${channelLabels[item.channel]} activity from ${item.sender}`} onClick={() => onDelete(item)}><Trash2 className="h-3.5 w-3.5" /></Button></div>}
      </div>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{item.message}</p>
      {item.reply && <div className="mt-3 border-l-2 border-primary/30 pl-3"><p className="text-xs font-medium text-muted-foreground">Their reply</p><p className="mt-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{item.reply}</p></div>}
      {item.followUpAt && <p className="mt-3 text-xs text-muted-foreground">Reminder: {new Date(item.followUpAt).toLocaleString()} · No automatic send</p>}
    </li>)}
  </ol>;
}
function ActivityForm({ initial, busy, onSave, onCancel }: {
  initial: ExternalActivity | null; busy: boolean; onSave: (input: ExternalActivityInput) => Promise<void>; onCancel: () => void;
}) {
  const [form, setForm] = useState(() => ({
    channel: initial?.channel ?? "email", sender: initial?.sender ?? "", occurredAt: localDate(initial?.occurredAt ?? new Date().toISOString()),
    message: initial?.message ?? "", reply: initial?.reply ?? "", outcome: initial?.outcome ?? "no_reply",
    followUpAt: initial?.followUpAt ? localDate(initial.followUpAt) : "",
  }));
  const [error, setError] = useState("");
  return <form className="space-y-3 rounded-lg border bg-muted/20 p-4" onSubmit={async (e) => {
    e.preventDefault(); setError("");
    try {
      const input = externalActivitySchema.parse({ ...form, occurredAt: new Date(form.occurredAt).toISOString(), followUpAt: form.followUpAt ? new Date(form.followUpAt).toISOString() : null });
      await onSave(input);
    } catch (err) { setError(err instanceof Error && "issues" in err ? "Check required fields and dates. Activity must be in the past; sender and message are required." : outreachError(err)); }
  }}>
    <h3 className="text-sm font-semibold">{initial ? "Edit activity" : "Record external activity"}</h3>
    <fieldset disabled={busy} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium">Channel<select className={selectClass} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as ExternalActivityInput["channel"] })}>{Object.entries(channelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="space-y-1 text-xs font-medium">Occurred at (your local time)<Input required type="datetime-local" value={form.occurredAt} onChange={(e) => setForm({ ...form, occurredAt: e.target.value })} /></label>
      </div>
      <label className="block space-y-1 text-xs font-medium">Sender<Input required maxLength={300} value={form.sender} onChange={(e) => setForm({ ...form, sender: e.target.value })} /></label>
      <label className="block space-y-1 text-xs font-medium">Message or conversation notes<Textarea required maxLength={12000} rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
      <label className="block space-y-1 text-xs font-medium">Reply<Textarea maxLength={12000} rows={3} value={form.reply} onChange={(e) => setForm({ ...form, reply: e.target.value })} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium">Outcome<select className={selectClass} value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value as ExternalActivityInput["outcome"] })}>{Object.entries(outcomeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="space-y-1 text-xs font-medium">Follow-up reminder (optional)<Input type="datetime-local" value={form.followUpAt} onChange={(e) => setForm({ ...form, followUpAt: e.target.value })} /></label>
      </div>
      <p className="text-xs text-muted-foreground">A follow-up date is a reminder only. It never schedules or sends a message.</p>
      <div className="flex gap-2"><Button type="submit" size="sm">{busy ? "Saving…" : "Save activity"}</Button><Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button></div>
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </form>;
}
export function OutreachContextPanel({ prospectId, canEdit }: { prospectId: string; canEdit: boolean }) {
  const query = useOutreachContext(prospectId);
  const { settings, activity } = useOutreachActions(prospectId);
  const [editing, setEditing] = useState<ExternalActivity | null | undefined>();
  const [deleting, setDeleting] = useState<ExternalActivity | null>(null);
  const [error, setError] = useState("");
  if (query.isLoading) return <div aria-label="Loading contact history" className="space-y-3"><div className="h-10 animate-pulse rounded bg-muted" /><div className="h-32 animate-pulse rounded bg-muted" /></div>;
  if (query.isError || !query.data) return <div role="alert" className="space-y-2 text-sm"><p>Contact context could not load. {outreachError(query.error)}</p><Button variant="outline" onClick={() => query.refetch()}>Retry history</Button></div>;
  const context = query.data;
  const busy = settings.isPending || activity.isPending;
  return <div className="space-y-5">
    <div className="rounded-lg border bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">History and outreach hold are shared across campaigns. Messaging group and familiarity are explicit settings for this campaign; neither is inferred from a role.</div>
    <MessagingGroupSelect value={context.messagingGroup} disabled={!canEdit || busy} onChange={(messagingGroup) => { setError(""); settings.mutate({ messagingGroup }, { onError: (e) => setError(outreachError(e)) }); }} />
    <FamiliaritySelect value={context.familiarity} disabled={!canEdit || busy} onChange={(familiarity) => { setError(""); settings.mutate({ familiarity }, { onError: e => setError(outreachError(e)) }); }} />
    <label className={`flex items-start gap-3 rounded-lg border p-3 ${context.hold ? "border-amber-400/60 bg-amber-500/10" : ""}`}>
      <input type="checkbox" className="mt-1" checked={context.hold} disabled={!canEdit || busy} onChange={(e) => { setError(""); settings.mutate({ hold: e.target.checked }, { onError: (err) => setError(outreachError(err)) }); }} />
      <span className="text-sm font-medium">Hold outreach across all campaigns<span className="mt-1 block text-xs font-normal text-muted-foreground">Blocks new drafts and approval. Existing history is kept.</span></span>
      {context.hold && <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />}
    </label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Contact history · {context.activities.length}</h3>{canEdit && editing === undefined && <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditing(null)}><Plus className="mr-1 h-3.5 w-3.5" />Record activity</Button>}</div>
    {canEdit && editing !== undefined && <ActivityForm key={editing?.id ?? "new"} initial={editing} busy={busy} onCancel={() => setEditing(undefined)} onSave={async (input) => { await activity.mutateAsync({ type: "save", activityId: editing?.id, input }); setEditing(undefined); }} />}
    <OutreachHistory context={context} onEdit={canEdit && !busy ? setEditing : undefined} onDelete={canEdit && !busy ? setDeleting : undefined} />
    <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open && !busy) setDeleting(null); }}><AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>Delete this activity?</AlertDialogTitle><AlertDialogDescription>This removes the activity from this contact’s history in every campaign. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel disabled={busy}>Keep activity</AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={async () => { if (!deleting) return; try { await activity.mutateAsync({ type: "delete", activityId: deleting.id }); setDeleting(null); setError(""); } catch (err) { setError(outreachError(err)); } }}>{busy ? "Deleting…" : "Delete activity"}</Button></AlertDialogFooter>
      {activity.isError && <p role="alert" className="text-sm text-destructive">{outreachError(activity.error)}</p>}
    </AlertDialogContent></AlertDialog>
  </div>;
}
export default function OutreachContactContext({ contact, canEdit, onClose }: { contact: { id: string; name: string } | null; canEdit: boolean; onClose: () => void }) {
  return <Dialog open={!!contact} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{contact?.name} · Outreach context</DialogTitle><DialogDescription>Actual conversations, shared contact settings, and the next appropriate step.</DialogDescription></DialogHeader>{contact && <OutreachContextPanel key={contact.id} prospectId={contact.id} canEdit={canEdit} />}</DialogContent></Dialog>;
}
