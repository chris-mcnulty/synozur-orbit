import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getTabMarketId, getTabTenantId } from "@/lib/tabContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface CampaignNextStep {
  id: string; prospectId: string; prospectName: string; companyName: string | null;
  priority: "urgent" | "high" | "normal"; title: string; reason: string;
  action: "review_draft" | "review_history" | "research" | "compose" | "meeting";
  touchId?: string; dueAt?: string | null;
}
interface NextSteps { generatedAt: string; items: CampaignNextStep[] }
interface Summary {
  generatedAt: string; summary: string;
  counts: { contacts: number; pendingDrafts: number; sent: number; replied: number; held: number; overdue: number };
  nextSteps: CampaignNextStep[];
}
const actionLabels = { review_draft: "Review draft", review_history: "Review history", research: "Research", compose: "Compose", meeting: "Meeting prep" };

/** Listen to successes and directory invalidations, including actions in child dialogs. */
export function useCampaignSnapshotInvalidation(campaignId: string, scope: string) {
  const client = useQueryClient();
  useEffect(() => {
    const invalidate = () => {
      void client.invalidateQueries({ queryKey: ["campaign-next-steps", scope, campaignId] });
      client.setQueriesData<Summary | null>({ queryKey: ["campaign-summary", scope, campaignId] }, null);
    };
    const unsubscribeMutation = client.getMutationCache().subscribe(event => {
      if (event.type === "updated" && event.action.type === "success" && event.mutation.options.mutationKey?.[0] !== "generate-campaign-summary") invalidate();
    });
    const unsubscribeQuery = client.getQueryCache().subscribe(event => {
      if (event.type !== "updated" || event.action.type !== "invalidate") return;
      const key = event.query.queryKey;
      if (key[0] === "/api/sales-outreach/campaigns" || String(key[0]).includes("/meetings") || String(key[0]).includes("/outreach-context")) invalidate();
    });
    return () => { unsubscribeMutation(); unsubscribeQuery(); };
  }, [client, campaignId, scope]);
}

export function CampaignSummary({ campaignId, scope, canGenerate }: { campaignId: string; scope: string; canGenerate: boolean }) {
  const client = useQueryClient();
  const key = ["campaign-summary", scope, campaignId];
  const { data } = useQuery<Summary>({ queryKey: key, enabled: false });
  const [copyState, setCopyState] = useState("");
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; client.removeQueries({ queryKey: key }); }; }, [client, campaignId, scope]);
  // The parent keys this component by scope: old requests never populate the new scope.
  const generate = useMutation({
    mutationKey: ["generate-campaign-summary", scope, campaignId],
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/sales-outreach/campaigns/${campaignId}/summary`, {});
      return response.json() as Promise<Summary>;
    },
    onSuccess: summary => { if (active.current) { client.setQueryData(key, summary); setCopyState(""); } },
  });
  return <section className="space-y-3 rounded-lg border bg-muted/20 p-4" aria-label="Campaign summary">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-sm font-semibold">Campaign snapshot</h2><p className="text-xs text-muted-foreground">Current campaign facts, not an AI-generated report. Nothing is sent.</p></div>
      <Button size="sm" variant="outline" disabled={!canGenerate || generate.isPending} onClick={() => generate.mutate()}>{generate.isPending ? "Generating summary…" : data ? "Regenerate summary" : "Generate campaign summary"}</Button>
    </div>
    {generate.isPending && <div className="space-y-2 animate-pulse" aria-label="Loading summary"><div className="h-3 w-4/5 rounded bg-muted" /><div className="h-3 w-3/5 rounded bg-muted" /></div>}
    {generate.isError && <p role="alert" className="text-sm text-destructive">Could not generate the summary. Use the generate control to retry.</p>}
    {data && !generate.isPending && <><div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><time dateTime={data.generatedAt}>{new Date(data.generatedAt).toLocaleString()}</time><Button size="sm" variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(data.summary); setCopyState("Copied summary"); } catch { setCopyState("Could not copy. Select the summary text to copy manually."); } }}><Copy className="mr-1 h-3 w-3" />Copy summary</Button><span role="status">{copyState}</span></div><p className="whitespace-pre-wrap text-sm leading-relaxed">{data.summary}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{Object.entries(data.counts).map(([label, count]) => <span key={label}><strong className="text-foreground tabular-nums">{count}</strong> {label === "pendingDrafts" ? "pending drafts" : label}</span>)}</div></>}
  </section>;
}

export default function CampaignNextSteps({ campaignId, scope, canEdit, onAction, busy = false }: {
  campaignId: string; scope: string; canEdit: boolean; onAction: (item: CampaignNextStep) => void; busy?: boolean;
}) {
  const query = useQuery<NextSteps>({
    queryKey: ["campaign-next-steps", scope, campaignId, getTabTenantId(), getTabMarketId()],
    queryFn: async () => (await apiRequest("GET", `/api/sales-outreach/campaigns/${campaignId}/next-steps`)).json(),
  });
  return <section className="space-y-4 rounded-lg border p-4" aria-label="Campaign next steps">
    <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">Next steps</h2><p className="text-sm text-muted-foreground">Prioritized for review. Every outbound message still needs your approval.</p>{query.data && <time className="text-xs text-muted-foreground" dateTime={query.data.generatedAt}>Updated {new Date(query.data.generatedAt).toLocaleString()}</time>}</div><Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className="mr-1 h-3 w-3" />Refresh</Button></div>
    {query.isLoading ? <div className="space-y-3 animate-pulse" aria-label="Loading next steps">{[1, 2, 3].map(i => <div key={i} className="h-16 rounded bg-muted" />)}</div>
      : query.isError ? <div role="alert" className="rounded-md border border-destructive/30 p-4 text-sm">Next steps could not be loaded.<Button variant="link" size="sm" onClick={() => void query.refetch()}>Retry</Button></div>
      : !query.data?.items.length ? <div className="rounded-md border border-dashed bg-muted/20 px-4 py-8 text-center"><p className="text-sm font-medium">No next steps right now</p><p className="mt-1 text-xs text-muted-foreground">Add contacts or update campaign activity, then refresh to review what needs attention.</p></div>
      : <ul className="divide-y">{query.data.items.map(item => <li key={item.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1"><div className="flex flex-wrap items-center gap-2"><Badge variant={item.priority === "urgent" ? "destructive" : "outline"} className="text-[10px] capitalize">{item.priority}</Badge><h3 className="text-sm font-medium">{item.title}</h3></div><p className="text-xs">{item.prospectName}{item.companyName ? ` · ${item.companyName}` : ""}</p><p className="text-xs text-muted-foreground">{item.reason}</p>{item.dueAt && <time className="text-xs text-muted-foreground" dateTime={item.dueAt}>Due {new Date(item.dueAt).toLocaleString()}</time>}</div>
        <Button className="shrink-0 self-start sm:self-center" size="sm" variant="outline" disabled={busy || (!canEdit && item.action !== "review_history" && item.action !== "meeting")} onClick={() => onAction(item)}>{actionLabels[item.action]}</Button>
      </li>)}</ul>}
    {!canEdit && <p className="text-xs text-muted-foreground">Your role can review contact history and meeting details. Editing outreach is restricted.</p>}
  </section>;
}
