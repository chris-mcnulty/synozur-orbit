import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Legend,
} from "recharts";
import { Download, FileText, RefreshCw, Plug } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface OutcomesPayload {
  range: { start: string; end: string };
  score: {
    value: number;
    weekStart: string;
    components: Record<string, any>;
    businessType: string;
  };
  scoreHistory: Array<{ weekStart: string; score: number; components: any }>;
  totals: { sessions: number; users: number; conversions: number; revenue: number; orbitClicks: number };
  dailySeries: Array<{ date: string; sessions: number; users: number; conversions: number; revenue: number; orbitClicks: number }>;
  sources: Array<{ source: string; medium: string; sessions: number; conversions: number; revenue: number; orbitClicks: number }>;
  sovTrend: Array<{ date: string; sov: number }>;
  topActions: Array<{ id: string; title: string; area: string; impact: string; status: string; isPriority: boolean; attributableScore: number }>;
  seoMovers: { gainers: Array<{ entityName: string; from: number; to: number; delta: number }>; losers: Array<{ entityName: string; from: number; to: number; delta: number }> };
  sinceStart: {
    firstScore: { score: number; weekStart: string } | null;
    currentScore: { score: number; weekStart: string } | null;
    scoreDelta: number | null;
    firstSov: { value: number; capturedAt: string } | null;
  };
  benchmark: { p50: number; p75: number; sampleSize: number; componentP50: any; sicCode: string } | null;
  connection: { provider: string; status: string; propertyId: string | null; propertyName: string | null; lastSyncAt: string | null; lastError: string | null } | null;
  gaConfigured: boolean;
}

const COMPONENT_LABELS: Record<string, string> = {
  sovTrend: "SoV Trend",
  publishRate: "Publish Rate",
  actionCompletion: "Action Completion",
  socialEngagement: "Social Engagement",
  competitorFreshness: "Competitor Coverage",
};

function todayISO() { return new Date().toISOString().slice(0, 10); }
function daysAgoISO(d: number) { return new Date(Date.now() - d * 86400000).toISOString().slice(0, 10); }

export default function InsightsOutcomesPage() {
  const [start, setStart] = useState(daysAgoISO(28));
  const [end, setEnd] = useState(todayISO());

  const { data, isLoading, refetch } = useQuery<OutcomesPayload>({
    queryKey: ["/api/insights/outcomes", start, end],
    queryFn: async () => {
      const res = await fetch(`/api/insights/outcomes?start=${start}&end=${end}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/insights/refresh"),
    onSuccess: () => { setTimeout(() => refetch(), 1500); },
  });

  const exportCsv = () => {
    window.location.href = `/api/insights/outcomes.csv?start=${start}&end=${end}`;
  };
  const exportPdf = () => {
    window.location.href = `/api/insights/outcomes.pdf?start=${start}&end=${end}`;
  };

  const componentsBar = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.score.components)
      .filter(([k]) => k !== "weights")
      .map(([k, v]) => ({
        name: COMPONENT_LABELS[k] || k,
        score: v as number,
        benchmark: data.benchmark?.componentP50?.[k] ?? null,
      }));
  }, [data]);

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-insights-outcomes">
      <Helmet><title>Outcomes & Orbit Score · Orbit</title></Helmet>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">Outcomes & Orbit Score</h1>
          <p className="text-muted-foreground">ROI dashboard linking marketing activity to business outcomes.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-40" data-testid="input-start-date" />
          <span className="text-muted-foreground">→</span>
          <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-40" data-testid="input-end-date" />
          <Button variant="outline" size="sm" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending} data-testid="button-refresh">
            <RefreshCw className="w-4 h-4 mr-1" />{refreshMutation.isPending ? "Refreshing…" : "Refresh"}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid="button-export-csv"><Download className="w-4 h-4 mr-1" />CSV</Button>
          <Button variant="outline" size="sm" onClick={exportPdf} data-testid="button-export-pdf"><FileText className="w-4 h-4 mr-1" />PDF</Button>
        </div>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading outcomes…</p>}

      {data && (
        <>
          {/* GA4 connection state — compact summary that links to Settings */}
          <Card data-testid="card-ga-connection">
            <CardHeader><CardTitle className="flex items-center gap-2"><Plug className="w-4 h-4" /> Google Analytics 4</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              {!data.gaConfigured ? (
                <Alert className="w-full">
                  <AlertTitle>Google Analytics OAuth not configured</AlertTitle>
                  <AlertDescription>Outcomes use UTM-tagged Orbit links only. Ask your admin to set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>.</AlertDescription>
                </Alert>
              ) : data.connection ? (
                <>
                  <Badge variant={data.connection.status === "connected" ? "default" : "destructive"} data-testid="badge-ga-status">{data.connection.status}</Badge>
                  <span className="text-sm" data-testid="text-ga-property">{data.connection.propertyName || data.connection.propertyId || "No property selected"}</span>
                  {data.connection.lastSyncAt && <span className="text-xs text-muted-foreground">Last sync: {new Date(data.connection.lastSyncAt).toLocaleString()}</span>}
                  <Button asChild variant="outline" size="sm" data-testid="link-manage-ga"><a href="/app/settings/integrations">Manage in Settings</a></Button>
                </>
              ) : (
                <>
                  <span className="text-sm text-muted-foreground">Not connected. Outcomes will use UTM-tagged Orbit links only.</span>
                  <Button asChild variant="outline" size="sm" data-testid="link-connect-ga"><a href="/app/settings/integrations">Connect in Settings</a></Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Score tile + components */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="md:col-span-1" data-testid="card-orbit-score">
              <CardHeader><CardTitle>Orbit Score</CardTitle></CardHeader>
              <CardContent>
                <div className="text-7xl font-bold text-primary" data-testid="text-orbit-score">{data.score.value}</div>
                <div className="text-sm text-muted-foreground mt-1">Week of {data.score.weekStart} · {data.score.businessType.toUpperCase()}</div>
                {data.benchmark && (
                  <div className="mt-3 text-sm" data-testid="text-benchmark">
                    Industry median: <strong>{data.benchmark.p50}</strong> · Top quartile: <strong>{data.benchmark.p75}</strong> <span className="text-muted-foreground">(SIC {data.benchmark.sicCode}, n={data.benchmark.sampleSize})</span>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="md:col-span-2" data-testid="card-components">
              <CardHeader><CardTitle>Score components</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={componentsBar}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="score" fill="#810FFB" name="Your score" />
                    {data.benchmark && <Bar dataKey="benchmark" fill="#E60CB3" name="Industry median" />}
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Score history + totals */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card data-testid="card-score-history">
              <CardHeader><CardTitle>Score trend (last 12 weeks)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.scoreHistory}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="weekStart" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="score" stroke="#810FFB" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card data-testid="card-totals">
              <CardHeader><CardTitle>Totals · {data.range.start} → {data.range.end}</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Sessions" value={data.totals.sessions} testid="stat-sessions" />
                  <Stat label="Users" value={data.totals.users} testid="stat-users" />
                  <Stat label="Conversions" value={data.totals.conversions} testid="stat-conversions" />
                  <Stat label="Revenue" value={`$${(data.totals.revenue / 100).toFixed(2)}`} testid="stat-revenue" />
                  <Stat label="Orbit clicks" value={data.totals.orbitClicks} testid="stat-orbit-clicks" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Daily series + SoV trend */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card data-testid="card-daily-series">
              <CardHeader><CardTitle>Sessions & conversions</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={data.dailySeries}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="sessions" stroke="#810FFB" name="Sessions" />
                    <Line type="monotone" dataKey="conversions" stroke="#E60CB3" name="Conversions" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card data-testid="card-sov-trend">
              <CardHeader><CardTitle>Share of Voice trend</CardTitle></CardHeader>
              <CardContent>
                {data.sovTrend.length === 0 ? <p className="text-sm text-muted-foreground">No SoV data in this range.</p> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={data.sovTrend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="sov" stroke="#810FFB" />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* SEO movers */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card data-testid="card-seo-gainers">
              <CardHeader><CardTitle>Top SEO gainers</CardTitle></CardHeader>
              <CardContent>
                {data.seoMovers.gainers.length === 0 ? <p className="text-sm text-muted-foreground">No rank gains in this range.</p> : (
                  <ul className="space-y-1 text-sm">
                    {data.seoMovers.gainers.map((m, i) => (
                      <li key={i} className="flex justify-between" data-testid={`gainer-${i}`}>
                        <span className="truncate">{m.entityName}</span>
                        <span className="text-green-600 font-mono">#{m.from} → #{m.to} (+{m.delta})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card data-testid="card-seo-losers">
              <CardHeader><CardTitle>Top SEO losers</CardTitle></CardHeader>
              <CardContent>
                {data.seoMovers.losers.length === 0 ? <p className="text-sm text-muted-foreground">No rank losses in this range.</p> : (
                  <ul className="space-y-1 text-sm">
                    {data.seoMovers.losers.map((m, i) => (
                      <li key={i} className="flex justify-between" data-testid={`loser-${i}`}>
                        <span className="truncate">{m.entityName}</span>
                        <span className="text-red-600 font-mono">#{m.from} → #{m.to} ({m.delta})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sources + actions */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card data-testid="card-sources">
              <CardHeader><CardTitle>Top sources / mediums</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-muted-foreground">
                    <th className="py-1">Source</th><th>Medium</th><th className="text-right">Sessions</th><th className="text-right">Conv</th><th className="text-right">Orbit</th>
                  </tr></thead>
                  <tbody>
                    {data.sources.length === 0 && <tr><td colSpan={5} className="text-muted-foreground py-3">No traffic recorded yet.</td></tr>}
                    {data.sources.map((s, i) => (
                      <tr key={i} className="border-t" data-testid={`row-source-${i}`}>
                        <td className="py-1">{s.source}</td><td>{s.medium}</td>
                        <td className="text-right">{s.sessions}</td>
                        <td className="text-right">{s.conversions}</td>
                        <td className="text-right">{s.orbitClicks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <Card data-testid="card-top-actions">
              <CardHeader><CardTitle>Top recommended actions</CardTitle></CardHeader>
              <CardContent>
                {data.topActions.length === 0 ? <p className="text-sm text-muted-foreground">No recommendations in this range.</p> : (
                  <ul className="space-y-2">
                    {data.topActions.map((a) => (
                      <li key={a.id} className="border-l-2 border-primary pl-3" data-testid={`action-${a.id}`}>
                        <div className="font-medium">{a.title}</div>
                        <div className="text-xs text-muted-foreground">{a.area} · {a.impact} impact · {a.status}{a.isPriority ? " · priority" : ""} · score {a.attributableScore}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, testid }: { label: string; value: any; testid: string }) {
  return (
    <div className="border rounded p-3" data-testid={testid}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
