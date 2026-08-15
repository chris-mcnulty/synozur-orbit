import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Gauge, Plus, Pencil, Trash2, Sparkles, Loader2, Download, TrendingUp, Target, ExternalLink,
} from "lucide-react";

// ─── types (mirror server market_segments row) ──────────────────────────────

interface Firmographics {
  industry?: string;
  companySize?: string;
  geography?: string;
  businessType?: "b2b" | "b2c";
}
interface NeedsMap {
  pains: string[];
  triggers: string[];
  barriers: string[];
  buyingCriteria: string[];
}
interface MarketSegment {
  id: string;
  name: string;
  description: string | null;
  personaId: string | null;
  firmographics: Firmographics | null;
  needsMap: NeedsMap | null;
  needsMapSource: string | null;
  tamLow: number | null; tamMid: number | null; tamHigh: number | null;
  samLow: number | null; samMid: number | null; samHigh: number | null;
  tamUserOverride: number | null; samUserOverride: number | null;
  sizingCurrency: string | null;
  sizingMethod: string | null;
  sizingConfidence: string | null;
  sizingRationale: string | null;
  lastEstimatedAt: string | null;
  priorityScore: number | null;
  priorityScoreSource: string | null;
  priorityRationale: string | null;
  status: string;
}
interface SourceRow {
  id: string; url: string | null; title: string | null; publisher: string | null; excerpt: string | null; usedForField: string | null;
}

const EMPTY_NEEDS: NeedsMap = { pains: [], triggers: [], barriers: [], buyingCriteria: [] };

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined, currency = "USD"): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  const sym = currency === "USD" ? "$" : `${currency} `;
  if (n >= 1e9) return `${sym}${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${sym}${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${sym}${(n / 1e3).toFixed(0)}K`;
  return `${sym}${n}`;
}
function effectiveTam(s: MarketSegment) { return s.tamUserOverride ?? s.tamMid; }
function effectiveSam(s: MarketSegment) { return s.samUserOverride ?? s.samMid; }
function confidenceColor(c: string | null): string {
  if (c === "high") return "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30";
  if (c === "medium") return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
  return "bg-muted text-muted-foreground";
}
const linesToArr = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const arrToLines = (a: string[] | undefined) => (a ?? []).join("\n");

// Module-scoped so it isn't a fresh component type each render (which would
// remount the textarea and drop focus on every keystroke).
function NeedsField({ label, value, onChange }: { label: string; value: string[]; onChange: (next: string[]) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Textarea
        rows={3}
        value={arrToLines(value)}
        onChange={(e) => onChange(linesToArr(e.target.value))}
        placeholder="One per line"
        className="text-sm"
      />
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function MarketSegmentsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<MarketSegment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MarketSegment | null>(null);

  const { data: segments = [], isLoading } = useQuery<MarketSegment[]>({
    queryKey: ["/api/market-segments"],
    queryFn: async () => (await apiRequest("GET", "/api/market-segments")).json(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/market-segments"] });

  const backfillMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/market-segments/backfill")).json(),
    onSuccess: (r: { created: number }) => {
      invalidate();
      toast({ title: r.created > 0 ? `Created ${r.created} segment(s) from personas` : "No new personas to import" });
    },
    onError: (e: any) => toast({ title: "Backfill failed", description: e.message, variant: "destructive" }),
  });

  return (
    <AppLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Gauge className="h-6 w-6" /> Market Segments
            </h1>
            <p className="text-muted-foreground mt-1 max-w-2xl">
              Quantified buyer segments ranked by priority. Estimate TAM/SAM with cited sources,
              build a Needs Map, and decide where to focus GTM first.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => backfillMutation.mutate()} disabled={backfillMutation.isPending} data-testid="button-backfill-segments">
              {backfillMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="ml-2">Import from personas</span>
            </Button>
            <Button onClick={() => setCreateOpen(true)} data-testid="button-new-segment">
              <Plus className="h-4 w-4 mr-2" /> New segment
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : segments.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <Target className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No market segments yet</p>
              <p className="text-sm mt-1">Import your personas to get started, or create a segment from scratch.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {segments.map((s) => (
              <SegmentCard key={s.id} segment={s} onEdit={() => setEditing(s)} onDelete={() => setDeleteTarget(s)} />
            ))}
          </div>
        )}
      </div>

      {createOpen && <CreateDialog onClose={() => setCreateOpen(false)} onCreated={invalidate} />}
      {editing && <EditDialog segment={editing} onClose={() => setEditing(null)} onSaved={invalidate} />}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete segment?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" and its sizing history will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <DeleteButton target={deleteTarget} onDone={() => setDeleteTarget(null)} onDeleted={invalidate} />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

// ─── card ─────────────────────────────────────────────────────────────────────

function SegmentCard({ segment: s, onEdit, onDelete }: { segment: MarketSegment; onEdit: () => void; onDelete: () => void }) {
  const cur = s.sizingCurrency ?? "USD";
  return (
    <Card className="hover:border-primary/40 transition-colors" data-testid={`card-segment-${s.id}`}>
      <CardContent className="py-4 flex items-center gap-4 flex-wrap">
        <div className="flex flex-col items-center justify-center w-14 shrink-0">
          <span className="text-2xl font-bold tabular-nums" data-testid={`text-priority-${s.id}`}>{s.priorityScore ?? "–"}</span>
          <span className="text-[10px] uppercase text-muted-foreground tracking-wide">priority</span>
        </div>
        <div className="flex-1 min-w-[180px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{s.name}</span>
            {s.personaId && <Badge variant="outline" className="text-[10px]">from persona</Badge>}
            {s.sizingConfidence && (
              <Badge variant="outline" className={`text-[10px] ${confidenceColor(s.sizingConfidence)}`}>
                {s.sizingConfidence} confidence
              </Badge>
            )}
          </div>
          {s.firmographics?.industry && (
            <p className="text-xs text-muted-foreground mt-0.5">{s.firmographics.industry}{s.firmographics.geography ? ` · ${s.firmographics.geography}` : ""}</p>
          )}
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">TAM</div>
            <div className="font-semibold tabular-nums flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-muted-foreground" />{fmtMoney(effectiveTam(s), cur)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">SAM</div>
            <div className="font-semibold tabular-nums">{fmtMoney(effectiveSam(s), cur)}</div>
          </div>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${s.name}`} data-testid={`button-edit-${s.id}`}><Pencil className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Delete ${s.name}`} data-testid={`button-delete-${s.id}`}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DeleteButton({ target, onDone, onDeleted }: { target: MarketSegment | null; onDone: () => void; onDeleted: () => void }) {
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/market-segments/${target!.id}`); },
    onSuccess: () => { onDeleted(); onDone(); toast({ title: "Segment deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });
  return (
    <AlertDialogAction onClick={(e) => { e.preventDefault(); mutation.mutate(); }} disabled={mutation.isPending}>
      {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
    </AlertDialogAction>
  );
}

// ─── create dialog ─────────────────────────────────────────────────────────────

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [description, setDescription] = useState("");

  const mutation = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/market-segments", {
        name, description, firmographics: { industry: industry || undefined },
      })).json(),
    onSuccess: () => { onCreated(); onClose(); toast({ title: "Segment created" }); },
    onError: (e: any) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New market segment</DialogTitle>
          <DialogDescription>Name the buyer group; you can size and profile it next.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mid-market SaaS RevOps" data-testid="input-segment-name" /></div>
          <div><Label>Industry</Label><Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Software Publishers" /></div>
          <div><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!name.trim() || mutation.isPending} data-testid="button-save-new-segment">
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── edit dialog (the per-segment workspace) ────────────────────────────────────

function EditDialog({ segment, onClose, onSaved }: { segment: MarketSegment; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const cur = segment.sizingCurrency ?? "USD";

  const [name, setName] = useState(segment.name);
  const [description, setDescription] = useState(segment.description ?? "");
  const [industry, setIndustry] = useState(segment.firmographics?.industry ?? "");
  const [companySize, setCompanySize] = useState(segment.firmographics?.companySize ?? "");
  const [geography, setGeography] = useState(segment.firmographics?.geography ?? "");
  const [acv, setAcv] = useState("");
  const [priority, setPriority] = useState(segment.priorityScore?.toString() ?? "");
  const [needs, setNeeds] = useState<NeedsMap>(segment.needsMap ?? EMPTY_NEEDS);

  const { data: sources = [] } = useQuery<SourceRow[]>({
    queryKey: ["/api/market-segments", segment.id, "sources"],
    queryFn: async () => (await apiRequest("GET", `/api/market-segments/${segment.id}/sources`)).json(),
  });

  const refresh = () => {
    onSaved();
    queryClient.invalidateQueries({ queryKey: ["/api/market-segments", segment.id, "sources"] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Only send needsMap / priorityScore when actually edited, so a plain save
      // doesn't flip AI-authored sources to "user".
      const payload: Record<string, unknown> = {
        name, description,
        firmographics: { industry: industry || undefined, companySize: companySize || undefined, geography: geography || undefined },
      };
      const needsDirty = JSON.stringify(needs) !== JSON.stringify(segment.needsMap ?? EMPTY_NEEDS);
      if (needsDirty) payload.needsMap = needs;
      const priorityDirty = (priority ? Number(priority) : null) !== (segment.priorityScore ?? null);
      if (priorityDirty && priority) payload.priorityScore = Number(priority);
      return (await apiRequest("PATCH", `/api/market-segments/${segment.id}`, payload)).json();
    },
    onSuccess: () => { refresh(); toast({ title: "Saved" }); onClose(); },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const sizeMutation = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/market-segments/${segment.id}/size`, { acv: acv ? Number(acv) : undefined })).json(),
    onSuccess: () => { refresh(); toast({ title: "Sizing updated" }); },
    onError: (e: any) => toast({ title: "Sizing failed", description: e.message, variant: "destructive" }),
  });

  const needsMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/market-segments/${segment.id}/needs-map`)).json(),
    onSuccess: (r: MarketSegment) => { setNeeds(r.needsMap ?? EMPTY_NEEDS); refresh(); toast({ title: "Needs Map generated" }); },
    onError: (e: any) => toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  const priorityMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/market-segments/${segment.id}/priority`)).json(),
    onSuccess: (r: MarketSegment) => { setPriority(r.priorityScore?.toString() ?? ""); refresh(); toast({ title: "Priority suggested" }); },
    onError: (e: any) => toast({ title: "Scoring failed", description: e.message, variant: "destructive" }),
  });

  const busy = sizeMutation.isPending || needsMutation.isPending || priorityMutation.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{segment.name}</DialogTitle>
          <DialogDescription>Profile, size, and prioritize this segment.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Basics */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="col-span-2"><Label>Description</Label><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <div><Label>Industry</Label><Input value={industry} onChange={(e) => setIndustry(e.target.value)} /></div>
            <div><Label>Company size</Label><Input value={companySize} onChange={(e) => setCompanySize(e.target.value)} placeholder="e.g. 50-500" /></div>
            <div><Label>Geography</Label><Input value={geography} onChange={(e) => setGeography(e.target.value)} placeholder="e.g. US" /></div>
          </div>

          {/* Sizing */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="font-semibold text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Market sizing</h3>
              <div className="flex items-end gap-2">
                <div>
                  <Label className="text-xs">ACV (for bottom-up)</Label>
                  <Input value={acv} onChange={(e) => setAcv(e.target.value)} placeholder="e.g. 25000" className="w-32 h-8" data-testid="input-acv" />
                </div>
                <Button size="sm" onClick={() => sizeMutation.mutate()} disabled={busy} data-testid="button-run-sizing">
                  {sizeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  <span className="ml-2">Run sizing</span>
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">TAM (low / mid / high)</div>
                <div className="tabular-nums">{fmtMoney(segment.tamLow, cur)} / <b>{fmtMoney(segment.tamMid, cur)}</b> / {fmtMoney(segment.tamHigh, cur)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">SAM (low / mid / high)</div>
                <div className="tabular-nums">{fmtMoney(segment.samLow, cur)} / <b>{fmtMoney(segment.samMid, cur)}</b> / {fmtMoney(segment.samHigh, cur)}</div>
              </div>
            </div>
            {segment.sizingMethod && (
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline">{segment.sizingMethod.replace("_", " ")}</Badge>
                <Badge variant="outline" className={confidenceColor(segment.sizingConfidence)}>{segment.sizingConfidence}</Badge>
              </div>
            )}
            {segment.sizingRationale && <p className="text-xs text-muted-foreground">{segment.sizingRationale}</p>}
            {sources.length > 0 && (
              <div className="text-xs space-y-1">
                <div className="font-medium text-muted-foreground">Sources</div>
                {sources.map((src) => (
                  <div key={src.id} className="flex items-start gap-1">
                    <span>•</span>
                    <span>
                      {src.url ? (
                        <a href={src.url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                          {src.title || src.url} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (src.title || "source")}
                      {src.publisher ? ` — ${src.publisher}` : ""}{src.excerpt ? ` (${src.excerpt})` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Priority */}
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Priority (1–10)</h3>
              <div className="flex items-center gap-2">
                <Input type="number" min={1} max={10} value={priority} onChange={(e) => setPriority(e.target.value)} className="w-20 h-8" data-testid="input-priority" />
                <Button size="sm" variant="outline" onClick={() => priorityMutation.mutate()} disabled={busy} data-testid="button-suggest-priority">
                  {priorityMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  <span className="ml-2">Suggest</span>
                </Button>
              </div>
            </div>
            {segment.priorityRationale && <p className="text-xs text-muted-foreground">{segment.priorityRationale}</p>}
          </div>

          {/* Needs Map */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Needs Map</h3>
              <Button size="sm" variant="outline" onClick={() => needsMutation.mutate()} disabled={busy} data-testid="button-generate-needs">
                {needsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                <span className="ml-2">Generate</span>
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NeedsField label="Pains" value={needs.pains} onChange={(v) => setNeeds({ ...needs, pains: v })} />
              <NeedsField label="Triggers" value={needs.triggers} onChange={(v) => setNeeds({ ...needs, triggers: v })} />
              <NeedsField label="Barriers" value={needs.barriers} onChange={(v) => setNeeds({ ...needs, barriers: v })} />
              <NeedsField label="Buying criteria" value={needs.buyingCriteria} onChange={(v) => setNeeds({ ...needs, buyingCriteria: v })} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-segment">
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
