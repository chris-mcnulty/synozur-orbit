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
  return <li className="border-l-2 border-[#b7c7ba] pl-3">
    <p className="text-sm leading-relaxed text-[#344b41]">{activity.summary}</p>
    <p className="mt-1 text-[11px] text-slate-500">
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
  return <article className="rounded-xl border border-[#e1e1d7] bg-white/60 p-4">
    <div className="flex items-start gap-3">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 accent-[#315849]"
        aria-label={`Select ${contact.name} for import`}
        checked={selected}
        disabled={disabled}
        onChange={onToggle}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-[#2c443b]">{contact.name}</h3>
            <p className="mt-0.5 text-sm text-slate-600">{[contact.jobTitle, contact.company].filter(Boolean).join(" · ") || "Role or company not listed"}</p>
            <p className="mt-1 break-all text-xs text-slate-500">{contact.email || "No email listed"}{contact.linkedinUrl ? <> · <a className="text-[#315849] underline" href={contact.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn profile</a></> : null}</p>
          </div>
          <Badge variant="outline" className="border-[#d4dfd7] bg-[#e3ece5] text-[#315447]">Fit score {contact.score}</Badge>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {contact.relationships.length ? contact.relationships.map((role) => <Badge key={role} variant="outline" className="border-[#d9ded5] bg-[#f5f4ec] text-[#50665c] capitalize">{role.replaceAll("_", " ")}</Badge>) : <Badge variant="outline">Relationship not classified</Badge>}
          <Badge variant="outline" className="border-[#e2d9c7] bg-[#f8f1e4] text-[#735b31]">Attendance unknown</Badge>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-700"><strong className="text-[#344b41]">Why suggested:</strong> {contact.reasons.length ? contact.reasons.join(" · ") : "No specific reason was returned."}</p>
        <div className="mt-3 grid gap-2 rounded-lg border border-[#e6e5db] bg-[#f8f7f2] p-3 text-xs sm:grid-cols-2">
          <p><strong>CRM owner ID:</strong> {contact.crmOwnerId || "Not listed"}</p>
          <p><strong>Orbit owner IDs:</strong> {contact.ownerUserIds.length ? contact.ownerUserIds.join(", ") : "None returned"}</p>
          <p className="sm:col-span-2"><strong>Campaign overlap:</strong> {contact.relatedCampaigns.length ? contact.relatedCampaigns.join(", ") : "No overlap returned"}</p>
        </div>
        <div className="mt-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#64756d]">Recent relationship activity</h4>
          {contact.activities.length ? <ul className="mt-2 space-y-2">{contact.activities.map((activity) => <ActivityItem key={`${activity.source}-${activity.id}`} activity={activity} />)}</ul> : <p className="mt-1 text-xs leading-relaxed text-slate-600">No recent activity was returned. This is not evidence that no relationship exists.</p>}
        </div>
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
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

  return <Card className="border-[#d9ded5] bg-[#fbfaf5] shadow-none">
    <CardHeader className="pb-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 font-serif text-lg text-[#2c443b]"><Users className="h-4 w-4" />Warm conference shortlist</CardTitle>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600">Find people already connected to your team or campaign. Preview is read-only; nothing enters the campaign until you select and import.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => recommend.mutate()} disabled={!planSaved || recommend.isPending || importSelected.isPending}>
          {recommend.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Finding people…</> : shortlist ? <><RefreshCw className="mr-2 h-4 w-4" />Refresh shortlist</> : "Find warm contacts"}
        </Button>
      </div>
    </CardHeader>
    <CardContent className="space-y-3">
      {!planSaved && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">Save the event plan first. Recommendations use the saved campaign brief and event context.</p>}
      {recommend.isError && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-900"><span className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Could not load warm recommendations: {messageOf(recommend.error)}</span><Button variant="outline" size="sm" onClick={() => recommend.mutate()} disabled={!planSaved || recommend.isPending}>Retry</Button></div>}
      {recommend.isPending && <div aria-live="polite" className="space-y-2 rounded-lg border border-[#e1e1d7] p-4"><div className="h-4 w-48 animate-pulse rounded bg-[#e5e7dd]" /><div className="h-14 animate-pulse rounded bg-[#eeefe8]" /><div className="h-14 animate-pulse rounded bg-[#eeefe8]" /><p className="text-xs text-slate-500">Checking the bounded relationship pool…</p></div>}
      {importSelected.isError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-900">Import failed: {messageOf(importSelected.error)}</p>}
      {importResult && <p role="status" className="rounded-lg border border-[#cbdccf] bg-[#e8f0e8] px-3 py-2.5 text-sm text-[#315849]">Imported {importResult.imported}; skipped {importResult.skipped} existing or ineligible contacts. The shortlist was cleared to avoid stale recommendations.</p>}
      {shortlist && <>
        <div className="rounded-lg border border-[#e1e1d7] bg-[#f5f4ec] px-3 py-2.5 text-xs leading-relaxed text-slate-700">
          <p><strong>{shortlist.contacts.length}</strong> recommendations from a bounded pool of <strong>{shortlist.candidateCount}</strong> candidates · checked {formatDate(shortlist.checkedAt)}.</p>
          <p className="mt-1 font-medium text-amber-900">Fit is a relationship signal, not event attendance. Attendance is unknown for every recommendation; verify it directly before planning.</p>
          <p className="mt-1"><strong>Owner coordination:</strong> Check with CRM and Orbit owners before outreach or meeting assignment to avoid duplicate or conflicting contact.</p>
          {shortlist.limitations.length ? <div className="mt-2 border-t border-[#deded1] pt-2"><strong>Shortlist coverage limits</strong><ul className="mt-1 list-disc space-y-0.5 pl-4">{shortlist.limitations.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div> : <p className="mt-2 border-t border-[#deded1] pt-2">Coverage limits: no additional shortlist-level limits were returned. Results are bounded and may not include every relevant person.</p>}
        </div>
        {shortlist.contacts.length === 0 ? <div className="rounded-xl border border-dashed border-[#d7d9ce] px-4 py-7 text-center"><Users className="mx-auto mb-2 h-5 w-5 text-[#82978b]" /><h3 className="font-serif text-base text-[#33493f]">No warm contacts in this pool</h3><p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-slate-600">No eligible recommendations were returned. The bounded pool or its coverage limitations may explain the empty result; use the reviewed import workflow if you have researched people.</p></div> : <div className="space-y-3">{shortlist.contacts.slice(0, 10).map((contact) => <ContactRow key={contact.hubspotContactId} contact={contact} selected={selectedIds.has(contact.hubspotContactId)} disabled={recommend.isPending || importSelected.isPending || (!selectedIds.has(contact.hubspotContactId) && selectedIds.size >= 10)} onToggle={() => toggleContact(contact.hubspotContactId)} />)}</div>}
        {shortlist.contacts.length > 10 && <p className="text-xs text-amber-900">Only the first 10 recommendations can be selected for import.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => importSelected.mutate()} disabled={!planSaved || !selectedIds.size || importSelected.isPending || recommend.isPending}>
            {importSelected.isPending ? "Importing…" : `Import ${selectedIds.size} selected`}
          </Button>
          <span className="text-xs text-slate-500">{selectedIds.size} of 10 selected · selection is explicit; preview does not import.</span>
        </div>
      </>}
    </CardContent>
  </Card>;
}
