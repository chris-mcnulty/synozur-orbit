import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowUpRight, Loader2, RefreshCw, Users } from "lucide-react";
import type { RelationshipActivity, WarmConferenceContact, WarmConferenceShortlist } from "@shared/conference-meetings";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ImportResult = { imported: number; skipped: number };
const meetingEndpoint = (campaignId: string) => `/api/sales-outreach/campaigns/${campaignId}/meetings`;

function messageOf(error: unknown) {
  return error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : "Something went wrong. Try again.";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function ActivityItem({ activity }: { activity: RelationshipActivity }) {
  return <li className="border-l-2 border-border pl-3">
    <p className="text-sm leading-relaxed text-foreground">{activity.summary}</p>
    <p className="mt-1 text-[11px] text-muted-foreground">
      {formatDate(activity.at)} · {activity.source === "hubspot" ? "HubSpot" : "Orbit"} · {activity.kind}
      {activity.url && <> · <a className="inline-flex items-center gap-0.5 underline" href={activity.url} target="_blank" rel="noreferrer">Source <ArrowUpRight className="h-3 w-3" /></a></>}
    </p>
  </li>;
}

function ContactRow({ contact, selected, disabled, onToggle }: {
  contact: WarmConferenceContact;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return <article className={`rounded-xl border p-4 transition-colors ${selected ? "border-primary/50 bg-primary/10" : "border-border bg-background/60"}`}>
    <div className="flex items-start gap-3">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 accent-primary"
        aria-label={`Select ${contact.name} for import`}
        checked={selected}
        disabled={disabled}
        onChange={onToggle}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground">{contact.name}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">{[contact.jobTitle, contact.company].filter(Boolean).join(" · ") || "Role or company not listed"}</p>
            <p className="mt-1 break-all text-xs text-muted-foreground">{contact.email || "No email listed"}{contact.linkedinUrl ? <> · <a className="text-primary underline" href={contact.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn profile</a></> : null}</p>
          </div>
          <Badge variant="secondary">Fit score {contact.score}</Badge>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {contact.relationships.length ? contact.relationships.map((role) => <Badge key={role} variant="outline" className="capitalize">{role.replaceAll("_", " ")}</Badge>) : <Badge variant="outline">Relationship not classified</Badge>}
          <Badge variant="outline">Attendance unknown</Badge>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-foreground"><strong>Why suggested:</strong> {contact.reasons.length ? contact.reasons.join(" · ") : "No specific reason was returned."}</p>
        <div className="mt-3 grid gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs sm:grid-cols-2">
          <p><strong>CRM owner ID:</strong> {contact.crmOwnerId || "Not listed"}</p>
          <p><strong>Orbit owner IDs:</strong> {contact.ownerUserIds.length ? contact.ownerUserIds.join(", ") : "None returned"}</p>
          <p className="sm:col-span-2"><strong>Campaign overlap:</strong> {contact.relatedCampaigns.length ? contact.relatedCampaigns.join(", ") : "No overlap returned"}</p>
        </div>
        <div className="mt-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recent relationship activity</h4>
          {contact.activities.length ? <ul className="mt-2 space-y-2">{contact.activities.map((activity) => <ActivityItem key={`${activity.source}-${activity.id}`} activity={activity} />)}</ul> : <p className="mt-1 text-xs leading-relaxed text-muted-foreground">No recent activity was returned. This is not evidence that no relationship exists.</p>}
        </div>
        <div className="mt-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <strong>Coverage and limitations:</strong> {contact.limitations.length ? contact.limitations.join(" · ") : "No person-specific limitation was returned; source coverage may still be incomplete."}
        </div>
      </div>
    </div>
  </article>;
}

export default function ConferenceWarmContacts({ campaignId, planSaved }: { campaignId: string; planSaved: boolean }) {
  const queryClient = useQueryClient();
  const [shortlist, setShortlist] = useState<WarmConferenceShortlist | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const shortlistPath = `${meetingEndpoint(campaignId)}/recommendations`;

  const recommend = useMutation({
    mutationFn: async () => (await apiRequest("POST", shortlistPath, {})).json() as Promise<WarmConferenceShortlist>,
    onMutate: () => {
      setShortlist(null);
      setSelectedIds(new Set());
      setImportResult(null);
    },
    onSuccess: (result) => {
      setShortlist(result);
      setSelectedIds(new Set());
      setImportResult(null);
    },
  });
  const importSelected = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${shortlistPath}/import`, { contactIds: Array.from(selectedIds).slice(0, 10) })).json() as Promise<ImportResult>,
    onSuccess: async (result) => {
      setImportResult(result);
      setShortlist(null);
      setSelectedIds(new Set());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [meetingEndpoint(campaignId)] }),
        queryClient.invalidateQueries({ queryKey: ["/api/sales-outreach/campaigns", campaignId, "prospects"] }),
      ]);
    },
  });

  function toggleContact(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 10) next.add(id);
      return next;
    });
  }

  return <Card className="border-border bg-card shadow-none">
    <CardHeader className="pb-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg"><Users className="h-4 w-4" />Warm conference shortlist</CardTitle>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">Find people already connected to your team or campaign. Preview is read-only; nothing enters the campaign until you select and import.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => recommend.mutate()} disabled={!planSaved || recommend.isPending || importSelected.isPending}>
          {recommend.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Finding people…</> : shortlist ? <><RefreshCw className="mr-2 h-4 w-4" />Refresh shortlist</> : "Find warm contacts"}
        </Button>
      </div>
    </CardHeader>
    <CardContent className="space-y-3">
      {!planSaved && <p className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">Save the event plan first. Recommendations use the saved campaign brief and event context.</p>}
      {recommend.isError && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"><span className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Could not load warm recommendations: {messageOf(recommend.error)}</span><Button variant="outline" size="sm" onClick={() => recommend.mutate()} disabled={!planSaved || recommend.isPending}>Retry</Button></div>}
      {recommend.isPending && <div aria-live="polite" className="space-y-2 rounded-lg border border-border p-4"><div className="h-4 w-48 animate-pulse rounded bg-muted" /><div className="h-14 animate-pulse rounded bg-muted/70" /><div className="h-14 animate-pulse rounded bg-muted/70" /><p className="text-xs text-muted-foreground">Checking the bounded relationship pool…</p></div>}
      {importSelected.isError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">Import failed: {messageOf(importSelected.error)}</p>}
      {importResult && <p role="status" className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5 text-sm text-foreground">Imported {importResult.imported}; skipped {importResult.skipped} existing or ineligible contacts. The shortlist was cleared to avoid stale recommendations.</p>}
      {shortlist && <>
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-foreground">
          <p><strong>{shortlist.contacts.length}</strong> recommendations from a bounded pool of <strong>{shortlist.candidateCount}</strong> candidates · checked {formatDate(shortlist.checkedAt)}.</p>
          <p className="mt-1 font-medium text-amber-950 dark:text-amber-100">Fit is a relationship signal, not event attendance. Attendance is unknown for every recommendation; verify it directly before planning.</p>
          <p className="mt-1"><strong>Owner coordination:</strong> Check with CRM and Orbit owners before outreach or meeting assignment to avoid duplicate or conflicting contact.</p>
          {shortlist.limitations.length ? <div className="mt-2 border-t border-border pt-2"><strong>Shortlist coverage limits</strong><ul className="mt-1 list-disc space-y-0.5 pl-4">{shortlist.limitations.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div> : <p className="mt-2 border-t border-border pt-2">Coverage limits: no additional shortlist-level limits were returned. Results are bounded and may not include every relevant person.</p>}
        </div>
        {shortlist.contacts.length === 0 ? <div className="rounded-xl border border-dashed border-border px-4 py-7 text-center"><Users className="mx-auto mb-2 h-5 w-5 text-muted-foreground" /><h3 className="text-base font-semibold text-foreground">No warm contacts in this pool</h3><p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground">No eligible recommendations were returned. The bounded pool or its coverage limitations may explain the empty result; use the reviewed import workflow if you have researched people.</p></div> : <div className="space-y-3">{shortlist.contacts.slice(0, 10).map((contact) => <ContactRow key={contact.hubspotContactId} contact={contact} selected={selectedIds.has(contact.hubspotContactId)} disabled={recommend.isPending || importSelected.isPending || (!selectedIds.has(contact.hubspotContactId) && selectedIds.size >= 10)} onToggle={() => toggleContact(contact.hubspotContactId)} />)}</div>}
        {shortlist.contacts.length > 10 && <p className="text-xs text-amber-950 dark:text-amber-100">Only the first 10 recommendations can be selected for import.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => importSelected.mutate()} disabled={!planSaved || !selectedIds.size || importSelected.isPending || recommend.isPending}>
            {importSelected.isPending ? "Importing…" : `Import ${selectedIds.size} selected`}
          </Button>
          <span className="text-xs text-muted-foreground">{selectedIds.size} of 10 selected · selection is explicit; preview does not import.</span>
        </div>
      </>}
    </CardContent>
  </Card>;
}
