import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Inbox as InboxIcon, CheckCircle2, AlertTriangle, CalendarClock, Eye,
  Megaphone, Handshake, Telescope, ArrowRight, Loader2,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getTabMarketId } from "@/lib/tabContext";

interface CalendarPost {
  id: string; status: string; scheduledDate: string | null; publishedAt: string | null;
  deliveryMode: string | null; publishError: string | null; platform: string;
  preview: string; campaignId: string | null; campaignName: string | null;
}
interface ActivityItem {
  id: string; impact?: string; competitorId?: string | null; competitorName?: string | null;
  summary?: string; description?: string; type?: string; createdAt?: string;
}
interface OutreachPending {
  id: string; campaignId: string | null; channel: string; subject: string | null;
  createdAt: string | null; prospectName: string | null; companyName: string | null; campaignName: string | null;
}

type Tone = "amber" | "red" | "sky";
interface Item { id: string; title: string; subtitle?: string; href: string; when?: string | null; }
interface Section {
  key: string; label: string; icon: typeof InboxIcon; area: string; areaIcon: typeof Megaphone;
  tone: Tone; items: Item[]; viewAllHref: string;
}

const TONE: Record<Tone, { dot: string; ring: string }> = {
  amber: { dot: "bg-amber-500", ring: "text-amber-600 dark:text-amber-400" },
  red: { dot: "bg-destructive", ring: "text-destructive" },
  sky: { dot: "bg-sky-500", ring: "text-sky-600 dark:text-sky-400" },
};

export default function InboxPage() {
  const { data: posts = [], isLoading: postsLoading } = useQuery<CalendarPost[]>({
    queryKey: ["/api/generated-posts/calendar", getTabMarketId(), "inbox"],
    queryFn: async () => {
      const from = new Date(); from.setDate(from.getDate() - 7);
      const to = new Date(); to.setDate(to.getDate() + 90);
      const p = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), includeUnscheduled: "true" });
      const r = await fetch(`/api/generated-posts/calendar?${p}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });
  const { data: activity = [], isLoading: actLoading } = useQuery<ActivityItem[]>({
    queryKey: ["/api/activity", getTabMarketId()],
    queryFn: async () => {
      const r = await fetch("/api/activity", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });
  const { data: outreach = [], isLoading: outLoading } = useQuery<OutreachPending[]>({
    queryKey: ["/api/sales-outreach/pending-approvals", getTabMarketId()],
    queryFn: async () => {
      const r = await fetch("/api/sales-outreach/pending-approvals", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const isLoading = postsLoading || actLoading || outLoading;

  const sections = useMemo<Section[]>(() => {
    const postHref = (p: CalendarPost, fallback: string) =>
      p.campaignId ? `/app/marketing/campaigns/${p.campaignId}#posts` : fallback;

    const drafts = posts.filter((p) => p.status === "draft");
    const failed = posts.filter((p) => p.status === "publish_failed" || p.publishError);
    const unscheduled = posts.filter((p) => p.status === "approved" && !p.scheduledDate && p.deliveryMode !== "csv");
    const highSignals = activity.filter((a) => a.impact === "High");

    const out: Section[] = [
      {
        key: "post-approvals", label: "Posts awaiting approval", icon: CheckCircle2,
        area: "Marketing", areaIcon: Megaphone, tone: "amber", viewAllHref: "/app/marketing/pipeline",
        items: drafts.map((p) => ({
          id: p.id,
          title: p.preview || "Untitled post",
          subtitle: `${p.platform}${p.campaignName ? ` · ${p.campaignName}` : ""}`,
          href: postHref(p, "/app/marketing/pipeline"),
        })),
      },
      {
        key: "outreach-approvals", label: "Outreach drafts awaiting approval", icon: CheckCircle2,
        area: "Sales", areaIcon: Handshake, tone: "amber", viewAllHref: "/app/sales/outreach",
        items: outreach.map((t) => ({
          id: t.id,
          title: t.subject || `${t.channel} message`,
          subtitle: [t.prospectName, t.companyName, t.campaignName].filter(Boolean).join(" · "),
          href: t.campaignId ? `/app/sales/outreach/${t.campaignId}` : "/app/sales/outreach",
          when: t.createdAt,
        })),
      },
      {
        key: "failed", label: "Posts that failed to publish", icon: AlertTriangle,
        area: "Marketing", areaIcon: Megaphone, tone: "red", viewAllHref: "/app/marketing/queue",
        items: failed.map((p) => ({
          id: p.id,
          title: p.preview || "Untitled post",
          subtitle: p.publishError || `${p.platform}${p.campaignName ? ` · ${p.campaignName}` : ""}`,
          href: postHref(p, "/app/marketing/queue"),
        })),
      },
      {
        key: "unscheduled", label: "Approved posts not yet scheduled", icon: CalendarClock,
        area: "Marketing", areaIcon: Megaphone, tone: "sky", viewAllHref: "/app/marketing/queue",
        items: unscheduled.map((p) => ({
          id: p.id,
          title: p.preview || "Untitled post",
          subtitle: `${p.platform}${p.campaignName ? ` · ${p.campaignName}` : ""}`,
          href: postHref(p, "/app/marketing/queue"),
        })),
      },
      {
        key: "signals", label: "High-impact competitive signals", icon: Eye,
        area: "Research", areaIcon: Telescope, tone: "sky", viewAllHref: "/app/activity",
        items: highSignals.map((a) => ({
          id: a.id,
          title: a.summary || a.description || a.type?.replace(/_/g, " ") || "Signal",
          subtitle: a.competitorName || "Market",
          href: a.competitorId ? `/app/competitors/${a.competitorId}` : "/app/activity",
          when: a.createdAt,
        })),
      },
    ];
    return out.filter((s) => s.items.length > 0);
  }, [posts, activity, outreach]);

  const total = sections.reduce((sum, s) => sum + s.items.length, 0);
  const MAX_ROWS = 6;

  return (
    <AppLayout breadcrumbs={[{ label: "Needs attention" }]}>
      <div className="p-6 max-w-4xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <InboxIcon className="w-6 h-6" /> Needs your attention
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Approvals and alerts that need you, gathered from Marketing, Sales, and Research.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16" data-testid="inbox-loading">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : total === 0 ? (
          <Card data-testid="inbox-empty">
            <CardContent className="text-center py-16">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-500" />
              <p className="text-sm font-medium">You're all caught up</p>
              <p className="text-xs text-muted-foreground mt-1">No approvals or alerts waiting right now.</p>
            </CardContent>
          </Card>
        ) : (
          sections.map((s) => {
            const tone = TONE[s.tone];
            const shown = s.items.slice(0, MAX_ROWS);
            const rest = s.items.length - shown.length;
            return (
              <Card key={s.key} data-testid={`inbox-section-${s.key}`}>
                <CardContent className="p-0">
                  <div className="flex items-center gap-2 px-4 py-3 border-b">
                    <s.icon className={cn("w-4 h-4", tone.ring)} />
                    <span className="text-sm font-semibold">{s.label}</span>
                    <Badge variant="secondary" className="text-[10px] tabular-nums">{s.items.length}</Badge>
                    <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <s.areaIcon className="w-3 h-3" /> {s.area}
                    </span>
                  </div>
                  <div className="divide-y divide-border">
                    {shown.map((it) => (
                      <Link
                        key={it.id}
                        href={it.href}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors"
                        data-testid={`inbox-item-${it.id}`}
                      >
                        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", tone.dot)} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm truncate">{it.title}</div>
                          {it.subtitle && <div className="text-xs text-muted-foreground truncate">{it.subtitle}</div>}
                        </div>
                        {it.when && (
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {formatDistanceToNow(new Date(it.when), { addSuffix: true })}
                          </span>
                        )}
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      </Link>
                    ))}
                  </div>
                  {rest > 0 && (
                    <Link
                      href={s.viewAllHref}
                      className="flex items-center justify-center gap-1 px-4 py-2.5 border-t text-xs font-medium text-primary hover:bg-muted/40"
                    >
                      View {rest} more in {s.area} <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </AppLayout>
  );
}
