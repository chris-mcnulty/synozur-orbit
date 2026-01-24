import React from "react";
import AppLayout from "@/components/layout/AppLayout";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip as TooltipPrimitive, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Users, Target, Eye, ArrowUpRight, Building2, Briefcase, TrendingUp, 
  AlertCircle, CheckCircle2, Clock, Lightbulb, FileText, Plus, 
  Globe, Zap, Activity, ChevronRight, Sparkles, BarChart3, Rocket, X, Swords,
  RefreshCw, Loader2, CheckCircle, XCircle, User, Linkedin, Rss, MessageSquare, HelpCircle
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/lib/userContext";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

const hasAdminAccess = (role: string) => 
  role === "Global Admin" || role === "Domain Admin";

// Format date for mobile-friendly display (relative time or short date)
const formatSignalDate = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  // For older dates, show short format like "Jan 17"
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const innovationVal = typeof payload[0]?.value === 'number' ? payload[0].value.toFixed(2) : payload[0]?.value;
    const presenceVal = typeof payload[1]?.value === 'number' ? payload[1].value.toFixed(2) : payload[1]?.value;
    return (
      <div className="bg-card border border-border p-3 rounded-lg shadow-lg text-xs">
        <p className="font-semibold text-sm mb-1">{payload[0].payload.name}</p>
        <div className="space-y-1 text-muted-foreground">
          <p>Innovation: {innovationVal}</p>
          <p>Market Presence: {presenceVal}</p>
        </div>
        <p className="text-primary text-xs mt-2 flex items-center">
          Click to view details <ChevronRight className="w-3 h-3 ml-1" />
        </p>
      </div>
    );
  }
  return null;
};

export default function Dashboard() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [checklistDismissed, setChecklistDismissed] = useState(() => {
    return localStorage.getItem("orbit_onboarding_dismissed") === "true";
  });
  const [isRebuilding, setIsRebuilding] = useState(false);

  const isAdmin = user ? hasAdminAccess(user.role) : false;

  const { data: competitors = [] } = useQuery({
    queryKey: ["/api/competitors"],
    queryFn: async () => {
      const response = await fetch("/api/competitors", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const { data: activity = [] } = useQuery({
    queryKey: ["/api/activity"],
    queryFn: async () => {
      const response = await fetch("/api/activity", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const { data: recommendations = [] } = useQuery({
    queryKey: ["/api/recommendations"],
    queryFn: async () => {
      const response = await fetch("/api/recommendations", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const { data: companyProfile } = useQuery({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const response = await fetch("/api/company-profile", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["/api/projects"],
    queryFn: async () => {
      const response = await fetch("/api/projects", { credentials: "include" });
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

  const { data: reports = [] } = useQuery({
    queryKey: ["/api/reports"],
    queryFn: async () => {
      const response = await fetch("/api/reports", { credentials: "include" });
      if (!response.ok) return [];
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

  // Fetch calculated scores for baseline and competitors
  const { data: dashboardScores } = useQuery<{
    baseline: { name: string; innovationScore: number; marketPresenceScore: number; overallScore: number } | null;
    competitors: { id: string; name: string; innovationScore: number; marketPresenceScore: number; overallScore: number }[];
    marketAverages: { innovationScore: number; marketPresenceScore: number; overallScore: number };
    deltaVsMarket: { absolute: number; percent: number };
  }>({
    queryKey: ["/api/dashboard/scores"],
    queryFn: async () => {
      const response = await fetch("/api/dashboard/scores", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
  });

  const { data: tenantUsers = [] } = useQuery<{ id: string; name: string; email: string }[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const response = await fetch("/api/users", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const rebuildAll = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/rebuild-all", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to start rebuild");
      }
      return res.json();
    },
    onSuccess: (result) => {
      setIsRebuilding(true);
      toast({
        title: "Rebuild Started",
        description: `Processing ${result.totalItems} items (${result.competitors} competitors, ${result.products} products)`,
      });
      setTimeout(() => {
        setIsRebuilding(false);
        queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
        queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/scores"] });
        toast({
          title: "Rebuild Complete",
          description: "All competitive intelligence has been refreshed.",
        });
      }, 30000);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateRecommendation = useMutation({
    mutationFn: async ({ id, status, assignedTo }: { id: string; status?: string; assignedTo?: string | null }) => {
      const res = await fetch(`/api/recommendations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, assignedTo }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
      toast({ title: "Updated", description: "Action item updated successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update action item.", variant: "destructive" });
    },
  });

  const baselineComplete = companyProfile && companyProfile.websiteUrl;
  const hasAnalysis = analysis && analysis.themes;
  const activeProjects = projects.filter((p: any) => p.status === "active");
  const highImpactActivity = activity.filter((a: any) => a.impact === "High");
  
  const prioritizedActivity = [...activity].sort((a: any, b: any) => {
    const typePriority: Record<string, number> = { 
      website_update: 1, 
      blog_update: 2, 
      social_update: 3, 
      crawl: 4 
    };
    const aPriority = typePriority[a.type] || 5;
    const bPriority = typePriority[b.type] || 5;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime();
  });
  
  const meaningfulSignals = activity.filter((a: any) => 
    a.type === "website_update" || a.type === "blog_update" || a.type === "social_update"
  );

  // Onboarding checklist items
  const onboardingSteps = [
    {
      id: "company",
      label: "Set up company profile",
      description: "Add your website and company details",
      complete: !!baselineComplete,
      href: "/app/company-profile",
      icon: Building2,
    },
    {
      id: "competitors",
      label: "Add competitors",
      description: "Track at least one competitor",
      complete: competitors.length > 0,
      href: "/app/competitors",
      icon: Users,
    },
    {
      id: "analysis",
      label: "Run an analysis",
      description: "Generate competitive insights",
      complete: !!hasAnalysis,
      href: "/app/analysis",
      icon: Sparkles,
    },
    {
      id: "battlecards",
      label: "Create a battle card",
      description: "Arm your sales team",
      complete: battleCards.length > 0,
      href: "/app/battlecards",
      icon: Swords,
    },
    {
      id: "reports",
      label: "Generate a report",
      description: "Create your first competitive report",
      complete: reports.length > 0,
      href: "/app/reports",
      icon: FileText,
    },
  ];

  const completedSteps = onboardingSteps.filter(s => s.complete).length;
  const onboardingProgress = Math.round((completedSteps / onboardingSteps.length) * 100);
  const showOnboarding = !checklistDismissed && completedSteps < onboardingSteps.length;

  const handleDismissChecklist = () => {
    localStorage.setItem("orbit_onboarding_dismissed", "true");
    setChecklistDismissed(true);
  };

  // Build positioning data from calculated scores
  const positioningData = [
    ...(dashboardScores?.baseline ? [{
      x: dashboardScores.baseline.innovationScore,
      y: dashboardScores.baseline.marketPresenceScore,
      name: dashboardScores.baseline.name || 'Your Company',
      type: 'us',
      id: 'baseline'
    }] : []),
    ...(dashboardScores?.competitors || []).slice(0, 6).map((c) => ({
      x: c.innovationScore,
      y: c.marketPresenceScore,
      name: c.name,
      type: 'competitor',
      id: c.id
    }))
  ];

  // Current score - no fake trend data
  const baselineScore = dashboardScores?.baseline?.overallScore || 0;

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case "High": return "text-destructive bg-destructive/10";
      case "Medium": return "text-yellow-500 bg-yellow-500/10";
      default: return "text-green-500 bg-green-500/10";
    }
  };

  return (
    <AppLayout>
      <div className="mb-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-1">Overview</h1>
            <p className="text-muted-foreground">
              Welcome back, {user?.name?.split(" ")[0] || "there"}. Here's your competitive intelligence at a glance.
            </p>
          </div>
          <div className="flex gap-2">
            {isAdmin ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => rebuildAll.mutate()}
                disabled={isRebuilding || rebuildAll.isPending}
                data-testid="button-rebuild-all"
              >
                {isRebuilding || rebuildAll.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Rebuilding...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Rebuild All
                  </>
                )}
              </Button>
            ) : (
              <TooltipPrimitive>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" disabled data-testid="button-rebuild-all-disabled">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Rebuild All
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Admin access required</p>
                </TooltipContent>
              </TooltipPrimitive>
            )}
            <Link href="/app/reports">
              <Button variant="outline" size="sm" data-testid="button-view-reports">
                <FileText className="w-4 h-4 mr-2" /> Reports
              </Button>
            </Link>
            <Link href="/app/analysis">
              <Button size="sm" data-testid="button-run-analysis">
                <Sparkles className="w-4 h-4 mr-2" /> Run Analysis
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {showOnboarding && (
        <Card className="mb-6 border-primary/30 bg-gradient-to-r from-primary/5 to-secondary/5 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-75 fill-mode-backwards" data-testid="card-onboarding-checklist">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Rocket className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Getting Started</CardTitle>
                  <CardDescription>Complete these steps to unlock Orbit's full potential</CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right mr-2">
                  <span className="text-sm font-semibold text-primary">{completedSteps}/{onboardingSteps.length}</span>
                  <span className="text-xs text-muted-foreground ml-1">complete</span>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={handleDismissChecklist}
                  data-testid="button-dismiss-checklist"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <Progress value={onboardingProgress} className="h-1.5 mt-3" />
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {onboardingSteps.map((step, index) => {
                const Icon = step.icon;
                const isNext = !step.complete && onboardingSteps.slice(0, index).every(s => s.complete);
                return (
                  <Link key={step.id} href={step.href}>
                    <div
                      className={cn(
                        "group relative p-3 rounded-lg border transition-all duration-200 cursor-pointer",
                        step.complete
                          ? "bg-green-500/5 border-green-500/30"
                          : isNext
                          ? "bg-primary/5 border-primary/50 ring-1 ring-primary/20"
                          : "bg-muted/30 border-border hover:border-primary/30"
                      )}
                      data-testid={`checklist-step-${step.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "p-1.5 rounded-md transition-colors",
                            step.complete
                              ? "bg-green-500/20 text-green-500"
                              : isNext
                              ? "bg-primary/20 text-primary"
                              : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
                          )}
                        >
                          {step.complete ? (
                            <CheckCircle2 className="w-4 h-4" />
                          ) : (
                            <Icon className="w-4 h-4" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className={cn(
                              "text-sm font-medium leading-tight",
                              step.complete ? "text-green-500" : isNext ? "text-primary" : "text-foreground"
                            )}
                          >
                            {step.label}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {step.complete ? "Completed" : step.description}
                          </p>
                        </div>
                      </div>
                      {isNext && (
                        <div className="absolute -top-1 -right-1">
                          <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                          </span>
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100 fill-mode-backwards">
        <Link href="/app/company-profile">
          <Card className={cn(
            "cursor-pointer hover:border-primary/50 transition-all duration-300 group h-full",
            !baselineComplete && "border-yellow-500/50"
          )} data-testid="card-baseline-status">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Baseline Status</CardTitle>
              {baselineComplete ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <AlertCircle className="h-4 w-4 text-yellow-500" />
              )}
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold group-hover:text-primary transition-colors">
                {baselineComplete ? "Complete" : "Needs Setup"}
              </div>
              <p className="text-xs text-muted-foreground">
                {companyProfile?.name || "Set up your company profile"}
              </p>
              {!baselineComplete && (
                <div className="mt-2">
                  <Progress value={30} className="h-1" />
                </div>
              )}
            </CardContent>
          </Card>
        </Link>

        <Link href="/app/competitors">
          <Card className="cursor-pointer hover:border-primary/50 transition-all duration-300 group h-full" data-testid="card-competitors">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Competitors</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold group-hover:text-primary transition-colors">{competitors.length}</div>
              <p className="text-xs text-muted-foreground">Being tracked</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/app/activity">
          <Card className={cn(
            "cursor-pointer hover:border-primary/50 transition-all duration-300 group h-full",
            highImpactActivity.length > 0 && "border-destructive/30"
          )} data-testid="card-signals">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Live Signals</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold group-hover:text-primary transition-colors">{activity.length}</span>
                {highImpactActivity.length > 0 && (
                  <Badge variant="destructive" className="text-xs">{highImpactActivity.length} High</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Recent changes detected</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/app/projects">
          <Card className="cursor-pointer hover:border-primary/50 transition-all duration-300 group h-full" data-testid="card-projects">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Products</CardTitle>
              <Briefcase className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold group-hover:text-primary transition-colors">{activeProjects.length}</div>
              <p className="text-xs text-muted-foreground">Client analyses</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/app/analysis">
          <Card className="cursor-pointer hover:border-primary/50 transition-all duration-300 group h-full" data-testid="card-orbit-score">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Orbit Score</CardTitle>
              <TrendingUp className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-primary">
                  {dashboardScores?.baseline?.overallScore?.toFixed(2) || '—'}
                </span>
                {dashboardScores?.deltaVsMarket && (
                  <span className={cn("text-xs", dashboardScores.deltaVsMarket.percent >= 0 ? "text-green-500" : "text-red-500")}>
                    {dashboardScores.deltaVsMarket.percent >= 0 ? '+' : ''}{dashboardScores.deltaVsMarket.percent}%
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">vs market average</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200 fill-mode-backwards">
        <Card className="lg:col-span-2 hover:border-primary/20 transition-colors duration-300">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-primary" />
                Market Positioning
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" data-testid="button-scoring-help">
                      <HelpCircle className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-primary" />
                        Understanding Orbit Scores
                      </DialogTitle>
                      <DialogDescription>How we measure competitive positioning</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-6 py-4">
                      <div>
                        <h4 className="font-semibold mb-2">Orbit Score (0-100)</h4>
                        <p className="text-sm text-muted-foreground mb-3">
                          The overall Orbit Score combines four key components to give you a comprehensive view of each competitor's market position.
                        </p>
                        <div className="grid gap-3">
                          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                            <div className="w-12 text-center">
                              <span className="text-lg font-bold text-primary">35%</span>
                            </div>
                            <div>
                              <p className="font-medium">Innovation Score</p>
                              <p className="text-xs text-muted-foreground">How differentiated and fresh the messaging is. Based on keyword variety, distinct value propositions, content freshness, and blog activity.</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                            <div className="w-12 text-center">
                              <span className="text-lg font-bold text-primary">35%</span>
                            </div>
                            <div>
                              <p className="font-medium">Market Presence</p>
                              <p className="text-xs text-muted-foreground">Visibility and establishment in the market. Includes social followers, engagement, website depth, and brand consistency.</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                            <div className="w-12 text-center">
                              <span className="text-lg font-bold text-primary">15%</span>
                            </div>
                            <div>
                              <p className="font-medium">Content Activity</p>
                              <p className="text-xs text-muted-foreground">How actively they publish and update content. Measures content freshness, blog posting frequency, and website completeness.</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                            <div className="w-12 text-center">
                              <span className="text-lg font-bold text-primary">15%</span>
                            </div>
                            <div>
                              <p className="font-medium">Social Engagement</p>
                              <p className="text-xs text-muted-foreground">Social media reach and interaction. Combines follower counts and engagement metrics from LinkedIn and other platforms.</p>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <h4 className="font-semibold mb-2">Reading the Chart</h4>
                        <p className="text-sm text-muted-foreground mb-3">
                          The scatter plot shows competitors plotted on two axes:
                        </p>
                        <ul className="text-sm text-muted-foreground space-y-2 ml-4">
                          <li><strong>X-axis (Innovation):</strong> How unique and differentiated the positioning is</li>
                          <li><strong>Y-axis (Market Presence):</strong> How visible and established in the market</li>
                        </ul>
                        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                          <div className="p-2 rounded bg-green-500/10 text-green-600 text-center">
                            <strong>Top-Right:</strong> Strong competitors
                          </div>
                          <div className="p-2 rounded bg-yellow-500/10 text-yellow-600 text-center">
                            <strong>Top-Left:</strong> Established but generic
                          </div>
                          <div className="p-2 rounded bg-blue-500/10 text-blue-600 text-center">
                            <strong>Bottom-Right:</strong> Innovative disruptors
                          </div>
                          <div className="p-2 rounded bg-muted text-muted-foreground text-center">
                            <strong>Bottom-Left:</strong> Weaker competitors
                          </div>
                        </div>
                      </div>
                      
                      <div className="pt-2 border-t">
                        <p className="text-xs text-muted-foreground">
                          Scores update automatically when you run analyses. For detailed documentation, see the User Guide in About.
                        </p>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardTitle>
              <CardDescription>Your brand vs competitors on key axes. Click any point for details.</CardDescription>
            </div>
            <Link href="/app/analysis">
              <Button variant="ghost" size="sm" className="text-xs" data-testid="link-full-analysis">
                Full Analysis <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 20, bottom: 30, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis 
                  type="number" 
                  dataKey="x" 
                  name="Innovation" 
                  unit="%" 
                  domain={[0, 100]} 
                  label={{ value: 'Innovation Score', position: 'insideBottom', offset: -15, fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} 
                  tick={{fontSize: 10, fill: 'hsl(var(--muted-foreground))'}} 
                />
                <YAxis 
                  type="number" 
                  dataKey="y" 
                  name="Market Presence" 
                  unit="%" 
                  domain={[0, 100]} 
                  label={{ value: 'Market Presence', angle: -90, position: 'insideLeft', offset: 5, fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} 
                  tick={{fontSize: 10, fill: 'hsl(var(--muted-foreground))'}} 
                />
                <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />
                <Scatter 
                  name="Competitors" 
                  data={positioningData} 
                  shape={(props: any) => {
                    const { cx, cy, payload } = props;
                    const isUs = payload?.type === 'us';
                    return (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isUs ? 12 : 8}
                        fill={isUs ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
                        opacity={isUs ? 1 : 0.7}
                        style={{ cursor: 'pointer' }}
                        data-testid={`chart-point-${payload?.id}`}
                        onClick={() => {
                          if (payload?.id) {
                            if (isUs) {
                              setLocation('/app/company-profile');
                            } else {
                              setLocation(`/app/competitors/${payload.id}`);
                            }
                          }
                        }}
                      />
                    );
                  }}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              Score Trend
            </CardTitle>
            <CardDescription>Your Orbit Score over time</CardDescription>
          </CardHeader>
          <CardContent className="h-[200px] flex flex-col items-center justify-center">
            <div className="text-center">
              <TrendingUp className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-medium text-muted-foreground">Historical data coming soon</p>
              <p className="text-xs text-muted-foreground mt-1">
                Score trends will appear as you track competitors over time
              </p>
              {baselineScore > 0 && (
                <div className="mt-4 px-4 py-2 bg-primary/10 rounded-lg inline-block">
                  <p className="text-xs text-muted-foreground">Current Score</p>
                  <p className="text-2xl font-bold text-primary">{baselineScore.toFixed(0)}</p>
                </div>
              )}
            </div>
          </CardContent>
          <CardFooter className="pt-0">
            <p className="text-xs text-muted-foreground">
              {dashboardScores?.deltaVsMarket ? (
                <>
                  <span className={cn("font-medium", dashboardScores.deltaVsMarket.absolute >= 0 ? "text-green-500" : "text-red-500")}>
                    {dashboardScores.deltaVsMarket.absolute >= 0 ? '+' : ''}{dashboardScores.deltaVsMarket.absolute.toFixed(2)}
                  </span> vs market average ({dashboardScores.marketAverages?.overallScore?.toFixed(2) || '—'})
                </>
              ) : (
                'Add competitors to see score comparison'
              )}
            </p>
          </CardFooter>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300 fill-mode-backwards">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-500" />
                Live Signals
              </CardTitle>
              <CardDescription>Latest competitor movements</CardDescription>
            </div>
            <Link href="/app/activity">
              <Button variant="ghost" size="sm" className="text-xs" data-testid="link-all-signals">
                View All <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <div className="text-center py-8">
                <Activity className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-sm text-muted-foreground">No signals yet</p>
                <p className="text-xs text-muted-foreground">Add competitors to start tracking</p>
              </div>
            ) : (
              <div className="space-y-3">
                {meaningfulSignals.length > 0 && (
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="default" className="text-xs bg-primary/10 text-primary border-0">
                      {meaningfulSignals.length} meaningful change{meaningfulSignals.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                )}
                {prioritizedActivity.slice(0, 5).map((item: any) => {
                  const isMeaningful = item.type === "website_update" || item.type === "blog_update" || item.type === "social_update";
                  const getSignalIcon = () => {
                    if (item.type === "website_update") return <Globe className="w-3 h-3" />;
                    if (item.type === "blog_update") return <Rss className="w-3 h-3" />;
                    if (item.type === "social_update") return <Linkedin className="w-3 h-3" />;
                    if (item.impact === "High") return <AlertCircle className="w-3 h-3" />;
                    return <Eye className="w-3 h-3" />;
                  };
                  const getSignalLabel = () => {
                    if (item.type === "website_update") return "website change";
                    if (item.type === "blog_update") {
                      const postCount = item.details?.newPosts?.length || item.details?.postCount;
                      return postCount ? `${postCount} new post${postCount > 1 ? 's' : ''}` : "blog activity";
                    }
                    if (item.type === "social_update") {
                      const postCount = item.details?.postCount;
                      return postCount ? `${postCount} LinkedIn post${postCount > 1 ? 's' : ''}` : "social update";
                    }
                    return item.type?.replace(/_/g, ' ') || "update";
                  };
                  const getIconBgColor = () => {
                    if (item.type === "blog_update") return "bg-orange-500/20 text-orange-500";
                    if (item.type === "social_update") return "bg-blue-500/20 text-blue-500";
                    return getImpactColor(item.impact);
                  };
                  return (
                    <div 
                      key={item.id} 
                      onClick={() => setLocation(`/app/competitors/${item.competitorId}`)}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group",
                        isMeaningful && "border border-primary/20 bg-primary/5"
                      )} 
                      data-testid={`signal-${item.id}`}
                    >
                      <div className={cn("p-1.5 rounded-full shrink-0", getIconBgColor())}>
                        {getSignalIcon()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                            {item.competitorName}
                          </span>
                          <Badge variant={isMeaningful ? "default" : "outline"} className={cn(
                            "text-xs shrink-0",
                            item.type === "blog_update" && "bg-orange-500/10 text-orange-600 border-orange-500/30",
                            item.type === "social_update" && "bg-blue-500/10 text-blue-600 border-blue-500/30"
                          )}>
                            {getSignalLabel()}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {item.summary || item.description}
                        </p>
                        {item.type === "blog_update" && item.details?.newPosts?.[0]?.title && (
                          <div className="mt-1">
                            <p className="text-xs text-orange-600 truncate">
                              "{item.details.newPosts[0].title}"
                            </p>
                            {item.details.newPosts[0].link && (
                              <a 
                                href={item.details.newPosts[0].link} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs text-orange-500 hover:text-orange-600 hover:underline mt-0.5 inline-flex items-center gap-1"
                              >
                                Read post →
                              </a>
                            )}
                          </div>
                        )}
                        {item.type === "social_update" && item.details?.latestPostTitle && (
                          <div className="mt-1">
                            <p className="text-xs text-blue-600 truncate">
                              "{item.details.latestPostTitle}"
                            </p>
                            {item.details?.recentPosts?.[0]?.url && (
                              <a 
                                href={item.details.recentPosts[0].url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs text-blue-500 hover:text-blue-600 hover:underline mt-0.5 inline-flex items-center gap-1"
                              >
                                View on LinkedIn →
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0 flex items-center gap-1" title={item.date || item.createdAt}>
                        <Clock className="w-3 h-3 hidden sm:block" />
                        {formatSignalDate(item.createdAt || item.date)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-primary" />
                AI Insights
              </CardTitle>
              <CardDescription>Recommended actions based on analysis</CardDescription>
            </div>
            <Link href="/app/recommendations">
              <Button variant="ghost" size="sm" className="text-xs" data-testid="link-all-insights">
                View All <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {recommendations.length === 0 ? (
              <div className="text-center py-8">
                <Sparkles className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-sm text-muted-foreground">No insights yet</p>
                <p className="text-xs text-muted-foreground mb-4">Run an analysis to get AI recommendations</p>
                <Link href="/app/analysis">
                  <Button size="sm" variant="outline">
                    <Sparkles className="w-4 h-4 mr-2" /> Run Analysis
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {recommendations.slice(0, 4).map((rec: any) => (
                  <div key={rec.id} className="p-3 rounded-lg border border-border hover:border-primary/30 transition-colors" data-testid={`insight-${rec.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="p-1.5 rounded-full bg-primary/10 text-primary shrink-0">
                          <Target className="w-3 h-3" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm mb-1">{rec.title}</p>
                          <p className="text-xs text-muted-foreground line-clamp-2">{rec.description}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant="secondary" className="text-xs">{rec.area}</Badge>
                            <Badge variant={rec.impact === "High" ? "destructive" : "outline"} className="text-xs">
                              {rec.impact} Impact
                            </Badge>
                            {rec.assignedTo && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <User className="w-3 h-3" /> Assigned
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Select
                          value={rec.assignedTo || "unassigned"}
                          onValueChange={(value) => 
                            updateRecommendation.mutate({ 
                              id: rec.id, 
                              assignedTo: value === "unassigned" ? null : value 
                            })
                          }
                        >
                          <SelectTrigger className="w-24 h-7 text-xs" data-testid={`select-assign-${rec.id}`}>
                            <SelectValue placeholder="Assign" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                            {tenantUsers.map((u) => (
                              <SelectItem key={u.id} value={u.id}>
                                {u.name || u.email}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-green-500 hover:text-green-400 hover:bg-green-500/10"
                          onClick={() => updateRecommendation.mutate({ id: rec.id, status: "accepted" })}
                          data-testid={`button-accept-${rec.id}`}
                        >
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                          onClick={() => updateRecommendation.mutate({ id: rec.id, status: "dismissed" })}
                          data-testid={`button-dismiss-${rec.id}`}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {activeProjects.length > 0 && (
        <div className="mb-6 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-400 fill-mode-backwards">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-primary" />
              Active Products
            </h2>
            <Link href="/app/projects">
              <Button variant="ghost" size="sm" className="text-xs" data-testid="link-all-projects">
                View All <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {activeProjects.slice(0, 3).map((project: any) => (
              <Link key={project.id} href={`/app/products/${project.id}`}>
                <Card className="cursor-pointer hover:border-primary/50 transition-all duration-300 group h-full" data-testid={`project-card-${project.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant="outline" className="text-xs">
                        {project.analysisType === "product" ? "Product Analysis" : "Company Analysis"}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">{project.status}</Badge>
                    </div>
                    <CardTitle className="text-base group-hover:text-primary transition-colors">{project.clientName}</CardTitle>
                    <CardDescription className="text-xs line-clamp-1">{project.name}</CardDescription>
                  </CardHeader>
                  <CardContent className="pb-3">
                    {project.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{project.description}</p>
                    )}
                  </CardContent>
                  <CardFooter className="pt-0 border-t">
                    <div className="flex items-center justify-between w-full text-xs text-muted-foreground pt-3">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Updated {new Date(project.updatedAt).toLocaleDateString()}
                      </span>
                      <ChevronRight className="w-4 h-4 group-hover:text-primary transition-colors" />
                    </div>
                  </CardFooter>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-500 fill-mode-backwards">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" />
              Quick Actions
            </CardTitle>
            <CardDescription>Common tasks to keep your intelligence fresh</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <Link href="/app/competitors">
                <Button variant="outline" className="w-full justify-start h-auto py-3" data-testid="action-add-competitor">
                  <Plus className="w-4 h-4 mr-3 text-primary" />
                  <div className="text-left">
                    <div className="font-medium">Add Competitor</div>
                    <div className="text-xs text-muted-foreground">Track a new company</div>
                  </div>
                </Button>
              </Link>
              <Link href="/app/analysis">
                <Button variant="outline" className="w-full justify-start h-auto py-3" data-testid="action-run-analysis">
                  <Sparkles className="w-4 h-4 mr-3 text-primary" />
                  <div className="text-left">
                    <div className="font-medium">Run Analysis</div>
                    <div className="text-xs text-muted-foreground">Get AI-powered insights</div>
                  </div>
                </Button>
              </Link>
              <Link href="/app/reports">
                <Button variant="outline" className="w-full justify-start h-auto py-3" data-testid="action-generate-report">
                  <FileText className="w-4 h-4 mr-3 text-primary" />
                  <div className="text-left">
                    <div className="font-medium">Generate Report</div>
                    <div className="text-xs text-muted-foreground">Create branded PDF</div>
                  </div>
                </Button>
              </Link>
              <Link href="/app/projects">
                <Button variant="outline" className="w-full justify-start h-auto py-3" data-testid="action-new-project">
                  <Briefcase className="w-4 h-4 mr-3 text-primary" />
                  <div className="text-left">
                    <div className="font-medium">New Project</div>
                    <div className="text-xs text-muted-foreground">Start client analysis</div>
                  </div>
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Recent Reports
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reports.length === 0 ? (
              <div className="text-center py-6">
                <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                <p className="text-sm text-muted-foreground">No reports yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {reports.slice(0, 3).map((report: any) => (
                  <div key={report.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors" data-testid={`recent-report-${report.id}`}>
                    <div className="p-2 rounded bg-primary/10 text-primary">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{report.name}</p>
                      <p className="text-xs text-muted-foreground">{report.date}</p>
                    </div>
                    <Badge variant={report.status === "Ready" ? "default" : "secondary"} className="text-xs shrink-0">
                      {report.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
          <CardFooter className="pt-0">
            <Link href="/app/reports" className="w-full">
              <Button variant="ghost" size="sm" className="w-full text-xs" data-testid="link-all-reports">
                View All Reports <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    </AppLayout>
  );
}
