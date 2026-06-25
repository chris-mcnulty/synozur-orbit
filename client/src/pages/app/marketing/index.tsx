import React from "react";
import { Link } from "wouter";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Megaphone,
  Rocket,
  MessageCircle,
  Mail,
  Gem,
  Sparkles,
  CheckCircle,
  ArrowRight,
  Loader2,
  Calendar,
  CalendarRange,
  Share2,
  ClipboardList,
  LayoutList,
  Library,
  Image,
  Send,
  LayoutGrid,
  TrendingUp,
  Target,
  ListChecks,
  AlertTriangle,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LinkPerformanceTab } from "@/components/marketing/LinkPerformanceTab";
import { ClicksByCampaign } from "@/components/marketing/ClicksByCampaign";
import { StageBar } from "@/components/hub/hub-charts";
import { MarketingHubNextActions } from "@/components/marketing/NextActionsByBatch";
import { buildAreas } from "@/lib/areaNavigation";
import { useQuery } from "@tanstack/react-query";

type LongFormRecommendation = {
  id: string;
  type: string;
  content: string | null;
  status: string;
  lastGeneratedAt: string | null;
};

interface MarketingPlan {
  id: string;
  name: string;
  fiscalYear: string;
  status: string;
  tasks?: { id: string }[];
}

export default function MarketingLandingPage() {
  const { data: companyProfile } = useQuery({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const response = await fetch("/api/company-profile", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
  });

  const { data: gtmPlan, isLoading: gtmLoading } = useQuery<LongFormRecommendation | null>({
    queryKey: ["/api/baseline/recommendations/gtm_plan"],
    queryFn: async () => {
      const response = await fetch("/api/baseline/recommendations/gtm_plan", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!companyProfile,
  });

  const { data: messagingFramework, isLoading: msgLoading } = useQuery<LongFormRecommendation | null>({
    queryKey: ["/api/baseline/recommendations/messaging_framework"],
    queryFn: async () => {
      const response = await fetch("/api/baseline/recommendations/messaging_framework", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!companyProfile,
  });

  const { data: tenantSettings } = useQuery<{ plan: string }>({
    queryKey: ["/api/tenant/settings"],
    queryFn: async () => {
      const response = await fetch("/api/tenant/settings", { credentials: "include" });
      if (!response.ok) return { plan: "free" };
      return response.json();
    },
  });

  const isEnterprise = tenantSettings?.plan === "enterprise" || tenantSettings?.plan === "unlimited";

  const { data: marketingPlans = [], isLoading: plansLoading } = useQuery<MarketingPlan[]>({
    queryKey: ["/api/marketing-plans"],
    queryFn: async () => {
      const response = await fetch("/api/marketing-plans", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: isEnterprise,
  });

  // Pipeline pulse for the hub: same source the Content Pipeline board uses.
  const { data: pipelinePosts = [] } = useQuery<
    { id: string; status: string; scheduledDate: string | null; publishedAt: string | null }[]
  >({
    queryKey: ["/api/generated-posts/calendar", "marketing-hub"],
    queryFn: async () => {
      const from = new Date();
      from.setDate(from.getDate() - 30);
      const to = new Date();
      to.setDate(to.getDate() + 60);
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
        includeUnscheduled: "true",
      });
      const r = await fetch(`/api/generated-posts/calendar?${params}`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: isEnterprise,
  });

  const now = Date.now();
  const weekAhead = now + 7 * 24 * 60 * 60 * 1000;
  const awaitingApproval = pipelinePosts.filter(p => p.status === "draft").length;
  const approvedUnscheduled = pipelinePosts.filter(p => p.status === "approved" && !p.scheduledDate).length;
  const failedPublishes = pipelinePosts.filter(p => p.status === "publish_failed").length;
  const scheduledThisWeek = pipelinePosts.filter(p => {
    if (!p.scheduledDate || p.publishedAt) return false;
    const t = new Date(p.scheduledDate).getTime();
    return t >= now && t <= weekAhead;
  }).length;
  const inFlight = pipelinePosts.filter(p => !["published", "exported"].includes(p.status)).length;

  // "Pipeline at a glance" — post counts mapped to the board's canonical
  // stages, rendered as the segmented bar from the hub mockup.
  const scheduledCount = pipelinePosts.filter(
    p => !p.publishedAt && (p.status === "publish_failed" || (p.status === "approved" && p.scheduledDate)),
  ).length;
  const publishedCount = pipelinePosts.filter(p => p.status === "published" || p.status === "exported").length;
  const pipelineSegments = [
    { label: "Draft", value: awaitingApproval, className: "bg-gray-400" },
    { label: "Approved", value: approvedUnscheduled, className: "bg-blue-500" },
    { label: "Scheduled", value: scheduledCount, className: "bg-teal-500" },
    { label: "Published", value: publishedCount, className: "bg-green-500" },
  ];

  const attentionItems = [
    awaitingApproval > 0 && {
      key: "approval",
      tone: "amber" as const,
      text: `${awaitingApproval} post${awaitingApproval === 1 ? "" : "s"} awaiting approval`,
      action: "Review board",
    },
    approvedUnscheduled > 0 && {
      key: "unscheduled",
      tone: "teal" as const,
      text: `${approvedUnscheduled} approved post${approvedUnscheduled === 1 ? "" : "s"} not yet scheduled`,
      action: "Schedule",
    },
    failedPublishes > 0 && {
      key: "failed",
      tone: "red" as const,
      text: `${failedPublishes} post${failedPublishes === 1 ? "" : "s"} failed to publish`,
      action: "Fix",
    },
  ].filter(Boolean) as { key: string; tone: "amber" | "teal" | "red"; text: string; action: string }[];

  const gtmGenerated = gtmPlan?.status === "generated" && !!gtmPlan?.content;
  const msgGenerated = messagingFramework?.status === "generated" && !!messagingFramework?.content;
  const activePlans = marketingPlans.filter(p => p.status === "active");
  const totalPlanTasks = marketingPlans.reduce((sum, p) => sum + (p.tasks?.length || 0), 0);

  // The hub cards are derived from the same Marketing nav source used by the
  // sidebar (areaNavigation.ts) so labels, descriptions, and the set of
  // surfaces can never drift between the two. Per-card status (Ready badges,
  // last-updated, action labels) is layered on by href below. "Measure" is
  // excluded — Performance has its own tab on this page.
  const sectionOrder = ["Calendar", "Plan", "Create", "Libraries"] as const;
  const enrichment: Record<
    string,
    { generated?: boolean; loading?: boolean; lastUpdated?: string | null; actionLabel?: string }
  > = {
    "/app/marketing/messaging-framework": {
      generated: msgGenerated,
      loading: msgLoading,
      lastUpdated: messagingFramework?.lastGeneratedAt ?? null,
      actionLabel: msgGenerated ? "View Framework" : "Generate Framework",
    },
    "/app/marketing/gtm-plan": {
      generated: gtmGenerated,
      loading: gtmLoading,
      lastUpdated: gtmPlan?.lastGeneratedAt ?? null,
      actionLabel: gtmGenerated ? "View GTM Plan" : "Generate GTM Plan",
    },
    "/app/marketing/projects": {
      generated: marketingPlans.length > 0,
      loading: plansLoading,
      actionLabel: isEnterprise ? (marketingPlans.length > 0 ? "View Projects" : "Create Project") : "Learn More",
    },
  };
  const marketingItems = buildAreas({ isEnterprise: true, isAdminUser: true, isGlobalAdmin: false })
    .find((a) => a.id === "marketing")!
    .items.filter((it) => it.href !== "/app/marketing" && it.section !== "Measure");

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="page-header-gradient-bar rounded-t-lg px-6 py-5 bg-card mb-6">
            <div className="flex items-center gap-3 mb-1">
              <Megaphone size={24} className="text-primary" />
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Marketing</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Generate and manage marketing content powered by your competitive intelligence.
            </p>
          </div>

          {!companyProfile && (
            <Card className="mb-6 border-amber-500/30 bg-amber-500/5" data-testid="card-setup-prompt">
              <CardContent className="flex items-center gap-4 py-4">
                <div className="p-2 bg-amber-500/10 rounded-full">
                  <Sparkles className="w-5 h-5 text-amber-500" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm">Set up your company profile first</p>
                  <p className="text-xs text-muted-foreground">
                    Marketing content is generated from your company baseline and competitive analysis.
                  </p>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/app/company-profile" data-testid="link-setup-profile">
                    Set Up Profile
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList>
              <TabsTrigger value="overview" className="gap-1.5" data-testid="tab-marketing-overview">
                <LayoutGrid className="w-3.5 h-3.5" /> Overview
              </TabsTrigger>
              <TabsTrigger value="performance" className="gap-1.5" data-testid="tab-marketing-performance">
                <TrendingUp className="w-3.5 h-3.5" /> Performance
              </TabsTrigger>
            </TabsList>

            <TabsContent value="performance" className="space-y-4">
              <ClicksByCampaign />
              <LinkPerformanceTab />
            </TabsContent>

            <TabsContent value="overview" className="space-y-4">
              {isEnterprise && <MarketingHubNextActions />}
              {isEnterprise && pipelinePosts.length > 0 && (
                <Card data-testid="card-pipeline-pulse">
                  <CardContent className="py-4">
                    <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                      {[
                        { label: "In pipeline", value: inFlight },
                        { label: "Awaiting approval", value: awaitingApproval, highlight: awaitingApproval > 0 },
                        { label: "Scheduled · next 7 days", value: scheduledThisWeek },
                      ].map(({ label, value, highlight }) => (
                        <div key={label}>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                          <p className={`text-2xl font-bold ${highlight ? "text-amber-600 dark:text-amber-400" : ""}`}>{value}</p>
                        </div>
                      ))}
                      <Button size="sm" className="ml-auto" asChild data-testid="button-pulse-open-pipeline">
                        <Link href="/app/marketing/pipeline">
                          <ListChecks className="w-3.5 h-3.5 mr-1.5" /> Open pipeline
                          <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                        </Link>
                      </Button>
                    </div>
                    {inFlight + publishedCount > 0 && (
                      <div className="mt-4 pt-3 border-t border-border">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                          Pipeline at a glance
                        </p>
                        <StageBar segments={pipelineSegments} />
                      </div>
                    )}
                    {attentionItems.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-border space-y-2">
                        {attentionItems.map(item => (
                          <div key={item.key} className="flex items-center gap-2 text-sm" data-testid={`attention-${item.key}`}>
                            {item.tone === "red" ? (
                              <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                            ) : (
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${item.tone === "amber" ? "bg-amber-500" : "bg-teal-500"}`}
                              />
                            )}
                            <span className={item.tone === "red" ? "text-destructive" : ""}>{item.text}</span>
                            <Link
                              href="/app/marketing/pipeline"
                              className="ml-auto text-xs font-medium text-primary hover:underline"
                            >
                              {item.action} →
                            </Link>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
              <div className="space-y-8">
                {sectionOrder.map((section) => {
                  const items = marketingItems.filter((it) => it.section === section);
                  if (items.length === 0) return null;
                  return (
                    <div key={section} className="space-y-3">
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {section}
                      </h2>
                      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {items.map((item) => {
                          const Icon = item.icon;
                          const ex = enrichment[item.href] ?? {};
                          const generatable = "generated" in ex;
                          const isProjects = item.href === "/app/marketing/projects";
                          const slug = item.href.split("/").pop();
                          return (
                            <Card
                              key={item.href}
                              className="group hover:border-primary/40 transition-all duration-200 flex flex-col"
                              data-testid={`card-${slug}`}
                            >
                              <CardHeader className="pb-3">
                                <div className="flex items-start justify-between">
                                  <div className="p-2 bg-primary/10 rounded-lg">
                                    <Icon className="w-5 h-5 text-primary" />
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    {item.enterprise && !isEnterprise && (
                                      <Badge variant="outline" className="text-primary border-primary/30 text-[10px]">
                                        <Gem className="w-3 h-3 mr-0.5" />
                                        Enterprise
                                      </Badge>
                                    )}
                                    {ex.loading ? (
                                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                                    ) : ex.generated ? (
                                      <Badge className="bg-emerald-600/90 dark:bg-emerald-500/90 text-primary-foreground text-[10px]">
                                        <CheckCircle className="w-3 h-3 mr-0.5" />
                                        Ready
                                      </Badge>
                                    ) : null}
                                  </div>
                                </div>
                                <CardTitle className="text-base mt-3">{item.label}</CardTitle>
                                <CardDescription className="text-xs leading-relaxed">
                                  {item.description}
                                </CardDescription>
                              </CardHeader>
                              <CardContent className="mt-auto pt-0">
                                {isProjects && isEnterprise && (
                                  <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                                    <span className="flex items-center gap-1">
                                      <Calendar className="w-3 h-3" />
                                      {marketingPlans.length} {marketingPlans.length === 1 ? "project" : "projects"}
                                    </span>
                                    {activePlans.length > 0 && (
                                      <span className="text-emerald-500">{activePlans.length} active</span>
                                    )}
                                    {totalPlanTasks > 0 && <span>{totalPlanTasks} tasks</span>}
                                  </div>
                                )}
                                {ex.lastUpdated && (
                                  <p className="text-[11px] text-muted-foreground mb-3">
                                    Last updated: {new Date(ex.lastUpdated).toLocaleDateString()}
                                  </p>
                                )}
                                <Button
                                  variant={ex.generated ? "default" : "outline"}
                                  size="sm"
                                  className="w-full"
                                  asChild
                                  data-testid={`button-card-${slug}`}
                                >
                                  <Link href={item.href}>
                                    {generatable && !ex.generated && (
                                      <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                                    )}
                                    {ex.actionLabel ?? `Open ${item.label}`}
                                    <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                                  </Link>
                                </Button>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
