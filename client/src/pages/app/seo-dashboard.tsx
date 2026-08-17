import { useState, useMemo, useEffect, useRef } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getTabMarketId } from "@/lib/tabContext";
import { Search, Plus, RefreshCw, Trash2, Download, Loader2, BarChart2, Lock, FileText } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, ResponsiveContainer, Cell } from "recharts";
import { downloadCSVBlob } from "@/lib/csv-export";
import { useUser } from "@/lib/userContext";
import { useJobStatus, jobStatusLabel } from "@/hooks/use-job-status";

interface TrackedKeyword {
  id: string;
  keyword: string;
  country: string;
  locale: string;
  createdAt: string;
}

interface ShareOfVoiceEntity {
  entityId: string;
  name: string;
  type: "baseline" | "competitor";
  domain: string | null;
  averageRank: number | null;
  keywordsRanking: number;
  totalTraffic: number;
  shareOfVoice: number; // basis points
}

interface SeoMetric {
  id: string;
  keywordId: string;
  entityType: string;
  entityId: string | null;
  entityName: string;
  rank: number | null;
  estimatedTraffic: number;
  shareOfVoice: number;
  capturedAt: string;
}

interface ShareOfVoiceResponse {
  keywordCount: number;
  entityCount: number;
  totalTraffic: number;
  entities: ShareOfVoiceEntity[];
  metrics: SeoMetric[];
  keywords: TrackedKeyword[];
}

const ENTITY_COLORS = ["#6366f1", "#22d3ee", "#a78bfa", "#f97316", "#10b981", "#f43f5e", "#eab308", "#3b82f6"];

export default function SeoDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const isAdmin = user?.role === "Global Admin" || user?.role === "Domain Admin";

  const [newKeyword, setNewKeyword] = useState("");
  const [newCountry, setNewCountry] = useState("us");
  const [isPdfGenerating, setIsPdfGenerating] = useState(false);
  const [pdfJobId, setPdfJobId] = useState<string | null>(null);
  // Poll the job queue for progress display (percent / phase).
  const pdfQueueStatus = useJobStatus(pdfJobId ? `seo-report-pdf:${pdfJobId}` : null, isPdfGenerating);
  const pdfButtonLabel = jobStatusLabel(pdfQueueStatus, "Generating…");
  // Poll the report-specific status endpoint until the PDF is ready.
  const pdfStatusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!isPdfGenerating || !pdfJobId) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/seo/report/status/${pdfJobId}`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json() as { status: string; downloadUrl?: string; message?: string };
        if (data.status === "complete" && data.downloadUrl) {
          if (pdfStatusPollRef.current) clearInterval(pdfStatusPollRef.current);
          setIsPdfGenerating(false);
          setPdfJobId(null);
          // Trigger browser download.
          const dlRes = await fetch(data.downloadUrl, { credentials: "include" });
          if (!dlRes.ok) throw new Error("Download failed");
          const blob = await dlRes.blob();
          const date = new Date().toISOString().split("T")[0];
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `SEO_Share_of_Voice_${date}.pdf`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
          toast({ title: "PDF downloaded" });
        } else if (data.status === "error") {
          if (pdfStatusPollRef.current) clearInterval(pdfStatusPollRef.current);
          setIsPdfGenerating(false);
          setPdfJobId(null);
          toast({ title: "PDF generation failed", description: data.message || "Unknown error", variant: "destructive" });
        }
      } catch (err) {
        // Silently retry — polling will continue.
      }
    };
    void poll();
    pdfStatusPollRef.current = setInterval(poll, 2000);
    return () => {
      if (pdfStatusPollRef.current) clearInterval(pdfStatusPollRef.current);
    };
  }, [isPdfGenerating, pdfJobId]);

  const sov = useQuery<ShareOfVoiceResponse>({
    queryKey: ["/api/seo/share-of-voice", getTabMarketId()],
    queryFn: async () => {
      const res = await fetch("/api/seo/share-of-voice", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load share-of-voice");
      return res.json();
    },
  });

  const keywordsQuery = useQuery<TrackedKeyword[]>({
    queryKey: ["/api/seo/keywords", getTabMarketId()],
    queryFn: async () => {
      const res = await fetch("/api/seo/keywords", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load keywords");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (input: { keyword: string; country: string }) => {
      const res = await fetch("/api/seo/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Could not add keyword");
      return res.json();
    },
    onSuccess: () => {
      setNewKeyword("");
      queryClient.invalidateQueries({ queryKey: ["/api/seo/keywords"] });
      queryClient.invalidateQueries({ queryKey: ["/api/seo/share-of-voice"] });
      toast({ title: "Keyword added", description: "Refresh data to capture rankings." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/seo/keywords/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok && res.status !== 204) throw new Error("Could not delete keyword");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/seo/keywords"] });
      queryClient.invalidateQueries({ queryKey: ["/api/seo/share-of-voice"] });
      toast({ title: "Keyword removed" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/seo/refresh", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).error || "Refresh failed");
      return res.json();
    },
    onSuccess: (data: { keywordsProcessed: number; rowsRecorded: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/seo/share-of-voice"] });
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
      toast({
        title: "SEO data refreshed",
        description: `Captured ${data.rowsRecorded} ranking rows for ${data.keywordsProcessed} keywords.`,
      });
    },
    onError: (err: Error) => toast({ title: "Refresh failed", description: err.message, variant: "destructive" }),
  });

  const handleExport = async () => {
    try {
      const res = await fetch("/api/seo/share-of-voice.csv", { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const text = await res.text();
      downloadCSVBlob(text, "share-of-voice");
      toast({ title: "CSV downloaded" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      toast({ title: "Export failed", description: message, variant: "destructive" });
    }
  };

  const handleDownloadPdf = async () => {
    try {
      const res = await fetch("/api/seo/report/generate", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to queue PDF generation");
      }
      const { jobId } = await res.json() as { jobId: string };
      setPdfJobId(jobId);
      setIsPdfGenerating(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "PDF generation failed";
      toast({ title: "PDF generation failed", description: message, variant: "destructive" });
    }
  };

  const handleAdd = () => {
    const trimmed = newKeyword.trim();
    if (!trimmed) {
      toast({ title: "Keyword required", variant: "destructive" });
      return;
    }
    createMutation.mutate({ keyword: trimmed, country: newCountry.trim().toLowerCase() || "us" });
  };

  const entities = sov.data?.entities ?? [];
  const chartData = entities.map((e) => ({
    name: e.name,
    sov: Math.round((e.shareOfVoice / 100) * 10) / 10,
    type: e.type,
  }));

  const keywords = keywordsQuery.data ?? [];

  // Build a keyword × entity rank matrix from the metrics already in the SOV response.
  const keywordRankMatrix = useMemo(() => {
    const metrics = sov.data?.metrics ?? [];
    const kws = sov.data?.keywords ?? [];

    // Map: keywordId → entityId → rank (null = tracked but not ranking in top results)
    const rankMap = new Map<string, Map<string, number | null>>();
    for (const m of metrics) {
      if (!m.keywordId || !m.entityId) continue;
      if (!rankMap.has(m.keywordId)) rankMap.set(m.keywordId, new Map());
      rankMap.get(m.keywordId)!.set(m.entityId, m.rank);
    }

    // Sort keywords: ranked first (ascending best rank), unranked last.
    const rows = kws.map((kw) => {
      const byEntity = rankMap.get(kw.id) ?? new Map<string, number | null>();
      const ranks = Array.from(byEntity.values()).filter((r): r is number => r !== null && r > 0);
      const bestRank = ranks.length > 0 ? Math.min(...ranks) : null;
      return { kw, byEntity, bestRank };
    });
    rows.sort((a, b) => {
      if (a.bestRank === null && b.bestRank === null) return a.kw.keyword.localeCompare(b.kw.keyword);
      if (a.bestRank === null) return 1;
      if (b.bestRank === null) return -1;
      return a.bestRank - b.bestRank;
    });
    return rows;
  }, [sov.data]);

  // Entities sorted: baseline first, then competitors by SOV descending (same as chart).
  const sortedEntities = useMemo(() => {
    return [...entities].sort((a, b) => {
      if (a.type === "baseline" && b.type !== "baseline") return -1;
      if (b.type === "baseline" && a.type !== "baseline") return 1;
      return b.shareOfVoice - a.shareOfVoice;
    });
  }, [entities]);

  return (
    <AppLayout>
      <div className="mb-6">
        <div className="h-1 w-full bg-gradient-to-r from-blue-600 via-cyan-500 to-emerald-400 rounded-full mb-6" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-3">
              <Search className="h-8 w-8 text-primary" />
              SEO &amp; Share of Voice
            </h1>
            <p className="text-muted-foreground max-w-2xl">
              Track how your company and competitors rank for the keywords that matter. SERP positions and
              share-of-voice are captured weekly and on demand.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={entities.length === 0}
              data-testid="button-export-csv"
            >
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
            <Button
              variant="outline"
              onClick={handleDownloadPdf}
              disabled={isPdfGenerating || entities.length === 0}
              data-testid="button-download-pdf"
            >
              {isPdfGenerating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}
              {isPdfGenerating ? pdfButtonLabel : "Download PDF"}
            </Button>
            <Button
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending || keywords.length === 0}
              data-testid="button-refresh-now"
            >
              {refreshMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Refresh now
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card data-testid="card-share-of-voice">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart2 className="h-5 w-5 text-primary" /> Share of Voice
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Estimated visibility across all tracked keywords ({sov.data?.keywordCount ?? 0} keywords, {entities.length} entities).
              </p>
            </CardHeader>
            <CardContent className="h-80">
              {sov.isLoading ? (
                <div className="text-center text-muted-foreground py-8" data-testid="text-sov-loading">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" /> Loading...
                </div>
              ) : entities.length === 0 ? (
                <div className="text-center text-muted-foreground py-12" data-testid="text-sov-empty">
                  Add keywords below and refresh to see share-of-voice.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-15} textAnchor="end" interval={0} />
                    <YAxis tick={{ fontSize: 11 }} unit="%" />
                    <ReTooltip formatter={(v: number) => `${v}%`} />
                    <Bar dataKey="sov" name="Share of Voice">
                      {chartData.map((entry, idx) => (
                        <Cell
                          key={entry.name}
                          fill={entry.type === "baseline" ? "#10b981" : ENTITY_COLORS[idx % ENTITY_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Entity Leaderboard</CardTitle>
            </CardHeader>
            <CardContent>
              {entities.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-leaderboard-empty">No data yet — add keywords and refresh.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-2">Entity</th>
                        <th className="py-2 pr-2">Type</th>
                        <th className="py-2 pr-2">Avg Rank</th>
                        <th className="py-2 pr-2">Keywords Ranking</th>
                        <th className="py-2 pr-2">Est. Traffic</th>
                        <th className="py-2 pr-2">Share of Voice</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entities.map((e) => (
                        <tr key={e.entityId} className="border-b" data-testid={`row-entity-${e.entityId}`}>
                          <td className="py-2 pr-2 font-medium">{e.name}</td>
                          <td className="py-2 pr-2">
                            <Badge variant={e.type === "baseline" ? "default" : "secondary"}>
                              {e.type === "baseline" ? "You" : "Competitor"}
                            </Badge>
                          </td>
                          <td className="py-2 pr-2" data-testid={`text-avg-rank-${e.entityId}`}>
                            {e.averageRank !== null ? e.averageRank.toFixed(1) : "—"}
                          </td>
                          <td className="py-2 pr-2" data-testid={`text-keywords-ranking-${e.entityId}`}>
                            {e.keywordsRanking}
                          </td>
                          <td className="py-2 pr-2">{e.totalTraffic.toLocaleString()}</td>
                          <td className="py-2 pr-2 font-semibold" data-testid={`text-sov-${e.entityId}`}>
                            {(e.shareOfVoice / 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Keyword-by-keyword ranking breakdown */}
          <Card data-testid="card-keyword-rankings">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" /> Keyword Rankings Breakdown
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                SERP position per keyword, per entity — most recent capture. Lower number = higher on the page.
                Bold = best rank for that keyword. Refresh anytime to update.
              </p>
            </CardHeader>
            <CardContent>
              {keywordRankMatrix.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-keyword-rankings-empty">
                  No data yet — add keywords and refresh.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-2 pr-4 text-muted-foreground font-medium min-w-[160px]">Keyword</th>
                        {sortedEntities.map((e, idx) => (
                          <th
                            key={e.entityId}
                            className="py-2 px-3 text-center text-muted-foreground font-medium whitespace-nowrap"
                            data-testid={`th-entity-${e.entityId}`}
                          >
                            <span
                              className="inline-block w-2 h-2 rounded-full mr-1.5"
                              style={{ background: e.type === "baseline" ? "#10b981" : ENTITY_COLORS[idx % ENTITY_COLORS.length] }}
                            />
                            {e.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {keywordRankMatrix.map(({ kw, byEntity, bestRank }) => (
                        <tr key={kw.id} className="border-b hover:bg-muted/30" data-testid={`row-keyword-${kw.id}`}>
                          <td className="py-2 pr-4">
                            <span className="font-medium">{kw.keyword}</span>
                            <span className="ml-1.5 text-[10px] text-muted-foreground uppercase">{kw.country}</span>
                          </td>
                          {sortedEntities.map((e) => {
                            const rank = byEntity.get(e.entityId) ?? null;
                            const isBest = rank !== null && rank > 0 && rank === bestRank;
                            const rankClass =
                              rank === null || rank === 0 ? "text-muted-foreground/50" :
                              rank <= 3 ? "text-emerald-600" :
                              rank <= 10 ? "text-yellow-600" :
                              rank <= 20 ? "text-orange-500" :
                              "text-muted-foreground";
                            return (
                              <td
                                key={e.entityId}
                                className="py-2 px-3 text-center"
                                data-testid={`cell-rank-${kw.id}-${e.entityId}`}
                              >
                                <span className={`${rankClass} ${isBest ? "font-bold text-base" : "text-sm"}`}>
                                  {rank !== null && rank > 0 ? `#${rank}` : "—"}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/20">
                        <td className="py-2 pr-4 text-xs text-muted-foreground font-medium">Avg Rank</td>
                        {sortedEntities.map((e) => (
                          <td key={e.entityId} className="py-2 px-3 text-center text-xs text-muted-foreground font-medium">
                            {e.averageRank !== null ? e.averageRank.toFixed(1) : "—"}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {isAdmin ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Plus className="h-4 w-4" /> Track a Keyword
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label htmlFor="seo-new-keyword">Keyword</Label>
                  <Input
                    id="seo-new-keyword"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    placeholder="e.g. competitive intelligence platform"
                    data-testid="input-new-keyword"
                    onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                  />
                </div>
                <div>
                  <Label htmlFor="seo-new-country">Country (ISO code)</Label>
                  <Input
                    id="seo-new-country"
                    value={newCountry}
                    onChange={(e) => setNewCountry(e.target.value)}
                    maxLength={4}
                    data-testid="input-new-country"
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={handleAdd}
                  disabled={createMutation.isPending}
                  data-testid="button-add-keyword"
                >
                  {createMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                  Add keyword
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card data-testid="card-admin-only-notice">
              <CardContent className="py-6 text-sm text-muted-foreground flex items-start gap-2">
                <Lock className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>Only Domain or Global Admins can add or remove tracked keywords. Contact your admin to update this list.</span>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tracked Keywords ({keywords.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {keywords.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-keywords-empty">No keywords yet.</p>
              ) : (
                keywords.map((k) => (
                  <div
                    key={k.id}
                    className="flex items-center justify-between border rounded-md px-3 py-2"
                    data-testid={`item-keyword-${k.id}`}
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{k.keyword}</p>
                      <p className="text-xs text-muted-foreground uppercase">{k.country} · {k.locale}</p>
                    </div>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(k.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-keyword-${k.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
