import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, Clock3, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getTabMarketId, getTabTenantId } from "@/lib/tabContext";
import { OUTCOMES, REASON_CODES, type ImportMapping, type OutcomeInput } from "@shared/win-loss";
import {
  apiJson, BASE, dateLabel, ErrorBanner, Field, money, outcomeLabel,
  PanelLoading, postJson, REASON_LABELS, type DataSet, type Discovery,
  type Preview, type PreviewRow, type Competitor,
  EmptyState,
  useOutcomeScopeGuard,
} from "./win-loss-shared";

function isUnmappedOutcome(row: PreviewRow) {
  return row.warnings.some((warning) => {
    const text = warning.toLowerCase();
    return text.includes("unmapped") && text.includes("outcome");
  });
}

export function HubSpotReview({ data, canEdit, onSaved }: { data: DataSet; canEdit: boolean; onSaved: () => void }) {
  const assertScope = useOutcomeScopeGuard();
  const context = [getTabMarketId(), getTabTenantId()];
  const queryClient = useQueryClient();
  const [mapping, setMapping] = useState<ImportMapping>({ label: "", closeDate: "", amount: "", currency: null, segment: null, competitor: null, reason: null, stages: {}, reasons: {} });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [candidates, setCandidates] = useState<Record<string, OutcomeInput>>({});
  const [competitorChoice, setCompetitorChoice] = useState<Record<string, string>>({});
  const [outcomeChoice, setOutcomeChoice] = useState<Record<string, OutcomeInput["outcome"] | "">>({});
  const [replaceConfirmed, setReplaceConfirmed] = useState<Record<string, boolean>>({});
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const discovery = useQuery<Discovery>({
    queryKey: [`${BASE}/hubspot/discovery`, ...context],
    queryFn: () => { assertScope(); return apiJson<Discovery>(`${BASE}/hubspot/discovery`); },
    enabled: canEdit,
  });
  const previewMutation = useMutation({
    mutationFn: () => { assertScope(); return postJson<Preview>(`${BASE}/hubspot/preview`, mapping); },
    onSuccess: (result) => {
      setPreview(result);
      setSelected({});
      setCandidates(Object.fromEntries(result.rows.map((row) => [row.externalId, row.candidate])));
      setCompetitorChoice({});
      setOutcomeChoice(Object.fromEntries(result.rows.map((row) => [row.externalId, isUnmappedOutcome(row) ? "" : row.candidate.outcome])));
      setReplaceConfirmed({});
      setMessage("");
    },
  });
  const importMutation = useMutation({
    mutationFn: () => { assertScope(); return postJson<{ imported: number }>(`${BASE}/hubspot/import`, {
      reviewId: preview?.id,
      selected: preview?.rows.filter((row) => selected[row.externalId]).map((row) => {
        const unmapped = isUnmappedOutcome(row);
        const outcome = unmapped ? outcomeChoice[row.externalId] : (candidates[row.externalId] ?? row.candidate).outcome;
        const candidate = candidates[row.externalId] ?? row.candidate;
        return {
          externalId: row.externalId,
          data: { ...candidate, outcome: outcome || candidate.outcome, competitorId: competitorChoice[row.externalId] || null, competitorConfirmed: !!competitorChoice[row.externalId] },
          expectedVersion: row.existing?.version ?? null,
          replace: !!replaceConfirmed[row.externalId],
          reviewed: true,
          ...(unmapped && outcome ? { outcomeConfirmed: true } : {}),
        };
      }),
    }); },
    onSuccess: (result) => {
      setMessage(`${result.imported} outcome${result.imported === 1 ? "" : "s"} imported.`);
      setPreview(null);
      setSelected({});
      onSaved();
      queryClient.invalidateQueries({ queryKey: [`${BASE}/summary`, ...context] });
    },
  });
  useEffect(() => {
    setPreview(null);
    setSelected({});
    setCandidates({});
    setCompetitorChoice({});
    setOutcomeChoice({});
    setReplaceConfirmed({});
    setMessage("");
  }, [context[0], context[1]]);
  const setMapField = (key: keyof Omit<ImportMapping, "stages" | "reasons">, value: string) => setMapping((current) => ({ ...current, [key]: value || null }));
  const props = discovery.data?.properties ?? [];
  const properties = (field: keyof Pick<ImportMapping, "label" | "closeDate" | "amount" | "currency" | "segment" | "competitor" | "reason">, required = false) => (
    <label className="space-y-1.5">
      <span className="text-xs font-medium">{field === "label" ? "Deal label" : field === "closeDate" ? "Close date" : field === "amount" ? "Amount" : field === "currency" ? "Currency" : field === "segment" ? "Segment" : field === "competitor" ? "Competitor name" : "Reason"}{required ? " *" : ""}</span>
      <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" required={required} value={mapping[field] ?? ""} onChange={(e) => setMapField(field, e.target.value)}>
        <option value="">Do not map</option>{props.map((property) => <option key={property.name} value={property.name}>{property.label} · {property.name}</option>)}
      </select>
    </label>
  );

  if (!canEdit) return <Card><CardContent className="p-6"><p className="text-sm font-semibold">HubSpot review is unavailable in read-only mode.</p><p className="mt-1 text-sm text-muted-foreground">Discovery, preview, and import require Analyst, Domain Admin, or Global Admin edit access.</p><Link href="/app/settings" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Open Settings <ArrowRight className="h-3.5 w-3.5" /></Link></CardContent></Card>;
  if (discovery.isLoading) return <PanelLoading label="Connecting to HubSpot…" />;
  if (discovery.isError) return <Card><CardContent className="p-6"><ErrorBanner error={discovery.error} onRetry={() => discovery.refetch()} /><p className="mt-3 text-sm text-muted-foreground">Check the HubSpot connection and permissions in <Link href="/app/settings" className="font-medium text-primary underline">Settings</Link>.</p></CardContent></Card>;
  if (!discovery.data) return null;

  const selectedRows = preview?.rows.filter((row) => selected[row.externalId]) ?? [];
  const importableSelection = selectedRows.length > 0 && selectedRows.every((row) => !isUnmappedOutcome(row) || !!outcomeChoice[row.externalId]);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4 text-primary" />Portal {discovery.data.portalId}</p><p className="mt-1 text-sm text-muted-foreground">Map HubSpot fields, preview the complete result set, then select each record to import. Orbit does not write back to HubSpot.</p></div><Link href="/app/settings" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Integration settings <ArrowRight className="h-3.5 w-3.5" /></Link></div>
    {message && <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">{message}</div>}
    <Card><CardHeader><CardTitle className="text-base">1. Map HubSpot fields</CardTitle><CardDescription>Required fields must be mapped. Outcomes are only assigned from closed pipeline stages with an explicit selection below.</CardDescription></CardHeader><CardContent className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{properties("label", true)}{properties("closeDate", true)}{properties("amount", true)}{properties("currency")}{properties("segment")}{properties("competitor")}{properties("reason")}</div>
      <div><p className="mb-2 text-sm font-medium">Closed-stage outcome mapping</p><div className="grid gap-2 sm:grid-cols-2">{discovery.data.pipelines.flatMap((pipeline) => pipeline.stages.filter((stage) => stage.closed).map((stage) => {
        const key = `${pipeline.id}:${stage.id}`;
        return <label key={key} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm"><span className="min-w-0 truncate">{pipeline.label} / {stage.label}</span><select aria-label={`Outcome for ${pipeline.label} ${stage.label}`} className="h-9 rounded-md border bg-background px-2 text-sm" value={mapping.stages[key] ?? ""} onChange={(e) => setMapping((current) => { const stages = { ...current.stages }; if (e.target.value) stages[key] = e.target.value as OutcomeInput["outcome"]; else delete stages[key]; return { ...current, stages }; })}><option value="">Do not map</option>{OUTCOMES.map((outcome) => <option key={outcome} value={outcome}>{outcomeLabel(outcome)}</option>)}</select></label>;
      }))}</div><p className="mt-2 text-xs text-muted-foreground">Open stages are intentionally excluded. Unmapped stages do not imply a loss.</p></div>
      <ReasonMapping discovery={discovery.data} mapping={mapping} setMapping={setMapping} />
      {previewMutation.isError && <ErrorBanner error={previewMutation.error} onRetry={() => previewMutation.mutate()} />}
      <Button disabled={previewMutation.isPending || !mapping.label || !mapping.closeDate || !mapping.amount} onClick={() => previewMutation.mutate()}>{previewMutation.isPending ? "Retrieving every page…" : "Build complete preview"}<ArrowRight className="ml-2 h-4 w-4" /></Button>
    </CardContent></Card>
    {preview && <PreviewPanel preview={preview} candidates={candidates} setCandidates={setCandidates} selected={selected} setSelected={setSelected} competitorChoice={competitorChoice} setCompetitorChoice={setCompetitorChoice} outcomeChoice={outcomeChoice} setOutcomeChoice={setOutcomeChoice} replaceConfirmed={replaceConfirmed} setReplaceConfirmed={setReplaceConfirmed} competitors={data.competitors} editingRow={editingRow} setEditingRow={setEditingRow} canEdit={canEdit} />}
    {preview && <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 p-5"><div><p className="text-sm font-semibold">{Object.values(selected).filter(Boolean).length} selected of {preview.rows.length}</p><p className="mt-1 text-xs text-muted-foreground">Preview expires {new Date(preview.expiresAt).toLocaleString()}. Each selected row must be explicitly reviewed.</p></div><Button disabled={importMutation.isPending || !importableSelection || preview.rows.some((row) => selected[row.externalId] && row.existing && !replaceConfirmed[row.externalId])} onClick={() => importMutation.mutate()}>{importMutation.isPending ? "Importing…" : "Import selected outcomes"}</Button></CardContent>{importMutation.isError && <div className="px-5 pb-5"><ErrorBanner error={importMutation.error} onRetry={() => importMutation.mutate()} /></div>}</Card>}
    {!preview && !previewMutation.isPending && <div className="rounded-lg border border-dashed p-1"><EmptyState title="Review before import" body="A preview retrieves the complete HubSpot result set, shows source fields and existing Orbit records, and leaves selection in your hands." /></div>}
  </div>;
}

function ReasonMapping({ discovery, mapping, setMapping }: { discovery: Discovery; mapping: ImportMapping; setMapping: Dispatch<SetStateAction<ImportMapping>> }) {
  const reasonField = discovery.properties.find((property) => property.name === mapping.reason);
  if (!reasonField?.options.length) return <p className="text-xs text-muted-foreground">Map a reason property with options to assign raw CRM values to Orbit reason codes.</p>;
  return <div><p className="mb-2 text-sm font-medium">Reason value mapping</p><div className="grid gap-2 sm:grid-cols-2">{reasonField.options.map((option) => <label key={option.value} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"><span className="truncate">{option.label}<span className="ml-1 text-xs text-muted-foreground">({option.value})</span></span><select aria-label={`Orbit reason for ${option.label}`} className="h-9 rounded-md border bg-background px-2 text-sm" value={mapping.reasons[option.value] ?? ""} onChange={(e) => setMapping((current) => { const reasons = { ...current.reasons }; if (e.target.value) reasons[option.value] = e.target.value as OutcomeInput["reasonCodes"][number]; else delete reasons[option.value]; return { ...current, reasons }; })}><option value="">Unmapped</option>{REASON_CODES.map((reason) => <option key={reason} value={reason}>{REASON_LABELS[reason]}</option>)}</select></label>)}</div></div>;
}

function PreviewPanel({ preview, candidates, setCandidates, selected, setSelected, competitorChoice, setCompetitorChoice, outcomeChoice, setOutcomeChoice, replaceConfirmed, setReplaceConfirmed, competitors, editingRow, setEditingRow, canEdit }: {
  preview: Preview; candidates: Record<string, OutcomeInput>; setCandidates: Dispatch<SetStateAction<Record<string, OutcomeInput>>>; selected: Record<string, boolean>; setSelected: Dispatch<SetStateAction<Record<string, boolean>>>; competitorChoice: Record<string, string>; setCompetitorChoice: Dispatch<SetStateAction<Record<string, string>>>; outcomeChoice: Record<string, OutcomeInput["outcome"] | "">; setOutcomeChoice: Dispatch<SetStateAction<Record<string, OutcomeInput["outcome"] | "">>>; replaceConfirmed: Record<string, boolean>; setReplaceConfirmed: Dispatch<SetStateAction<Record<string, boolean>>>; competitors: Competitor[]; editingRow: string | null; setEditingRow: (id: string | null) => void; canEdit: boolean;
}) {
  const setRowOutcome = (row: PreviewRow, value: OutcomeInput["outcome"] | "") => {
    setOutcomeChoice((current) => ({ ...current, [row.externalId]: value }));
    if (value) setCandidates((current) => ({ ...current, [row.externalId]: { ...(current[row.externalId] ?? row.candidate), outcome: value } }));
    else setSelected((current) => ({ ...current, [row.externalId]: false }));
  };
  return <Card><CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle className="text-base">2. Preview and review each record</CardTitle><CardDescription>{preview.rows.length} rows returned. Nothing is selected by default.</CardDescription></div><Badge variant="outline"><Clock3 className="mr-1 h-3 w-3" />Expires {new Date(preview.expiresAt).toLocaleTimeString()}</Badge></div></CardHeader><CardContent className="space-y-3">
    {preview.rows.map((row) => {
      const candidate = candidates[row.externalId] ?? row.candidate;
      const unmapped = isUnmappedOutcome(row);
      const chosenOutcome = outcomeChoice[row.externalId] ?? (unmapped ? "" : candidate.outcome);
      const choices = [...new Map([...row.competitorMatches, ...competitors].map((competitor) => [competitor.id, competitor])).values()];
      const chosenCompetitor = competitorChoice[row.externalId] ?? "";
      const currentCandidate = { ...candidate, outcome: chosenOutcome || candidate.outcome, competitorId: chosenCompetitor || null, competitorConfirmed: !!chosenCompetitor };
      const canSelect = canEdit && (!unmapped || !!chosenOutcome);
      const candidateCompetitor = choices.find((competitor) => competitor.id === chosenCompetitor)?.name ?? (chosenCompetitor ? "Unknown competitor" : "Unattributed");
      return <article key={row.externalId} className={`rounded-xl border p-4 ${selected[row.externalId] ? "border-primary/40 bg-primary/[0.025]" : "bg-card"}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <label className="flex items-start gap-3"><input type="checkbox" aria-label={`Select ${candidate.dealLabel}`} disabled={!canSelect} checked={!!selected[row.externalId]} onChange={(e) => setSelected((current) => ({ ...current, [row.externalId]: e.target.checked }))} className="mt-1 h-4 w-4 accent-primary" /><span><strong className="text-sm">{candidate.dealLabel || `HubSpot record ${row.externalId}`}</strong><span className="mt-1 block text-xs text-muted-foreground">ID {row.externalId} · {unmapped ? (chosenOutcome ? outcomeLabel(chosenOutcome) : "Outcome needs confirmation") : outcomeLabel(candidate.outcome)} · {dateLabel(candidate.closeDate)}</span></span></label>
          <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => setEditingRow(editingRow === row.externalId ? null : row.externalId)}>{editingRow === row.externalId ? "Close editor" : "Edit candidate"}</Button><Button variant="ghost" size="sm" onClick={() => setSelected((current) => ({ ...current, [row.externalId]: !current[row.externalId] }))} disabled={!canSelect}>{selected[row.externalId] ? "Remove selection" : "Select row"}</Button></div>
        </div>
        {unmapped && <label className="mt-3 block max-w-sm space-y-1.5"><span className="text-xs font-semibold text-amber-900 dark:text-amber-200">Outcome is unmapped — choose explicitly to review this row</span><select disabled={!canEdit} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={chosenOutcome} onChange={(e) => setRowOutcome(row, e.target.value as OutcomeInput["outcome"] | "")}><option value="">Choose an outcome</option>{OUTCOMES.map((outcome) => <option key={outcome} value={outcome}>{outcomeLabel(outcome)}</option>)}</select></label>}
        {(row.warnings.length > 0 || !candidate.reasonCodes.length) && <div className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"><p className="font-medium">Review flags</p><ul className="mt-1 list-inside list-disc">{row.warnings.map((warning, index) => <li key={index}>{warning}</li>)}{!candidate.reasonCodes.length && <li>No mapped reason. This is not evidence of a loss.</li>}</ul></div>}
        {row.existing && <div className="mt-3 rounded-lg border border-amber-700/20 bg-amber-500/5 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Full correction comparison · existing v{row.existing.version} vs HubSpot candidate</p>
          <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead><tr className="border-b text-muted-foreground"><th className="py-2 pr-3">Field</th><th className="px-3 py-2">Existing Orbit record</th><th className="px-3 py-2">HubSpot candidate</th></tr></thead><tbody>
            <CompareRow label="Deal label" existing={row.existing.dealLabel} candidate={candidate.dealLabel} />
            <CompareRow label="Outcome" existing={outcomeLabel(row.existing.outcome)} candidate={unmapped && !chosenOutcome ? "Not confirmed" : outcomeLabel(chosenOutcome || candidate.outcome)} />
            <CompareRow label="Close date" existing={dateLabel(row.existing.closeDate)} candidate={dateLabel(candidate.closeDate)} />
            <CompareRow label="Amount" existing={money(row.existing.amount, row.existing.currency)} candidate={money(candidate.amount, candidate.currency)} />
            <CompareRow label="Currency" existing={row.existing.currency ?? "Not provided"} candidate={candidate.currency ?? "Not provided"} />
            <CompareRow label="Segment" existing={row.existing.segment ?? "Not provided"} candidate={candidate.segment ?? "Not provided"} />
            <CompareRow label="Competitor attribution" existing={`${competitors.find((competitor) => competitor.id === row.existing?.competitorId)?.name ?? row.existing.competitorId ?? "Unattributed"}${row.existing.competitorConfirmed ? " · confirmed" : " · unconfirmed"}`} candidate={`${candidateCompetitor}${chosenCompetitor ? " · explicitly selected" : " · unattributed"}`} />
            <CompareRow label="Reason codes" existing={row.existing.reasonCodes.length ? row.existing.reasonCodes.map((reason) => REASON_LABELS[reason]).join(", ") : "Not coded"} candidate={candidate.reasonCodes.length ? candidate.reasonCodes.map((reason) => REASON_LABELS[reason]).join(", ") : "Not coded"} />
            <CompareRow label="Notes" existing={row.existing.notes || "No notes"} candidate={candidate.notes || "No notes"} />
          </tbody></table></div>
          <label className="mt-3 flex items-start gap-2 text-xs font-medium"><input type="checkbox" disabled={!canEdit} checked={!!replaceConfirmed[row.externalId]} onChange={(e) => setReplaceConfirmed((current) => ({ ...current, [row.externalId]: e.target.checked }))} className="mt-0.5 accent-primary" />I reviewed the full comparison and authorize replacing the existing record.</label>
        </div>}
        <details className="mt-3 rounded-lg border px-3 py-2"><summary className="cursor-pointer text-xs font-medium">Raw HubSpot source properties</summary><pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted/30 p-3 text-[11px] leading-5">{JSON.stringify(row.raw, null, 2)}</pre></details>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs"><span className="font-medium">Competitor attribution · choose explicitly</span><select disabled={!canEdit} className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={chosenCompetitor} onChange={(e) => setCompetitorChoice((current) => ({ ...current, [row.externalId]: e.target.value }))}><option value="">Leave unattributed</option>{choices.map((competitor) => <option key={competitor.id} value={competitor.id}>{competitor.name}</option>)}</select><span className="block text-muted-foreground">{row.competitorText ? `CRM value: “${row.competitorText}” · No association is auto-confirmed.` : "A competitor is never inferred from a HubSpot association."}</span></label>
          <div className="space-y-1 text-xs"><p className="font-medium">Mapped reason</p><p className="text-sm text-muted-foreground">{candidate.reasonCodes.length ? candidate.reasonCodes.map((reason) => REASON_LABELS[reason]).join(", ") : "Not mapped"}</p>{row.reasonText && <p className="text-muted-foreground">CRM value: “{row.reasonText}”</p>}</div>
        </div>
        {editingRow === row.externalId && <InlineCandidateEditor value={currentCandidate} onChange={(value) => { setCandidates((all) => ({ ...all, [row.externalId]: value })); if (value.competitorId) setCompetitorChoice((all) => ({ ...all, [row.externalId]: value.competitorId! })); }} disableOutcome={unmapped} />}
        {selected[row.externalId] && row.existing && !replaceConfirmed[row.externalId] && <p className="mt-2 text-xs font-medium text-destructive">Explicit replacement confirmation is required before importing this correction.</p>}
      </article>;
    })}
  </CardContent></Card>;
}

function CompareRow({ label, existing, candidate }: { label: string; existing: string; candidate: string }) {
  return <tr className="border-b last:border-0 align-top"><th className="w-36 py-2 pr-3 font-medium text-muted-foreground">{label}</th><td className="max-w-xs whitespace-pre-wrap break-words px-3 py-2">{existing}</td><td className="max-w-xs whitespace-pre-wrap break-words px-3 py-2">{candidate}</td></tr>;
}

function InlineCandidateEditor({ value, onChange, disableOutcome }: { value: OutcomeInput; onChange: (value: OutcomeInput) => void; disableOutcome: boolean }) {
  const set = <K extends keyof OutcomeInput>(key: K, val: OutcomeInput[K]) => onChange({ ...value, [key]: val });
  return <div className="mt-4 grid gap-3 rounded-lg bg-muted/30 p-4 sm:grid-cols-2">
    <Field label="Deal label"><Input value={value.dealLabel} onChange={(e) => set("dealLabel", e.target.value)} /></Field>
    {!disableOutcome && <Field label="Outcome"><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={value.outcome} onChange={(e) => set("outcome", e.target.value as OutcomeInput["outcome"])}>{OUTCOMES.map((outcome) => <option key={outcome} value={outcome}>{outcomeLabel(outcome)}</option>)}</select></Field>}
    <Field label="Close date"><Input type="date" value={value.closeDate ?? ""} onChange={(e) => set("closeDate", e.target.value || null)} /></Field>
    <Field label="Amount"><Input value={value.amount ?? ""} onChange={(e) => set("amount", e.target.value || null)} /></Field>
    <Field label="Currency"><Input value={value.currency ?? ""} onChange={(e) => set("currency", e.target.value.toUpperCase() || null)} /></Field>
    <Field label="Segment"><Input value={value.segment ?? ""} onChange={(e) => set("segment", e.target.value || null)} /></Field>
    <Field label="Notes"><Textarea rows={2} value={value.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
    <Field label="Reason codes"><div className="flex flex-wrap gap-1.5">{REASON_CODES.map((reason) => <button type="button" key={reason} onClick={() => set("reasonCodes", value.reasonCodes.includes(reason) ? value.reasonCodes.filter((item) => item !== reason) : [...value.reasonCodes, reason])} className={`rounded-full border px-2 py-1 text-xs ${value.reasonCodes.includes(reason) ? "border-primary bg-primary/10 text-primary" : ""}`}>{REASON_LABELS[reason]}</button>)}</div></Field>
  </div>;
}
