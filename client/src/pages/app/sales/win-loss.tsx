import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine, BarChart3, Database, Plus, ShieldCheck, Sparkles, Trash2, X,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { PageFeatureGate } from "@/components/UpgradePrompt";
import { useUser } from "@/lib/userContext";
import { apiRequest } from "@/lib/queryClient";
import { getTabMarketId, getTabTenantId, getTabContextSnapshot, subscribeTabContext } from "@/lib/tabContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { OUTCOMES, REASON_CODES, type OutcomeInput, type OutcomeRecord } from "@shared/win-loss";
import { EvidenceSection } from "./win-loss-evidence";
import { HubSpotReview } from "./win-loss-hubspot";
import {
  apiJson, BASE, dateLabel, EMPTY_INPUT, EmptyState, ErrorBanner,
  Field, money, OutcomeBadge, outcomeLabel, postJson, REASON_LABELS,
  type DataSet, type FilterState, type Summary, useOutcomeScopeGuard,
} from "./win-loss-shared";
import { competitors } from "@shared/schema";

function paramsFor(filters: FilterState) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  return params.toString();
}

export default function WinLossPage() {
  const contextKey = useSyncExternalStore(subscribeTabContext, getTabContextSnapshot, getTabContextSnapshot);
  return <AppLayout><WinLossWorkspace key={contextKey} /></AppLayout>;
}

function WinLossWorkspace() {
  const { user } = useUser();
  const assertScope = useOutcomeScopeGuard();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<FilterState>({ from: "", to: "", outcome: "", segment: "", competitorId: "", currency: "" });
  const qs = useMemo(() => paramsFor(filters), [filters]);
  const context = [getTabMarketId(), getTabTenantId()];
  const { data, isLoading, isError, error, refetch } = useQuery<DataSet>({
    queryKey: [BASE, ...context, qs],
    queryFn: () => { assertScope(); return apiJson<DataSet>(`${BASE}${qs ? `?${qs}` : ""}`); },
  });
  const summaryQuery = useQuery<Summary>({
    queryKey: [`${BASE}/summary`, ...context, qs],
    queryFn: () => { assertScope(); return apiJson<Summary>(`${BASE}/summary${qs ? `?${qs}` : ""}`); },
  });
  const canEdit = !!data?.canEdit && ["Analyst", "Domain Admin", "Global Admin"].includes(user?.role ?? "");
  const [section, setSection] = useState<"outcomes" | "analytics" | "hubspot" | "evidence">("outcomes");
  const [editor, setEditor] = useState<OutcomeRecord | null | "new">(null);
  const [inspected, setInspected] = useState<{ record: OutcomeRecord; snapshotOnly: boolean } | null>(null);
  const [notice, setNotice] = useState("");
  const records = data?.records ?? [];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [BASE, ...context] });
  const save = useMutation({
    mutationFn: async ({ input, record }: { input: OutcomeInput; record: OutcomeRecord | null }) => {
      assertScope();
      if (!record) return postJson<OutcomeRecord>(BASE, input);
      const response = await apiRequest("PATCH", `${BASE}/${encodeURIComponent(record.id)}`, { data: input, version: record.version });
      return await response.json() as OutcomeRecord;
    },
    onSuccess: () => { setEditor(null); setNotice("Outcome saved."); invalidate(); queryClient.invalidateQueries({ queryKey: [`${BASE}/summary`, ...context] }); },
  });
  const remove = useMutation({
    mutationFn: async ({ record, confirmLabel }: { record: OutcomeRecord; confirmLabel: string }) => {
      assertScope();
      await apiRequest("DELETE", `${BASE}/${encodeURIComponent(record.id)}`, { version: record.version, confirmLabel });
    },
    onSuccess: () => { setInspected(null); setNotice("Outcome deleted."); invalidate(); queryClient.invalidateQueries({ queryKey: [`${BASE}/summary`, ...context] }); },
  });
  const setFilter = (key: keyof FilterState, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const inspect = (record: OutcomeRecord, snapshotOnly = false) => setInspected({ record, snapshotOnly });

  return <div className="mx-auto max-w-7xl space-y-6 pb-10" data-testid="page-sales-win-loss">
    <header className="relative overflow-hidden rounded-2xl border bg-card px-6 py-7 md:px-9 md:py-9">
      <div className="absolute -right-10 -top-20 h-64 w-64 rounded-full border-[38px] border-primary/5" aria-hidden="true" />
      <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary"><BarChart3 className="h-4 w-4" /> Sales intelligence / outcomes</div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Win / loss evidence</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Keep the deal record close to the evidence. Review what changed, where the signal is thin, and what deserves a closer look.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{!canEdit && <Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Read only</Badge>}{canEdit && <Button onClick={() => setEditor("new")}><Plus className="mr-2 h-4 w-4" /> Log outcome</Button>}</div>
      </div>
    </header>
    <nav className="flex gap-1 overflow-x-auto border-b" aria-label="Win-loss views">
      {([["outcomes", "Outcome log", Database], ["analytics", "Analytics", BarChart3], ["hubspot", "HubSpot review", ArrowDownToLine], ["evidence", "AI evidence", Sparkles]] as const).map(([id, label, Icon]) => (
        <button key={id} onClick={() => setSection(id)} className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${section === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`} aria-current={section === id ? "page" : undefined}><Icon className="h-4 w-4" />{label}</button>
      ))}
    </nav>
    {(section === "outcomes" || section === "analytics") && data && <FilterControls records={records} competitors={data.competitors} filters={filters} setFilter={setFilter} />}
    {notice && <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss message"><X className="h-4 w-4" /></button></div>}
    {(save.isError || remove.isError) && <ErrorBanner error={save.error ?? remove.error} onRetry={() => { save.reset(); remove.reset(); }} />}
    {isLoading ? <WorkspaceSkeleton /> : isError ? <ErrorBanner error={error} onRetry={() => refetch()} /> : !data ? null : <>
      {(section === "outcomes" || section === "analytics") && summaryQuery.isError && <ErrorBanner error={summaryQuery.error} onRetry={() => summaryQuery.refetch()} />}
      {section === "outcomes" && <OutcomeSection records={records} competitors={data.competitors} summary={summaryQuery.data} onInspect={(record) => inspect(record)} onEdit={setEditor} canEdit={canEdit} />}
      {section === "analytics" && <AnalyticsSection summary={summaryQuery.data} competitors={data.competitors} />}
      {section === "hubspot" && <PageFeatureGate featureKey="hubspotIntegration" label="HubSpot integration" description="Connect HubSpot to review sales outcomes before importing them into Orbit."><HubSpotReview data={data} canEdit={canEdit} onSaved={invalidate} /></PageFeatureGate>}
      {section === "evidence" && <EvidenceSection data={data} canEdit={canEdit} onInspect={(record) => inspect(record, true)} />}
    </>}
    {editor !== null && <OutcomeEditor record={editor === "new" ? null : editor} competitors={data?.competitors ?? []} pending={save.isPending} error={save.error} onClose={() => { setEditor(null); save.reset(); }} onSave={(input) => save.mutate({ input, record: editor === "new" ? null : editor })} />}
    {inspected && <RecordInspector record={inspected.record} snapshotOnly={inspected.snapshotOnly} competitors={data?.competitors ?? []} canEdit={canEdit} onClose={() => setInspected(null)} onEdit={() => { setEditor(inspected.record); setInspected(null); }} onDelete={(confirmLabel) => remove.mutate({ record: inspected.record, confirmLabel })} deleting={remove.isPending} deleteError={remove.error} />}
  </div>;
}

function OutcomeSection({ records, competitors, summary, onInspect, onEdit, canEdit }: {
  records: OutcomeRecord[]; competitors: DataSet["competitors"]; summary?: Summary; onInspect: (record: OutcomeRecord) => void; onEdit: (record: OutcomeRecord) => void; canEdit: boolean;
}) {
  return <div className="space-y-5">
    <Card><CardHeader className="pb-3">
      <div><CardTitle className="text-base">Decision record</CardTitle><CardDescription className="mt-1">A focused log of closed outcomes. Open Analytics for win rates and evidence coverage.</CardDescription></div>
    </CardHeader><CardContent className="p-0">
      {records.length === 0 ? <EmptyState title="No outcomes match this scope" body="Adjust the filters or log a closed decision to start building a useful evidence base." /> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
        <thead><tr className="border-y bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground"><th className="px-5 py-3">Deal</th><th className="px-4 py-3">Outcome</th><th className="px-4 py-3">Competitor</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Close date</th><th className="px-4 py-3 text-right">Amount</th><th className="px-5 py-3"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{records.map((record) => {
          const competitor = record.competitorId && record.competitorConfirmed ? competitors.find((item) => item.id === record.competitorId)?.name ?? "Competitor" : "Unattributed";
          return <tr key={record.id} className="border-b last:border-0 hover:bg-muted/20">
            <td className="px-5 py-3.5"><button className="text-left font-medium hover:text-primary hover:underline" onClick={() => onInspect(record)}>{record.dealLabel}</button><div className="mt-1 text-xs text-muted-foreground">{record.segment || "Segment not provided"} · {record.source === "hubspot" ? "HubSpot" : "Manual"}</div></td>
            <td className="px-4 py-3.5"><OutcomeBadge outcome={record.outcome} /></td><td className="px-4 py-3.5 text-muted-foreground">{competitor}{record.competitorId && !record.competitorConfirmed && <span className="ml-1 text-amber-700">· unconfirmed</span>}</td>
            <td className="px-4 py-3.5 text-muted-foreground">{record.reasonCodes.length ? record.reasonCodes.map((reason) => REASON_LABELS[reason]).join(", ") : <span className="italic">Not coded</span>}</td><td className="px-4 py-3.5 text-muted-foreground">{dateLabel(record.closeDate)}</td><td className="px-4 py-3.5 text-right tabular-nums">{money(record.amount, record.currency)}</td>
            <td className="px-5 py-3.5 text-right"><button className="rounded px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5" onClick={() => canEdit ? onEdit(record) : onInspect(record)}>{canEdit ? "Edit" : "Inspect"}</button></td>
          </tr>;
        })}</tbody>
      </table></div>}
      {summary?.scope && <div className="border-t px-5 py-3 text-xs text-muted-foreground">Date basis: close date · {summary.scope.undatedExcluded ? "Undated records are excluded from date-scoped analytics." : "Undated records are included."}</div>}
    </CardContent></Card>
  </div>;
}

function FilterControls({ records, competitors, filters, setFilter }: {
  records: OutcomeRecord[]; competitors: DataSet["competitors"]; filters: FilterState; setFilter: (key: keyof FilterState, value: string) => void;
}) {
  const segments = [...new Set([...records.map((record) => record.segment).filter((value): value is string => !!value), filters.segment].filter(Boolean))].sort();
  const currencies = [...new Set([...records.map((record) => record.currency).filter((value): value is string => !!value), filters.currency].filter(Boolean))].sort();
  const hasFilters = Object.values(filters).some(Boolean);
  return <Card><CardContent className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-7">
    <Input aria-label="From date" type="date" value={filters.from} onChange={(event) => setFilter("from", event.target.value)} />
    <Input aria-label="To date" type="date" value={filters.to} onChange={(event) => setFilter("to", event.target.value)} />
    <select aria-label="Outcome" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.outcome} onChange={(event) => setFilter("outcome", event.target.value)}><option value="">All outcomes</option>{OUTCOMES.map((outcome) => <option key={outcome} value={outcome}>{outcomeLabel(outcome)}</option>)}</select>
    <select aria-label="Segment" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.segment} onChange={(event) => setFilter("segment", event.target.value)}><option value="">All segments</option>{segments.map((segment) => <option key={segment} value={segment}>{segment}</option>)}</select>
    <select aria-label="Competitor" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.competitorId} onChange={(event) => setFilter("competitorId", event.target.value)}><option value="">All competitors</option>{competitors.map((competitor) => <option key={competitor.id} value={competitor.id}>{competitor.name}</option>)}</select>
    <select aria-label="Currency" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.currency} onChange={(event) => setFilter("currency", event.target.value)}><option value="">All currencies</option>{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select>
    <Button variant="outline" disabled={!hasFilters} onClick={() => Object.keys(filters).forEach((key) => setFilter(key as keyof FilterState, ""))}>Clear filters</Button>
  </CardContent></Card>;
}

function AnalyticsSection({ summary, competitors }: { summary?: Summary; competitors: DataSet["competitors"] }) {
  if (!summary) return <div className="space-y-4" aria-label="Loading outcome analytics"><div className="h-28 animate-pulse rounded-xl border bg-muted/40" /><div className="h-64 animate-pulse rounded-xl border bg-muted/40" /></div>;
  const range = summary.scope.from || summary.scope.to
    ? `${summary.scope.from ? dateLabel(summary.scope.from) : "Beginning"} — ${summary.scope.to ? dateLabel(summary.scope.to) : "Present"}`
    : "All close dates";
  const coverageItems = [
    ["Missing close date", summary.coverage.missingDate],
    ["Missing amount", summary.coverage.missingAmount],
    ["Missing currency", summary.coverage.missingCurrency],
    ["Missing segment", summary.coverage.missingSegment],
    ["Missing competitor", summary.coverage.missingCompetitor],
    ["Missing reasons", summary.coverage.missingReasons],
  ] as const;
  const competitorName = (id: string) => id === "Unattributed" ? id : competitors.find((competitor) => competitor.id === id)?.name ?? id;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Decision intelligence</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Outcome analytics</h2><p className="mt-1 text-sm text-muted-foreground">Close-date scope: {range}{summary.scope.undatedExcluded ? " · undated records excluded" : ""}</p></div><Badge variant="outline">{summary.total} records in selected scope</Badge></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Win rate" value={summary.winRate == null ? "—" : `${(summary.winRate * 100).toFixed(1)}%`} detail={`${summary.won} wins from ${summary.denominator} decided outcomes`} accent />
      <MetricCard label="Qualified decisions" value={summary.denominator} detail={`${summary.won} won · ${summary.lost} lost`} />
      <MetricCard label="No decision" value={summary.noDecision} detail={`${summary.total} outcomes in selected scope`} />
      <MetricCard label="Records in scope" value={summary.total} detail={range} />
    </div>
    <p className="text-sm text-muted-foreground">Win rate = won / (won + lost). No-decision outcomes are reported separately. Value totals include only records with both an amount and a currency; no currency conversion is performed.</p>
    <Card><CardHeader className="pb-3"><div className="flex flex-wrap items-end justify-between gap-2"><div><CardTitle className="text-base">Evidence coverage</CardTitle><CardDescription className="mt-1">Missing-field counts use all {summary.total} selected records as the denominator.</CardDescription></div><Badge variant="secondary">{summary.total} selected records</Badge></div></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{coverageItems.map(([label, count]) => <div key={label} className="rounded-lg border bg-muted/20 p-4"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{count}<span className="ml-1 text-sm font-normal text-muted-foreground">of {summary.total}</span></p></div>)}</div></CardContent></Card>
    <div className="grid gap-4 lg:grid-cols-2">
      <GroupTable title="By competitor" rows={summary.competitors} nameFor={competitorName} />
      <GroupTable title="By segment" rows={summary.segments} />
      {Object.keys(summary.currencies).length > 0 && <CurrencyTable currencies={summary.currencies} />}
    </div>
  </div>;
}

function MetricCard({ label, value, detail, accent = false }: { label: string; value: string | number; detail: string; accent?: boolean }) {
  return <Card className={accent ? "border-primary/25 bg-primary/[0.035]" : ""}><CardContent className="p-5"><p className="text-xs font-semibold uppercase tracking-[0.13em] text-muted-foreground">{label}</p><div className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</div><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>;
}
function GroupTable({ title, rows, nameFor = (name) => name }: { title: string; rows: Summary["competitors"]; nameFor?: (name: string) => string }) {
  return <Card><CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead><tr className="border-y bg-muted/30 text-xs text-muted-foreground"><th className="px-5 py-2 text-left font-medium">Group</th><th className="px-3 py-2 text-right font-medium">Records</th><th className="px-3 py-2 text-right font-medium">Won</th><th className="px-3 py-2 text-right font-medium">Lost</th><th className="px-3 py-2 text-right font-medium">No decision</th><th className="px-3 py-2 text-right font-medium">Decided</th><th className="px-5 py-2 text-right font-medium">Win rate</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.name} className="border-b last:border-0"><td className="px-5 py-3">{nameFor(row.name)}</td><td className="px-3 py-3 text-right tabular-nums">{row.total}</td><td className="px-3 py-3 text-right tabular-nums">{row.won}</td><td className="px-3 py-3 text-right tabular-nums">{row.lost}</td><td className="px-3 py-3 text-right tabular-nums">{row.noDecision}</td><td className="px-3 py-3 text-right tabular-nums">{row.denominator}</td><td className="px-5 py-3 text-right tabular-nums">{row.winRate == null ? "—" : `${(row.winRate * 100).toFixed(1)}%`}</td></tr>) : <tr><td colSpan={7} className="px-5 py-5 text-sm text-muted-foreground">No grouped outcomes in scope.</td></tr>}</tbody></table></div></CardContent></Card>;
}
function CurrencyTable({ currencies }: { currencies: Summary["currencies"] }) {
  return <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Deal value by currency</CardTitle><CardDescription className="text-xs">Exact totals from outcome records; currencies are not combined.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-y bg-muted/30 text-xs text-muted-foreground"><th className="px-5 py-2 text-left font-medium">Currency</th><th className="px-3 py-2 text-right font-medium">Deals</th><th className="px-3 py-2 text-right font-medium">Won</th><th className="px-3 py-2 text-right font-medium">Lost</th><th className="px-3 py-2 text-right font-medium">No decision</th><th className="px-5 py-2 text-right font-medium">Total</th></tr></thead><tbody>{Object.entries(currencies).map(([currency, values]) => <tr key={currency} className="border-b last:border-0"><td className="px-5 py-3 font-medium">{currency}</td><td className="px-3 py-3 text-right tabular-nums">{values.count}</td><td className="px-3 py-3 text-right tabular-nums">{currency} {values.won}</td><td className="px-3 py-3 text-right tabular-nums">{currency} {values.lost}</td><td className="px-3 py-3 text-right tabular-nums">{currency} {values.noDecision}</td><td className="px-5 py-3 text-right tabular-nums">{currency} {values.total}</td></tr>)}</tbody></table></div></CardContent></Card>;
}

function OutcomeEditor({ record, competitors, pending, error, onClose, onSave }: { record: OutcomeRecord | null; competitors: DataSet["competitors"]; pending: boolean; error: unknown; onClose: () => void; onSave: (value: OutcomeInput) => void }) {
  const [form, setForm] = useState<OutcomeInput>(() => record ? ({ dealLabel: record.dealLabel, outcome: record.outcome, closeDate: record.closeDate, amount: record.amount, currency: record.currency, segment: record.segment, competitorId: record.competitorId, competitorConfirmed: record.competitorConfirmed, reasonCodes: [...record.reasonCodes], notes: record.notes }) : { ...EMPTY_INPUT });
  const change = <K extends keyof OutcomeInput>(key: K, value: OutcomeInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const toggleReason = (reason: OutcomeInput["reasonCodes"][number]) => change("reasonCodes", form.reasonCodes.includes(reason) ? form.reasonCodes.filter((item) => item !== reason) : [...form.reasonCodes, reason].slice(0, 8));
  return <Overlay title={record ? "Edit outcome" : "Log a closed outcome"} eyebrow="Outcome record" onClose={onClose}>
    <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Deal label" className="sm:col-span-2"><Input required maxLength={240} value={form.dealLabel} onChange={(event) => change("dealLabel", event.target.value)} placeholder="For example, Northstar renewal" /></Field>
        <Field label="Outcome"><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.outcome} onChange={(event) => change("outcome", event.target.value as OutcomeInput["outcome"])}>{OUTCOMES.map((outcome) => <option key={outcome} value={outcome}>{outcomeLabel(outcome)}</option>)}</select></Field>
        <Field label="Close date"><Input type="date" value={form.closeDate ?? ""} onChange={(event) => change("closeDate", event.target.value || null)} /></Field>
        <Field label="Amount"><Input inputMode="decimal" value={form.amount ?? ""} onChange={(event) => change("amount", event.target.value || null)} placeholder="Leave blank if unknown" /></Field>
        <Field label="Currency"><Input maxLength={3} value={form.currency ?? ""} onChange={(event) => change("currency", event.target.value.toUpperCase() || null)} placeholder="USD" /></Field>
        <Field label="Segment"><Input maxLength={160} value={form.segment ?? ""} onChange={(event) => change("segment", event.target.value || null)} placeholder="Enterprise, mid-market…" /></Field>
        <Field label="Competitor"><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.competitorId ?? ""} onChange={(event) => { change("competitorId", event.target.value || null); change("competitorConfirmed", false); }}><option value="">Not attributed</option>{competitors.map((competitor) => <option key={competitor.id} value={competitor.id}>{competitor.name}</option>)}</select></Field>
        {form.competitorId && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.competitorConfirmed} onChange={(event) => change("competitorConfirmed", event.target.checked)} className="h-4 w-4 accent-primary" />I confirm this competitor attribution from the deal evidence.</label>}
      </div>
      <fieldset><legend className="mb-2 text-sm font-medium">Reason codes</legend><div className="flex flex-wrap gap-2">{REASON_CODES.map((reason) => <button type="button" key={reason} onClick={() => toggleReason(reason)} aria-pressed={form.reasonCodes.includes(reason)} className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${form.reasonCodes.includes(reason) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}>{REASON_LABELS[reason]}</button>)}</div></fieldset>
      <Field label="Notes"><Textarea maxLength={10000} rows={4} value={form.notes} onChange={(event) => change("notes", event.target.value)} placeholder="What did the buyer say? Capture direct evidence where possible." /></Field>
      {error != null && <ErrorBanner error={error} onRetry={() => onSave(form)} />}
      <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending || !form.dealLabel.trim() || (!!form.competitorId && !form.competitorConfirmed)}>{pending ? "Saving…" : "Save outcome"}</Button></div>
    </form>
  </Overlay>;
}

function RecordInspector({ record, snapshotOnly, competitors, canEdit, onClose, onEdit, onDelete, deleting, deleteError }: { record: OutcomeRecord; snapshotOnly: boolean; competitors: DataSet["competitors"]; canEdit: boolean; onClose: () => void; onEdit: () => void; onDelete: (label: string) => void; deleting: boolean; deleteError: unknown }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLabel, setConfirmLabel] = useState("");
  const canMutate = canEdit && !snapshotOnly;
  const competitorName = competitors.find((competitor) => competitor.id === record.competitorId)?.name ?? "Not attributed";
  return <Overlay title={record.dealLabel} eyebrow={snapshotOnly ? "Retained evidence snapshot" : "Evidence record"} onClose={onClose} wide>
    <div className="grid gap-6 md:grid-cols-[1fr_0.8fr]">
      <div className="space-y-5"><div className="flex flex-wrap gap-2"><OutcomeBadge outcome={record.outcome} /><Badge variant="outline">{record.source === "hubspot" ? "HubSpot import" : "Manual entry"}</Badge>{record.competitorConfirmed && record.competitorId && <Badge variant="outline">Competitor confirmed</Badge>}{snapshotOnly && <Badge variant="secondary">Historical snapshot</Badge>}</div>
        <div className="grid grid-cols-2 gap-4 rounded-xl border bg-muted/20 p-4 text-sm"><DataValue label="Close date" value={dateLabel(record.closeDate)} /><DataValue label="Deal amount" value={money(record.amount, record.currency)} /><DataValue label="Segment" value={record.segment ?? "Not provided"} /><DataValue label="Competitor" value={competitorName} /><DataValue label="Reason codes" value={record.reasonCodes.length ? record.reasonCodes.map((reason) => REASON_LABELS[reason]).join(", ") : "Not coded"} /><DataValue label="Record version" value={`v${record.version}`} /></div>
        <div><h3 className="mb-2 text-sm font-semibold">Deal notes</h3><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{record.notes || "No notes were captured."}</p></div>
        <div className="text-xs text-muted-foreground">Created {new Date(record.createdAt).toLocaleString()} · Updated {new Date(record.updatedAt).toLocaleString()}{record.externalId ? ` · Source ID ${record.externalId}` : ""}</div>
      </div>
      <div><h3 className="mb-2 text-sm font-semibold">Source snapshot</h3><p className="mb-3 text-xs text-muted-foreground">Retained source evidence at the time this outcome was recorded.</p><pre className="max-h-96 overflow-auto rounded-lg border bg-muted/30 p-4 text-xs leading-5">{record.sourceSnapshot == null ? "No source snapshot was retained." : JSON.stringify(record.sourceSnapshot, null, 2)}</pre></div>
    </div>
    {canMutate && deleteError != null && <div className="mt-4"><ErrorBanner error={deleteError} onRetry={() => onDelete(confirmLabel)} /></div>}
    {snapshotOnly && <p className="mt-5 rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">This is a historical evidence snapshot. Editing and deletion are disabled.</p>}
    {canMutate && <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      {!confirmDelete ? <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}><Trash2 className="mr-2 h-4 w-4" />Delete record</Button> : <div className="w-full rounded-lg border border-destructive/30 bg-destructive/5 p-4"><p className="text-sm font-medium">This permanently removes this outcome.</p><p className="mt-1 text-xs text-muted-foreground">Type <strong>{record.dealLabel}</strong> to confirm. Version {record.version} will be checked.</p><div className="mt-3 flex flex-wrap gap-2"><Input className="max-w-sm" value={confirmLabel} onChange={(event) => setConfirmLabel(event.target.value)} aria-label="Type deal label to confirm deletion" /><Button variant="destructive" size="sm" disabled={deleting || confirmLabel !== record.dealLabel} onClick={() => onDelete(confirmLabel)}>{deleting ? "Deleting…" : "Confirm delete"}</Button><Button variant="outline" size="sm" onClick={() => { setConfirmDelete(false); setConfirmLabel(""); }}>Keep record</Button></div></div>}
      {!confirmDelete && <Button onClick={onEdit}>Edit outcome</Button>}
    </div>}
  </Overlay>;
}
function DataValue({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>; }

function Overlay({ title, eyebrow, children, onClose, wide = false }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="fixed inset-0 z-[100] flex items-end justify-center bg-foreground/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-label={title} className={`max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl border bg-background shadow-2xl sm:rounded-2xl ${wide ? "max-w-4xl" : "max-w-2xl"}`}><header className="sticky top-0 z-10 flex items-start justify-between border-b bg-background/95 px-5 py-4 backdrop-blur sm:px-7"><div>{eyebrow && <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>}<h2 className="mt-1 text-xl font-semibold">{title}</h2></div><button onClick={onClose} aria-label="Close dialog" className="rounded-md p-2 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button></header><div className="p-5 sm:p-7">{children}</div></section></div>;
}
function WorkspaceSkeleton() {
  return <div className="space-y-4 animate-pulse" aria-label="Loading win-loss workspace"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-28 rounded-xl border bg-muted/40" />)}</div><div className="h-80 rounded-xl border bg-muted/40" /></div>;
}
