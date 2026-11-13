import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getTabMarketId, getTabTenantId } from "@/lib/tabContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CampaignNextStep, CampaignWorkspace } from "@shared/outreach-workspace";

export type { CampaignNextStep } from "@shared/outreach-workspace";
const nextStepsKey = (campaignId: string, scope: string) => ["campaign-next-steps", scope, campaignId, getTabTenantId(), getTabMarketId()] as const;
const summaryKey = (campaignId: string, scope: string) => ["campaign-summary", scope, campaignId] as const;
const actionLabels = { review_draft: "Review draft", review_history: "Review history", research: "Research", compose: "Compose", meeting: "Meeting prep" };
const snapshotCountLabels: Record<string, string> = {
  contacts: "active contacts", pendingDrafts: "pending drafts", sent: "Orbit messages", replied: "replied contacts",
  held: "on hold", overdue: "overdue", worked: "worked", communicated: "communicated contacts",
  externallyContacted: "external contacts", externalCommunications: "external logged communications",
  meetings: "total meetings", bookedMeetings: "booked", agreedMeetings: "agreed · scheduling needed",
};

/** Listen to successes and directory invalidations, including actions in child dialogs. */
export function useCampaignSnapshotInvalidation(campaignId: string, scope: string) {
  const client = useQueryClient();
  useEffect(() => {
    const invalidate = () => {
      void client.invalidateQueries({ queryKey: ["campaign-next-steps", scope, campaignId] });
      void client.invalidateQueries({
        predicate: query => query.queryKey[0] === "/api/sales-outreach/campaigns"
          && query.queryKey.includes(campaignId) && query.queryKey.at(-1) === "performance",
      });
       client.setQueriesData<CampaignWorkspace | null>({ queryKey: ["campaign-summary", scope, campaignId] }, null);
    };
    const unsubscribeMutation = client.getMutationCache().subscribe(event => {
      if (event.type === "updated" && event.action.type === "success"
        && !["generate-campaign-summary", "complete-campaign-next-step"].includes(String(event.mutation.options.mutationKey?.[0]))) invalidate();
    });
    const unsubscribeQuery = client.getQueryCache().subscribe(event => {
      if (event.type !== "updated" || event.action.type !== "invalidate") return;
      const key = event.query.queryKey;
      if (key.at(-1) === "performance") return;
      if (key[0] === "/api/sales-outreach/campaigns" || String(key[0]).includes("/meetings") || String(key[0]).includes("/outreach-context")) invalidate();
    });
    return () => { unsubscribeMutation(); unsubscribeQuery(); };
  }, [client, campaignId, scope]);
}

export function CampaignSummary({ campaignId, scope, canGenerate }: { campaignId: string; scope: string; canGenerate: boolean }) {
  const client = useQueryClient();
  const key = summaryKey(campaignId, scope);
  const { data } = useQuery<CampaignWorkspace>({ queryKey: key, enabled: false });
  const [copyState, setCopyState] = useState("");
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; client.removeQueries({ queryKey: key }); }; }, [client, campaignId, scope]);
  // The parent keys this component by scope: old requests never populate the new scope.
  const generate = useMutation({
    mutationKey: ["generate-campaign-summary", scope, campaignId],
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/sales-outreach/campaigns/${campaignId}/summary`, {});
      return response.json() as Promise<CampaignWorkspace>;
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
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{Object.entries(data.counts).map(([label, count]) => <span key={label}><strong className="text-foreground tabular-nums">{count}</strong> {snapshotCountLabels[label] ?? label}</span>)}</div>
      {!!data.nextSteps.length && <div className="border-t pt-3"><h3 className="mb-2 text-xs font-semibold">Priorities</h3><ul className="space-y-2">{data.nextSteps.map(item => <li key={item.id} className="text-xs"><span className="font-medium">{item.title}</span><span className="text-muted-foreground"> · {item.prospectName}{item.companyName ? ` · ${item.companyName}` : ""}</span></li>)}</ul></div>}
      {!!data.meetings.length && <div className="border-t pt-3"><h3 className="mb-2 text-xs font-semibold">Meetings</h3><ul className="space-y-2 text-xs text-muted-foreground">{data.meetings.map(meeting => <li key={meeting.id}>
        <p>{meeting.contacts.map(contact => `${contact.name}${contact.companyName ? ` · ${contact.companyName}` : ""}`).join(", ")} — {meeting.status === "booked" ? "Booked" : meeting.meetingAt ? "Agreed" : "Agreed · scheduling needed"}</p>
        <p>{meeting.meetingAt ? new Date(meeting.meetingAt).toLocaleString() : "Date and time not set"}{meeting.owner ? ` · ${meeting.owner}` : ""}{meeting.location ? ` · ${meeting.location}` : ""}</p>
      </li>)}</ul></div>}</>}
  </section>;
}

export default function CampaignNextSteps({ campaignId, scope, canEdit, onAction, busy = false }: {
  campaignId: string; scope: string; canEdit: boolean; onAction: (item: CampaignNextStep) => void; busy?: boolean;
}) {
  const client = useQueryClient();
  const [completionError, setCompletionError] = useState<{ scope: string; campaignId: string; itemId: string; message: string } | null>(null);
  const activeIdentity = useRef({ scope, campaignId });
  activeIdentity.current = { scope, campaignId };
  const query = useQuery<CampaignWorkspace>({
    queryKey: nextStepsKey(campaignId, scope),
    queryFn: async () => (await apiRequest("GET", `/api/sales-outreach/campaigns/${campaignId}/next-steps`)).json(),
  });
  const completion = useMutation({
    mutationKey: ["complete-campaign-next-step", scope, campaignId],
    mutationFn: async (variables: { scope: string; campaignId: string; item: CampaignNextStep; completed: boolean; queryKey: readonly unknown[] }) => {
      await apiRequest("PATCH", `/api/sales-outreach/campaigns/${variables.campaignId}/next-steps/completion`, {
        prospectId: variables.item.prospectId, itemId: variables.item.id, version: variables.item.version, completed: variables.completed,
      });
    },
    onSuccess: async (_result, variables) => {
      setCompletionError(null);
      await client.invalidateQueries({ queryKey: variables.queryKey });
      client.setQueriesData<CampaignWorkspace | null>({ queryKey: ["campaign-summary", variables.scope, variables.campaignId] }, null);
    },
    onError: (error, variables) => {
      if (activeIdentity.current.scope === variables.scope && activeIdentity.current.campaignId === variables.campaignId) {
        setCompletionError({ scope: variables.scope, campaignId: variables.campaignId, itemId: variables.item.id, message: error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : "Try again." });
      }
    },
  });
  const completedIds = new Set((query.data?.completedItems ?? []).map(item => item.id));
  const completedItems = query.data?.completedItems ?? [];
  const markDone = (item: CampaignNextStep, completed: boolean) => {
    setCompletionError(null);
    completion.mutate({ scope, campaignId, item, completed, queryKey: nextStepsKey(campaignId, scope) });
  };
  return <section className="space-y-4 rounded-lg border p-4" aria-label="Campaign next steps">
    <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">Next steps</h2><p className="text-sm text-muted-foreground">Prioritized for review. Every outbound message still needs your approval.</p>{query.data && <time className="text-xs text-muted-foreground" dateTime={query.data.generatedAt}>Updated {new Date(query.data.generatedAt).toLocaleString()}</time>}</div><Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className="mr-1 h-3 w-3" />Refresh</Button></div>
    {query.isLoading ? <div className="space-y-3 animate-pulse" aria-label="Loading next steps">{[1, 2, 3].map(i => <div key={i} className="h-16 rounded bg-muted" />)}</div>
      : query.isError ? <div role="alert" className="rounded-md border border-destructive/30 p-4 text-sm">Next steps could not be loaded.<Button variant="link" size="sm" onClick={() => void query.refetch()}>Retry</Button></div>
       : !query.data?.items.length ? <div className="rounded-md border border-dashed bg-muted/20 px-4 py-8 text-center"><p className="text-sm font-medium">No next steps right now</p><p className="mt-1 text-xs text-muted-foreground">Add contacts or update campaign activity, then refresh to review what needs attention.</p></div>
       : <ul className="divide-y">{query.data.items.map(item => <li key={item.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1"><div className="flex flex-wrap items-center gap-2"><Badge variant={item.priority === "urgent" ? "destructive" : "outline"} className="text-[10px] capitalize">{item.priority}</Badge><h3 className="text-sm font-medium">{item.title}</h3></div><p className="text-xs">{item.prospectName}{item.companyName ? ` · ${item.companyName}` : ""}</p><p className="text-xs text-muted-foreground">{item.reason}</p>{item.dueAt && <time className="text-xs text-muted-foreground" dateTime={item.dueAt}>Due {new Date(item.dueAt).toLocaleString()}</time>}</div>
         <div className="flex shrink-0 flex-wrap gap-2 self-start sm:self-center">
           <Button size="sm" variant="outline" disabled={busy || (!canEdit && item.action !== "review_history" && item.action !== "meeting")} onClick={() => onAction(item)}>{actionLabels[item.action]}</Button>
           {!completedIds.has(item.id) && <Button size="sm" variant="ghost" disabled={!canEdit || completion.isPending} aria-label={`Mark done: ${item.title}`} onClick={() => markDone(item, true)}>Mark done</Button>}
           {completionError?.scope === scope && completionError.campaignId === campaignId && completionError.itemId === item.id && <span role="alert" className="w-full text-xs text-destructive">Could not update reminder: {completionError.message}</span>}
         </div>
      </li>)}</ul>}
     {completedItems.length > 0 && <details className="rounded-md border bg-muted/20 px-3 py-2">
       <summary className="cursor-pointer text-sm font-medium">Completed ({completedItems.length})</summary>
       <ul className="mt-2 divide-y">{completedItems.map(item => <li key={item.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
         <div><p className="text-sm font-medium">{item.title}</p><p className="text-xs text-muted-foreground">{item.prospectName}{item.companyName ? ` · ${item.companyName}` : ""} · Reminder marked done</p></div>
         <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={!canEdit || completion.isPending} onClick={() => markDone(item, false)}>Undo</Button>
           {completionError?.scope === scope && completionError.campaignId === campaignId && completionError.itemId === item.id && <span role="alert" className="text-xs text-destructive">Could not update reminder: {completionError.message}</span>}
         </div>
       </li>)}</ul>
     </details>}
     <p className="text-xs text-muted-foreground">Mark done changes reminders only. It does not send a message or change outreach holds or meeting status.</p>
     {!canEdit && <p className="text-xs text-muted-foreground">Your role can review contact history and meeting details. Editing outreach is restricted.</p>}
  </section>;
}
