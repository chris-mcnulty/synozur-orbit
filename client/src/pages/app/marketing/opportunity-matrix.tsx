import { useState, useMemo } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CANONICAL_CHANNELS, channelLabel } from "@shared/market-intelligence";
import { Grid3x3, Sparkles, Loader2, Trophy, Lightbulb } from "lucide-react";

interface Cell {
  id: string;
  segmentId: string;
  needKey: string;
  needLabel: string;
  channelKey: string;
  revenuePotential: number | null;
  executionEffort: number | null;
  roiScore: number | null;
  scoreRationale: string | null;
  isWhitespace: boolean;
  source: string;
}
interface Segment { id: string; name: string; priorityScore: number | null }

// ROI → green heat. Alpha capped so 100 isn't opaque.
function heat(roi: number | null): React.CSSProperties {
  if (roi == null) return { background: "transparent" };
  const a = Math.min(0.85, Math.max(0.05, roi / 130));
  return { backgroundColor: `rgba(34,197,94,${a})` };
}

export default function OpportunityMatrixPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [detail, setDetail] = useState<Cell | null>(null);

  const { data: cells = [], isLoading } = useQuery<Cell[]>({
    queryKey: ["/api/opportunity-matrix"],
    queryFn: async () => (await apiRequest("GET", "/api/opportunity-matrix")).json(),
  });
  const { data: segments = [] } = useQuery<Segment[]>({
    queryKey: ["/api/market-segments"],
    queryFn: async () => (await apiRequest("GET", "/api/market-segments")).json(),
  });

  const segName = useMemo(() => new Map(segments.map((s) => [s.id, s.name])), [segments]);

  const rebuild = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/opportunity-matrix/generate")).json(),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunity-matrix"] });
      toast({
        title: r.cellsCreated > 0 ? `Scored ${r.cellsCreated} cells across ${r.segmentsProcessed} segment(s)` : "Nothing to score",
        description: r.message ?? (r.whitespaceCount ? `${r.whitespaceCount} whitespace opportunities found.` : undefined),
      });
    },
    onError: (e: any) => toast({ title: "Rebuild failed", description: e.message, variant: "destructive" }),
  });

  // Group cells: segmentId → needKey → channelKey → cell
  const grouped = useMemo(() => {
    const bySeg = new Map<string, Map<string, { needLabel: string; byChannel: Map<string, Cell> }>>();
    for (const c of cells) {
      if (!bySeg.has(c.segmentId)) bySeg.set(c.segmentId, new Map());
      const needs = bySeg.get(c.segmentId)!;
      if (!needs.has(c.needKey)) needs.set(c.needKey, { needLabel: c.needLabel, byChannel: new Map() });
      needs.get(c.needKey)!.byChannel.set(c.channelKey, c);
    }
    return bySeg;
  }, [cells]);

  const topOpportunities = useMemo(
    () => [...cells].filter((c) => c.roiScore != null).sort((a, b) => (b.roiScore ?? 0) - (a.roiScore ?? 0)).slice(0, 8),
    [cells],
  );

  return (
    <AppLayout>
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Grid3x3 className="h-6 w-6" /> GTM Opportunity Matrix</h1>
            <p className="text-muted-foreground mt-1 max-w-2xl">
              Where to focus GTM first — every segment need scored against each channel on ROI
              (revenue potential vs. execution effort). Brighter cells are higher ROI.
            </p>
          </div>
          <Button onClick={() => rebuild.mutate()} disabled={rebuild.isPending} data-testid="button-rebuild-matrix">
            {rebuild.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span className="ml-2">Rebuild matrix</span>
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : cells.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <Grid3x3 className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No matrix yet</p>
              <p className="text-sm mt-1 max-w-md mx-auto">
                Add market segments and generate their Needs Maps first, then <b>Rebuild matrix</b> to
                score channel opportunities.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Top opportunities */}
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2 mb-2"><Trophy className="h-4 w-4" /> Top opportunities</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {topOpportunities.map((c) => (
                  <button key={c.id} onClick={() => setDetail(c)} className="text-left rounded-lg border p-3 hover:border-primary/50 transition-colors" data-testid={`top-opportunity-${c.id}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-bold tabular-nums">{Math.round(c.roiScore ?? 0)}</span>
                      {c.isWhitespace && <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400"><Lightbulb className="h-3 w-3 mr-1" />whitespace</Badge>}
                    </div>
                    <div className="text-xs font-medium mt-1 truncate">{channelLabel(c.channelKey)}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{segName.get(c.segmentId) ?? "Segment"} · {c.needLabel}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Heatmap per segment */}
            {[...grouped.entries()].map(([segmentId, needs]) => (
              <div key={segmentId} className="space-y-2">
                <h2 className="text-sm font-semibold">{segName.get(segmentId) ?? "Segment"}</h2>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-muted/40">
                        <th className="text-left p-2 font-medium sticky left-0 bg-muted/40 min-w-[160px]">Need</th>
                        {CANONICAL_CHANNELS.map((ch) => (
                          <th key={ch.key} className="p-2 font-medium text-center whitespace-nowrap min-w-[64px]" title={ch.label}>
                            {ch.label.split(" ")[0]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...needs.entries()].map(([needKey, { needLabel, byChannel }]) => (
                        <tr key={needKey} className="border-t">
                          <td className="p-2 font-medium sticky left-0 bg-background min-w-[160px]">{needLabel}</td>
                          {CANONICAL_CHANNELS.map((ch) => {
                            const cell = byChannel.get(ch.key);
                            return (
                              <td key={ch.key} className="p-0 text-center">
                                {cell ? (
                                  <button
                                    onClick={() => setDetail(cell)}
                                    style={heat(cell.roiScore)}
                                    className={`w-full h-9 tabular-nums hover:ring-2 hover:ring-primary/50 ${cell.isWhitespace ? "ring-2 ring-amber-400/70" : ""}`}
                                    title={`ROI ${Math.round(cell.roiScore ?? 0)} · rev ${cell.revenuePotential} / effort ${cell.executionEffort}`}
                                    data-testid={`cell-${cell.id}`}
                                  >
                                    {Math.round(cell.roiScore ?? 0)}
                                  </button>
                                ) : (
                                  <div className="h-9" />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {detail && <CellDialog cell={detail} segmentName={segName.get(detail.segmentId)} onClose={() => setDetail(null)} onSaved={() => queryClient.invalidateQueries({ queryKey: ["/api/opportunity-matrix"] })} />}
    </AppLayout>
  );
}

function CellDialog({ cell, segmentName, onClose, onSaved }: { cell: Cell; segmentName?: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [rev, setRev] = useState(cell.revenuePotential?.toString() ?? "");
  const [eff, setEff] = useState(cell.executionEffort?.toString() ?? "");

  const save = useMutation({
    mutationFn: async () =>
      (await apiRequest("PATCH", `/api/opportunity-matrix/${cell.id}`, {
        revenuePotential: rev ? Number(rev) : undefined,
        executionEffort: eff ? Number(eff) : undefined,
      })).json(),
    onSuccess: () => { onSaved(); onClose(); toast({ title: "Cell updated" }); },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{channelLabel(cell.channelKey)}</DialogTitle>
          <DialogDescription>{segmentName ? `${segmentName} · ` : ""}{cell.needLabel}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="text-3xl font-bold tabular-nums">{Math.round(cell.roiScore ?? 0)}</div>
            <div className="text-xs text-muted-foreground">
              ROI score{cell.isWhitespace && <span className="ml-2 text-amber-600 dark:text-amber-400">· whitespace</span>}
              {cell.source === "user" && <span className="ml-2">· edited</span>}
            </div>
          </div>
          {cell.scoreRationale && <p className="text-sm text-muted-foreground">{cell.scoreRationale}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Revenue potential (0–100)</Label><Input type="number" min={0} max={100} value={rev} onChange={(e) => setRev(e.target.value)} data-testid="input-revenue" /></div>
            <div><Label className="text-xs">Execution effort (0–100)</Label><Input type="number" min={0} max={100} value={eff} onChange={(e) => setEff(e.target.value)} data-testid="input-effort" /></div>
          </div>
          <p className="text-[11px] text-muted-foreground">Editing recomputes ROI = revenue × (100 − effort).</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-cell">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save override"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
