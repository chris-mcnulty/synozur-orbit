import { useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { MessagingGroupSelect, OutreachContextPanel, OutreachHistory } from "./outreach-contact-context";
import { fetchOutreachContext, outreachError, outreachKey, useOutreachActions, useOutreachContext } from "./use-outreach-context";

export class OutreachPreflightCancelled extends Error {}
type Contact = { id: string; name: string };
type Request = { contact: Contact; resolve: (fingerprint: string) => void; reject: (error: Error) => void };
/** Central generation guard: every path, including private clarification recovery, passes here. */
export function useOutreachPreflight(scope: string) {
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef<Request | null>(null);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => () => {
    pending.current?.reject(new OutreachPreflightCancelled("Context review closed."));
    pending.current = null;
    setRequest(null);
  }, [scope]);
  async function confirm(contact: Contact, suppliedFingerprint?: string): Promise<string> {
    const requestScope = currentScope.current;
    // Retries may reuse an acknowledged snapshot, but only after checking it is current.
    if (suppliedFingerprint) {
      const context = await fetchOutreachContext(contact.id);
      if (requestScope !== currentScope.current) throw new OutreachPreflightCancelled();
      if (context.fingerprint === suppliedFingerprint && !context.hold) return suppliedFingerprint;
    }
    return new Promise((resolve, reject) => {
      if (requestScope !== currentScope.current) { reject(new OutreachPreflightCancelled()); return; }
      pending.current?.reject(new OutreachPreflightCancelled());
      const next = { contact, resolve, reject };
      pending.current = next;
      setRequest(next);
    });
  }
  function close() {
    pending.current?.reject(new OutreachPreflightCancelled("Context review cancelled."));
    pending.current = null; setRequest(null);
  }
  return {
    confirm,
    dialog: (canEdit: boolean) => <Dialog open={!!request} onOpenChange={(open) => { if (!open) close(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Before drafting for {request?.contact.name}</DialogTitle><DialogDescription>Review the relationship, not just the campaign. Nothing is sent by this step.</DialogDescription></DialogHeader>{request && <PreflightBody key={request.contact.id} contact={request.contact} canEdit={canEdit} onCancel={close} onConfirm={(fingerprint) => { request.resolve(fingerprint); pending.current = null; setRequest(null); }} />}</DialogContent></Dialog>,
  };
}
function PreflightBody({ contact, canEdit, onConfirm, onCancel }: { contact: Contact; canEdit: boolean; onConfirm: (fingerprint: string) => void; onCancel: () => void }) {
  const query = useOutreachContext(contact.id);
  const { settings } = useOutreachActions(contact.id);
  const qc = useQueryClient();
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const context = query.data;
  const acknowledgedCurrent = !!context && acknowledged === context.fingerprint;
  const groupBrief = context?.briefs.find((brief) => brief.group === context.messagingGroup);
  if (query.isLoading) return <div aria-label="Loading outreach context" className="space-y-3"><div className="h-16 animate-pulse rounded bg-muted" /><div className="h-40 animate-pulse rounded bg-muted" /></div>;
  if (query.isError || !context) return <div role="alert" className="space-y-3"><p className="text-sm">Outreach context is unavailable. Drafting is paused until it can be checked.</p><Button variant="outline" onClick={() => query.refetch()}>Retry context</Button></div>;
  return <div className="space-y-4">
    <p className="text-xs leading-relaxed text-muted-foreground">History and outreach hold apply to this contact across campaigns. Follow-up dates are reminders only, never automatic sends.</p>
    {context.hold && <div role="alert" className="flex gap-2 rounded-lg border border-amber-400/60 bg-amber-500/10 p-3 text-sm"><ShieldAlert className="h-5 w-5 shrink-0" /><p><strong>Outreach is on hold.</strong> Drafting and approval are blocked in every campaign. An editor must release the hold before continuing.</p></div>}
    {context.recentActivity && <div role="status" className="rounded-lg border border-amber-400/60 bg-amber-500/10 p-3 text-sm"><strong>Recent outreach recorded.</strong> Check what was said and any reply before deciding whether another message is appropriate.</div>}
    <MessagingGroupSelect value={context.messagingGroup} disabled={!canEdit || settings.isPending || busy} onChange={(messagingGroup) => { setAcknowledged(null); setError(""); settings.mutate({ messagingGroup }, { onError: (e) => setError(outreachError(e)) }); }} />
    {groupBrief && <details className="rounded-lg border bg-muted/20 p-3"><summary className="cursor-pointer text-sm font-medium">Assigned group’s campaign brief</summary><dl className="mt-3 space-y-2">{(["goal", "guidance", "ask", "exclusions"] as const).map((field) => <div key={field}><dt className="text-xs font-medium capitalize text-muted-foreground">{field}</dt><dd className="whitespace-pre-wrap break-words text-sm">{groupBrief[field] || "Not specified"}</dd></div>)}</dl></details>}
    {!context.messagingGroup && <p className="text-xs text-muted-foreground">This draft will use the shared campaign brief, without group-specific guidance.</p>}
    <h3 className="text-sm font-semibold">Global contact history</h3>
    {expanded ? <OutreachContextPanel prospectId={contact.id} canEdit={canEdit} /> : <OutreachHistory context={context} />}
    <Button size="sm" variant="outline" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Collapse history settings" : "Manage history & hold"}</Button>
    {context.activities.length > 0 && <label className="flex items-start gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" className="mt-1" checked={acknowledgedCurrent} onChange={(e) => setAcknowledged(e.target.checked ? context.fingerprint : null)} /><span>I reviewed this contact’s history and replies. Another draft is appropriate.</span></label>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button><Button disabled={busy || query.isFetching || settings.isPending || context.hold || (context.activities.length > 0 && !acknowledgedCurrent)} onClick={async () => {
      setBusy(true); setError("");
      try {
        const latest = await fetchOutreachContext(contact.id);
        qc.setQueryData(outreachKey(contact.id), latest);
        if (latest.fingerprint !== context.fingerprint || latest.hold) { setAcknowledged(null); setError("Contact context changed. Review the latest context before drafting."); return; }
        onConfirm(latest.fingerprint);
      } catch (e) { setError(outreachError(e)); } finally { setBusy(false); }
    }}>{busy ? "Checking context…" : "Confirm & generate draft"}</Button></div>
  </div>;
}
