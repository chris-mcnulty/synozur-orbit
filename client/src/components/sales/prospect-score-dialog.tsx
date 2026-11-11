import { useState } from "react";
import { effectiveScoringFacts, type ScoringFacts } from "@shared/prospect-scoring";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canClassifyCampaign } from "./campaign-classification-helpers";
import { missingScoringLabels, scoreSignalState, type ScorablePerson, type ScoringCriteria } from "./prospect-score-helpers";
import { useProspectRescore } from "./use-prospect-rescore";

const factFields: [keyof ScoringFacts, string][] = [
  ["title", "Title / role"], ["industry", "Industry"], ["geography", "Geography"], ["segment", "Segment"],
];

export function ProspectScoreButton({ person, criteria, onClick }: {
  person: ScorablePerson; criteria?: ScoringCriteria | null; onClick: () => void;
}) {
  const missing = missingScoringLabels(person, criteria);
  return <button type="button" className="inline-flex min-w-14 flex-col items-center rounded px-1.5 py-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onClick} data-testid={`prospect-score-${person.id}`} aria-label={`Inspect score for ${person.name || person.email || "contact"}: ${person.icpScore ?? "unscored"}${missing.length ? ", incomplete data" : ""}`}>
    <span className="underline decoration-dotted underline-offset-4">{person.icpScore ?? "Unscored"}</span>
    {missing.length > 0 && <span className="mt-1 text-[10px] font-normal text-amber-700 dark:text-amber-400" title={`Missing: ${missing.join(", ")}`} data-testid={`score-incomplete-${person.id}`}>Incomplete data</span>}
  </button>;
}

/** Mounted with a contact/campaign key so drafts and mutation results cannot leak between contacts. */
export default function ProspectScoreDialog({ person, campaignId, criteria, role, onClose }: {
  person: ScorablePerson; campaignId: string; criteria?: ScoringCriteria | null; role?: string | null; onClose: () => void;
}) {
  const [facts, setFacts] = useState(() => effectiveScoringFacts(person));
  const [result, setResult] = useState<{ score: number; breakdown: ScorablePerson["scoreBreakdown"] } | null>(null);
  const [savedNotice, setSavedNotice] = useState("");
  const mutation = useProspectRescore(campaignId, person.id, role);
  const canEdit = canClassifyCampaign(role);
  const breakdown = result ? result.breakdown : person.scoreBreakdown;
  const score = result ? result.score : person.icpScore;
  const signals = breakdown?.signals ?? [];
  const pending = mutation.isPending;
  async function rescore(saveFacts: boolean) {
    setSavedNotice("");
    try {
      const next = await mutation.mutateAsync(saveFacts ? facts : undefined);
      setResult({ score: next.score, breakdown: next.breakdown });
      if (saveFacts) setFacts(next.facts);
      setSavedNotice(saveFacts ? "Campaign scoring facts saved and score recalculated." : "Score recalculated from saved facts. Unsaved edits were not used.");
    } catch { /* Keep edited facts and prior breakdown intact for retry. */ }
  }
  const targetFields: [string, string[] | undefined][] = [
    ["Target roles", criteria?.targetRoles], ["Industries", criteria?.industries],
    ["Geographies", criteria?.geographies], ["Segments", criteria?.segments],
  ];
  return <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" data-testid="prospect-score-dialog" onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onPointerDownOutside={event => { if (pending) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>Score · {person.name || person.email || "Contact"}</DialogTitle>
        <DialogDescription>Campaign fit based on saved facts and targeting rules. Rescoring uses no AI and sends no emails.</DialogDescription>
      </DialogHeader>
      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-4 py-3">
        <div><p className="text-xs text-muted-foreground">ICP fit score</p><p className="text-2xl font-semibold tabular-nums" data-testid="score-current">{score == null ? "Unscored" : `${score}/100`}</p></div>
        <div className="text-right text-xs text-muted-foreground">{breakdown?.threshold != null && <p>Qualification threshold: {breakdown.threshold}</p>}<p>Meeting priority is separate.</p></div>
      </div>
      <section className="space-y-2" aria-label="Current campaign criteria">
        <h3 className="text-xs font-semibold">Current campaign criteria</h3>
        <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[100px_1fr]" data-testid="score-target-criteria">{targetFields.map(([label, values]) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd>{values?.length ? values.join(", ") : "Not specified"}</dd></div>)}</dl>
        {breakdown?.matchedPersonaName && <p className="text-xs" data-testid="score-best-persona">Best-match persona: <span className="font-medium">{breakdown.matchedPersonaName}</span></p>}
        <p className="text-[11px] text-muted-foreground">The breakdown below reflects the last saved score. Rescore to apply current criteria.</p>
      </section>
      <section className="space-y-2" aria-label="Score explanation">
        <h3 className="text-xs font-semibold">What contributed to this score</h3>
        {signals.length ? <div className="divide-y rounded-md border" data-testid="score-signal-list">{signals.map((signal, index) => {
          const state = scoreSignalState(signal);
          return <div key={`${signal.key}-${index}`} className="px-3 py-2" data-testid={`score-signal-${signal.key}`} data-state={state}>
            <div className="flex items-center justify-between gap-3 text-xs"><span className="font-medium">{signal.label}</span><span className="flex items-center gap-2"><Badge variant="outline" className={`text-[10px] font-normal ${state === "missing" ? "border-amber-300 text-amber-700 dark:text-amber-400" : state === "matched" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>{state === "missing" ? "Missing data" : state === "matched" ? "Matched" : "Mismatch"}</Badge><span className="min-w-16 text-right tabular-nums">{state === "matched" ? signal.weight : 0} / {signal.weight} pts</span></span></div>
            <p className="mt-1 text-[11px] text-muted-foreground">{state === "missing" ? "Unknown, not a confirmed mismatch. Add a verified fact to evaluate this criterion." : state === "mismatch" ? "Available data does not meet this criterion." : "Available data meets this criterion."}{signal.note ? ` ${signal.note}` : ""}</p>
          </div>;
        })}</div> : <div className="rounded-md border border-dashed bg-muted/20 px-3 py-4 text-xs text-muted-foreground" data-testid="score-no-breakdown">No saved breakdown yet. {canEdit ? "Review the facts below, then rescore to see matched, mismatched and missing criteria." : "An Analyst or administrator can rescore this contact to generate an explanation."}</div>}
        <p className="text-[11px] text-muted-foreground">Missing data earns no points; it is not evidence of poor fit. Adding facts may raise, lower, or leave the score unchanged.</p>
      </section>
      <section className="space-y-3 border-t pt-3" aria-label="Campaign scoring facts">
        <div><h3 className="text-xs font-semibold">Campaign scoring facts</h3><p className="mt-1 text-xs text-muted-foreground">These overrides apply only to this campaign’s scoring. They do not change the shared contact title or other contact records. Leave unknown facts blank.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">{factFields.map(([key, label]) => <div key={key} className="space-y-1"><Label htmlFor={`scoring-fact-${key}`} className="text-xs">{label}</Label><Input id={`scoring-fact-${key}`} data-testid={`scoring-fact-${key}`} maxLength={300} value={facts[key]} readOnly={!canEdit} disabled={pending} placeholder="Unknown" className="h-8 text-xs" onChange={event => setFacts(previous => ({ ...previous, [key]: event.target.value }))} /></div>)}</div>
        {!canEdit && <p className="text-xs text-muted-foreground" data-testid="score-read-only">Read-only for your role. Analysts and administrators can save and rescore.</p>}
      </section>
      {mutation.error && <p role="alert" className="text-xs text-destructive" data-testid="score-save-error">{mutation.error instanceof Error ? mutation.error.message.replace(/^\d+:\s*/, "") : "Could not rescore. Your edits are preserved; try again."}</p>}
      {savedNotice && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400" data-testid="score-save-success">{savedNotice}</p>}
      <DialogFooter className="gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>Close</Button>
        {canEdit && <><Button variant="outline" size="sm" onClick={() => void rescore(false)} disabled={pending} data-testid="score-rescore-saved">{pending && mutation.variables === undefined ? "Rescoring…" : "Rescore saved facts"}</Button><Button size="sm" onClick={() => void rescore(true)} disabled={pending} data-testid="score-save-rescore">{pending && mutation.variables !== undefined ? "Saving and rescoring…" : "Save and rescore"}</Button></>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
