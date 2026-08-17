/**
 * Per-campaign link clicks, grouped by destination.
 *
 * Orbit mints one tracked link per post variation, so a campaign that posts
 * the same article a dozen times ends up with a dozen links — most with few
 * or zero clicks. Showing them one-per-row buries the signal, so we roll up
 * on destinationUrl: the article's total is the headline, and the per-post
 * variants (including the zeros) sit in an expandable drawer. All of it is a
 * client-side group-by over /api/marketing-links/analytics.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTabMarketId } from "@/lib/tabContext";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight, ExternalLink, Link2, MousePointerClick, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface AnalyticsLink {
  id: string;
  slug: string;
  label: string | null;
  destinationUrl: string;
  campaignId: string | null;
  utmContent: string | null;
  clickCount: number;
  recentClicks: number;
  lastClickedAt: string | null;
  source: string;
  sparkline: number[];
}

interface AnalyticsResp {
  days: number;
  links: AnalyticsLink[];
}

interface DestGroup {
  destinationUrl: string;
  totalClicks: number;
  recentClicks: number;
  last7: number;
  linkCount: number;
  lastClickedAt: string | null;
  sparkline: number[];
  variants: AnalyticsLink[];
}

function Sparkline({ data, max, muted }: { data: number[]; max: number; muted?: boolean }) {
  if (!data.length) return null;
  const w = 88;
  const h = 24;
  const peak = Math.max(max, 1);
  const step = w / Math.max(data.length - 1, 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / peak) * h).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className={muted ? "text-muted-foreground/50" : "text-primary"} data-testid="link-sparkline">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={pts} />
      <polyline fill="currentColor" fillOpacity="0.12" stroke="none" points={`0,${h} ${pts} ${w},${h}`} />
    </svg>
  );
}

function variantName(l: AnalyticsLink) {
  return l.label || l.utmContent || `/r/${l.slug}`;
}

export function CampaignLinkClicks({ campaignId }: { campaignId: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<AnalyticsResp>({
    queryKey: ["/api/marketing-links/analytics", getTabMarketId(), "campaign-clicks"],
    queryFn: async () => {
      const r = await fetch("/api/marketing-links/analytics?days=30", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load link analytics");
      return r.json();
    },
  });

  const groups = useMemo<DestGroup[]>(() => {
    const links = (data?.links ?? []).filter((l) => l.campaignId === campaignId);
    const byDest = new Map<string, DestGroup>();
    for (const l of links) {
      let g = byDest.get(l.destinationUrl);
      if (!g) {
        g = {
          destinationUrl: l.destinationUrl,
          totalClicks: 0,
          recentClicks: 0,
          last7: 0,
          linkCount: 0,
          lastClickedAt: null,
          sparkline: l.sparkline.map(() => 0),
          variants: [],
        };
        byDest.set(l.destinationUrl, g);
      }
      g.totalClicks += l.clickCount;
      g.recentClicks += l.recentClicks;
      g.last7 += l.sparkline.slice(-7).reduce((a, b) => a + b, 0);
      g.linkCount += 1;
      g.variants.push(l);
      l.sparkline.forEach((v, i) => { g!.sparkline[i] = (g!.sparkline[i] ?? 0) + v; });
      if (l.lastClickedAt && (!g.lastClickedAt || l.lastClickedAt > g.lastClickedAt)) {
        g.lastClickedAt = l.lastClickedAt;
      }
    }
    for (const g of byDest.values()) g.variants.sort((a, b) => b.clickCount - a.clickCount);
    return Array.from(byDest.values()).sort((a, b) => b.totalClicks - a.totalClicks);
  }, [data, campaignId]);

  const totals = useMemo(() => {
    const linkCount = groups.reduce((s, g) => s + g.linkCount, 0);
    const recent = groups.reduce((s, g) => s + g.recentClicks, 0);
    const last7 = groups.reduce((s, g) => s + g.last7, 0);
    const lastClickedAt = groups.reduce<string | null>(
      (m, g) => (g.lastClickedAt && (!m || g.lastClickedAt > m) ? g.lastClickedAt : m),
      null,
    );
    return { destinations: groups.length, linkCount, recent, last7, lastClickedAt };
  }, [groups]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10" data-testid="campaign-clicks-loading">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <Card data-testid="campaign-clicks-empty">
        <CardContent className="text-center py-10">
          <Link2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
          <p className="text-sm font-medium">No tracked links yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            Build a UTM link below, or enable "wrap outbound URLs" when generating posts so Orbit can count clicks for this campaign.
          </p>
        </CardContent>
      </Card>
    );
  }

  const peakDaily = Math.max(1, ...groups.flatMap((g) => g.sparkline));

  return (
    <Card data-testid="campaign-clicks">
      <CardContent className="p-0">
        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border border-b">
          <div className="px-4 py-3">
            <div className="text-xl font-bold tabular-nums flex items-baseline gap-2">
              {totals.recent.toLocaleString()}
              {totals.last7 > 0 && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">▲ {totals.last7} · 7d</span>}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Clicks · 30 days</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-xl font-bold tabular-nums">{totals.destinations}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Destinations</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-xl font-bold tabular-nums">{totals.linkCount}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Tracked links</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-xl font-bold tabular-nums">
              {totals.lastClickedAt ? formatDistanceToNow(new Date(totals.lastClickedAt), { addSuffix: false }) : "—"}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Last click</div>
          </div>
        </div>

        {/* Destination rows */}
        <div className="divide-y divide-border">
          {groups.map((g) => {
            const open = expanded.has(g.destinationUrl);
            const best = g.variants[0];
            // Short, selector-safe token for test IDs — the raw URL is long
            // and contains characters that break CSS-based E2E selectors.
            const slug = g.destinationUrl.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48).toLowerCase();
            return (
              <div key={g.destinationUrl}>
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      next.has(g.destinationUrl) ? next.delete(g.destinationUrl) : next.add(g.destinationUrl);
                      return next;
                    })
                  }
                  className="w-full grid grid-cols-[20px_1fr_auto_auto] sm:grid-cols-[20px_1fr_80px_96px_96px] items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                  data-testid={`dest-row-${slug}`}
                  aria-expanded={open}
                >
                  <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform", open && "rotate-90")} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{best?.label || g.destinationUrl}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{g.destinationUrl}</div>
                  </div>
                  <div className="hidden sm:block text-xs text-muted-foreground font-mono">
                    <span className="text-foreground font-semibold">{g.linkCount}</span> {g.linkCount === 1 ? "link" : "links"}
                  </div>
                  <div className="flex items-center justify-end gap-1.5 text-sm font-semibold tabular-nums">
                    <MousePointerClick className="w-3.5 h-3.5 text-muted-foreground" />
                    {g.totalClicks.toLocaleString()}
                  </div>
                  <div className="hidden sm:flex justify-end">
                    <Sparkline data={g.sparkline} max={peakDaily} muted={g.recentClicks === 0} />
                  </div>
                </button>

                {open && (
                  <div className="bg-muted/30 border-t border-border" data-testid={`dest-variants-${slug}`}>
                    <div className="px-4 pl-11 py-2 text-[11px] text-muted-foreground">
                      {g.linkCount} post {g.linkCount === 1 ? "variation" : "variations"}
                      {best && best.clickCount > 0 && (
                        <> · <span className="text-emerald-600 dark:text-emerald-400 font-medium">Best: {variantName(best)} ({best.clickCount})</span></>
                      )}
                    </div>
                    {g.variants.map((v) => (
                      <div
                        key={v.id}
                        className={cn(
                          "grid grid-cols-[1fr_64px] items-center gap-3 px-4 pl-11 py-1.5 text-xs",
                          v.clickCount === 0 && "text-muted-foreground",
                        )}
                        data-testid={`variant-${v.id}`}
                      >
                        <a
                          href={v.destinationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 truncate hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="truncate">{variantName(v)}</span>
                          <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                        </a>
                        <span className="text-right font-mono tabular-nums">{v.clickCount}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
