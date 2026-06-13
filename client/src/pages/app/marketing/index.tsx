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
import { StageBar } from "@/components/hub/hub-charts";
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

  const cards = [
    {
      title: "Messaging Framework",
      description: "AI-generated messaging and positioning based on competitive gaps.",
      icon: MessageCircle,
      generated: msgGenerated,
      loading: msgLoading,
      lastUpdated: messagingFramework?.lastGeneratedAt,
      actionLabel: msgGenerated ? "View Framework" : "Generate Framework",
      actionHref: "/app/marketing/messaging-framework",
      testId: "card-messaging-framework",
    },
    {
      title: "GTM Plan",
      description: "Strategic Go-To-Market plan from your competitive analysis.",
      icon: Rocket,
      generated: gtmGenerated,
      loading: gtmLoading,
      lastUpdated: gtmPlan?.lastGeneratedAt,
      actionLabel: gtmGenerated ? "View GTM Plan" : "Generate GTM Plan",
      actionHref: "/app/marketing/gtm-plan",
      testId: "card-gtm-plan",
    },
    {
      title: "Marketing Planner",
      description: "AI-powered marketing task plans across 14 activity categories.",
      icon: Gem,
      generated: marketingPlans.length > 0,
      loading: plansLoading,
      enterprise: true,
      planCount: marketingPlans.length,
      activePlanCount: activePlans.length,
      taskCount: totalPlanTasks,
      actionLabel: isEnterprise
        ? (marketingPlans.length > 0 ? "View Plans" : "Create Plan")
        : "Learn More",
      actionHref: "/app/marketing-planner",
      testId: "card-marketing-planner",
    },
    {
      title: "Social Campaigns",
      description: "Plan and manage multi-channel marketing campaigns with AI-generated social media content.",
      icon: LayoutList,
      generated: false,
      loading: false,
      enterprise: true,
      actionLabel: "View Social Campaigns",
      actionHref: "/app/marketing/campaigns",
      testId: "card-social-campaigns",
    },
    {
      title: "Themes Hub",
      description: "See and plan every piece of marketing for a solution-area theme in one view.",
      icon: Target,
      generated: false,
      loading: false,
      enterprise: true,
      actionLabel: "Open Themes Hub",
      actionHref: "/app/marketing/planning-hub",
      testId: "card-planning-hub",
    },
    {
      title: "Content Calendar",
      description: "Cross-channel overview of every scheduled social post, email, and content piece.",
      icon: CalendarRange,
      generated: false,
      loading: false,
      enterprise: true,
      actionLabel: "Open Content Calendar",
      actionHref: "/app/marketing/marketing-calendar",
      testId: "card-master-calendar",
    },
    {
      title: "Content Briefs",
      description: "Plan and draft long-form content briefs grounded in your strategy.",
      icon: ClipboardList,
      generated: false,
      loading: false,
      enterprise: true,
      actionLabel: "Open Content Briefs",
      actionHref: "/app/marketing/editorial-calendar",
      testId: "card-content-briefs",
    },
    {
      title: "Social Posts",
      description: "Social-only view to schedule, reschedule, and add graphics to posts.",
      icon: Share2,
      generated: false,
      loading: false,
      enterprise: true,
      actionLabel: "Open Social Posts",
      actionHref: "/app/marketing/calendar",
      testId: "card-social-posts",
    },
    {
      title: "Email Newsletters",
      description: "AI-generated email content based on competitive intelligence.",
      icon: Mail,
      generated: false,
      loading: false,
      enterprise: true,
      actionLabel: "View Newsletters",
      actionHref: "/app/marketing/email-newsletters",
      testId: "card-email-newsletters",
    },
    {
      title: "Digital/Web Assets",
      description: "Centralized repository for URLs, articles, and web-based content.",
      icon: Library,
      generated: false,
      loading: false,
      enterprise: true,
      actionLabel: "View Library",
      actionHref: "/app/marketing/content-library",
      testId: "card-content-library",
    },
    {
      title: "Visual/Brand Assets",
      description: "Manage approved images, logos, and visual brand identity.",
      icon: Image,
      generated: false,
      loading: false,
      enterprise: true,
      actionLabel: "View Assets",
      actionHref: "/app/marketing/brand-library",
      testId: "card-brand-library",
    },
    {
      title: "Content Pipeline",
      description: "Every in-flight post, email, and brief on one drag-and-drop board.",
      icon: ListChecks,
      generated: false,
      loading: false,
      enterprise: true,
      actionLabel: "Open Pipeline",
      actionHref: "/app/marketing/pipeline",
      testId: "card-content-pipeline",
    },
    {
      title: "Email Sends",
      description: "Track campaign deliveries, recipient lists, and unsubscribe suppressions.",
      icon: Send,
      generated: false,
      loading: false,
      enterprise: true,
      actionLabel: "View Sends",
      actionHref: "/app/marketing/sends",
      testId: "card-sends",
    },
  ];

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

            <TabsContent value="performance">
              <LinkPerformanceTab />
            </TabsContent>

            <TabsContent value="overview" className="space-y-4">
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
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => {
              const Icon = card.icon;
              return (
                <Card
                  key={card.testId}
                  className="group hover:border-primary/40 transition-all duration-200 flex flex-col"
                  data-testid={card.testId}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        {card.enterprise && !isEnterprise && (
                          <Badge variant="outline" className="text-primary border-primary/30 text-[10px]">
                            <Gem className="w-3 h-3 mr-0.5" />
                            Enterprise
                          </Badge>
                        )}
                        {card.loading ? (
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        ) : card.generated ? (
                          <Badge className="bg-emerald-600/90 dark:bg-emerald-500/90 text-primary-foreground text-[10px]">
                            <CheckCircle className="w-3 h-3 mr-0.5" />
                            Ready
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <CardTitle className="text-base mt-3">{card.title}</CardTitle>
                    <CardDescription className="text-xs leading-relaxed">
                      {card.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto pt-0">
                    {'planCount' in card && isEnterprise && (
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {card.planCount} {card.planCount === 1 ? 'plan' : 'plans'}
                        </span>
                        {(card.activePlanCount ?? 0) > 0 && (
                          <span className="text-emerald-500">
                            {card.activePlanCount} active
                          </span>
                        )}
                        {(card.taskCount ?? 0) > 0 && (
                          <span>{card.taskCount} tasks</span>
                        )}
                      </div>
                    )}
                    {card.lastUpdated && (
                      <p className="text-[11px] text-muted-foreground mb-3">
                        Last updated: {new Date(card.lastUpdated).toLocaleDateString()}
                      </p>
                    )}
                    <Button
                      variant={card.generated ? "default" : "outline"}
                      size="sm"
                      className="w-full"
                      asChild
                      data-testid={`button-${card.testId}`}
                    >
                      <Link href={card.actionHref}>
                        {!card.generated && (
                          <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                        )}
                        {card.actionLabel}
                        <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
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
