import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowRight, AlertTriangle, BarChart2, Play, Loader2, RefreshCw, ChevronDown, Zap, Globe, Sparkles } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type AnalysisMode = "quick" | "full" | "full_with_change";

export default function Analysis() {
  const queryClient = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);

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

  const { data: tenant } = useQuery({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const response = await fetch("/api/tenant/info", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
  });

  const isPremium = tenant?.isPremium || tenant?.plan === "pro" || tenant?.plan === "enterprise";

  const generateAnalysisMutation = useMutation({
    mutationFn: async (mode: AnalysisMode) => {
      setIsGenerating(true);
      const response = await fetch("/api/analysis/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisType: mode }),
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

  const runAnalysis = (mode: AnalysisMode) => {
    if (mode === "full_with_change" && !isPremium) {
      toast.error("Change detection requires a Pro or Enterprise plan");
      return;
    }
    generateAnalysisMutation.mutate(mode);
  };

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
      <div className="mb-8 flex justify-between items-center">
        <div>
           <h1 className="text-3xl font-bold tracking-tight mb-2">Competitive Analysis</h1>
           <p className="text-muted-foreground">AI-powered analysis of your competitors' websites and positioning.</p>
        </div>
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
      </div>

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
        <Tabs defaultValue="themes" className="space-y-6">
          <TabsList className="bg-muted/50 p-1 border border-border rounded-lg">
            <TabsTrigger value="themes" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">Key Themes</TabsTrigger>
            <TabsTrigger value="messaging" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">Messaging Matrix</TabsTrigger>
            <TabsTrigger value="gaps" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">Gap Analysis</TabsTrigger>
          </TabsList>
          
          <TabsContent value="themes">
            <Card className="border-border">
              <CardHeader>
                <CardTitle>Thematic Presence</CardTitle>
                <CardDescription>How strongly each competitor emphasizes key market themes.</CardDescription>
              </CardHeader>
              <CardContent>
                {analysis.themes?.length > 0 ? (
                  <div className="relative w-full overflow-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="text-muted-foreground font-medium border-b border-border/50">
                        <tr>
                          <th className="py-4 px-4 font-semibold w-1/4">Theme</th>
                          <th className="py-4 px-4 font-semibold w-1/4">Us</th>
                          {competitors.slice(0, 2).map((c: any, i: number) => (
                            <th key={c.id} className="py-4 px-4 font-semibold w-1/4 text-muted-foreground">{c.name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.themes.map((theme: any, i: number) => (
                          <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="py-4 px-4 font-medium text-foreground">{theme.theme}</td>
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
                          </tr>
                        ))}
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
                            {analysis.messaging.map((item: any, i: number) => (
                                <div key={i} className="space-y-3">
                                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{item.category}</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                                    </div>
                                </div>
                            ))}
                        </div>
                      ) : (
                        <p className="text-center text-muted-foreground py-8">No messaging data available.</p>
                      )}
                  </CardContent>
              </Card>
          </TabsContent>

          <TabsContent value="gaps">
              {analysis.gaps?.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                    {analysis.gaps.map((gap: any, i: number) => (
                        <Card key={i} className="border-l-4 border-l-destructive hover:bg-muted/20 transition-colors">
                            <CardHeader>
                                <div className="flex justify-between items-start gap-4">
                                    <div>
                                        <CardTitle className="text-lg">{gap.area}</CardTitle>
                                        <CardDescription className="mt-1 flex items-center gap-2">
                                            <AlertTriangle size={14} className="text-destructive" />
                                            Impact: <span className="text-destructive font-medium">{gap.impact}</span>
                                        </CardDescription>
                                    </div>
                                    <Badge variant="outline" className="shrink-0">Gap Detected</Badge>
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
              ) : (
                <Card className="p-8 text-center">
                  <p className="text-muted-foreground">No gaps detected yet.</p>
                </Card>
              )}
          </TabsContent>
        </Tabs>
      )}
    </AppLayout>
  );
}
