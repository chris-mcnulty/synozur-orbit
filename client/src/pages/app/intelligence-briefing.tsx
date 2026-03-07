import React, { useState, useEffect } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/lib/userContext";
import { useToast } from "@/hooks/use-toast";
import { useSearch } from "wouter";
import {
  Brain,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Shield,
  Zap,
  Target,
  Loader2,
  FileText,
  ChevronRight,
  Eye,
  Sparkles,
  BarChart3,
  ArrowRight,
  Calendar,
  RefreshCw,
  Newspaper,
  ExternalLink,
} from "lucide-react";

interface BriefingTheme {
  title: string;
  description: string;
  competitors: string[];
  significance: "high" | "medium" | "low";
}

interface CompetitorMovement {
  name: string;
  signals: string[];
  interpretation: string;
  threatLevel: "high" | "medium" | "low" | "none";
}

interface ActionItem {
  title: string;
  description: string;
  urgency: "immediate" | "this_week" | "this_month" | "watch";
  category: string;
  relatedCompetitors: string[];
}

interface RiskAlert {
  title: string;
  description: string;
  severity: "critical" | "warning" | "watch";
  source: string;
}

interface NewsArticleBrief {
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string;
  matchedEntity: string;
}

interface BriefingData {
  executiveSummary: string;
  keyThemes: BriefingTheme[];
  competitorMovements: CompetitorMovement[];
  actionItems: ActionItem[];
  riskAlerts: RiskAlert[];
  signalDigest: {
    totalSignals: number;
    byType: Record<string, number>;
    byImpact: Record<string, number>;
    highlights: string[];
  };
  newsArticles?: NewsArticleBrief[];
  periodLabel: string;
  generatedAt: string;
}

interface IntelligenceBriefing {
  id: string;
  tenantDomain: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  briefingData: BriefingData;
  signalCount: number;
  competitorCount: number;
  createdAt: string;
}

const hasAdminAccess = (role: string) =>
  role === "Global Admin" || role === "Domain Admin";

const urgencyConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  immediate: { label: "Immediate", color: "bg-red-500/10 text-red-500 border-red-500/20", icon: <Zap className="w-3.5 h-3.5" /> },
  this_week: { label: "This Week", color: "bg-orange-500/10 text-orange-500 border-orange-500/20", icon: <Clock className="w-3.5 h-3.5" /> },
  this_month: { label: "This Month", color: "bg-blue-500/10 text-blue-500 border-blue-500/20", icon: <Calendar className="w-3.5 h-3.5" /> },
  watch: { label: "Watch", color: "bg-gray-500/10 text-gray-500 border-gray-500/20", icon: <Eye className="w-3.5 h-3.5" /> },
};

const severityConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  critical: { label: "Critical", color: "bg-red-500/10 text-red-500 border-red-500/20", icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  warning: { label: "Warning", color: "bg-amber-500/10 text-amber-500 border-amber-500/20", icon: <Shield className="w-3.5 h-3.5" /> },
  watch: { label: "Watch", color: "bg-blue-500/10 text-blue-500 border-blue-500/20", icon: <Eye className="w-3.5 h-3.5" /> },
};

const significanceConfig: Record<string, { label: string; color: string }> = {
  high: { label: "High", color: "bg-red-500/10 text-red-500 border-red-500/20" },
  medium: { label: "Medium", color: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  low: { label: "Low", color: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
};

const threatConfig: Record<string, { label: string; color: string }> = {
  high: { label: "High Threat", color: "bg-red-500/10 text-red-500 border-red-500/20" },
  medium: { label: "Medium Threat", color: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  low: { label: "Low Threat", color: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  none: { label: "No Threat", color: "bg-green-500/10 text-green-500 border-green-500/20" },
};

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateRange(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const sMonth = s.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const eMonth = e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${sMonth} – ${eMonth}`;
}

export default function IntelligenceBriefingPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const search = useSearch();
  const idFromUrl = new URLSearchParams(search).get("id");
  const [selectedBriefingId, setSelectedBriefingId] = useState<string | null>(idFromUrl);
  const [periodDays, setPeriodDays] = useState("7");
  const isAdmin = user ? hasAdminAccess(user.role) : false;

  useEffect(() => {
    if (idFromUrl) setSelectedBriefingId(idFromUrl);
  }, [idFromUrl]);

  const { data: briefings = [], isLoading: loadingList } = useQuery<IntelligenceBriefing[]>({
    queryKey: ["/api/intelligence-briefings"],
    queryFn: async () => {
      const res = await fetch("/api/intelligence-briefings?limit=20", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load briefings");
      return res.json();
    },
  });

  const activeBriefingId = selectedBriefingId || (briefings.length > 0 ? briefings[0].id : null);

  const { data: briefing, isLoading: loadingBriefing } = useQuery<IntelligenceBriefing>({
    queryKey: ["/api/intelligence-briefings", activeBriefingId],
    queryFn: async () => {
      const res = await fetch(`/api/intelligence-briefings/${activeBriefingId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load briefing");
      return res.json();
    },
    enabled: !!activeBriefingId,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/intelligence-briefings/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ periodDays: parseInt(periodDays) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to generate briefing");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence-briefings"] });
      setSelectedBriefingId(data.id);
      toast({ title: "Briefing Generated", description: "Your intelligence briefing is ready." });
    },
    onError: (err: Error) => {
      toast({ title: "Generation Failed", description: err.message, variant: "destructive" });
    },
  });

  const bd = briefing?.briefingData;
  const isLoading = loadingList || loadingBriefing;

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6 p-4 md:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="heading-intelligence-briefing">
              <Brain className="w-6 h-6 text-primary" />
              Intelligence Briefing
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              AI-synthesized market intelligence from your competitive signals
            </p>
          </div>

          <div className="flex items-center gap-2">
            {briefings.length > 1 && (
              <Select
                value={activeBriefingId || ""}
                onValueChange={(val) => setSelectedBriefingId(val)}
              >
                <SelectTrigger className="w-[220px]" data-testid="select-briefing-history">
                  <SelectValue placeholder="Select briefing..." />
                </SelectTrigger>
                <SelectContent>
                  {briefings.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {formatDateRange(b.periodStart, b.periodEnd)} ({b.signalCount} signals)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {isAdmin && (
              <div className="flex items-center gap-2">
                <Select value={periodDays} onValueChange={setPeriodDays}>
                  <SelectTrigger className="w-[110px]" data-testid="select-briefing-period">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                  data-testid="button-generate-briefing"
                >
                  {generateMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-2" />
                  )}
                  Generate
                </Button>
              </div>
            )}
          </div>
        </div>

        {isLoading && !bd && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && !bd && briefings.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Brain className="w-12 h-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Intelligence Briefings Yet</h3>
              <p className="text-muted-foreground text-sm max-w-md mb-6">
                Generate your first intelligence briefing to get AI-synthesized insights from your competitive monitoring signals.
              </p>
              {isAdmin && (
                <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} data-testid="button-generate-first-briefing">
                  {generateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  Generate First Briefing
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {bd && briefing && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-xs text-muted-foreground mb-1">Period</div>
                  <div className="text-sm font-semibold" data-testid="text-briefing-period">
                    {formatDateRange(briefing.periodStart, briefing.periodEnd)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-xs text-muted-foreground mb-1">Signals</div>
                  <div className="text-sm font-semibold" data-testid="text-signal-count">{bd.signalDigest.totalSignals}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-xs text-muted-foreground mb-1">Competitors</div>
                  <div className="text-sm font-semibold" data-testid="text-competitor-count">{briefing.competitorCount}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-xs text-muted-foreground mb-1">News Articles</div>
                  <div className="text-sm font-semibold" data-testid="text-news-count">{bd.newsArticles?.length || 0}</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="w-5 h-5 text-primary" />
                  Executive Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm dark:prose-invert max-w-none" data-testid="text-executive-summary">
                  {bd.executiveSummary.split("\n\n").map((para, i) => (
                    <p key={i} className="text-sm leading-relaxed text-foreground/90 mb-3">{para}</p>
                  ))}
                </div>
              </CardContent>
            </Card>

            {bd.keyThemes.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  Key Themes
                </h2>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {bd.keyThemes.map((theme, i) => {
                    const sig = significanceConfig[theme.significance] || significanceConfig.medium;
                    return (
                      <Card key={i} data-testid={`card-theme-${i}`}>
                        <CardContent className="pt-4 pb-4 px-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <h3 className="text-sm font-semibold">{theme.title}</h3>
                            <Badge variant="outline" className={`text-[10px] shrink-0 ${sig.color}`}>{sig.label}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed mb-2">{theme.description}</p>
                          {theme.competitors.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {theme.competitors.map((c, ci) => (
                                <span key={ci} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{c}</span>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {bd.riskAlerts.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                  Risk Alerts
                </h2>
                <div className="space-y-2">
                  {bd.riskAlerts.map((risk, i) => {
                    const sev = severityConfig[risk.severity] || severityConfig.watch;
                    return (
                      <Card key={i} className={risk.severity === "critical" ? "border-red-500/30" : ""} data-testid={`card-risk-${i}`}>
                        <CardContent className="flex items-start gap-3 pt-4 pb-4 px-4">
                          <div className="shrink-0 mt-0.5">{sev.icon}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-sm font-semibold">{risk.title}</h3>
                              <Badge variant="outline" className={`text-[10px] ${sev.color}`}>{sev.label}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">{risk.description}</p>
                            <p className="text-[10px] text-muted-foreground/70 mt-1">Source: {risk.source}</p>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {bd.competitorMovements.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Target className="w-5 h-5 text-primary" />
                  Competitive Movements
                </h2>
                <div className="space-y-3">
                  {bd.competitorMovements.map((mov, i) => {
                    const threat = threatConfig[mov.threatLevel] || threatConfig.none;
                    return (
                      <Card key={i} data-testid={`card-movement-${i}`}>
                        <CardContent className="pt-4 pb-4 px-4">
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold">{mov.name}</h3>
                            <Badge variant="outline" className={`text-[10px] ${threat.color}`}>{threat.label}</Badge>
                          </div>
                          {mov.signals.length > 0 && (
                            <ul className="space-y-1 mb-2">
                              {mov.signals.map((sig, si) => (
                                <li key={si} className="text-xs text-muted-foreground flex items-start gap-1.5">
                                  <ChevronRight className="w-3 h-3 mt-0.5 shrink-0 text-primary/50" />
                                  {sig}
                                </li>
                              ))}
                            </ul>
                          )}
                          <Separator className="my-2" />
                          <p className="text-xs text-foreground/80 leading-relaxed">
                            <span className="font-medium">Analysis: </span>{mov.interpretation}
                          </p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {bd.actionItems.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                  Recommended Actions
                </h2>
                <div className="space-y-2">
                  {bd.actionItems.map((item, i) => {
                    const urg = urgencyConfig[item.urgency] || urgencyConfig.watch;
                    return (
                      <Card key={i} data-testid={`card-action-${i}`}>
                        <CardContent className="flex items-start gap-3 pt-4 pb-4 px-4">
                          <div className="shrink-0 mt-0.5">{urg.icon}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <h3 className="text-sm font-semibold">{item.title}</h3>
                              <Badge variant="outline" className={`text-[10px] ${urg.color}`}>{urg.label}</Badge>
                              <Badge variant="secondary" className="text-[10px]">{item.category}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
                            {item.relatedCompetitors.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {item.relatedCompetitors.map((c, ci) => (
                                  <span key={ci} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{c}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {bd.newsArticles && bd.newsArticles.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Newspaper className="w-5 h-5 text-primary" />
                  News & Press Coverage
                  <Badge variant="secondary" className="text-[10px]">{bd.newsArticles.length} articles</Badge>
                </h2>
                <div className="space-y-2">
                  {(() => {
                    const byEntity: Record<string, typeof bd.newsArticles> = {};
                    for (const article of bd.newsArticles!) {
                      if (!byEntity[article.matchedEntity]) byEntity[article.matchedEntity] = [];
                      byEntity[article.matchedEntity]!.push(article);
                    }
                    return Object.entries(byEntity).map(([entity, articles]) => (
                      <Card key={entity} data-testid={`card-news-${entity.replace(/\s+/g, "-").toLowerCase()}`}>
                        <CardContent className="pt-4 pb-4 px-4">
                          <h3 className="text-sm font-semibold mb-2">{entity}</h3>
                          <div className="space-y-2">
                            {articles!.map((article, ai) => (
                              <div key={ai} className="flex items-start gap-2 text-xs">
                                <ChevronRight className="w-3 h-3 mt-0.5 shrink-0 text-primary/50" />
                                <div className="flex-1 min-w-0">
                                  <a
                                    href={article.url.startsWith("http://") || article.url.startsWith("https://") ? article.url : "#"}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm font-medium text-foreground hover:text-primary transition-colors inline-flex items-center gap-1"
                                    data-testid={`link-news-${ai}`}
                                  >
                                    {article.title}
                                    <ExternalLink className="w-3 h-3 shrink-0" />
                                  </a>
                                  <div className="flex items-center gap-2 mt-0.5 text-muted-foreground">
                                    <span>{article.source}</span>
                                    <span>·</span>
                                    <span>{new Date(article.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                                  </div>
                                  {article.description && (
                                    <p className="text-muted-foreground mt-1 line-clamp-2">{article.description}</p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    ));
                  })()}
                </div>
              </div>
            )}

            {bd.signalDigest.highlights.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <BarChart3 className="w-5 h-5 text-primary" />
                    Signal Highlights
                  </CardTitle>
                  <CardDescription>Top signals from this period</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {bd.signalDigest.highlights.map((h, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm" data-testid={`text-highlight-${i}`}>
                        <ArrowRight className="w-3.5 h-3.5 mt-1 shrink-0 text-primary/60" />
                        <span className="text-foreground/80">{h}</span>
                      </li>
                    ))}
                  </ul>

                  {Object.keys(bd.signalDigest.byType).length > 0 && (
                    <div className="mt-4 pt-4 border-t border-border">
                      <div className="text-xs text-muted-foreground mb-2 font-medium">Signal Breakdown</div>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(bd.signalDigest.byType).map(([type, count]) => (
                          <div key={type} className="flex items-center gap-1.5 text-xs bg-muted/50 rounded px-2 py-1">
                            <span className="text-muted-foreground">{type.replace(/_/g, " ")}:</span>
                            <span className="font-semibold">{count as number}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
