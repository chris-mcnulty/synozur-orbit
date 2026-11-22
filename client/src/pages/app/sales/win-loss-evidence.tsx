import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, FileCheck2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageFeatureGate } from "@/components/UpgradePrompt";
import { getTabMarketId, getTabTenantId } from "@/lib/tabContext";
import { type OutcomeRecord } from "@shared/win-loss";
import {
  BASE, dateLabel, EmptyState, ErrorBanner,
  outcomeLabel, postJson, type DataSet, type Review, useOutcomeScopeGuard,
} from "./win-loss-shared";

export function EvidenceSection({ data, canEdit, onInspect }: { data: DataSet; canEdit: boolean; onInspect: (record: OutcomeRecord) => void }) {
  const assertScope = useOutcomeScopeGuard();
  const context = [getTabMarketId(), getTabTenantId()];
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [battlecardId, setBattlecardId] = useState("");
  const [message, setMessage] = useState("");
  const ids = Object.keys(picked).filter((id) => picked[id]);
  const selectedCompetitors = new Set(data.records.filter((record) => ids.includes(record.id) && record.competitorId && record.competitorConfirmed).map((record) => record.competitorId!));
  const eligibleBattlecards = data.battlecards.filter((battlecard) => selectedCompetitors.has(battlecard.competitorId));
  const activeBattlecard = eligibleBattlecards.find((battlecard) => battlecard.id === battlecardId);
  const evidenceIds = activeBattlecard
    ? data.records.filter((record) => ids.includes(record.id) && record.competitorId === activeBattlecard.competitorId && record.competitorConfirmed).map((record) => record.id)
    : ids;
  const generation = useMutation({
    mutationFn: () => {
      assertScope();
      const body: { recordIds: string[]; battlecardId?: string } = { recordIds: evidenceIds };
      if (activeBattlecard) body.battlecardId = activeBattlecard.id;
      return postJson<Review>(`${BASE}/themes`, body);
    },
    onSuccess: () => { setPicked({}); setBattlecardId(""); setMessage("Evidence review generated and saved."); queryClient.invalidateQueries({ queryKey: [BASE, ...context] }); },
  });
  const approval = useMutation({
    mutationFn: (reviewId: string) => { assertScope(); return postJson<{ approved: boolean }>(`${BASE}/reviews/${encodeURIComponent(reviewId)}/approve`, { approve: true }); },
    onSuccess: () => {
      setMessage("Battlecard addition approved.");
      queryClient.invalidateQueries({ queryKey: [BASE, ...context] });
      queryClient.invalidateQueries({ queryKey: ["/api/battlecards"] });
    },
  });
  useEffect(() => {
    setPicked({});
    setBattlecardId("");
    setMessage("");
  }, [context[0], context[1]]);
  useEffect(() => {
    if (battlecardId && !eligibleBattlecards.some((battlecard) => battlecard.id === battlecardId)) setBattlecardId("");
  }, [battlecardId, eligibleBattlecards]);
  const reviews = [...data.reviews].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return <div className="space-y-5">
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <Card><CardHeader><CardTitle className="text-base">Select evidence</CardTitle><CardDescription>Choose up to 100 outcomes. Every generated theme cites source record IDs.</CardDescription></CardHeader><CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2"><span className="text-sm font-medium">{ids.length} selected</span><Button variant="ghost" size="sm" disabled={!canEdit} onClick={() => setPicked(Object.fromEntries(data.records.slice(0, 100).map((record) => [record.id, true])))}>Select first 100</Button></div>
        <div className="max-h-[360px] space-y-1 overflow-auto pr-1">{data.records.length ? data.records.map((record) => <label key={record.id} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/40"><input type="checkbox" disabled={!canEdit || (!picked[record.id] && ids.length >= 100)} checked={!!picked[record.id]} onChange={(e) => setPicked((current) => ({ ...current, [record.id]: e.target.checked }))} className="mt-1 h-4 w-4 accent-primary" /><span className="min-w-0 flex-1"><button type="button" className="text-left text-sm font-medium hover:underline" onClick={(e) => { e.preventDefault(); onInspect(record); }}>{record.dealLabel}</button><span className="block text-xs text-muted-foreground">{outcomeLabel(record.outcome)} · {dateLabel(record.closeDate)} · {record.reasonCodes.length ? record.reasonCodes.join(", ") : "Reason missing"}</span></span></label>) : <EmptyState title="No outcome evidence yet" body="Log outcomes first, then select records for a grounded review." />}</div>
        {eligibleBattlecards.length > 0 ? <PageFeatureGate featureKey="battlecards" label="Sales Battlecards" description="Generate evidence-backed additions for competitive battlecards. Upgrade to unlock this feature.">
          <label className="block space-y-1.5"><span className="text-sm font-medium">Optional: propose a battlecard note addition</span><select disabled={!canEdit} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={battlecardId} onChange={(e) => setBattlecardId(e.target.value)}><option value="">Themes only — no battlecard change</option>{eligibleBattlecards.map((battlecard) => <option key={battlecard.id} value={battlecard.id}>{data.competitors.find((competitor) => competitor.id === battlecard.competitorId)?.name ?? battlecard.competitorId}</option>)}</select><span className="text-xs text-muted-foreground">Only evidence explicitly attributed to the card’s competitor is eligible. Approval is always separate.</span></label>
        </PageFeatureGate> : <p className="text-xs text-muted-foreground">No battlecard matches the explicitly attributed competitors in your selected evidence. Themes can still be generated.</p>}
        {message && <p className="rounded-md bg-primary/5 px-3 py-2 text-sm">{message}</p>}
        {generation.isError && <ErrorBanner error={generation.error} onRetry={() => generation.mutate()} />}
        {activeBattlecard && <p className="text-xs text-muted-foreground">The proposal will be generated from {evidenceIds.length} selected outcome{evidenceIds.length === 1 ? "" : "s"} explicitly attributed to this competitor; other selected outcomes will be left out of this review.</p>}
        <Button disabled={!canEdit || !ids.length || ids.length > 100 || (!!activeBattlecard && evidenceIds.length === 0) || generation.isPending} onClick={() => generation.mutate()}><Sparkles className="mr-2 h-4 w-4" />{generation.isPending ? "Reviewing evidence…" : "Generate evidence review"}</Button>
        {!canEdit && <p className="text-xs text-muted-foreground">Read-only access: persisted reviews remain available, but generation and approval are disabled.</p>}
      </CardContent></Card>
      <div className="space-y-4"><div className="flex items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Saved evidence reviews</h2><p className="text-sm text-muted-foreground">Themes and proposals remain traceable to their retained source snapshots.</p></div><Badge variant="secondary">{reviews.length} reviews</Badge></div>
        {reviews.length ? reviews.map((review) => <ReviewCard key={review.id} review={review} competitors={data.competitors} canEdit={canEdit} onInspect={onInspect} approving={approval.isPending} onApprove={() => approval.mutate(review.id)} error={approval.isError ? approval.error : null} />) : <Card><CardContent className="p-0"><EmptyState title="No saved reviews yet" body="Select a set of outcomes to generate a persisted, cited review." /></CardContent></Card>}
      </div>
    </div>
  </div>;
}

function ReviewCard({ review, competitors, canEdit, onInspect, approving, onApprove, error }: { review: Review; competitors: DataSet["competitors"]; canEdit: boolean; onInspect: (record: OutcomeRecord) => void; approving: boolean; onApprove: () => void; error: unknown }) {
  const payload = review.payload ?? {};
  const proposal = payload.proposal;
  const pending = !!proposal && !review.approvedAt;
  const cardName = competitors.find((competitor) => competitor.id === proposal?.battlecardId)?.name ?? proposal?.battlecardId;
  return <Card><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-sm">{review.kind === "battlecard" ? "Battlecard evidence proposal" : "Outcome themes"}</CardTitle><CardDescription className="mt-1">{new Date(review.createdAt).toLocaleString()} · {payload.scope?.recordIds?.length ?? 0} evidence records</CardDescription></div><Badge variant={review.approvedAt ? "secondary" : "outline"}>{review.approvedAt ? "Approved" : "Pending review"}</Badge></div></CardHeader><CardContent className="space-y-4">
    {(payload.warnings ?? []).length > 0 && <div className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200"><p className="mb-1 font-semibold">Evidence limitations</p><ul className="list-inside list-disc">{payload.warnings.map((warning: string, index: number) => <li key={index}>{warning}</li>)}</ul></div>}
    <div className="space-y-3">{(payload.themes ?? []).map((theme: any, index: number) => <div key={`${theme.title}-${index}`} className="border-l-2 border-primary/40 pl-3"><h3 className="text-sm font-semibold">{theme.title}</h3><p className="mt-1 text-sm leading-5 text-muted-foreground">{theme.summary}</p><div className="mt-2 flex flex-wrap gap-1.5">{(theme.evidenceIds ?? []).map((id: string) => { const record = (payload.evidence ?? []).find((candidate: OutcomeRecord) => candidate.id === id); return record ? <button key={id} onClick={() => onInspect(record)} className="rounded-full border px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/5">{record.dealLabel} · {id}</button> : <Badge key={id} variant="outline" className="text-[10px]">Record {id}</Badge>; })}</div></div>)}</div>
    {(payload.evidence ?? []).length > 0 && <details className="rounded-lg border px-3 py-2"><summary className="cursor-pointer text-xs font-medium">Retained evidence snapshots ({payload.evidence.length}) <ChevronDown className="inline h-3 w-3" /></summary><div className="mt-3 space-y-2">{payload.evidence.map((record: OutcomeRecord) => <button key={record.id} className="block w-full rounded-md bg-muted/30 p-2 text-left hover:bg-muted/60" onClick={() => onInspect(record)}><span className="text-xs font-medium">{record.dealLabel}</span><pre className="mt-1 max-h-20 overflow-hidden text-[10px] text-muted-foreground">{record.sourceSnapshot == null ? "No source snapshot." : JSON.stringify(record.sourceSnapshot)}</pre></button>)}</div></details>}
    {proposal && <div className="rounded-xl border border-primary/20 bg-primary/[0.035] p-4"><div className="flex items-center gap-2 text-sm font-semibold"><FileCheck2 className="h-4 w-4 text-primary" />Proposed addition for {cardName}</div><p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Current custom notes</p><pre className="mt-1 whitespace-pre-wrap rounded-md bg-background/70 p-3 text-xs">{proposal.beforeNotes || "No custom notes currently."}</pre><p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">AI addition · awaiting explicit approval</p><pre className="mt-1 whitespace-pre-wrap rounded-md bg-background/70 p-3 text-xs">{proposal.addition}</pre>{review.approvedAt ? <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5" />Approved {new Date(review.approvedAt).toLocaleString()}{review.approvedBy ? ` by ${review.approvedBy}` : ""}</p> : <div className="mt-3"><Button size="sm" disabled={!canEdit || !pending || approving} onClick={onApprove}><Check className="mr-2 h-3.5 w-3.5" />{approving ? "Approving…" : "Approve addition"}</Button>{!canEdit && <p className="mt-2 text-xs text-muted-foreground">Only an editor can approve this proposal. The server rechecks card and evidence versions.</p>}</div>}</div>}
    {error != null && <ErrorBanner error={error} onRetry={onApprove} />}
  </CardContent></Card>;
}
