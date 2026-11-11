import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { messagingGroups, messagingGroupLabels, type SegmentBrief } from "@shared/outreach-context";
import { apiRequest } from "@/lib/queryClient";
import { getTabMarketId, getTabTenantId } from "@/lib/tabContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { outreachError } from "./use-outreach-context";

export default function CampaignMessagingBriefs({ campaignId, canEdit }: { campaignId: string; canEdit: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const path = `/api/sales-outreach/campaigns/${encodeURIComponent(campaignId)}/messaging-briefs`;
  const key = [path, getTabTenantId(), getTabMarketId()];
  const query = useQuery<SegmentBrief[]>({ queryKey: key, enabled: expanded, queryFn: async () => (await apiRequest("GET", path)).json() });
  const qc = useQueryClient();
  return <section className="rounded-lg border bg-card" aria-label="Campaign messaging briefs">
    <div className="flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 className="text-sm font-semibold">Messaging by relationship</h2><p className="mt-1 text-xs text-muted-foreground">One campaign. Four explicit groups. Different goals, not generic templates.</p></div><Button size="sm" variant="outline" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Close briefs" : "Messaging briefs"}</Button></div>
    {expanded && <div className="border-t p-4">{query.isLoading ? <div aria-label="Loading messaging briefs" className="h-40 animate-pulse rounded bg-muted" /> : query.isError ? <div role="alert" className="space-y-2 text-sm"><p>Could not load campaign briefs.</p><Button variant="outline" onClick={() => query.refetch()}>Retry briefs</Button></div> : query.data && <BriefEditor key={campaignId} initial={query.data} canEdit={canEdit} path={path} onSaved={(saved) => { qc.setQueryData(key, saved); void qc.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].endsWith("/outreach-context") }); }} />}</div>}
  </section>;
}
function BriefEditor({ initial, canEdit, path, onSaved }: { initial: SegmentBrief[]; canEdit: boolean; path: string; onSaved: (briefs: SegmentBrief[]) => void }) {
  const [briefs, setBriefs] = useState<SegmentBrief[]>(() => messagingGroups.map((group) => initial.find((item) => item.group === group) ?? { group, goal: "", guidance: "", ask: "", exclusions: "" }));
  const [activeGroup, setActiveGroup] = useState<SegmentBrief["group"]>("customer");
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: async (): Promise<SegmentBrief[]> => (await apiRequest("PUT", path, { briefs })).json(),
    onSuccess: (data) => { setBriefs(data); setSaved(true); onSaved(data); },
  });
  const active = briefs.find((brief) => brief.group === activeGroup) ?? { group: activeGroup, goal: "", guidance: "", ask: "", exclusions: "" };
  return <div className="space-y-4">
    <p className="text-xs text-muted-foreground">These briefs belong to this campaign. They apply only when a seller explicitly assigns the contact’s messaging group. Unassigned contacts use the shared campaign brief.</p>
    <label className="block space-y-1 text-xs font-medium">Edit relationship group<select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={activeGroup} onChange={(e) => setActiveGroup(e.target.value as SegmentBrief["group"])}>{messagingGroups.map((group) => <option key={group} value={group}>{messagingGroupLabels[group]}</option>)}</select></label>
    <fieldset disabled={!canEdit || save.isPending} className="grid gap-4 sm:grid-cols-2">
      {(["goal", "guidance", "ask", "exclusions"] as const).map((field) => <label key={field} className={`block space-y-1.5 text-xs font-medium ${field === "guidance" ? "sm:col-span-2" : ""}`}><span>{({ goal: "Goal", guidance: "Messaging guidance", ask: "The ask", exclusions: "Exclusions / what not to say" })[field]}</span><Textarea rows={field === "guidance" ? 4 : 3} maxLength={field === "guidance" ? 6000 : 2000} value={active[field]} onChange={(e) => { setSaved(false); setBriefs((rows) => [...rows.filter((row) => row.group !== activeGroup), { ...active, [field]: e.target.value }]); }} /></label>)}
    </fieldset>
    <div className="flex items-center gap-3">{canEdit && <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save all group briefs"}</Button>}{saved && <p role="status" className="text-xs text-muted-foreground">All group briefs saved.</p>}{!canEdit && <p className="text-xs text-muted-foreground">Read only. An Analyst or administrator can edit these briefs.</p>}</div>
    {save.isError && <p role="alert" className="text-sm text-destructive">{outreachError(save.error)} Your edits are retained; try saving again.</p>}
  </div>;
}
