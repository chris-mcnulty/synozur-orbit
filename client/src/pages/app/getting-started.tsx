import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Rocket, Building2, Users, Sparkles, Swords, FileText,
  CheckCircle2, ChevronRight, ArrowRight, Eye, RefreshCw
} from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { calculateStaleness } from "@/lib/staleness";

const CHECKLIST_DISMISSED_KEY = "orbit_onboarding_dismissed";

export default function GettingStartedPage() {
  const [showOnDashboard, setShowOnDashboard] = useState(() => {
    return localStorage.getItem(CHECKLIST_DISMISSED_KEY) !== "true";
  });

  const { data: companyProfile } = useQuery({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const response = await fetch("/api/company-profile", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
  });

  const { data: competitors = [] } = useQuery({
    queryKey: ["/api/competitors"],
    queryFn: async () => {
      const response = await fetch("/api/competitors", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const { data: analysis } = useQuery({
    queryKey: ["/api/analysis"],
    queryFn: async () => {
      const response = await fetch("/api/analysis", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
  });

  const { data: battleCards = [] } = useQuery({
    queryKey: ["/api/battlecards"],
    queryFn: async () => {
      const response = await fetch("/api/battlecards", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const { data: reports = [] } = useQuery({
    queryKey: ["/api/reports"],
    queryFn: async () => {
      const response = await fetch("/api/reports", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const baselineComplete = companyProfile && companyProfile.websiteUrl;
  const hasAnalysis = analysis && analysis.themes;

  // Check if all data sources are fresh (no stale sources)
  const allDataFresh = (() => {
    const timestamps = [
      companyProfile?.lastCrawledAt,
      ...competitors.map((c: any) => c.lastCrawledAt),
      ...competitors.map((c: any) => c.socialLastFetchedAt),
    ].filter(Boolean);
    if (timestamps.length === 0) return false;
    return timestamps.every((ts: string) => calculateStaleness(ts) !== "stale");
  })();

  const steps = [
    {
      id: "company",
      step: 1,
      label: "Set up your company profile",
      description: "Add your website URL and company details so Orbit can establish your competitive baseline. This is the foundation for all analysis.",
      complete: !!baselineComplete,
      href: "/app/company-profile",
      icon: Building2,
      cta: "Set Up Profile",
    },
    {
      id: "competitors",
      step: 2,
      label: "Add your first competitor",
      description: "Enter a competitor's website URL and Orbit will automatically crawl their site, social profiles, and blog to build a competitive profile.",
      complete: competitors.length > 0,
      href: "/app/competitors",
      icon: Users,
      cta: "Add Competitor",
    },
    {
      id: "analysis",
      step: 3,
      label: "Run a competitive analysis",
      description: "Once you have a baseline and at least one competitor, run an AI-powered analysis to uncover themes, gaps, and strategic opportunities.",
      complete: !!hasAnalysis,
      href: "/app/analysis",
      icon: Sparkles,
      cta: "Run Analysis",
    },
    {
      id: "battlecards",
      step: 4,
      label: "Create a battle card",
      description: "Generate sales battle cards that compare your strengths against specific competitors. Perfect for arming your sales team with talking points.",
      complete: battleCards.length > 0,
      href: "/app/battlecards",
      icon: Swords,
      cta: "Create Battle Card",
    },
    {
      id: "reports",
      step: 5,
      label: "Generate a report",
      description: "Create a branded PDF competitive report you can share with your team or stakeholders. Reports include analysis, positioning, and recommendations.",
      complete: reports.length > 0,
      href: "/app/reports",
      icon: FileText,
      cta: "Generate Report",
    },
    {
      id: "freshness",
      step: 6,
      label: "Keep your data fresh",
      description: "Orbit works best when data is refreshed regularly. Check Data Sources to see freshness and refresh stale data anytime. Pro and Enterprise plans include automatic scheduled refreshes.",
      complete: allDataFresh,
      href: "/app/data-sources",
      icon: RefreshCw,
      cta: "Check Freshness",
    },
  ];

  const completedCount = steps.filter(s => s.complete).length;
  const progress = Math.round((completedCount / steps.length) * 100);
  const allComplete = completedCount === steps.length;
  const nextStep = steps.find(s => !s.complete);

  const handleToggleDashboard = (checked: boolean) => {
    setShowOnDashboard(checked);
    if (checked) {
      localStorage.removeItem(CHECKLIST_DISMISSED_KEY);
    } else {
      localStorage.setItem(CHECKLIST_DISMISSED_KEY, "true");
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Rocket className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Getting Started</h1>
              <p className="text-muted-foreground text-sm">
                {allComplete
                  ? "You've completed all the steps — Orbit is fully set up!"
                  : "Complete these steps to unlock Orbit's full potential"}
              </p>
            </div>
          </div>
          <Badge variant={allComplete ? "default" : "secondary"} className="text-sm px-3 py-1">
            {completedCount}/{steps.length} complete
          </Badge>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Setup Progress</CardTitle>
                <CardDescription>
                  {allComplete
                    ? "All steps completed. You're all set to use Orbit!"
                    : `${steps.length - completedCount} step${steps.length - completedCount !== 1 ? "s" : ""} remaining`}
                </CardDescription>
              </div>
              <span className="text-2xl font-bold text-primary">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2 mt-2" />
          </CardHeader>
        </Card>

        <div className="space-y-3">
          {steps.map((step) => {
            const Icon = step.icon;
            const isNext = !step.complete && step.id === nextStep?.id;
            return (
              <Card
                key={step.id}
                className={cn(
                  "transition-all duration-200",
                  step.complete && "border-green-500/30 bg-green-500/5",
                  isNext && "border-primary/50 ring-1 ring-primary/20 shadow-sm",
                  !step.complete && !isNext && "border-border"
                )}
                data-testid={`getting-started-step-${step.id}`}
              >
                <CardContent className="py-5">
                  <div className="flex items-start gap-4">
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold",
                        step.complete
                          ? "bg-emerald-500 text-primary-foreground dark:bg-emerald-600"
                          : isNext
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      )}>
                        {step.complete ? <CheckCircle2 className="w-4 h-4" /> : step.step}
                      </span>
                      <div className={cn(
                        "p-2 rounded-lg",
                        step.complete
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : isNext
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                      )}>
                        <Icon className="w-5 h-5" />
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className={cn(
                          "font-semibold",
                          step.complete ? "text-green-600 dark:text-green-400" : "text-foreground"
                        )}>
                          {step.label}
                        </h3>
                        {step.complete && (
                          <Badge variant="outline" className="text-xs text-green-600 border-green-500/30 bg-green-500/10">
                            Done
                          </Badge>
                        )}
                        {isNext && (
                          <Badge className="text-xs bg-primary/10 text-primary border-0">
                            Up Next
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{step.description}</p>
                    </div>

                    <div className="shrink-0 self-center">
                      {step.complete ? (
                        <Link href={step.href}>
                          <Button variant="ghost" size="sm">
                            <Eye className="w-4 h-4 mr-1.5" />
                            View
                          </Button>
                        </Link>
                      ) : (
                        <Link href={step.href}>
                          <Button size="sm" variant={isNext ? "default" : "outline"}>
                            {step.cta}
                            {isNext ? (
                              <ArrowRight className="w-4 h-4 ml-1.5" />
                            ) : (
                              <ChevronRight className="w-4 h-4 ml-1.5" />
                            )}
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Label htmlFor="show-on-dashboard" className="text-sm font-medium cursor-pointer">
                  Show getting started checklist on dashboard
                </Label>
                <p className="text-xs text-muted-foreground hidden sm:block">
                  Toggle the checklist card on your Overview page
                </p>
              </div>
              <Switch
                id="show-on-dashboard"
                checked={showOnDashboard}
                onCheckedChange={handleToggleDashboard}
                data-testid="toggle-dashboard-checklist"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
