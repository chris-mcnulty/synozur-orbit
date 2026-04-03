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
  LayoutList,
  Library,
  Image,
  AtSign,
} from "lucide-react";
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
      title: "Content Library",
      description: "Centralized repository for marketing content and assets.",
      icon: Library,
      generated: false,
      loading: false,
      enterprise: true,
      actionLabel: "View Library",
      actionHref: "/app/marketing/content-library",
      testId: "card-content-library",
    },
    {
      title: "Brand Library",
      description: "Manage brand assets, guidelines, and visual identity.",
      icon: Image,
      generated: false,
      loading: false,
      enterprise: true,
      actionLabel: "View Brand Library",
      actionHref: "/app/marketing/brand-library",
      testId: "card-brand-library",
    },
    {
      title: "Social Accounts",
      description: "Connect and manage social media accounts for publishing.",
      icon: AtSign,
      generated: false,
      loading: false,
      enterprise: true,
      actionLabel: "Manage Accounts",
      actionHref: "/app/marketing/social-accounts",
      testId: "card-social-accounts",
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
        </div>
      </div>
    </AppLayout>
  );
}
