import { useState } from "react";
import { useParams, useLocation } from "wouter";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { channelLabel, type StudyStage } from "@shared/market-intelligence";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  ArrowLeft, RefreshCw, Loader2, CheckCircle2, XCircle, MinusCircle, Circle, Trophy, Lightbulb, TrendingUp, Download,
} from "lucide-react";

interface Study {
  id: string;
  inputType: string; inputValue: string | null; depth: string;
  status: string; currentStage: string | null;
  stages: StudyStage[];
  executiveSummary: string | null;
  resultRefs: { segmentIds?: string[]; cellCount?: number; whitespaceCount?: number } | null;
  error: string | null;
  createdAt: string; completedAt: string | null;
}
interface Segment { id: string; name: string; priorityScore: number | null; tamMid: number | null; samMid: number | null; tamUserOverride: number | null; samUserOverride: number | null; sizingCurrency: string | null; sizingConfidence: string | null }
interface Cell { id: string; segmentId: string; needLabel: string; channelKey: string; roiScore: number | null; isWhitespace: boolean }

function fmtMoney(n: number | null | undefined, cur = "USD"): string {
  if (n == null || n <= 0) return "—";
  const s = cur === "USD" ? "$" : `${cur} `;
  if (n >= 1e9) return `${s}${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${s}${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${s}${(n / 1e3).toFixed(0)}K`;
  return `${s}${n}`;
}

function StageIcon({ status }: { status: string }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-amber-500" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-500" />;
  if (status === "skipped") return <MinusCircle className="h-4 w-4 text-muted-foreground" />;
  return <Circle className="h-4 w-4 text-muted-foreground/50" />;
}

export default function MarketStudyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isExporting, setIsExporting] = useState(false);

  const exportPdf = async () => {
    setIsExporting(true);
    try {
      const resp = await fetch(`/api/market-studies/${id}/export`, { credentials: "include" });
      if (!resp.ok) {
        const msg = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(msg.error ?? resp.statusText);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `market-study-${id.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const { data: study, isLoading } = useQuery<Study>({
    queryKey: ["/api/market-studies", id],
    queryFn: async () => (await apiRequest("GET", `/api/market-studies/${id}`)).json(),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "running" || s === "pending" ? 3000 : false;
    },
  });

  const done = study?.status === "completed";
  const segIds = study?.resultRefs?.segmentIds ?? [];

  const { data: allSegments = [] } = useQuery<Segment[]>({
    queryKey: ["/api/market-segments"],
    queryFn: async () => (await apiRequest("GET", "/api/market-segments")).json(),
    enabled: done,
  });
  const { data: allCells = [] } = useQuery<Cell[]>({
    queryKey: ["/api/opportunity-matrix"],
    queryFn: async () => (await apiRequest("GET", "/api/opportunity-matrix")).json(),
    enabled: done,
  });

  const segments = (segIds.length ? allSegments.filter((s) => segIds.includes(s.id)) : allSegments)
    .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
  const topCells = [...allCells]
    .filter((c) => c.roiScore != null && (segIds.length ? segIds.includes(c.segmentId) : true))
    .sort((a, b) => (b.roiScore ?? 0) - (a.roiScore ?? 0))
    .slice(0, 6);

  const refresh = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/market-studies/${id}/refresh`)).json(),
    onSuccess: (r: { studyId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/market-studies"] });
      toast({ title: "Re-running study" });
      navigate(`/app/marketing/market-studies/${r.studyId}`);
    },
    onError: (e: any) => toast({ title: "Refresh failed", description: e.message, variant: "destructive" }),
  });

  // Executive summary is AI/user-influenced markdown; sanitize before rendering.
  const summaryHtml = study?.executiveSummary
    ? DOMPurify.sanitize(marked.parse(study.executiveSummary) as string)
    : "";

  return (
    <AppLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-5">
        <button onClick={() => navigate("/app/marketing/market-studies")} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> All studies
        </button>

        {isLoading || !study ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <h1 className="text-xl font-bold">Market Study</h1>
                <p className="text-sm text-muted-foreground mt-0.5 break-words">{study.inputValue}</p>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="secondary" className="capitalize">{study.depth}</Badge>
                  <Badge variant="outline" className="capitalize">{study.status}</Badge>
                </div>
              </div>
              {done && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={exportPdf} disabled={isExporting} data-testid="button-export-study-pdf">
                    {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    <span className="ml-2">Export PDF</span>
                  </Button>
                  <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending} data-testid="button-refresh-study">
                    {refresh.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    <span className="ml-2">Refresh</span>
                  </Button>
                </div>
              )}
            </div>

            {/* Stages */}
            <Card>
              <CardContent className="py-4 space-y-2">
                {(study.stages ?? []).map((st) => (
                  <div key={st.key} className="flex items-center gap-3 text-sm" data-testid={`stage-${st.key}`}>
                    <StageIcon status={st.status} />
                    <span className={st.status === "pending" ? "text-muted-foreground" : ""}>{st.label}</span>
                    {st.detail && <span className="text-xs text-muted-foreground">— {st.detail}</span>}
                  </div>
                ))}
                {study.status === "failed" && study.error && (
                  <p className="text-sm text-red-600 dark:text-red-400 pt-2">{study.error}</p>
                )}
              </CardContent>
            </Card>

            {done && (
              <>
                {/* Executive summary */}
                {summaryHtml && (
                  <Card>
                    <CardContent className="py-5">
                      <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: summaryHtml }} />
                    </CardContent>
                  </Card>
                )}

                {/* Ranked segments */}
                {segments.length > 0 && (
                  <div>
                    <h2 className="text-sm font-semibold mb-2">Ranked segments</h2>
                    <div className="grid gap-2">
                      {segments.map((s) => (
                        <div key={s.id} className="rounded-lg border p-3 flex items-center gap-4">
                          <div className="w-10 text-center">
                            <div className="text-xl font-bold tabular-nums">{s.priorityScore ?? "–"}</div>
                          </div>
                          <div className="flex-1 min-w-0"><span className="font-medium">{s.name}</span></div>
                          <div className="text-right text-sm">
                            <div className="tabular-nums flex items-center gap-1"><TrendingUp className="h-3 w-3 text-muted-foreground" />TAM {fmtMoney(s.tamUserOverride ?? s.tamMid, s.sizingCurrency ?? "USD")}</div>
                            <div className="text-xs text-muted-foreground tabular-nums">SAM {fmtMoney(s.samUserOverride ?? s.samMid, s.sizingCurrency ?? "USD")}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top opportunities */}
                {topCells.length > 0 && (
                  <div>
                    <h2 className="text-sm font-semibold mb-2 flex items-center gap-2"><Trophy className="h-4 w-4" /> Top GTM opportunities</h2>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {topCells.map((c) => (
                        <div key={c.id} className="rounded-lg border p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-lg font-bold tabular-nums">{Math.round(c.roiScore ?? 0)}</span>
                            {c.isWhitespace && <Badge variant="outline" title="Top-ROI percentile (a whitespace proxy — not a competition measure yet)" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400"><Lightbulb className="h-3 w-3 mr-1" />top ROI</Badge>}
                          </div>
                          <div className="text-xs font-medium mt-1">{channelLabel(c.channelKey)}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{c.needLabel}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3">
                      <Button variant="outline" size="sm" onClick={() => navigate("/app/marketing/opportunity-matrix")}>Open full matrix</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
