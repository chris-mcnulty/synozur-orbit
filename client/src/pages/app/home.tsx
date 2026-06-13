import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Activity as ActivityIcon,
  AlertCircle,
  ArrowRight,
  ChevronRight,
  Eye,
  FileText,
  Globe,
  Handshake,
  Linkedin,
  Megaphone,
  Package,
  Rocket,
  Rss,
  Sparkles,
  Telescope,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUser } from "@/lib/userContext";

/**
 * Global Home — the company at a glance. A pure landing page, not a
 * workspace: live signals first, then the baseline executive summary
 * digest, then one glance-card per area with its most urgent action.
 * The Research workspace dashboard lives at /app/dashboard.
 */
export default function HomePage() {
  const [, setLocation] = useLocation();
  const { user } = useUser();

  const { data: activity = [] } = useQuery<any[]>({
    queryKey: ["/api/activity"],
    queryFn: async () => {
      const r = await fetch("/api/activity", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: execSummary } = useQuery<{
    exists: boolean;
    lastGeneratedAt?: string;
    data?: {
      companySnapshot?: string;
      marketPosition?: string;
      competitiveLandscape?: string;
      opportunities?: string;
    };
  }>({
    queryKey: ["/api/baseline/executive-summary"],
    queryFn: async () => {
      const r = await fetch("/api/baseline/executive-summary", { credentials: "include" });
      if (!r.ok) return { exists: false };
      return r.json();
    },
  });

  const { data: dashboardScores } = useQuery<{
    baseline: {
      name: string;
      overallScore: number;
      trend?: { previousScore: number; delta: number; direction: string } | null;
    } | null;
    deltaVsMarket?: { absolute: number; percent: number };
  }>({
    queryKey: ["/api/dashboard/scores"],
    queryFn: async () => {
      const r = await fetch("/api/dashboard/scores", { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
  });

  const { data: recommendations = [] } = useQuery<any[]>({
    queryKey: ["/api/recommendations"],
    queryFn: async () => {
      const r = await fetch("/api/recommendations", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ["/api/projects"],
    queryFn: async () => {
      const r = await fetch("/api/projects", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: battleCards = [] } = useQuery<any[]>({
    queryKey: ["/api/battlecards"],
    queryFn: async () => {
      const r = await fetch("/api/battlecards", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: reports = [] } = useQuery<any[]>({
    queryKey: ["/api/reports"],
    queryFn: async () => {
      const r = await fetch("/api/reports", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: marketingSummary } = useQuery<{
    totals: { campaigns: number; totalPosts: number; scheduledPosts: number; savedEmails: number };
  }>({
    queryKey: ["/api/marketing/dashboard-summary"],
    queryFn: async () => {
      const r = await fetch("/api/marketing/dashboard-summary", { credentials: "include" });
      if (!r.ok) return { totals: { campaigns: 0, totalPosts: 0, scheduledPosts: 0, savedEmails: 0 } };
      return r.json();
    },
  });

  const firstName = user?.name?.split(" ")[0] || "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const highImpact = activity.filter((a: any) => a.impact === "High");
  // High-impact first, then newest.
  const prioritizedSignals = [...activity].sort((a: any, b: any) => {
    if ((a.impact === "High") !== (b.impact === "High")) return a.impact === "High" ? -1 : 1;
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });

  const pendingRecs = recommendations.filter(
    (r: any) => r.status === "Open" || r.status === "In Progress" || r.status === "pending",
  );

  const baseline = dashboardScores?.baseline;
  const scoreDelta = baseline?.trend?.delta ?? 0;
  const summary = execSummary?.data;
  const hasSummary = !!(summary?.companySnapshot || summary?.marketPosition);

  const signalIcon = (item: any) => {
    if (item.type === "website_update") return <Globe className="w-3 h-3" />;
    if (item.type === "blog_update") return <Rss className="w-3 h-3" />;
    if (item.type === "social_update") return <Linkedin className="w-3 h-3" />;
    if (item.impact === "High") return <AlertCircle className="w-3 h-3" />;
    return <Eye className="w-3 h-3" />;
  };

  const signalIconBg = (item: any) => {
    if (item.type === "blog_update") return "bg-orange-500/20 text-orange-500";
    if (item.type === "social_update") return "bg-blue-500/20 text-blue-500";
    if (item.impact === "High") return "text-destructive bg-destructive/10";
    return "text-green-500 bg-green-500/10";
  };

  const areaCards = [
    {
      id: "research",
      label: "Research",
      icon: Telescope,
      accent: "bg-sky-500",
      stat: highImpact.length > 0 ? `${highImpact.length} high-impact signal${highImpact.length === 1 ? "" : "s"}` : `${activity.length} live signals`,
      sub: pendingRecs.length > 0 ? `${pendingRecs.length} open action item${pendingRecs.length === 1 ? "" : "s"}` : "no open action items",
      cta: highImpact.length > 0 ? "Review signals" : "Open Research",
      href: highImpact.length > 0 ? "/app/activity" : "/app/dashboard",
    },
    {
      id: "product",
      label: "Product",
      icon: Package,
      accent: "bg-orange-500",
      stat: `${projects.length} product${projects.length === 1 ? "" : "s"}`,
      sub: `${battleCards.length} battle card${battleCards.length === 1 ? "" : "s"} generated`,
      cta: "Open Products",
      href: "/app/products",
    },
    {
      id: "marketing",
      label: "Marketing",
      icon: Megaphone,
      accent: "bg-primary",
      stat: `${marketingSummary?.totals?.totalPosts ?? 0} posts in flight`,
      sub: `${marketingSummary?.totals?.scheduledPosts ?? 0} scheduled · ${marketingSummary?.totals?.campaigns ?? 0} campaigns`,
      cta: "Open pipeline",
      href: "/app/marketing/pipeline",
    },
    {
      id: "sales",
      label: "Sales",
      icon: Handshake,
      accent: "bg-amber-500",
      stat: `${reports.length} report${reports.length === 1 ? "" : "s"}`,
      sub: `${battleCards.length} battle card${battleCards.length === 1 ? "" : "s"} ready for sellers`,
      cta: "Open Sales",
      href: "/app/sales",
    },
  ];

  return (
    <AppLayout breadcrumbs={[]}>
      <div className="space-y-6" data-testid="page-home">
        {/* Greeting */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              {greeting}, {firstName}
            </h1>
            <p className="text-muted-foreground mt-1">
              {baseline?.name ? `${baseline.name} at a glance` : "Your company at a glance"}
            </p>
          </div>
          {baseline && (
            <Link href="/app/insights/outcomes" className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2 hover:border-primary/40 transition-colors">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Orbit Score</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-primary">{Math.round(baseline.overallScore)}</span>
                  {scoreDelta !== 0 && (
                    <span className={cn("flex items-center gap-0.5 text-xs font-medium", scoreDelta > 0 ? "text-green-600" : "text-destructive")}>
                      {scoreDelta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {scoreDelta > 0 ? "+" : ""}{scoreDelta}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          )}
        </div>

        {/* Live signals — first, per the front-page priority on market movement */}
        <Card data-testid="home-signals">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ActivityIcon className="w-4 h-4 text-primary" />
              Live signals
              {highImpact.length > 0 && (
                <Badge variant="destructive" className="text-[10px]">{highImpact.length} high impact</Badge>
              )}
            </CardTitle>
            <Link href="/app/activity">
              <Button variant="ghost" size="sm" className="text-xs" data-testid="home-all-signals">
                View all <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {prioritizedSignals.length === 0 ? (
              <div className="text-center py-6">
                <ActivityIcon className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                <p className="text-sm text-muted-foreground">No signals yet — add competitors to start tracking.</p>
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {prioritizedSignals.slice(0, 6).map((item: any) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setLocation(item.competitorId ? `/app/competitors/${item.competitorId}` : "/app/activity")}
                    className="flex items-start gap-3 p-2.5 rounded-lg text-left hover:bg-muted/50 transition-colors group"
                    data-testid={`home-signal-${item.id}`}
                  >
                    <div className={cn("p-1.5 rounded-full shrink-0 mt-0.5", signalIconBg(item))}>{signalIcon(item)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                          {item.competitorName || "Market"}
                        </span>
                        {item.impact === "High" && (
                          <Badge variant="outline" className="text-[10px] shrink-0 border-destructive/40 text-destructive">High</Badge>
                        )}
                        {item.createdAt && (
                          <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {item.summary || item.description || item.type?.replace(/_/g, " ")}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Executive summary digest */}
        <Card data-testid="home-exec-summary">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Executive summary
            </CardTitle>
            <Link href="/app/executive-summary">
              <Button variant="ghost" size="sm" className="text-xs">
                Open full <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {!hasSummary ? (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground mb-3">
                  No executive summary yet. Run an analysis to generate your baseline summary.
                </p>
                <Link href="/app/analysis">
                  <Button size="sm" variant="outline">
                    Run analysis <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
                {[
                  { label: "Company snapshot", text: summary?.companySnapshot },
                  { label: "Market position", text: summary?.marketPosition },
                  { label: "Competitive landscape", text: summary?.competitiveLandscape },
                  { label: "Opportunities", text: summary?.opportunities },
                ].map(({ label, text }) => (
                  <div key={label}>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-1">{label}</div>
                    <p className="text-sm text-muted-foreground line-clamp-3">{text || "Not yet generated"}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* One glance-card per area */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {areaCards.map((area) => (
            <Card key={area.id} className="relative overflow-hidden" data-testid={`home-area-${area.id}`}>
              <div className={cn("absolute inset-x-0 top-0 h-1", area.accent)} />
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 mb-3">
                  <area.icon className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">{area.label}</span>
                </div>
                <p className="text-base font-medium">{area.stat}</p>
                <p className="text-xs text-muted-foreground mt-0.5 mb-4">{area.sub}</p>
                <Link href={area.href}>
                  <Button variant="secondary" size="sm" className="text-xs w-full">
                    {area.cta} <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Getting started nudge — only until the basics are in place */}
        {activity.length === 0 && projects.length === 0 && reports.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Rocket className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">New here? Set up your workspace in five steps.</p>
                  <p className="text-xs text-muted-foreground">Company profile, competitors, first analysis, battle cards, and a report.</p>
                </div>
              </div>
              <Link href="/app/getting-started">
                <Button size="sm">
                  Getting started <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <FileText className="w-3 h-3" />
          Looking for the research dashboard? It now lives under{" "}
          <Link href="/app/dashboard" className="text-primary hover:underline">Research → Overview</Link>.
        </p>
      </div>
    </AppLayout>
  );
}
