/**
 * "Clicks by campaign" leaderboard for the marketing Performance tab.
 * Rolls up tracked-link clicks per campaign (last 30 days) and ranks them.
 * Destinations are surfaced ahead of raw link count because Orbit mints one
 * link per post variation — link counts overstate, destinations don't.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface AnalyticsLink {
  campaignId: string | null;
  campaignName: string | null;
  destinationUrl: string;
  recentClicks: number;
  sparkline: number[];
}

interface AnalyticsResp {
  days: number;
  links: AnalyticsLink[];
}

interface Row {
  campaignId: string;
  name: string;
  recentClicks: number;
  destinations: number;
  links: number;
  trendPct: number | null;
}

export function ClicksByCampaign() {
  const { data, isLoading } = useQuery<AnalyticsResp>({
    queryKey: ["/api/marketing-links/analytics", "by-campaign"],
    queryFn: async () => {
      const r = await fetch("/api/marketing-links/analytics?days=30", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load link analytics");
      return r.json();
    },
  });

  const rows = useMemo<Row[]>(() => {
    const byCampaign = new Map<string, { name: string; recent: number; dests: Set<string>; links: number; spark: number[] }>();
    for (const l of data?.links ?? []) {
      const key = l.campaignId ?? "__standalone__";
      let g = byCampaign.get(key);
      if (!g) {
        // A non-null campaignId whose name didn't resolve (e.g. a campaign in
        // another market) is its own "Unknown campaign" bucket — not lumped in
        // with genuine standalone (no-campaign) posts.
        const name = l.campaignName ?? (l.campaignId ? "Unknown campaign" : "Standalone posts");
        g = { name, recent: 0, dests: new Set(), links: 0, spark: l.sparkline.map(() => 0) };
        byCampaign.set(key, g);
      }
      g.recent += l.recentClicks;
      g.dests.add(l.destinationUrl);
      g.links += 1;
      l.sparkline.forEach((v, i) => { g!.spark[i] = (g!.spark[i] ?? 0) + v; });
    }
    return Array.from(byCampaign.entries())
      .map(([campaignId, g]) => {
        const half = Math.floor(g.spark.length / 2);
        const first = g.spark.slice(0, half).reduce((a, b) => a + b, 0);
        const last = g.spark.slice(half).reduce((a, b) => a + b, 0);
        const trendPct = first + last === 0 ? null : first === 0 ? 100 : Math.round(((last - first) / first) * 100);
        return { campaignId, name: g.name, recentClicks: g.recent, destinations: g.dests.size, links: g.links, trendPct };
      })
      .filter((r) => r.recentClicks > 0 || r.links > 0)
      .sort((a, b) => b.recentClicks - a.recentClicks);
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (rows.length === 0) return null;

  const peak = Math.max(1, ...rows.map((r) => r.recentClicks));

  return (
    <Card data-testid="clicks-by-campaign">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Clicks by campaign · last 30 days</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid grid-cols-[28px_1fr_88px_84px_72px] items-center gap-3 px-4 py-2 border-b text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          <span />
          <span>Campaign</span>
          <span>Destinations</span>
          <span className="text-right">Clicks</span>
          <span className="text-right">Trend</span>
        </div>
        <div className="divide-y divide-border">
          {rows.map((r, i) => (
            <div
              key={r.campaignId}
              className="grid grid-cols-[28px_1fr_88px_84px_72px] items-center gap-3 px-4 py-2.5"
              data-testid={`campaign-clicks-row-${r.campaignId}`}
            >
              <span className="text-xs text-muted-foreground font-mono tabular-nums">{i + 1}</span>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{r.name}</div>
                <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${(r.recentClicks / peak) * 100}%` }} />
                </div>
              </div>
              <div className="text-xs text-muted-foreground font-mono">
                <span className="text-foreground font-semibold">{r.destinations}</span>
                <span className="opacity-60"> · {r.links} {r.links === 1 ? "link" : "links"}</span>
              </div>
              <div className="text-right text-sm font-semibold tabular-nums">{r.recentClicks.toLocaleString()}</div>
              <div className="text-right">
                {r.trendPct === null ? (
                  <span className="inline-flex items-center text-xs text-muted-foreground"><Minus className="w-3 h-3" /></span>
                ) : r.trendPct >= 5 ? (
                  <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"><TrendingUp className="w-3 h-3" />{r.trendPct}%</span>
                ) : r.trendPct <= -5 ? (
                  <span className="inline-flex items-center gap-0.5 text-xs font-medium text-destructive"><TrendingDown className="w-3 h-3" />{Math.abs(r.trendPct)}%</span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="w-3 h-3" />0%</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
