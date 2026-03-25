import React, { useState } from "react";
import { Link } from "wouter";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowRight, AlertTriangle, BarChart2, Play, Loader2, RefreshCw, ChevronDown, Zap, Globe, Sparkles, Rocket, MessageCircle, Check, Clock, Download, FileText, ChevronRight, FileStack, Mail, RotateCcw, Filter, Table, X, Lock, Activity, Eye, Users, CheckCircle2 } from "lucide-react";
import { PlanLimitBadge } from "@/components/UpgradePrompt";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { exportToCSV, type CSVExportItem } from "@/lib/csv-export";
import { calculateStaleness, getTimeAgo, getStalenessInfo, checkArtifactFreshness, formatShortDate, type StalenessLevel } from "@/lib/staleness";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import SharedSourceFreshnessRow, { type SourceFreshnessItem, type SourceFreshnessData } from "@/components/SourceFreshnessRow";

// StalenessDot is now handled by shared SourceFreshnessRow component

function getThemeCompetitorNames(themes: any[]): string[] {
  if (!themes || themes.length === 0) return [];
  const first = themes[0];
  if (first.scores && typeof first.scores === "object") {
    return Object.keys(first.scores);
  }
  return [];
}

function getThemeLevel(theme: any, competitorName: string): string {
  if (theme.scores && theme.scores[competitorName]) {
    return theme.scores[competitorName].level || "";
  }
  if (competitorName === "Us") return theme.us || "";
  if (competitorName === "competitorA") return theme.competitorA || "";
  if (competitorName === "competitorB") return theme.competitorB || "";
  return "";
}

function getMessagingCompetitorNames(messaging: any[]): string[] {
  if (!messaging || messaging.length === 0) return [];
  const first = messaging[0];
  if (first.entries && typeof first.entries === "object") {
    return Object.keys(first.entries);
  }
  return [];
}

function getMessagingEntry(item: any, competitorName: string): string {
  if (item.entries && item.entries[competitorName]) {
    return item.entries[competitorName];
  }
  if (competitorName === "Us") return item.us || "";
  if (competitorName === "competitorA") return item.competitorA || "";
  if (competitorName === "competitorB") return item.competitorB || "";
  return "";
}

function isLegacyThemeFormat(themes: any[]): boolean {
  if (!themes || themes.length === 0) return false;
  return !themes[0].scores;
}

function isLegacyMessagingFormat(messaging: any[]): boolean {
  if (!messaging || messaging.length === 0) return false;
  return !messaging[0].entries;
}

type AnalysisMode = "quick" | "full" | "full_with_change";

export default function Analysis() {
  const queryClient = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);
  const [regenerationStarted, setRegenerationStarted] = useState(false);
  const [regenerationDialogOpen, setRegenerationDialogOpen] = useState(false);
  const [regenerateAllWarningOpen, setRegenerateAllWarningOpen] = useState(false);
  const [selectiveRegenOpen, setSelectiveRegenOpen] = useState(false);
  const [regenSelections, setRegenSelections] = useState<Record<string, boolean>>({
    analysis: true,
    battlecards: false,
    gtm: false,
    messaging: false,
  });
  const [gapCategoryFilter, setGapCategoryFilter] = useState<string>("all");
  const [isFreshnessDialogOpen, setIsFreshnessDialogOpen] = useState(false);
  const [pendingAnalysisMode, setPendingAnalysisMode] = useState<AnalysisMode>("full");
  const [refreshSelections, setRefreshSelections] = useState<Record<string, boolean>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [competitorSelections, setCompetitorSelections] = useState<Record<string, boolean>>({});

  const { data: analysis, isLoading } = useQuery({
    queryKey: ["/api/analysis"],
    queryFn: async () => {
      const response = await fetch("/api/analysis", { credentials: "include" });
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

  const { data: companyProfile } = useQuery({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const response = await fetch("/api/company-profile", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
  });

  const { data: tenant } = useQuery({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const response = await fetch("/api/tenant/info", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
  });

  const isPremium = tenant?.isPremium || tenant?.plan === "pro" || tenant?.plan === "enterprise" || tenant?.plan === "unlimited";
  const analysisLimit = tenant?.limits?.analysisLimit ?? tenant?.features?.analysisLimit ?? -1;
  const analysisCount = tenant?.usage?.monthlyAnalysisCount ?? 0;

  const { data: freshness, refetch: refetchFreshness } = useQuery<SourceFreshnessData>({
    queryKey: ["/api/analysis/source-freshness"],
    queryFn: async () => {
      const res = await fetch("/api/analysis/source-freshness", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load source freshness");
      return res.json();
    },
    staleTime: 60000,
    enabled: false,
  });


  const { data: recommendations = [] } = useQuery<any[]>({
    queryKey: ["/api/recommendations"],
    queryFn: async () => {
      const response = await fetch("/api/recommendations", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const generateAnalysisMutation = useMutation({
    mutationFn: async (mode: AnalysisMode) => {
      setIsGenerating(true);
      const hasExplicitSelections = Object.keys(competitorSelections).length > 0;
      const selectedIds = hasExplicitSelections
        ? Object.entries(competitorSelections).filter(([, v]) => v).map(([id]) => id)
        : [];
      if (hasExplicitSelections && selectedIds.length === 0) {
        throw new Error("No competitors selected. Please select at least one competitor to analyze.");
      }
      const response = await fetch("/api/analysis/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysisType: mode,
          ...(hasExplicitSelections ? { selectedCompetitorIds: selectedIds } : {}),
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to generate analysis");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setIsGenerating(false);
      toast.success(`Analysis complete! Analyzed ${data.analyzedCount} competitors.`);
      queryClient.invalidateQueries({ queryKey: ["/api/analysis"] });
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
    },
    onError: (error: Error) => {
      setIsGenerating(false);
      toast.error(error.message);
    },
  });

  const computeStaleKeys = (data: SourceFreshnessData): string[] => {
    const keys: string[] = [];
    const checkItem = (item: SourceFreshnessItem, prefix: string) => {
      if (calculateStaleness(item.lastCrawl) !== "fresh") keys.push(`${prefix}:${item.id}:crawl`);
      if (calculateStaleness(item.lastWebsiteMonitor) !== "fresh") keys.push(`${prefix}:${item.id}:monitor`);
      if (calculateStaleness(item.lastSocialMonitor) !== "fresh") keys.push(`${prefix}:${item.id}:social`);
    };
    if (data.baseline) checkItem(data.baseline, "baseline");
    data.competitors.forEach(c => checkItem(c, "competitor"));
    return keys;
  };

  const openFreshnessDialog = async (mode: AnalysisMode) => {
    if (mode === "full_with_change" && !isPremium) {
      toast.error("Change detection requires a Pro or Enterprise plan");
      return;
    }
    setPendingAnalysisMode(mode);
    const result = await refetchFreshness();
    const freshData = result.data;
    const defaultSelections: Record<string, boolean> = {};
    if (freshData) {
      computeStaleKeys(freshData).forEach(k => { defaultSelections[k] = false; });
    }
    setRefreshSelections(defaultSelections);
    const defaultCompetitorSelections: Record<string, boolean> = {};
    competitors.forEach((c: { id: string | number }) => { defaultCompetitorSelections[String(c.id)] = true; });
    setCompetitorSelections(defaultCompetitorSelections);
    setIsFreshnessDialogOpen(true);
  };

  const handleRefreshAndGenerate = async (refreshFirst: boolean) => {
    if (refreshFirst) {
      const selectedKeys = Object.entries(refreshSelections).filter(([, v]) => v).map(([k]) => k);
      if (selectedKeys.length > 0) {
        setIsRefreshing(true);
        try {
          for (const key of selectedKeys) {
            const [type, id, source] = key.split(":");
            let url = "";
            if (type === "baseline") {
              if (source === "crawl" || source === "monitor") {
                url = `/api/company-profile/${id}/refresh`;
              } else if (source === "social") {
                url = `/api/company-profile/${id}/refresh-social`;
              }
            } else {
              if (source === "crawl") {
                url = `/api/competitors/${id}/crawl`;
              } else if (source === "monitor") {
                url = `/api/competitors/${id}/monitor-website`;
              } else if (source === "social") {
                url = `/api/competitors/${id}/monitor-social`;
              }
            }
            if (url) {
              const res = await fetch(url, { method: "POST", credentials: "include" });
              if (!res.ok) {
                console.warn(`Refresh failed for ${key}: ${res.status}`);
              }
            }
          }
          toast.success(`${selectedKeys.length} source refresh(es) started. Generating analysis with latest data...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch {
          toast.error("Some refreshes failed. Proceeding with generation anyway.");
        } finally {
          setIsRefreshing(false);
        }
      }
    }
    setIsFreshnessDialogOpen(false);
    generateAnalysisMutation.mutate(pendingAnalysisMode);
  };

  const runAnalysis = (mode: AnalysisMode) => {
    openFreshnessDialog(mode);
  };

  const fullRegenerationMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/baseline/full-regenerate", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to start regeneration");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setRegenerationStarted(true);
      setRegenerationDialogOpen(true);
      toast.success(`Full regeneration started! Estimated time: ${data.estimatedMinutes} minutes`);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading analysis...</p>
        </div>
      </AppLayout>
    );
  }

  const hasData = analysis && (analysis.themes?.length > 0 || analysis.messaging?.length > 0 || analysis.gaps?.length > 0);
  const hasCompetitors = competitors.length > 0;

  return (
    <AppLayout>
      <Dialog open={regenerationDialogOpen} onOpenChange={setRegenerationDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              Full Regeneration Started
            </DialogTitle>
            <DialogDescription className="space-y-3 pt-4">
              <p>
                Your comprehensive analysis is now being generated in the background. This includes:
              </p>
              <ul className="text-sm space-y-1 pl-4 text-muted-foreground">
                <li>• Competitor website analysis</li>
                <li>• Gap analysis and recommendations</li>
                <li>• Battlecards for each competitor</li>
                <li>• GTM Plan (using GPT-5.2)</li>
                <li>• Messaging Framework</li>
              </ul>
              <p className="text-sm pt-2">
                <strong>You'll receive an email</strong> when everything is ready. Feel free to continue working or close this page.
              </p>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end pt-4">
            <Button onClick={() => setRegenerationDialogOpen(false)}>
              Got it
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="mb-8 flex justify-between items-start gap-4">
        <div>
           <h1 className="text-3xl font-bold tracking-tight mb-2">Competitive Analysis</h1>
           <p className="text-muted-foreground">AI-powered analysis of your competitors' websites and positioning.</p>
        </div>
        <div className="flex items-center gap-2">
          <PlanLimitBadge current={analysisCount} limit={analysisLimit} label="Analyses" />
          <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              disabled={isGenerating || !hasCompetitors}
              data-testid="button-run-analysis"
              className="gap-2"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : hasData ? (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Refresh Analysis
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Run Analysis
                </>
              )}
              <ChevronDown className="h-4 w-4 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuItem 
              onClick={() => runAnalysis("quick")}
              className="flex items-start gap-3 p-3 cursor-pointer"
              data-testid="analysis-mode-quick"
            >
              <Zap className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">Quick Refresh</div>
                <div className="text-xs text-muted-foreground">Use existing webpage data only. Fastest option.</div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => runAnalysis("full")}
              className="flex items-start gap-3 p-3 cursor-pointer"
              data-testid="analysis-mode-full"
            >
              <Globe className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">Full Analysis</div>
                <div className="text-xs text-muted-foreground">Re-crawl all competitor websites and run AI analysis.</div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => runAnalysis("full_with_change")}
              className={`flex items-start gap-3 p-3 cursor-pointer ${!isPremium ? "opacity-50" : ""}`}
              data-testid="analysis-mode-change"
            >
              <Sparkles className="h-5 w-5 text-purple-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-medium flex items-center gap-2">
                  Full + Change Detection
                  <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">Pro</Badge>
                </div>
                <div className="text-xs text-muted-foreground">Include social media and blog monitoring with change tracking.</div>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                disabled={fullRegenerationMutation.isPending || !hasCompetitors || !companyProfile}
                data-testid="button-regenerate-all"
                className="gap-2"
              >
                {fullRegenerationMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-4 w-4" />
                    Rebuild Artifacts
                    <ChevronDown className="h-3.5 w-3.5" />
                  </>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => setSelectiveRegenOpen(true)} className="cursor-pointer" data-testid="regen-selective">
                <Check className="w-4 h-4 mr-2 text-primary" />
                Choose Artifacts to Rebuild...
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setRegenerateAllWarningOpen(true)} className="cursor-pointer" data-testid="regen-all">
                <RotateCcw className="w-4 h-4 mr-2 text-destructive" />
                Regenerate Everything
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AlertDialog open={regenerateAllWarningOpen} onOpenChange={setRegenerateAllWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Full Regeneration Warning
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>This will completely regenerate all competitive intelligence data, including:</p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>Re-crawl your baseline company website</li>
                <li>Re-crawl all competitor websites</li>
                <li>Regenerate all AI analysis and recommendations</li>
                <li>Update gap analysis and battlecards</li>
              </ul>
              <p className="font-medium text-foreground pt-2">This process can take several minutes and uses significant AI credits.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setRegenerateAllWarningOpen(false);
                fullRegenerationMutation.mutate();
              }}
            >
              Continue with Regeneration
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={selectiveRegenOpen} onOpenChange={setSelectiveRegenOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-primary" />
              Select Artifacts to Rebuild
            </DialogTitle>
            <DialogDescription>
              Choose which downstream artifacts to regenerate using the latest source data.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            {[
              { key: "analysis", label: "Competitive Analysis", desc: "Themes, messaging & gap analysis" },
              { key: "battlecards", label: "Battle Cards", desc: "Per-competitor sales battle cards" },
              { key: "gtm", label: "GTM Plan", desc: "Go-to-market strategy & recommendations" },
              { key: "messaging", label: "Messaging Framework", desc: "Positioning & messaging guide" },
            ].map(item => (
              <label key={item.key} className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors" data-testid={`regen-check-${item.key}`}>
                <Checkbox
                  checked={regenSelections[item.key]}
                  onCheckedChange={(checked) => setRegenSelections(prev => ({ ...prev, [item.key]: !!checked }))}
                />
                <div>
                  <div className="font-medium text-sm">{item.label}</div>
                  <div className="text-xs text-muted-foreground">{item.desc}</div>
                </div>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectiveRegenOpen(false)}>Cancel</Button>
            <Button
              disabled={!Object.values(regenSelections).some(Boolean)}
              data-testid="button-selective-regen-confirm"
              onClick={async () => {
                setSelectiveRegenOpen(false);
                const selected = regenSelections;
                try {
                  if (selected.analysis) {
                    const res = await fetch("/api/analysis/generate", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ analysisType: "full" }),
                    });
                    if (!res.ok) throw new Error("Analysis generation failed");
                  }
                  if (selected.battlecards && competitors.length > 0) {
                    for (const c of competitors) {
                      await fetch(`/api/battlecards/generate/${c.id}`, {
                        method: "POST",
                        credentials: "include",
                      });
                    }
                  }
                  if (selected.gtm) {
                    await fetch("/api/baseline/recommendations/gtm_plan/generate", {
                      method: "POST",
                      credentials: "include",
                    });
                  }
                  if (selected.messaging) {
                    await fetch("/api/baseline/recommendations/messaging_framework/generate", {
                      method: "POST",
                      credentials: "include",
                    });
                  }
                  const names = Object.entries(selected).filter(([,v]) => v).map(([k]) => k);
                  toast.success(`Rebuilding ${names.length} artifact${names.length > 1 ? 's' : ''}. This may take a few minutes.`);
                  queryClient.invalidateQueries({ queryKey: ["/api/analysis"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/battlecards"] });
                } catch (e: any) {
                  toast.error(e.message || "Failed to start regeneration");
                }
              }}
            >
              Rebuild Selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isGenerating && (
        <Card className="mb-6 p-6 border-primary/50 bg-primary/5">
          <div className="flex items-center gap-4">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <div>
              <p className="font-medium">Analyzing your competitors...</p>
              <p className="text-sm text-muted-foreground">
                This may take a minute. We're crawling websites and using AI to extract insights.
              </p>
            </div>
          </div>
        </Card>
      )}

      {!hasData && !isGenerating ? (
        <Card className="p-12 text-center">
          <BarChart2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground mb-2">No analysis data yet.</p>
          <p className="text-sm text-muted-foreground mb-4">
            {!hasCompetitors 
              ? "Add competitors first, then run analysis to see insights."
              : "Click 'Run Analysis' to crawl competitor websites and generate AI-powered insights."}
          </p>
          {hasCompetitors && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  disabled={isGenerating}
                  data-testid="button-run-analysis-empty"
                  className="gap-2"
                >
                  <Play className="h-4 w-4" />
                  Run Analysis
                  <ChevronDown className="h-4 w-4 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-72">
                <DropdownMenuItem 
                  onClick={() => runAnalysis("quick")}
                  className="flex items-start gap-3 p-3 cursor-pointer"
                >
                  <Zap className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">Quick Refresh</div>
                    <div className="text-xs text-muted-foreground">Use existing webpage data only.</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => runAnalysis("full")}
                  className="flex items-start gap-3 p-3 cursor-pointer"
                >
                  <Globe className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">Full Analysis</div>
                    <div className="text-xs text-muted-foreground">Crawl websites and run AI analysis.</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => runAnalysis("full_with_change")}
                  className={`flex items-start gap-3 p-3 cursor-pointer ${!isPremium ? "opacity-50" : ""}`}
                >
                  <Sparkles className="h-5 w-5 text-purple-500 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="font-medium flex items-center gap-2">
                      Full + Change Detection
                      <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">Pro</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">Include social media and blog monitoring.</div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </Card>
      ) : hasData && (
        <>
        {(() => {
          const sourceDates = [
            ...(companyProfile?.lastCrawledAt ? [companyProfile.lastCrawledAt] : []),
            ...competitors.map((c: any) => c.lastCrawledAt).filter(Boolean),
            ...competitors.filter((c: any) => c.socialLastFetchedAt).map((c: any) => c.socialLastFetchedAt),
          ];
          const freshness = checkArtifactFreshness(analysis?.generatedFromDataAsOf || analysis?.createdAt, sourceDates);
          if (!freshness.isStale) return null;
          return (
            <Card className="mb-4 border-amber-200 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/10" data-testid="banner-stale-analysis">
              <CardContent className="py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>Built from data as of <strong>{formatShortDate(analysis?.generatedFromDataAsOf || analysis?.createdAt)}</strong> — {freshness.label}</span>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="shrink-0 gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50" data-testid="btn-rebuild-analysis">
                      <RefreshCw className="w-3.5 h-3.5" />
                      Rebuild with Latest Data
                      <ChevronDown className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={() => runAnalysis("quick")} className="cursor-pointer" data-testid="rebuild-quick">
                      <Zap className="w-4 h-4 mr-2 text-yellow-500" />
                      Quick Refresh
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => runAnalysis("full")} className="cursor-pointer" data-testid="rebuild-full">
                      <Globe className="w-4 h-4 mr-2 text-blue-500" />
                      Full Analysis
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardContent>
            </Card>
          );
        })()}
        <Tabs defaultValue="themes" className="space-y-6">
          <TabsList className="bg-muted/50 p-1 border border-border rounded-lg flex-wrap">
            <TabsTrigger value="themes" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">Key Themes</TabsTrigger>
            <TabsTrigger value="messaging" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">Messaging Matrix</TabsTrigger>
            <TabsTrigger value="gaps" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">Gap Analysis</TabsTrigger>
            <TabsTrigger value="full_report" className="data-[state=active]:bg-background data-[state=active]:shadow-sm flex items-center gap-1">
              <FileStack className="h-3.5 w-3.5" />
              Full Report
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="themes">
            <Card className="border-border">
              <CardHeader>
                <CardTitle>Thematic Presence</CardTitle>
                <CardDescription>How strongly each competitor emphasizes key market themes.</CardDescription>
              </CardHeader>
              <CardContent>
                {analysis.themes?.length > 0 ? (
                  <div className="relative w-full overflow-x-auto">
                    <table className="w-full text-sm text-left min-w-[600px]">
                      <thead className="text-muted-foreground font-medium border-b border-border/50">
                        <tr>
                          <th className="py-4 px-4 font-semibold sticky left-0 bg-card z-10 min-w-[150px]">Theme</th>
                          {isLegacyThemeFormat(analysis.themes) ? (
                            <>
                              <th className="py-4 px-4 font-semibold">Us</th>
                              <th className="py-4 px-4 font-semibold text-muted-foreground">{competitors[0]?.name || "Competitor A"}</th>
                              <th className="py-4 px-4 font-semibold text-muted-foreground">{competitors[1]?.name || "Competitor B"}</th>
                            </>
                          ) : (
                            getThemeCompetitorNames(analysis.themes).map((name: string) => (
                              <th key={name} className={`py-4 px-4 font-semibold ${name === "Us" ? "" : "text-muted-foreground"}`}>{name}</th>
                            ))
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.themes.map((theme: any, i: number) => {
                          return (
                            <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                              <td className="py-4 px-4 font-medium text-foreground sticky left-0 bg-card z-10">{theme.theme}</td>
                              {isLegacyThemeFormat(analysis.themes) ? (
                                <>
                                  <td className="py-4 px-4">
                                    <Badge 
                                      variant={theme.us === 'High' ? "default" : theme.us === 'Medium' ? "secondary" : "outline"}
                                      className="w-20 justify-center"
                                    >
                                      {theme.us}
                                    </Badge>
                                  </td>
                                  <td className="py-4 px-4">
                                    <span className={theme.competitorA === 'High' ? "font-medium text-foreground" : "text-muted-foreground"}>
                                      {theme.competitorA}
                                    </span>
                                  </td>
                                  <td className="py-4 px-4">
                                    <span className={theme.competitorB === 'High' ? "font-medium text-foreground" : "text-muted-foreground"}>
                                      {theme.competitorB}
                                    </span>
                                  </td>
                                </>
                              ) : (
                                getThemeCompetitorNames(analysis.themes).map((name: string) => {
                                  const level = getThemeLevel(theme, name);
                                  return (
                                    <td key={name} className="py-4 px-4">
                                      {name === "Us" ? (
                                        <Badge 
                                          variant={level === 'High' ? "default" : level === 'Medium' ? "secondary" : "outline"}
                                          className="w-20 justify-center"
                                        >
                                          {level}
                                        </Badge>
                                      ) : (
                                        <span className={level === 'High' ? "font-medium text-foreground" : "text-muted-foreground"}>
                                          {level}
                                        </span>
                                      )}
                                    </td>
                                  );
                                })
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">No theme data available.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="messaging">
              <Card className="border-border">
                  <CardHeader>
                      <CardTitle>Messaging Matrix</CardTitle>
                      <CardDescription>Direct comparison of copy and tone across key touchpoints.</CardDescription>
                  </CardHeader>
                  <CardContent>
                      {analysis.messaging?.length > 0 ? (
                        <div className="space-y-8">
                            {analysis.messaging.map((item: any, i: number) => {
                                const isLegacy = isLegacyMessagingFormat(analysis.messaging);
                                const msgNames = isLegacy
                                  ? ["Us", competitors[0]?.name || "Competitor A", competitors[1]?.name || "Competitor B"]
                                  : getMessagingCompetitorNames(analysis.messaging);
                                return (
                                <div key={i} className="space-y-3">
                                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{item.category}</h3>
                                    <div className={`grid grid-cols-1 gap-4 ${msgNames.length === 2 ? "md:grid-cols-2" : msgNames.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}`}>
                                        {isLegacy ? (
                                          <>
                                            <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                                              <div className="text-xs font-semibold text-primary mb-1">Us</div>
                                              <div className="font-medium text-lg">"{item.us}"</div>
                                            </div>
                                            <div className="p-4 rounded-lg bg-muted/50 border border-border">
                                              <div className="text-xs font-semibold text-muted-foreground mb-1">{competitors[0]?.name || "Competitor A"}</div>
                                              <div className="text-base">"{item.competitorA}"</div>
                                            </div>
                                            <div className="p-4 rounded-lg bg-muted/50 border border-border">
                                              <div className="text-xs font-semibold text-muted-foreground mb-1">{competitors[1]?.name || "Competitor B"}</div>
                                              <div className="text-base">"{item.competitorB}"</div>
                                            </div>
                                          </>
                                        ) : (
                                          msgNames.map((name: string) => {
                                            const msg = getMessagingEntry(item, name);
                                            const isUs = name === "Us";
                                            return (
                                              <div key={name} className={`p-4 rounded-lg ${isUs ? "bg-primary/10 border border-primary/20" : "bg-muted/50 border border-border"}`}>
                                                <div className={`text-xs font-semibold mb-1 ${isUs ? "text-primary" : "text-muted-foreground"}`}>{name}</div>
                                                <div className={isUs ? "font-medium text-lg" : "text-base"}>"{msg}"</div>
                                              </div>
                                            );
                                          })
                                        )}
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                      ) : (
                        <p className="text-center text-muted-foreground py-8">No messaging data available.</p>
                      )}
                  </CardContent>
              </Card>
          </TabsContent>

          <TabsContent value="gaps">
              {analysis.gaps?.length > 0 ? (
                <div className="space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <Filter className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Filter by type:</span>
                        <Select value={gapCategoryFilter} onValueChange={setGapCategoryFilter}>
                          <SelectTrigger className="w-[180px] h-8" data-testid="gap-category-filter">
                            <SelectValue placeholder="All Categories" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Categories</SelectItem>
                            <SelectItem value="messaging">Messaging</SelectItem>
                            <SelectItem value="features">Product Features</SelectItem>
                            <SelectItem value="audience">Target Audience</SelectItem>
                            <SelectItem value="content">Content</SelectItem>
                            <SelectItem value="positioning">Positioning</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          {gapCategoryFilter === "all" 
                            ? `${analysis.gaps.length} gaps detected`
                            : `${analysis.gaps.filter((g: any) => g.category === gapCategoryFilter || (!g.category && gapCategoryFilter === "other")).length} of ${analysis.gaps.length} gaps`
                          }
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const gapsToExport = analysis.gaps
                              .filter((gap: any) => {
                                if (gapCategoryFilter === "all") return true;
                                if (!gap.category && gapCategoryFilter === "other") return true;
                                return gap.category === gapCategoryFilter;
                              })
                              .map((gap: any): CSVExportItem => ({
                                title: gap.area || "",
                                description: gap.observation || "",
                                category: gap.category || "other",
                              }));
                            exportToCSV(gapsToExport, "Gap_Analysis");
                          }}
                          data-testid="button-export-gaps-csv"
                        >
                          <Table className="h-4 w-4 mr-1" />
                          Export CSV
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        {analysis.gaps
                          .filter((gap: any) => {
                            if (gapCategoryFilter === "all") return true;
                            if (!gap.category && gapCategoryFilter === "other") return true;
                            return gap.category === gapCategoryFilter;
                          })
                          .map((gap: any, i: number) => (
                            <Card key={i} className="border-l-4 border-l-destructive hover:bg-muted/20 transition-colors" data-testid={`gap-card-${i}`}>
                                <CardHeader>
                                    <div className="flex justify-between items-start gap-4">
                                        <div>
                                            <CardTitle className="text-lg">{gap.area}</CardTitle>
                                            <CardDescription className="mt-1 flex items-center gap-2">
                                                <AlertTriangle size={14} className="text-destructive" />
                                                Impact: <span className="text-destructive font-medium">{gap.impact}</span>
                                            </CardDescription>
                                        </div>
                                        <div className="flex flex-col items-end gap-1">
                                          <Badge variant="outline" className="shrink-0">Gap Detected</Badge>
                                          {gap.category && (
                                            <Badge variant="secondary" className="text-xs capitalize">{gap.category}</Badge>
                                          )}
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm leading-relaxed">{gap.observation}</p>
                                    <div className="mt-4 flex justify-end">
                                        <span className="text-xs text-primary font-medium flex items-center cursor-pointer hover:underline">
                                            View Recommendation <ArrowRight size={12} className="ml-1" />
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                    {gapCategoryFilter !== "all" && analysis.gaps.filter((g: any) => g.category === gapCategoryFilter || (!g.category && gapCategoryFilter === "other")).length === 0 && (
                      <Card className="p-8 text-center">
                        <p className="text-muted-foreground">No gaps in this category. Try selecting a different filter.</p>
                      </Card>
                    )}
                </div>
              ) : (
                <Card className="p-8 text-center">
                  <p className="text-muted-foreground">No gaps detected yet.</p>
                </Card>
              )}
          </TabsContent>

          {/* Full Report Tab */}
          <TabsContent value="full_report">
            <div className="space-y-8">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <FileStack className="h-5 w-5 text-primary" />
                        Full Analysis Report
                      </CardTitle>
                      <CardDescription>
                        Comprehensive view of all analysis, recommendations, and strategic plans
                      </CardDescription>
                    </div>
                    <Button
                      variant="default"
                      onClick={() => window.open("/api/reports/full-analysis/pdf", "_blank")}
                      data-testid="button-download-full-report"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download PDF Report
                    </Button>
                  </div>
                </CardHeader>
              </Card>

              {/* Themes Section */}
              <Card className="border-border">
                <CardHeader>
                  <CardTitle>Key Themes</CardTitle>
                  <CardDescription>How strongly each competitor emphasizes key market themes.</CardDescription>
                </CardHeader>
                <CardContent>
                  {analysis.themes?.length > 0 ? (
                    <div className="relative w-full overflow-x-auto">
                      <table className="w-full text-sm text-left min-w-[600px]">
                        <thead className="text-muted-foreground font-medium border-b border-border/50">
                          <tr>
                            <th className="py-3 px-4 font-semibold sticky left-0 bg-card z-10">Theme</th>
                            {isLegacyThemeFormat(analysis.themes) ? (
                              <>
                                <th className="py-3 px-4 font-semibold">Us</th>
                                <th className="py-3 px-4 font-semibold text-muted-foreground">{competitors[0]?.name || "Competitor A"}</th>
                                <th className="py-3 px-4 font-semibold text-muted-foreground">{competitors[1]?.name || "Competitor B"}</th>
                              </>
                            ) : (
                              getThemeCompetitorNames(analysis.themes).map((name: string) => (
                                <th key={name} className={`py-3 px-4 font-semibold ${name === "Us" ? "" : "text-muted-foreground"}`}>{name}</th>
                              ))
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {analysis.themes.slice(0, 5).map((theme: any, i: number) => (
                              <tr key={i} className="border-b border-border/50 last:border-0">
                                <td className="py-3 px-4 font-medium sticky left-0 bg-card z-10">{theme.theme}</td>
                                {isLegacyThemeFormat(analysis.themes) ? (
                                  <>
                                    <td className="py-3 px-4">
                                      <Badge variant={theme.us === 'High' ? "default" : theme.us === 'Medium' ? "secondary" : "outline"}>
                                        {theme.us}
                                      </Badge>
                                    </td>
                                    <td className="py-3 px-4">{theme.competitorA}</td>
                                    <td className="py-3 px-4">{theme.competitorB}</td>
                                  </>
                                ) : (
                                  getThemeCompetitorNames(analysis.themes).map((name: string) => {
                                    const level = getThemeLevel(theme, name);
                                    return (
                                      <td key={name} className="py-3 px-4">
                                        {name === "Us" ? (
                                          <Badge variant={level === 'High' ? "default" : level === 'Medium' ? "secondary" : "outline"}>
                                            {level}
                                          </Badge>
                                        ) : level}
                                      </td>
                                    );
                                  })
                                )}
                              </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-4">No theme data available.</p>
                  )}
                </CardContent>
              </Card>

              {/* Messaging Section */}
              <Card className="border-border">
                <CardHeader>
                  <CardTitle>Messaging Comparison</CardTitle>
                  <CardDescription>Direct comparison of copy and tone across key touchpoints.</CardDescription>
                </CardHeader>
                <CardContent>
                  {analysis.messaging?.length > 0 ? (
                    <div className="space-y-6">
                      {analysis.messaging.slice(0, 3).map((item: any, i: number) => {
                        const isLegacy = isLegacyMessagingFormat(analysis.messaging);
                        const msgNames = isLegacy
                          ? ["Us", competitors[0]?.name || "Competitor A", competitors[1]?.name || "Competitor B"]
                          : getMessagingCompetitorNames(analysis.messaging);
                        return (
                          <div key={i} className="space-y-2">
                            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{item.category}</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              {isLegacy ? (
                                <>
                                  <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                                    <div className="text-xs font-semibold text-primary mb-1">Us</div>
                                    <div className="text-sm">"{item.us}"</div>
                                  </div>
                                  <div className="p-3 rounded-lg bg-muted/50 border border-border">
                                    <div className="text-xs font-semibold text-muted-foreground mb-1">{competitors[0]?.name || "Competitor A"}</div>
                                    <div className="text-sm">"{item.competitorA}"</div>
                                  </div>
                                  <div className="p-3 rounded-lg bg-muted/50 border border-border">
                                    <div className="text-xs font-semibold text-muted-foreground mb-1">{competitors[1]?.name || "Competitor B"}</div>
                                    <div className="text-sm">"{item.competitorB}"</div>
                                  </div>
                                </>
                              ) : (
                                msgNames.map((name: string) => {
                                  const msg = getMessagingEntry(item, name);
                                  const isUs = name === "Us";
                                  return (
                                    <div key={name} className={`p-3 rounded-lg ${isUs ? "bg-primary/10 border border-primary/20" : "bg-muted/50 border border-border"}`}>
                                      <div className={`text-xs font-semibold mb-1 ${isUs ? "text-primary" : "text-muted-foreground"}`}>{name}</div>
                                      <div className="text-sm">"{msg}"</div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-4">No messaging data available.</p>
                  )}
                </CardContent>
              </Card>

              {/* Gaps Section */}
              <Card className="border-border">
                <CardHeader>
                  <CardTitle>Gap Analysis</CardTitle>
                  <CardDescription>Identified competitive gaps and opportunities.</CardDescription>
                </CardHeader>
                <CardContent>
                  {analysis.gaps?.length > 0 ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      {analysis.gaps.slice(0, 4).map((gap: any, i: number) => (
                        <div key={i} className="p-4 border-l-4 border-l-destructive bg-muted/20 rounded-r-lg">
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-medium">{gap.area}</h4>
                            <Badge variant="outline" className="text-xs">Impact: {gap.impact}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{gap.observation}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-4">No gaps detected.</p>
                  )}
                </CardContent>
              </Card>

              {/* Recommendations Section */}
              <Card className="border-border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Action Items</CardTitle>
                      <CardDescription>Strategic recommendations based on competitive analysis.</CardDescription>
                    </div>
                    {recommendations.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const recsToExport = recommendations.map((rec: any): CSVExportItem => ({
                            title: rec.title || "",
                            description: rec.description || "",
                            category: rec.area || "general",
                          }));
                          exportToCSV(recsToExport, "Recommendations");
                        }}
                        data-testid="button-export-recommendations-csv"
                      >
                        <Table className="h-4 w-4 mr-1" />
                        Export CSV
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {recommendations.length > 0 ? (
                    <div className="space-y-3">
                      {recommendations.slice(0, 5).map((rec: any) => (
                        <div key={rec.id} className="p-4 bg-muted/30 rounded-lg border border-border">
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-medium">{rec.title}</h4>
                            <Badge variant={rec.impact === "High" ? "default" : rec.impact === "Medium" ? "secondary" : "outline"}>
                              {rec.impact} Impact
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{rec.description}</p>
                          <div className="mt-2 text-xs text-muted-foreground">Area: {rec.area}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-4">No recommendations generated yet.</p>
                  )}
                </CardContent>
              </Card>

              <Card className="p-6 border-dashed border-2">
                <div className="flex items-center gap-4">
                  <div className="flex gap-2">
                    <Rocket className="h-6 w-6 text-primary" />
                    <MessageCircle className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium mb-1">Marketing Assets</h3>
                    <p className="text-sm text-muted-foreground">
                      Generate GTM Plans and Messaging Frameworks from the dedicated Marketing section.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Link href="/app/marketing/gtm-plan">
                      <Button variant="outline" size="sm" data-testid="link-gtm-plan">
                        <Rocket className="mr-2 h-4 w-4" />
                        GTM Plan
                      </Button>
                    </Link>
                    <Link href="/app/marketing/messaging-framework">
                      <Button variant="outline" size="sm" data-testid="link-messaging-framework">
                        <MessageCircle className="mr-2 h-4 w-4" />
                        Messaging
                      </Button>
                    </Link>
                  </div>
                </div>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
        </>
      )}
      <Dialog open={isFreshnessDialogOpen} onOpenChange={setIsFreshnessDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto" data-testid="dialog-analysis-freshness">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              Data Source Freshness
            </DialogTitle>
            <DialogDescription>
              Review data freshness and select competitors before running {pendingAnalysisMode === "quick" ? "quick" : pendingAnalysisMode === "full_with_change" ? "full + change detection" : "full"} analysis.
            </DialogDescription>
          </DialogHeader>
          {freshness ? (
            <div className="space-y-4 py-2">
              {freshness.competitors.length === 0 && !freshness.baseline ? (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted border">
                  <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground font-medium">No data sources configured for this market yet.</span>
                </div>
              ) : freshness.overallStaleness === "fresh" ? (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-sm text-green-500 font-medium">All sources are fresh — ready to generate.</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <span className="text-sm text-amber-500 font-medium">
                    Some sources are {freshness.overallStaleness}. Select any to refresh before generating.
                  </span>
                </div>
              )}

              {freshness.baseline && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Baseline</div>
                  <SharedSourceFreshnessRow
                    item={freshness.baseline}
                    prefix="baseline"
                    selections={refreshSelections}
                    onToggle={(key) => setRefreshSelections(prev => ({ ...prev, [key]: !prev[key] }))}
                    onRefresh={async (sourceType, itemId) => {
                      const url = sourceType === "social"
                        ? `/api/company-profile/${itemId}/refresh-social`
                        : `/api/company-profile/${itemId}/crawl`;
                      await fetch(url, { method: "POST", credentials: "include" });
                    }}
                    testIdPrefix="analysis-source-freshness"
                  />
                </div>
              )}

              {freshness.competitors.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Competitors ({freshness.competitors.length})
                  </div>
                  <div className="space-y-1">
                    {freshness.competitors.map(c => (
                      <div key={c.id} className="space-y-1">
                        <div className="flex items-center gap-2 px-3 pt-2">
                          <Checkbox
                            checked={competitorSelections[c.id] !== false}
                            onCheckedChange={(checked) => setCompetitorSelections(prev => ({ ...prev, [c.id]: !!checked }))}
                            className="h-4 w-4"
                            data-testid={`checkbox-competitor-select-${c.id}`}
                          />
                          <span className="text-sm font-medium">Include in analysis</span>
                        </div>
                        <SharedSourceFreshnessRow
                          item={c}
                          prefix="competitor"
                          selections={refreshSelections}
                          onToggle={(key) => setRefreshSelections(prev => ({ ...prev, [key]: !prev[key] }))}
                          onRefresh={async (sourceType, itemId) => {
                            const url = sourceType === "social"
                              ? `/api/competitors/${itemId}/refresh-social`
                              : `/api/competitors/${itemId}/crawl`;
                            await fetch(url, { method: "POST", credentials: "include" });
                          }}
                          testIdPrefix="analysis-source-freshness"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            {freshness?.overallStaleness !== "fresh" && Object.values(refreshSelections).some(v => v) ? (
              <Button
                onClick={() => handleRefreshAndGenerate(true)}
                disabled={isRefreshing || isGenerating}
                data-testid="button-refresh-and-generate-analysis"
              >
                {isRefreshing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Refresh & Generate
              </Button>
            ) : null}
            <Button
              variant={freshness?.overallStaleness === "fresh" ? "default" : "outline"}
              onClick={() => handleRefreshAndGenerate(false)}
              disabled={isRefreshing || isGenerating}
              data-testid="button-generate-analysis-anyway"
            >
              {isGenerating ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              {freshness?.overallStaleness === "fresh" ? "Generate Analysis" : "Generate Anyway"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

// AnalysisSourceFreshnessRow is now imported from @/components/SourceFreshnessRow
