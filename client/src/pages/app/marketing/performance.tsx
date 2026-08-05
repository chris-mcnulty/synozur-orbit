import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { AnalyticsViewSwitcher } from "@/components/marketing/AnalyticsViewSwitcher";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LineChart, Loader2, Sparkles, Lightbulb, TrendingUp, TrendingDown, GitMerge, BarChart3 } from "lucide-react";
import { FeatureGate } from "@/components/UpgradePrompt";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PerfMetrics {
  totals: { posts: number; clicks: number; conversions: number; revenue: number; sessions: number };
  benchmark: { hasBaseline: boolean; clicksIndex?: number; conversionsIndex?: number } | null;
  byCampaign: Array<{ campaignId: string | null; name: string; posts: number; clicks: number; conversions: number; revenue: number }>;
  perContent: Array<{ assetId: string; title: string; postsPublished: number; clicks: number; campaigns: string[] }>;
}

interface PerfReport {
  id: string;
  periodStart: string;
  periodEnd: string;
  summary: string | null;
  metrics: PerfMetrics | null;
  recommendationsEmitted: number;
  createdAt: string;
}

interface EmittedRec {
  id: string;
  title: string;
  description: string;
  impact: string;
}

export type AttributionModel = "first-touch" | "last-touch" | "linear" | "position-based";

const ATTRIBUTION_MODEL_LABELS: Record<AttributionModel, string> = {
  "first-touch": "First Touch",
  "last-touch": "Last Touch",
  "linear": "Linear",
  "position-based": "Position-Based (U-Shaped)",
};

interface AttributionCampaignRow {
  campaignId: string | null;
  campaignName: string;
  creditedConversions: number;
  touchpoints: number;
}

interface AttributionResult {
  model: AttributionModel;
  days: number;
  byCampaign: AttributionCampaignRow[];
  conversions: number;
  touchpointCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getJson(url: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return null;
  return res.json();
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

function IndexBadge({ label, value }: { label: string; value?: number }) {
  if (value == null) return null;
  const up = value >= 100;
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      {up ? <TrendingUp className="h-4 w-4 text-emerald-600" /> : <TrendingDown className="h-4 w-4 text-red-600" />}
      {label}: <strong>{value}</strong> <span className="text-muted-foreground">vs history</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Attribution panel
// ---------------------------------------------------------------------------

function AttributionPanel() {
  const [model, setModel] = useState<AttributionModel>("last-touch");
  const [days, setDays] = useState("30");

  const { data, isFetching } = useQuery<AttributionResult | null>({
    queryKey: ["/api/marketing/attribution", model, days],
    queryFn: () => getJson(`/api/marketing/attribution?model=${model}&days=${days}`),
  });

  const totalCredit = data?.byCampaign.reduce((s, r) => s + r.creditedConversions, 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Model:</span>
          <Select value={model} onValueChange={(v) => setModel(v as AttributionModel)}>
            <SelectTrigger className="w-[220px]" data-testid="select-attribution-model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(ATTRIBUTION_MODEL_LABELS) as [AttributionModel, string][]).map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Period:</span>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Summary stats */}
      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Conversions tracked" value={data.conversions} />
          <Stat label="Touchpoints" value={data.touchpointCount} />
          <Stat label="Credited campaigns" value={data.byCampaign.length} />
        </div>
      )}

      {/* Attribution table */}
      {data && data.byCampaign.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <GitMerge className="h-4 w-4 text-primary" />
              Campaign credit — {ATTRIBUTION_MODEL_LABELS[model]}
            </CardTitle>
            <CardDescription>
              Credited conversions across {data.days}-day window. Each conversion = 1 unit of credit distributed across touchpoints per model.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y rounded-md border text-sm">
              <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
                <span className="col-span-5">Campaign</span>
                <span className="col-span-3 text-right">Credited conv.</span>
                <span className="col-span-2 text-right">Touchpoints</span>
                <span className="col-span-2 text-right">Share</span>
              </div>
              {data.byCampaign.map((row, i) => {
                const share = totalCredit > 0 ? (row.creditedConversions / totalCredit) * 100 : 0;
                return (
                  <div key={row.campaignId ?? `none-${i}`} className="grid grid-cols-12 gap-2 px-3 py-2 items-center">
                    <span className="col-span-5 truncate">{row.campaignName}</span>
                    <span className="col-span-3 text-right font-medium">{row.creditedConversions.toFixed(2)}</span>
                    <span className="col-span-2 text-right text-muted-foreground">{row.touchpoints}</span>
                    <div className="col-span-2 flex items-center gap-1.5 justify-end">
                      <div className="h-1.5 flex-1 max-w-[40px] rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.min(share, 100)}%` }}
                        />
                      </div>
                      <span className="text-muted-foreground text-xs w-9 text-right">{share.toFixed(0)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : data && data.byCampaign.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <BarChart3 className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium">No attribution data yet</p>
              <p className="text-sm text-muted-foreground">
                Attribution requires contact events (form submits, lifecycle changes) linked to marketing touchpoints. Connect your website or ingest contact events to see campaign credit.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Model legend */}
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Attribution model guide</p>
        <p><strong>First Touch:</strong> 100 % credit to the first interaction before conversion.</p>
        <p><strong>Last Touch:</strong> 100 % credit to the last interaction before conversion (matches the existing performance report).</p>
        <p><strong>Linear:</strong> Equal credit split across all touchpoints.</p>
        <p><strong>Position-Based (U-Shaped):</strong> 40 % first + 40 % last + 20 % split across middle touchpoints.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MarketingPerformancePage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [latestRecs, setLatestRecs] = useState<EmittedRec[] | null>(null);

  const { data: tenant } = useQuery<{ features?: Record<string, boolean> } | null>({
    queryKey: ["/api/tenant/info"],
    queryFn: () => getJson("/api/tenant/info"),
  });
  const allowed = tenant?.features?.marketingPerformance !== false;

  const { data: reports } = useQuery<PerfReport[]>({
    queryKey: ["/api/marketing/performance-reports"],
    queryFn: async () => (await getJson("/api/marketing/performance-reports")) ?? [],
  });

  const activeId = selectedId ?? reports?.[0]?.id ?? null;
  const report = reports?.find((r) => r.id === activeId) ?? null;
  const m = report?.metrics ?? null;

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/marketing/performance-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to generate report");
      return res.json();
    },
    onSuccess: (data: { report: PerfReport; recommendations: EmittedRec[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/performance-reports"] });
      setSelectedId(data.report.id);
      setLatestRecs(data.recommendations);
      toast.success(
        data.recommendations.length
          ? `Report ready — ${data.recommendations.length} recommendations sent to the editorial calendar`
          : "Report ready",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const period = report ? `${report.periodStart.slice(0, 10)} → ${report.periodEnd.slice(0, 10)}` : "";

  return (
    <AppLayout>
      <FeatureGate
        feature="Marketing Performance"
        requiredPlan="Enterprise"
        isAllowed={allowed}
        description="Generate a closed-loop content performance report — per-content attribution from first-party clicks and GA4 conversions, benchmarked against your history, with recommendations that feed the editorial calendar. Upgrade to unlock."
      >
        <div className="space-y-6 p-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-semibold">
                <LineChart className="h-6 w-6 text-primary" />
                Marketing Performance
              </h1>
              <p className="text-sm text-muted-foreground">
                Conversion-first content report. Recommendations flow back into the editorial calendar — closing the loop.
              </p>
              <AnalyticsViewSwitcher className="mt-3" />
            </div>
            <Button onClick={() => generate.mutate()} disabled={generate.isPending} data-testid="button-generate-report">
              {generate.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate report
                </>
              )}
            </Button>
          </div>

          <Tabs defaultValue="report">
            <TabsList>
              <TabsTrigger value="report">
                <LineChart className="h-4 w-4 mr-1.5" />
                Performance Report
              </TabsTrigger>
              <TabsTrigger value="attribution">
                <GitMerge className="h-4 w-4 mr-1.5" />
                Multi-Touch Attribution
              </TabsTrigger>
            </TabsList>

            {/* ── Performance Report tab ── */}
            <TabsContent value="report" className="mt-4 space-y-4">
              {reports && reports.length > 0 ? (
                <Select value={activeId ?? undefined} onValueChange={setSelectedId}>
                  <SelectTrigger className="w-[340px]" data-testid="select-report">
                    <SelectValue placeholder="Select a report" />
                  </SelectTrigger>
                  <SelectContent>
                    {reports.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.periodStart.slice(0, 10)} → {r.periodEnd.slice(0, 10)} ({new Date(r.createdAt).toLocaleDateString()})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                    <LineChart className="h-10 w-10 text-muted-foreground" />
                    <div>
                      <p className="font-medium">No reports yet</p>
                      <p className="text-sm text-muted-foreground">
                        Generate a performance report for the last 30 days to see what's working.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {report && m && (
                <>
                  {report.summary && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Analyst summary</CardTitle>
                        <CardDescription>{period}</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <p className="text-sm">{report.summary}</p>
                        {m.benchmark?.hasBaseline && (
                          <div className="flex flex-wrap gap-4">
                            <IndexBadge label="Clicks" value={m.benchmark.clicksIndex} />
                            <IndexBadge label="Conversions" value={m.benchmark.conversionsIndex} />
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <Stat label="Posts" value={m.totals.posts} />
                    <Stat label="Clicks" value={m.totals.clicks} />
                    <Stat label="Conversions" value={m.totals.conversions} />
                    <Stat label="Revenue" value={`$${(m.totals.revenue / 100).toFixed(0)}`} />
                    <Stat label="Sessions" value={m.totals.sessions} />
                  </div>

                  {(latestRecs?.length ?? 0) > 0 && report.id === activeId && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Lightbulb className="h-4 w-4 text-amber-500" />
                          Recommendations (sent to the editorial calendar)
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {latestRecs!.map((r) => (
                          <div key={r.id} className="rounded-md border p-3">
                            <div className="flex items-center gap-2">
                              <Badge variant={r.impact === "High" ? "default" : "secondary"}>{r.impact}</Badge>
                              <p className="font-medium">{r.title}</p>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {m.byCampaign.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">By campaign</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="divide-y rounded-md border text-sm">
                          <div className="grid grid-cols-5 gap-2 px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
                            <span className="col-span-2">Campaign</span>
                            <span className="text-right">Posts</span>
                            <span className="text-right">Clicks</span>
                            <span className="text-right">Conv.</span>
                          </div>
                          {m.byCampaign.map((c, i) => (
                            <div key={c.campaignId ?? `none-${i}`} className="grid grid-cols-5 gap-2 px-3 py-2">
                              <span className="col-span-2 truncate">{c.name}</span>
                              <span className="text-right">{c.posts}</span>
                              <span className="text-right">{c.clicks}</span>
                              <span className="text-right">{c.conversions}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {m.perContent.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">By content</CardTitle>
                        <CardDescription>Campaign-attributed clicks (lowest granularity the data supports)</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="divide-y rounded-md border text-sm">
                          {m.perContent.map((c) => (
                            <div key={c.assetId} className="flex items-center justify-between gap-2 px-3 py-2">
                              <span className="truncate">{c.title}</span>
                              <span className="flex shrink-0 items-center gap-3 text-muted-foreground">
                                <span>{c.postsPublished} posts</span>
                                <span className="font-medium text-foreground">{c.clicks} clicks</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </TabsContent>

            {/* ── Multi-Touch Attribution tab ── */}
            <TabsContent value="attribution" className="mt-4">
              <AttributionPanel />
            </TabsContent>
          </Tabs>
        </div>
      </FeatureGate>
    </AppLayout>
  );
}
