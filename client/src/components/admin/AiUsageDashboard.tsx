import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Brain, DollarSign, Activity, TrendingUp, Loader2, AlertCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FeatureRow {
  operation: string;
  calls: string | number;
  total_input_tokens: string | number;
  total_output_tokens: string | number;
  tokens: string | number;
  cost: string | number | null;
  avg_duration_ms: string | number | null;
}

interface DailyRow {
  date: string;
  calls: string | number;
  tokens: string | number;
  cost: string | number | null;
}

interface AiUsageStatsResponse {
  period: { days: number; since: string };
  tenantDomain: string | null;
  totals: {
    total_calls: string | number;
    total_input_tokens: string | number;
    total_output_tokens: string | number;
    total_tokens: string | number;
    total_cost: string | number | null;
    total_errors: string | number;
  };
  byFeature: FeatureRow[];
  dailyTrend: DailyRow[];
  byModel: Array<{ model: string; provider: string; calls: string | number; tokens: string | number; cost: string | number | null }>;
  tenants: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Human-readable labels for known operation names
const OPERATION_LABELS: Record<string, string> = {
  analyze_competitor: "Competitor Analysis",
  analyze_company: "Company Analysis",
  analyze_website_changes: "Website Change Analysis",
  generate_battlecard: "Battlecard Generation",
  regen_battlecard: "Battlecard Regeneration",
  generate_recommendations: "Recommendations",
  generate_executive_summary: "Executive Summary",
  analyze_product: "Product Analysis",
  generate_briefing: "Intelligence Briefing",
  generate_social_post: "Social Post Generation",
  generate_content_brief: "Content Brief Generation",
  generate_campaign: "Campaign Planning",
  generate_posts: "Post Generation",
  generate_post_variants: "Post Variants",
  repurpose_content: "Content Repurposing",
  crawl_website: "Website Crawling",
  ai_company_research: "Company Research",
  analyze_sentiment: "Sentiment Analysis",
  distribution_planner: "Distribution Planning",
};

function labelFor(operation: string): string {
  return OPERATION_LABELS[operation] ?? operation.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function toNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : parseFloat(v) || 0;
}

function fmtCost(v: string | number | null | undefined): string {
  return `$${toNum(v).toFixed(4)}`;
}

function fmtTokens(v: string | number | null | undefined): string {
  const n = toNum(v);
  return n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
    ? `${(n / 1_000).toFixed(1)}K`
    : String(Math.round(n));
}

// Chart color palette sourced from CSS variables with fallbacks
const FALLBACK_COLORS = [
  "hsl(221.2 83.2% 53.3%)",
  "hsl(212 95% 68%)",
  "hsl(216 92% 60%)",
  "hsl(210 98% 78%)",
  "hsl(215 20.2% 65.1%)",
];

let _cachedColors: string[] | null = null;
function chartColor(i: number): string {
  if (!_cachedColors) {
    if (typeof window !== "undefined") {
      const s = getComputedStyle(document.documentElement);
      _cachedColors = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"].map(
        (v, idx) => {
          const val = s.getPropertyValue(v).trim();
          return val ? `hsl(${val})` : FALLBACK_COLORS[idx];
        }
      );
    } else {
      _cachedColors = FALLBACK_COLORS;
    }
  }
  return _cachedColors[i % _cachedColors.length];
}

// ─── Main Component ───────────────────────────────────────────────────────────

const DAY_OPTIONS = [
  { label: "Last 7 days", value: "7" },
  { label: "Last 30 days", value: "30" },
  { label: "Last 90 days", value: "90" },
];

export function AiUsageDashboard() {
  const [days, setDays] = useState("30");
  const [tenantDomain, setTenantDomain] = useState("__all__");

  const params = new URLSearchParams({ days });
  if (tenantDomain && tenantDomain !== "__all__") params.set("tenantDomain", tenantDomain);

  const { data: stats, isLoading, isError } = useQuery<AiUsageStatsResponse>({
    queryKey: [`/api/admin/ai-usage/stats?${params.toString()}`],
  });

  // ── Filters ────────────────────────────────────────────────────────────────
  const tenantOptions = stats?.tenants ?? [];

  // ── Derived data ───────────────────────────────────────────────────────────
  const byFeature: FeatureRow[] = stats?.byFeature ?? [];
  const totalCost = toNum(stats?.totals.total_cost);
  const totalCalls = toNum(stats?.totals.total_calls);
  const totalInputTokens = toNum(stats?.totals.total_input_tokens);
  const totalOutputTokens = toNum(stats?.totals.total_output_tokens);

  // Bar chart: top operations by cost (max 10)
  const costChartData = [...byFeature]
    .sort((a, b) => toNum(b.cost) - toNum(a.cost))
    .slice(0, 10)
    .map((r) => ({
      name: labelFor(r.operation),
      cost: toNum(r.cost),
    }));

  // Daily trend data
  const dailyData = (stats?.dailyTrend ?? []).map((r) => ({
    date: new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    calls: toNum(r.calls),
    cost: toNum(r.cost),
  }));

  const avgDailyCalls = dailyData.length > 0
    ? Math.round(dailyData.reduce((s, d) => s + d.calls, 0) / dailyData.length)
    : 0;

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading AI usage statistics…
        </div>
      </Card>
    );
  }

  if (isError || !stats) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center text-muted-foreground gap-2">
          <AlertCircle className="h-5 w-5" />
          Failed to load AI usage data
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DAY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={tenantDomain} onValueChange={setTenantDomain}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="All tenants" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All tenants</SelectItem>
            {tenantOptions.map((d) => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Summary cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-5" data-testid="card-total-requests">
          <div className="flex items-center gap-2 mb-1">
            <Brain className="h-4 w-4 text-primary" />
            <span className="text-sm text-muted-foreground">Total Requests</span>
          </div>
          <div className="text-3xl font-bold">{totalCalls.toLocaleString()}</div>
        </Card>

        <Card className="p-5" data-testid="card-estimated-cost">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="h-4 w-4 text-chart-2" />
            <span className="text-sm text-muted-foreground">Total AI Cost</span>
          </div>
          <div className="text-3xl font-bold">${totalCost.toFixed(2)}</div>
        </Card>

        <Card className="p-5" data-testid="card-avg-daily">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-4 w-4 text-chart-3" />
            <span className="text-sm text-muted-foreground">Avg Daily Calls</span>
          </div>
          <div className="text-3xl font-bold">{avgDailyCalls.toLocaleString()}</div>
        </Card>

        <Card className="p-5" data-testid="card-most-used">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4 text-chart-4" />
            <span className="text-sm text-muted-foreground">Top Cost Driver</span>
          </div>
          <div className="text-base font-bold leading-tight">
            {byFeature.length > 0
              ? labelFor([...byFeature].sort((a, b) => toNum(b.cost) - toNum(a.cost))[0].operation)
              : "—"}
          </div>
        </Card>
      </div>

      {/* ── Cost breakdown table ────────────────────────────────────────────── */}
      <Card className="p-6" data-testid="card-cost-breakdown">
        <h3 className="text-lg font-semibold mb-4">AI Cost Breakdown by Feature</h3>
        {byFeature.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            No AI usage recorded for this period
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Feature / Operation</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Input Tokens</TableHead>
                <TableHead className="text-right">Output Tokens</TableHead>
                <TableHead className="text-right">Est. Cost</TableHead>
                <TableHead className="text-right">% of Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...byFeature]
                .sort((a, b) => toNum(b.cost) - toNum(a.cost))
                .map((row) => {
                  const rowCost = toNum(row.cost);
                  const pct = totalCost > 0 ? (rowCost / totalCost) * 100 : 0;
                  return (
                    <TableRow key={row.operation}>
                      <TableCell>
                        <div className="font-medium">{labelFor(row.operation)}</div>
                        <div className="text-xs text-muted-foreground font-mono">{row.operation}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {toNum(row.calls).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {fmtTokens(row.total_input_tokens)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {fmtTokens(row.total_output_tokens)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {fmtCost(row.cost)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.min(pct, 100).toFixed(1)}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        )}
        {byFeature.length > 0 && (
          <div className="mt-3 pt-3 border-t flex justify-between text-sm text-muted-foreground">
            <span>
              Totals — {totalCalls.toLocaleString()} calls &middot; {fmtTokens(totalInputTokens)} input &middot; {fmtTokens(totalOutputTokens)} output
            </span>
            <span className="font-medium text-foreground">${totalCost.toFixed(4)} total</span>
          </div>
        )}
      </Card>

      {/* ── Charts row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost by feature bar chart */}
        <Card className="p-6" data-testid="card-cost-chart">
          <h3 className="text-lg font-semibold mb-4">Cost by Feature (Top 10)</h3>
          {costChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={costChartData} layout="vertical" margin={{ left: 16, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground) / 0.2)" horizontal={false} />
                <XAxis
                  type="number"
                  stroke="hsl(var(--muted-foreground) / 0.5)"
                  tickFormatter={(v) => `$${v.toFixed(3)}`}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={140}
                  stroke="hsl(var(--muted-foreground) / 0.5)"
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(v: number) => [`$${v.toFixed(4)}`, "Est. Cost"]}
                  contentStyle={{
                    backgroundColor: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="cost" fill={chartColor(0)} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
              No cost data for this period
            </div>
          )}
        </Card>

        {/* Daily trend chart */}
        <Card className="p-6" data-testid="card-daily-chart">
          <h3 className="text-lg font-semibold mb-4">Daily Calls Trend</h3>
          {dailyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground) / 0.2)" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground) / 0.5)" tick={{ fontSize: 11 }} />
                <YAxis stroke="hsl(var(--muted-foreground) / 0.5)" tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="calls" fill={chartColor(1)} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
              No daily data available
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
