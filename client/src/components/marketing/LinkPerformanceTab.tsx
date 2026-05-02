/**
 * Link Performance tab for the marketing index page. Renders a tenant-wide
 * roll-up of every tracked link, with last-30-day sparklines and a CSV
 * export. Bots are excluded from the daily counts (they're tagged on click).
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, Link2, MousePointerClick, ExternalLink } from "lucide-react";

interface AnalyticsLink {
  id: string;
  slug: string;
  label: string | null;
  destinationUrl: string;
  campaignId: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  clickCount: number;
  recentClicks: number;
  lastClickedAt: string | null;
  status: string;
  source: string;
  createdAt: string;
  sparkline: number[];
  shortUrl: string;
}

interface AnalyticsResp {
  days: number;
  dayKeys: string[];
  links: AnalyticsLink[];
  totals: { linkCount: number; totalClicks: number; recentClicks: number };
}

function Sparkline({ data, max }: { data: number[]; max: number }) {
  if (data.length === 0) return null;
  const w = 80;
  const h = 24;
  const peak = Math.max(max, 1);
  const step = w / Math.max(data.length - 1, 1);
  const points = data.map((v, i) => {
    const x = i * step;
    const y = h - (v / peak) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="text-primary" data-testid="sparkline">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        points={points}
      />
      <polyline
        fill="currentColor"
        fillOpacity="0.15"
        stroke="none"
        points={`0,${h} ${points} ${w},${h}`}
      />
    </svg>
  );
}

export function LinkPerformanceTab() {
  const { data, isLoading } = useQuery<AnalyticsResp>({
    queryKey: ["/api/marketing-links/analytics"],
    queryFn: async () => {
      const r = await fetch("/api/marketing-links/analytics?days=30", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load analytics");
      return r.json();
    },
  });

  const handleExport = () => {
    // Use a same-origin download so cookies are sent automatically. Anchor
    // navigation streams the CSV without leaving the SPA.
    window.location.assign("/api/marketing-links/export.csv");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="performance-loading">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || data.links.length === 0) {
    return (
      <Card data-testid="performance-empty-state">
        <CardContent className="text-center py-12">
          <Link2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground/60" />
          <p className="text-sm font-medium">No tracked links yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            Create tracked links from a campaign or enable "wrap outbound URLs" when generating posts and emails. Click counts will show up here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const peakDaily = Math.max(1, ...data.links.flatMap(l => l.sparkline));

  return (
    <div className="space-y-4" data-testid="performance-tab-content">
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Tracked Links</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold" data-testid="stat-link-count">{data.totals.linkCount}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">All-Time Clicks</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold" data-testid="stat-total-clicks">{data.totals.totalClicks.toLocaleString()}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Last {data.days} Days</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold" data-testid="stat-recent-clicks">{data.totals.recentClicks.toLocaleString()}</div></CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={handleExport} data-testid="button-export-csv">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Link</th>
                <th className="px-4 py-2.5 font-medium">UTM</th>
                <th className="px-4 py-2.5 font-medium text-right">Last 30d</th>
                <th className="px-4 py-2.5 font-medium text-right">All-time</th>
                <th className="px-4 py-2.5 font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>
              {data.links.map(link => (
                <tr key={link.id} className="border-b last:border-b-0 hover:bg-muted/20" data-testid={`row-link-${link.id}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col">
                      <span className="font-medium truncate max-w-xs" data-testid={`text-perf-label-${link.id}`}>
                        {link.label || link.slug}
                      </span>
                      <a
                        href={link.destinationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:underline flex items-center gap-1 truncate max-w-xs"
                      >
                        <span className="truncate">{link.destinationUrl}</span>
                        <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      </a>
                      <div className="flex items-center gap-1 mt-0.5">
                        <code className="text-[10px] bg-muted px-1 rounded">/r/{link.slug}</code>
                        <Badge variant="secondary" className="text-[9px] px-1 py-0">
                          {link.source === "manual" ? "Manual" : link.source === "email-wrap" ? "Email" : "Post"}
                        </Badge>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1 max-w-[180px]">
                      {link.utmSource && <Badge variant="outline" className="text-[10px]">{link.utmSource}</Badge>}
                      {link.utmMedium && <Badge variant="outline" className="text-[10px]">{link.utmMedium}</Badge>}
                      {link.utmCampaign && <Badge variant="outline" className="text-[10px]">{link.utmCampaign}</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1.5 text-sm font-semibold" data-testid={`text-perf-recent-${link.id}`}>
                      <MousePointerClick className="w-3.5 h-3.5 text-muted-foreground" />
                      {link.recentClicks}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm" data-testid={`text-perf-total-${link.id}`}>
                    {link.clickCount}
                  </td>
                  <td className="px-4 py-2.5">
                    <Sparkline data={link.sparkline} max={peakDaily} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
