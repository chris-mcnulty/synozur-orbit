import React, { useMemo, useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line,
  BarChart, Bar,
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Loader2, Download, BarChart2, TrendingUp, MessageSquare, Activity as ActivityIcon, DollarSign } from "lucide-react";

type Range = "30d" | "90d" | "180d" | "365d";

function rangeToFrom(range: Range, now: Date = new Date()): Date {
  const days = range === "30d" ? 30 : range === "90d" ? 90 : range === "180d" ? 180 : 365;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

interface Competitor { id: string; name: string }

function downloadCsv(filename: string, rows: Record<string, any>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(","),
    ...rows.map(r => headers.map(h => escape(r[h])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const CHART_COLORS = [
  "#810FFB", "#E60CB3", "#0EA5E9", "#10B981", "#F59E0B",
  "#EF4444", "#8B5CF6", "#EC4899", "#22C55E", "#F97316",
];

function colorFor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

interface EngagementPoint {
  snapshotAt: string;
  competitorId: string;
  platform: string;
  followers: number | null;
  posts: number | null;
  reactions: number | null;
  comments: number | null;
  likes: number | null;
}

interface BucketSeriesPoint {
  bucket: string;
  competitorId: string;
  count: number;
}

interface SentimentPoint {
  bucket: string;
  competitorId: string;
  avgSentiment: number;
  count: number;
}

interface PricingPoint {
  snapshotAt: string;
  competitorId: string;
  cheapestTier: { name: string; priceAmount: number } | null;
  dearestTier: { name: string; priceAmount: number } | null;
  currency: string | null;
}

// Pivot [{bucket, competitorId, value}] into wide-form rows keyed by competitorId
// (NOT name) so two competitors that share a display name don't collide in the
// chart or CSV export. Series labels in the legend/tooltip come from the
// competitorNames lookup passed to each `<Line/Bar/Area name={...} />`.
function pivotByCompetitor<T extends { bucket: string; competitorId: string }>(
  rows: T[],
  valueKey: keyof T,
) {
  const byBucket = new Map<string, Record<string, any>>();
  const competitorIds = new Set<string>();
  for (const row of rows) {
    competitorIds.add(row.competitorId);
    const existing = byBucket.get(row.bucket) || { bucket: row.bucket };
    existing[row.competitorId] = row[valueKey];
    byBucket.set(row.bucket, existing);
  }
  return {
    data: Array.from(byBucket.values()).sort((a, b) => a.bucket.localeCompare(b.bucket)),
    competitorIds: Array.from(competitorIds),
  };
}

export default function InsightsVisualizationsPage() {
  const [range, setRange] = useState<Range>("90d");
  const [bucket, setBucket] = useState<"day" | "week" | "month">("week");
  const [platform, setPlatform] = useState<string>("linkedin");
  const [engagementMetric, setEngagementMetric] = useState<"followers" | "posts" | "reactions" | "comments" | "likes">("followers");

  const { from, until } = useMemo(() => {
    const until = new Date();
    return { from: rangeToFrom(range, until), until };
  }, [range]);

  const params = useMemo(() => {
    const q = new URLSearchParams();
    q.set("from", from.toISOString());
    q.set("until", until.toISOString());
    q.set("bucket", bucket);
    return q.toString();
  }, [from, until, bucket]);

  const { data: competitors = [] } = useQuery<Competitor[]>({
    queryKey: ["/api/competitors"],
    queryFn: async () => {
      const res = await fetch("/api/competitors", { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : (data.items || []);
    },
  });
  const { data: companyProfile } = useQuery<{ id: string; companyName: string } | null>({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const res = await fetch("/api/company-profile", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });
  const competitorNames = useMemo(() => {
    const m = new Map<string, string>();
    competitors.forEach(c => m.set(c.id, c.name));
    if (companyProfile) {
      m.set(`baseline:${companyProfile.id}`, `${companyProfile.companyName} (You)`);
    }
    return m;
  }, [competitors, companyProfile]);

  const engagement = useQuery<{ points: EngagementPoint[] }>({
    queryKey: ["/api/dashboard/visualizations/engagement-trends", params, platform],
    queryFn: async () => {
      const q = new URLSearchParams(params);
      q.set("platforms", platform);
      const res = await fetch(`/api/dashboard/visualizations/engagement-trends?${q.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load engagement");
      return res.json();
    },
  });

  const postingFreq = useQuery<{ series: BucketSeriesPoint[] }>({
    queryKey: ["/api/dashboard/visualizations/posting-frequency", params],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/visualizations/posting-frequency?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load posting frequency");
      return res.json();
    },
  });

  const sentiment = useQuery<{ series: SentimentPoint[] }>({
    queryKey: ["/api/dashboard/visualizations/sentiment-trends", params],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/visualizations/sentiment-trends?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load sentiment");
      return res.json();
    },
  });

  const activityByComp = useQuery<{ series: BucketSeriesPoint[] }>({
    queryKey: ["/api/dashboard/visualizations/activity-by-competitor", params],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/visualizations/activity-by-competitor?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load activity");
      return res.json();
    },
  });

  const pricing = useQuery<{ points: PricingPoint[] }>({
    queryKey: ["/api/dashboard/visualizations/pricing-trends", params],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/visualizations/pricing-trends?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load pricing");
      return res.json();
    },
  });

  // Resolve a stable, unique label for a competitorId; falls back to a short id stub so
  // collisions stay distinct in legends even when names are missing.
  const labelFor = (competitorId: string): string => {
    const name = competitorNames.get(competitorId);
    return name ? `${name}` : competitorId.slice(0, 8);
  };

  // Engagement chart: bucket engagement snapshots into the selected bucket and pick the
  // latest value per competitor per bucket. Wide-form data keyed by competitorId (not name).
  const engagementChart = useMemo(() => {
    const points = engagement.data?.points || [];
    const buckets = new Map<string, Record<string, any>>();
    const latestPerBucket = new Map<string, Map<string, EngagementPoint>>();
    const competitorIds = new Set<string>();
    for (const p of points) {
      competitorIds.add(p.competitorId);
      const d = new Date(p.snapshotAt);
      const bucketKey = (() => {
        d.setUTCHours(0, 0, 0, 0);
        if (bucket === "week") d.setUTCDate(d.getUTCDate() - d.getUTCDay());
        if (bucket === "month") d.setUTCDate(1);
        return d.toISOString().split("T")[0];
      })();
      const inner = latestPerBucket.get(bucketKey) || new Map<string, EngagementPoint>();
      const existing = inner.get(p.competitorId);
      if (!existing || new Date(existing.snapshotAt) < new Date(p.snapshotAt)) {
        inner.set(p.competitorId, p);
      }
      latestPerBucket.set(bucketKey, inner);
    }
    latestPerBucket.forEach((byCompetitor, bucketKey) => {
      const row: Record<string, any> = { bucket: bucketKey };
      byCompetitor.forEach((point, competitorId) => {
        row[competitorId] = point[engagementMetric];
      });
      buckets.set(bucketKey, row);
    });
    return {
      data: Array.from(buckets.values()).sort((a, b) => a.bucket.localeCompare(b.bucket)),
      competitorIds: Array.from(competitorIds),
    };
  }, [engagement.data, engagementMetric, bucket]);

  const postingChart = useMemo(() =>
    pivotByCompetitor(postingFreq.data?.series || [], "count"),
  [postingFreq.data]);

  const sentimentChart = useMemo(() =>
    pivotByCompetitor(sentiment.data?.series || [], "avgSentiment"),
  [sentiment.data]);

  const activityChart = useMemo(() =>
    pivotByCompetitor(activityByComp.data?.series || [], "count"),
  [activityByComp.data]);

  const pricingChart = useMemo(() => {
    const buckets = new Map<string, Record<string, any>>();
    const competitorIds = new Set<string>();
    for (const p of pricing.data?.points || []) {
      competitorIds.add(p.competitorId);
      const d = new Date(p.snapshotAt);
      d.setUTCHours(0, 0, 0, 0);
      if (bucket === "week") d.setUTCDate(d.getUTCDate() - d.getUTCDay());
      if (bucket === "month") d.setUTCDate(1);
      const bucketKey = d.toISOString().split("T")[0];
      const row = buckets.get(bucketKey) || { bucket: bucketKey };
      if (p.cheapestTier) row[p.competitorId] = p.cheapestTier.priceAmount;
      buckets.set(bucketKey, row);
    }
    return {
      data: Array.from(buckets.values()).sort((a, b) => a.bucket.localeCompare(b.bucket)),
      competitorIds: Array.from(competitorIds),
    };
  }, [pricing.data, bucket]);

  return (
    <AppLayout>
      <div className="container mx-auto p-6 space-y-6" data-testid="page-insights-visualizations">
        <div className="page-header-gradient-bar" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <BarChart2 className="h-7 w-7 text-primary" />
              Competitive Visualizations
            </h1>
            <p className="text-muted-foreground mt-1">
              Engagement, posting, sentiment, and pricing trends across your tracked competitors.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={range} onValueChange={(v) => setRange(v as Range)}>
              <SelectTrigger className="w-32" data-testid="select-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="180d">Last 180 days</SelectItem>
                <SelectItem value="365d">Last year</SelectItem>
              </SelectContent>
            </Select>
            <Select value={bucket} onValueChange={(v) => setBucket(v as any)}>
              <SelectTrigger className="w-28" data-testid="select-bucket">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Daily</SelectItem>
                <SelectItem value="week">Weekly</SelectItem>
                <SelectItem value="month">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Engagement Trends */}
          <Card data-testid="card-engagement-trends">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <TrendingUp className="h-5 w-5 text-primary" /> Engagement Trends
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Latest captured {engagementMetric} per bucket
                  </p>
                </div>
                <div className="flex gap-2">
                  <Select value={platform} onValueChange={setPlatform}>
                    <SelectTrigger className="w-32" data-testid="select-platform">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="linkedin">LinkedIn</SelectItem>
                      <SelectItem value="instagram">Instagram</SelectItem>
                      <SelectItem value="twitter">Twitter/X</SelectItem>
                      <SelectItem value="facebook">Facebook</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={engagementMetric} onValueChange={(v) => setEngagementMetric(v as any)}>
                    <SelectTrigger className="w-32" data-testid="select-metric">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="followers">Followers</SelectItem>
                      <SelectItem value="posts">Posts</SelectItem>
                      <SelectItem value="reactions">Reactions</SelectItem>
                      <SelectItem value="comments">Comments</SelectItem>
                      <SelectItem value="likes">Likes</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => downloadCsv("engagement-trends.csv", engagement.data?.points || [])}
                    disabled={!engagement.data?.points?.length}
                    data-testid="button-export-engagement"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {engagement.isLoading ? (
                <div className="flex items-center justify-center h-72"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : engagementChart.data.length === 0 ? (
                <EmptyChart message="No engagement snapshots yet for this platform & range." />
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={engagementChart.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="bucket" fontSize={11} />
                    <YAxis fontSize={11} />
                    <ReTooltip />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    {engagementChart.competitorIds.map((id, idx) => (
                      <Line key={id} type="monotone" dataKey={id} name={labelFor(id)} stroke={colorFor(idx)} strokeWidth={2} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Posting Frequency */}
          <Card data-testid="card-posting-frequency">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ActivityIcon className="h-5 w-5 text-primary" /> Posting Frequency
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Blog + social posts per competitor per {bucket}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => downloadCsv("posting-frequency.csv", postingFreq.data?.series || [])}
                  disabled={!postingFreq.data?.series?.length}
                  data-testid="button-export-posting"
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {postingFreq.isLoading ? (
                <div className="flex items-center justify-center h-72"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : postingChart.data.length === 0 ? (
                <EmptyChart message="No posting events tracked in this range." />
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={postingChart.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="bucket" fontSize={11} />
                    <YAxis fontSize={11} allowDecimals={false} />
                    <ReTooltip />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    {postingChart.competitorIds.map((id, idx) => (
                      <Bar key={id} dataKey={id} name={labelFor(id)} stackId="posts" fill={colorFor(idx)} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Sentiment Over Time */}
          <Card data-testid="card-sentiment-trends">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MessageSquare className="h-5 w-5 text-primary" /> Sentiment Over Time
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Average AI sentiment score per {bucket} (-1 to +1)
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => downloadCsv("sentiment-trends.csv", sentiment.data?.series || [])}
                  disabled={!sentiment.data?.series?.length}
                  data-testid="button-export-sentiment"
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {sentiment.isLoading ? (
                <div className="flex items-center justify-center h-72"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : sentimentChart.data.length === 0 ? (
                <EmptyChart message="No sentiment-scored activity in this range." />
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={sentimentChart.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="bucket" fontSize={11} />
                    <YAxis fontSize={11} domain={[-1, 1]} />
                    <ReTooltip />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    {sentimentChart.competitorIds.map((id, idx) => (
                      <Area key={id} type="monotone" dataKey={id} name={labelFor(id)} stroke={colorFor(idx)} fill={colorFor(idx)} fillOpacity={0.18} />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Activity by Competitor */}
          <Card data-testid="card-activity-by-competitor">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BarChart2 className="h-5 w-5 text-primary" /> Activity by Competitor
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    All tracked events per competitor per {bucket}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => downloadCsv("activity-by-competitor.csv", activityByComp.data?.series || [])}
                  disabled={!activityByComp.data?.series?.length}
                  data-testid="button-export-activity"
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {activityByComp.isLoading ? (
                <div className="flex items-center justify-center h-72"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : activityChart.data.length === 0 ? (
                <EmptyChart message="No competitor activity in this range." />
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={activityChart.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="bucket" fontSize={11} />
                    <YAxis fontSize={11} allowDecimals={false} />
                    <ReTooltip />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    {activityChart.competitorIds.map((id, idx) => (
                      <Bar key={id} dataKey={id} name={labelFor(id)} stackId="activity" fill={colorFor(idx)} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Bonus: Pricing Trends */}
          <Card className="lg:col-span-2" data-testid="card-pricing-trends">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <DollarSign className="h-5 w-5 text-primary" /> Entry-Tier Pricing Trends
                    <Badge variant="outline" className="text-[10px]">requires Pricing Intelligence</Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Lowest captured tier price per competitor over time
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => downloadCsv("pricing-trends.csv", pricing.data?.points || [])}
                  disabled={!pricing.data?.points?.length}
                  data-testid="button-export-pricing"
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {pricing.isLoading ? (
                <div className="flex items-center justify-center h-72"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : pricingChart.data.length === 0 ? (
                <EmptyChart message="No pricing snapshots captured in this range yet." />
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={pricingChart.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="bucket" fontSize={11} />
                    <YAxis fontSize={11} />
                    <ReTooltip />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    {pricingChart.competitorIds.map((id, idx) => (
                      <Line key={id} type="stepAfter" dataKey={id} name={labelFor(id)} stroke={colorFor(idx)} strokeWidth={2} dot connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-72 text-muted-foreground text-sm gap-2">
      <BarChart2 className="h-10 w-10 opacity-30" />
      <p>{message}</p>
    </div>
  );
}
