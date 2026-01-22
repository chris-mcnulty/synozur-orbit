import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, ArrowUp, ArrowDown, Minus, TrendingUp, TrendingDown, Target, AlertTriangle, CheckCircle, RefreshCw, Loader2, BarChart3, Users, Swords, FileText, Sparkles, Share2, Linkedin, Instagram } from "lucide-react";
import { MarkdownContent } from "@/components/MarkdownViewer";
import { formatDateTime } from "@/lib/utils";

interface ExecutiveSummaryData {
  project: {
    id: string;
    name: string;
    clientName: string;
    analysisType: string;
    status: string;
  };
  baseline: {
    id: string;
    name: string;
    companyName: string;
    description: string;
  } | null;
  analytics: {
    totalCompetitors: number;
    analyzedCompetitors: number;
    battlecardsGenerated: number;
    completionPercentage: number;
  };
  rankings: {
    topCompetitors: Array<{
      competitorId: string;
      name: string;
      companyName: string;
      overallScore: number;
      trendDirection: string;
      trendDelta: number;
      breakdown: {
        marketPresence: number;
        innovation: number;
        pricing: number;
        featureBreadth: number;
        contentActivity: number;
        socialEngagement: number;
      };
    }>;
    risingThreats: Array<any>;
    decliningCompetitors: Array<any>;
  };
  insights: {
    gapAnalysis: { status: string; lastGenerated: string; content: string } | null;
    strategicRecommendations: { status: string; lastGenerated: string; content: string } | null;
    competitiveSummary: { status: string; lastGenerated: string; content: string } | null;
    gtmPlan: { status: string; lastGenerated: string } | null;
    messagingFramework: { status: string; lastGenerated: string } | null;
  };
  competitors: Array<{
    id: string;
    competitorId: string | null;
    name: string;
    companyName: string;
    score: number | null;
    trend: string;
    hasAnalysis: boolean;
    hasBattlecard: boolean;
  }>;
  lastUpdated: string;
}

function TrendIndicator({ direction, delta }: { direction: string; delta?: number }) {
  if (direction === "rising") {
    return (
      <div className="flex items-center gap-1 text-green-500">
        <ArrowUp className="h-4 w-4" />
        {delta && <span className="text-xs">+{delta}</span>}
      </div>
    );
  }
  if (direction === "falling") {
    return (
      <div className="flex items-center gap-1 text-red-500">
        <ArrowDown className="h-4 w-4" />
        {delta && <span className="text-xs">{delta}</span>}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 text-muted-foreground">
      <Minus className="h-4 w-4" />
    </div>
  );
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  const getScoreColor = (s: number) => {
    if (s >= 75) return "bg-green-500";
    if (s >= 50) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{score}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div 
          className={`h-full ${getScoreColor(score)} transition-all`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

export default function ExecutiveSummary() {
  const { productId, projectId: routeProjectId } = useParams<{ productId?: string; projectId?: string }>();
  const projectId = productId || routeProjectId;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const { data: summary, isLoading, error } = useQuery<ExecutiveSummaryData>({
    queryKey: ["executive-summary", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/executive-summary`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch executive summary");
      return res.json();
    },
    enabled: !!projectId,
  });

  const calculateScoresMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/calculate-scores`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to calculate scores");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["executive-summary", projectId] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="p-6">
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">Failed to load executive summary</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { project, baseline, analytics, rankings, insights, competitors } = summary;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/app/projects/${projectId}`)}
            data-testid="back-to-project"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Project
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <p className="text-muted-foreground">Executive Summary - {project.clientName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => calculateScoresMutation.mutate()}
            disabled={calculateScoresMutation.isPending}
            data-testid="refresh-scores"
          >
            {calculateScoresMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh Scores
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card data-testid="stat-total-competitors">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Competitors</p>
                <p className="text-3xl font-bold">{analytics.totalCompetitors}</p>
              </div>
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-analyzed">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Analyzed</p>
                <p className="text-3xl font-bold">{analytics.analyzedCompetitors}</p>
              </div>
              <BarChart3 className="h-8 w-8 text-muted-foreground" />
            </div>
            <Progress value={analytics.completionPercentage} className="mt-2" />
          </CardContent>
        </Card>

        <Card data-testid="stat-battlecards">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Battlecards</p>
                <p className="text-3xl font-bold">{analytics.battlecardsGenerated}</p>
              </div>
              <Swords className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-rising-threats">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Rising Threats</p>
                <p className="text-3xl font-bold text-orange-500">
                  {rankings.risingThreats.length}
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {baseline && (
        <Card data-testid="baseline-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <CardTitle>Your Position</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <h3 className="font-semibold text-lg">{baseline.name}</h3>
                <p className="text-muted-foreground">{baseline.companyName}</p>
                {baseline.description && (
                  <p className="text-sm text-muted-foreground mt-2">{baseline.description}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="rankings" className="space-y-4">
        <TabsList>
          <TabsTrigger value="rankings" data-testid="tab-rankings">
            <BarChart3 className="h-4 w-4 mr-2" />
            Rankings
          </TabsTrigger>
          <TabsTrigger value="competitors" data-testid="tab-competitors">
            <Users className="h-4 w-4 mr-2" />
            Competitors
          </TabsTrigger>
          <TabsTrigger value="social" data-testid="tab-social">
            <Share2 className="h-4 w-4 mr-2" />
            Social
          </TabsTrigger>
          <TabsTrigger value="insights" data-testid="tab-insights">
            <Sparkles className="h-4 w-4 mr-2" />
            Insights
          </TabsTrigger>
          <TabsTrigger value="alerts" data-testid="tab-alerts">
            <AlertTriangle className="h-4 w-4 mr-2" />
            Alerts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rankings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Competitor Rankings</CardTitle>
              <CardDescription>
                Ranked by composite score across market presence, innovation, features, and social engagement
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rankings.topCompetitors.length === 0 ? (
                <div className="text-center py-8" data-testid="empty-rankings">
                  <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No competitor scores yet</p>
                  <Button
                    className="mt-4"
                    onClick={() => calculateScoresMutation.mutate()}
                    disabled={calculateScoresMutation.isPending}
                    data-testid="button-calculate-scores"
                  >
                    Calculate Scores
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {rankings.topCompetitors.map((comp, index) => (
                    <div
                      key={comp.competitorId}
                      className="flex items-center gap-4 p-4 border rounded-lg"
                      data-testid={`ranking-${index}`}
                    >
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold truncate">{comp.name}</h4>
                          <TrendIndicator direction={comp.trendDirection} delta={comp.trendDelta} />
                        </div>
                        <p className="text-sm text-muted-foreground">{comp.companyName}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-2xl font-bold">{comp.overallScore}</p>
                          <p className="text-xs text-muted-foreground">Overall Score</p>
                        </div>
                      </div>
                      <div className="w-48 space-y-2 hidden lg:block">
                        <ScoreBar score={comp.breakdown.marketPresence || 0} label="Market" />
                        <ScoreBar score={comp.breakdown.innovation || 0} label="Innovation" />
                        <ScoreBar score={comp.breakdown.socialEngagement || 0} label="Social" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="competitors" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>All Competitors</CardTitle>
              <CardDescription>
                Complete list of competitors with analysis status
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {competitors.map((comp) => (
                  <div
                    key={comp.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                    data-testid={`competitor-${comp.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <h4 className="font-medium">{comp.name}</h4>
                        <p className="text-sm text-muted-foreground">{comp.companyName}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <TrendIndicator direction={comp.trend} />
                      {comp.score !== null && (
                        <Badge variant="outline">{comp.score}</Badge>
                      )}
                      {comp.hasAnalysis && (
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle className="h-3 w-3" />
                          Analyzed
                        </Badge>
                      )}
                      {comp.hasBattlecard && (
                        <Badge variant="secondary" className="gap-1">
                          <Swords className="h-3 w-3" />
                          Battlecard
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="insights" className="space-y-4">
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Target className="h-5 w-5 text-primary" />
                    <CardTitle>Gap Analysis</CardTitle>
                  </div>
                  {insights.gapAnalysis?.status === "generated" && (
                    <Badge variant="secondary">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Generated
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {insights.gapAnalysis?.content ? (
                  <div className="border rounded-lg p-4 bg-muted/30 max-h-96 overflow-y-auto">
                    <MarkdownContent content={insights.gapAnalysis.content} />
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">
                    No gap analysis generated yet
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    <CardTitle>Strategic Recommendations</CardTitle>
                  </div>
                  {insights.strategicRecommendations?.status === "generated" && (
                    <Badge variant="secondary">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Generated
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {insights.strategicRecommendations?.content ? (
                  <div className="border rounded-lg p-4 bg-muted/30 max-h-96 overflow-y-auto">
                    <MarkdownContent content={insights.strategicRecommendations.content} />
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">
                    No recommendations generated yet
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    <CardTitle>Competitive Summary</CardTitle>
                  </div>
                  {insights.competitiveSummary?.status === "generated" && (
                    <Badge variant="secondary">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Generated
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {insights.competitiveSummary?.content ? (
                  <div className="border rounded-lg p-4 bg-muted/30 max-h-96 overflow-y-auto">
                    <MarkdownContent content={insights.competitiveSummary.content} />
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">
                    No competitive summary generated yet
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="social" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Social Media Comparison</CardTitle>
              <CardDescription>
                Compare social presence and engagement across competitors
              </CardDescription>
            </CardHeader>
            <CardContent>
              {competitors.length === 0 ? (
                <div className="text-center py-8" data-testid="empty-social">
                  <Share2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No competitors to compare</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Card className="bg-muted/30">
                      <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                          <Linkedin className="h-5 w-5 text-blue-600" />
                          <CardTitle className="text-lg">LinkedIn Presence</CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {rankings.topCompetitors.slice(0, 5).map((comp, index) => (
                            <div key={comp.competitorId} className="flex items-center justify-between" data-testid={`social-linkedin-${index}`}>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium w-5 text-muted-foreground">{index + 1}</span>
                                <span className="text-sm truncate max-w-32">{comp.name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <ScoreBar score={comp.breakdown.socialEngagement || 0} label="" />
                                <span className="text-sm font-medium w-8 text-right">{comp.breakdown.socialEngagement || 0}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="bg-muted/30">
                      <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                          <Instagram className="h-5 w-5 text-pink-600" />
                          <CardTitle className="text-lg">Content Activity</CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {rankings.topCompetitors.slice(0, 5).map((comp, index) => (
                            <div key={comp.competitorId} className="flex items-center justify-between" data-testid={`social-content-${index}`}>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium w-5 text-muted-foreground">{index + 1}</span>
                                <span className="text-sm truncate max-w-32">{comp.name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <ScoreBar score={comp.breakdown.contentActivity || 0} label="" />
                                <span className="text-sm font-medium w-8 text-right">{comp.breakdown.contentActivity || 0}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <Card className="bg-muted/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg">Social Engagement Trends</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-3 md:grid-cols-3">
                        {rankings.risingThreats.length > 0 && (
                          <div className="p-4 rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950">
                            <div className="flex items-center gap-2 mb-2">
                              <TrendingUp className="h-5 w-5 text-orange-500" />
                              <span className="font-medium">Growing Fast</span>
                            </div>
                            <ul className="text-sm space-y-1">
                              {rankings.risingThreats.slice(0, 3).map(t => (
                                <li key={t.competitorId} className="text-muted-foreground">
                                  {t.name} (+{t.trendDelta})
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {rankings.decliningCompetitors.length > 0 && (
                          <div className="p-4 rounded-lg border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
                            <div className="flex items-center gap-2 mb-2">
                              <TrendingDown className="h-5 w-5 text-green-500" />
                              <span className="font-medium">Losing Ground</span>
                            </div>
                            <ul className="text-sm space-y-1">
                              {rankings.decliningCompetitors.slice(0, 3).map(c => (
                                <li key={c.competitorId} className="text-muted-foreground">
                                  {c.name} ({c.trendDelta})
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="p-4 rounded-lg border bg-muted/50">
                          <div className="flex items-center gap-2 mb-2">
                            <Minus className="h-5 w-5 text-muted-foreground" />
                            <span className="font-medium">Stable</span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {rankings.topCompetitors.filter(c => c.trendDirection === "stable").length} competitors with no significant changes
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Rising Threats</CardTitle>
              <CardDescription>
                Competitors showing increased activity and engagement
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rankings.risingThreats.length === 0 ? (
                <div className="text-center py-8">
                  <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No rising threats detected</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {rankings.risingThreats.map((threat) => (
                    <div
                      key={threat.competitorId}
                      className="flex items-center justify-between p-3 border border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950 rounded-lg"
                    >
                      <div>
                        <h4 className="font-medium">{threat.name}</h4>
                        <p className="text-sm text-muted-foreground">{threat.companyName}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-orange-500" />
                        <span className="font-medium text-orange-600 dark:text-orange-400">
                          +{threat.trendDelta} points
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Declining Competitors</CardTitle>
              <CardDescription>
                Competitors showing decreased activity
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rankings.decliningCompetitors.length === 0 ? (
                <div className="text-center py-8">
                  <TrendingDown className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No declining competitors detected</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {rankings.decliningCompetitors.map((comp) => (
                    <div
                      key={comp.competitorId}
                      className="flex items-center justify-between p-3 border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950 rounded-lg"
                    >
                      <div>
                        <h4 className="font-medium">{comp.name}</h4>
                        <p className="text-sm text-muted-foreground">{comp.companyName}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <TrendingDown className="h-5 w-5 text-green-500" />
                        <span className="font-medium text-green-600 dark:text-green-400">
                          {comp.trendDelta} points
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="text-xs text-muted-foreground text-right">
        Last updated: {formatDateTime(summary.lastUpdated)}
      </div>
    </div>
  );
}
