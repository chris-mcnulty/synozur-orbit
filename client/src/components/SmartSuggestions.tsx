import React, { useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { getFullStalenessInfo, checkArtifactFreshness, formatShortDate } from "@/lib/staleness";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, AlertTriangle, Globe, Linkedin, Building2, Swords, BarChart2, Rocket, MessageCircle, FileText, ChevronRight, Loader2 } from "lucide-react";
import { Link } from "wouter";

interface StaleSuggestion {
  id: string;
  type: "source" | "artifact";
  category: "competitor" | "baseline" | "social" | "analysis" | "battlecard" | "gtm" | "messaging";
  name: string;
  message: string;
  lastUpdated: string | null;
  targetId?: string;
  priority: number;
  href?: string;
}

interface NeedsAttentionCardProps {
  className?: string;
}

export function NeedsAttentionCard({ className }: NeedsAttentionCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());

  const { data: competitors = [] } = useQuery({
    queryKey: ["/api/competitors"],
    queryFn: async () => {
      const res = await fetch("/api/competitors", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: companyProfile } = useQuery({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const res = await fetch("/api/company-profile", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: analysis } = useQuery({
    queryKey: ["/api/analysis"],
    queryFn: async () => {
      const res = await fetch("/api/analysis", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: battleCards = [] } = useQuery({
    queryKey: ["/api/battlecards"],
    queryFn: async () => {
      const res = await fetch("/api/battlecards", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: gtmPlan } = useQuery({
    queryKey: ["/api/baseline/recommendations/gtm_plan"],
    queryFn: async () => {
      const res = await fetch("/api/baseline/recommendations/gtm_plan", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!companyProfile,
  });

  const { data: messagingFramework } = useQuery({
    queryKey: ["/api/baseline/recommendations/messaging_framework"],
    queryFn: async () => {
      const res = await fetch("/api/baseline/recommendations/messaging_framework", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!companyProfile,
  });

  const sourceDates = [
    ...(companyProfile?.lastCrawledAt ? [companyProfile.lastCrawledAt] : []),
    ...competitors.map((c: any) => c.lastCrawledAt).filter(Boolean),
    ...competitors.map((c: any) => c.socialLastFetchedAt).filter(Boolean),
  ];

  const suggestions: StaleSuggestion[] = [];

  if (companyProfile) {
    const staleness = getFullStalenessInfo(companyProfile.lastCrawledAt);
    if (staleness.level === "stale" || staleness.level === "never") {
      suggestions.push({
        id: `baseline-${companyProfile.id}`,
        type: "source",
        category: "baseline",
        name: "Company Baseline",
        message: staleness.level === "never" ? "Website not yet crawled" : `Website data is ${staleness.timeAgo} old`,
        lastUpdated: companyProfile.lastCrawledAt,
        targetId: companyProfile.id,
        priority: 1,
      });
    }
  }

  competitors.forEach((competitor: any) => {
    const websiteStaleness = getFullStalenessInfo(competitor.lastCrawledAt);
    if (websiteStaleness.level === "stale" || websiteStaleness.level === "never") {
      suggestions.push({
        id: `competitor-website-${competitor.id}`,
        type: "source",
        category: "competitor",
        name: competitor.name,
        message: websiteStaleness.level === "never" ? "Website not yet crawled" : `Website data is ${websiteStaleness.timeAgo} old`,
        lastUpdated: competitor.lastCrawledAt,
        targetId: competitor.id,
        priority: 2,
      });
    }
    if (competitor.linkedInUrl) {
      const socialStaleness = getFullStalenessInfo(competitor.socialLastFetchedAt);
      if (socialStaleness.level === "stale" || socialStaleness.level === "never") {
        suggestions.push({
          id: `competitor-social-${competitor.id}`,
          type: "source",
          category: "social",
          name: competitor.name,
          message: socialStaleness.level === "never" ? "Social data not yet fetched" : `Social data is ${socialStaleness.timeAgo} old`,
          lastUpdated: competitor.socialLastFetchedAt,
          targetId: competitor.id,
          priority: 3,
        });
      }
    }
  });

  if (analysis?.createdAt) {
    const analysisDataDate = analysis.generatedFromDataAsOf || analysis.createdAt;
    const freshness = checkArtifactFreshness(analysisDataDate, sourceDates);
    if (freshness.isStale) {
      suggestions.push({
        id: "artifact-analysis",
        type: "artifact",
        category: "analysis",
        name: "Analysis",
        message: freshness.label,
        lastUpdated: analysisDataDate,
        priority: 4,
        href: "/app/analysis",
      });
    }
  }

  const oldestBattlecard = battleCards.length > 0
    ? battleCards.reduce((oldest: any, bc: any) => {
        const bcDate = new Date(bc.generatedFromDataAsOf || bc.lastGeneratedAt || bc.createdAt).getTime();
        const oldDate = new Date(oldest.generatedFromDataAsOf || oldest.lastGeneratedAt || oldest.createdAt).getTime();
        return bcDate < oldDate ? bc : oldest;
      }, battleCards[0])
    : null;

  if (oldestBattlecard) {
    const bcDataDate = oldestBattlecard.generatedFromDataAsOf || oldestBattlecard.lastGeneratedAt || oldestBattlecard.createdAt;
    const freshness = checkArtifactFreshness(bcDataDate, sourceDates);
    if (freshness.isStale) {
      suggestions.push({
        id: "artifact-battlecards",
        type: "artifact",
        category: "battlecard",
        name: `Battle Cards (${battleCards.length})`,
        message: freshness.label,
        lastUpdated: bcDataDate,
        priority: 5,
        href: "/app/battlecards",
      });
    }
  }

  if (gtmPlan?.lastGeneratedAt) {
    const gtmDataDate = gtmPlan.generatedFromDataAsOf || gtmPlan.lastGeneratedAt;
    const freshness = checkArtifactFreshness(gtmDataDate, sourceDates);
    if (freshness.isStale) {
      suggestions.push({
        id: "artifact-gtm",
        type: "artifact",
        category: "gtm",
        name: "GTM Plan",
        message: freshness.label,
        lastUpdated: gtmDataDate,
        priority: 6,
        href: "/app/marketing/gtm-plan",
      });
    }
  }

  if (messagingFramework?.lastGeneratedAt) {
    const mfDataDate = messagingFramework.generatedFromDataAsOf || messagingFramework.lastGeneratedAt;
    const freshness = checkArtifactFreshness(mfDataDate, sourceDates);
    if (freshness.isStale) {
      suggestions.push({
        id: "artifact-messaging",
        type: "artifact",
        category: "messaging",
        name: "Messaging Framework",
        message: freshness.label,
        lastUpdated: mfDataDate,
        priority: 7,
        href: "/app/marketing/messaging-framework",
      });
    }
  }

  suggestions.sort((a, b) => a.priority - b.priority);

  const handleRefresh = async (suggestion: StaleSuggestion) => {
    setRefreshingIds(prev => new Set(prev).add(suggestion.id));
    try {
      if (suggestion.category === "baseline" && suggestion.targetId) {
        await fetch(`/api/company-profile/${suggestion.targetId}/crawl`, { method: "POST", credentials: "include" });
      } else if (suggestion.category === "competitor" && suggestion.targetId) {
        await fetch(`/api/competitors/${suggestion.targetId}/crawl`, { method: "POST", credentials: "include" });
      } else if (suggestion.category === "social" && suggestion.targetId) {
        await fetch(`/api/competitors/${suggestion.targetId}/refresh-social`, { method: "POST", credentials: "include" });
      } else if (suggestion.category === "analysis") {
        await fetch("/api/analysis/generate", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ analysisType: "full" }) });
      } else if (suggestion.category === "battlecard") {
        for (const bc of battleCards) {
          await fetch(`/api/battlecards/generate/${bc.competitorId}`, { method: "POST", credentials: "include" });
        }
      } else if (suggestion.category === "gtm") {
        await fetch("/api/baseline/recommendations/gtm_plan/generate", { method: "POST", credentials: "include" });
      } else if (suggestion.category === "messaging") {
        await fetch("/api/baseline/recommendations/messaging_framework/generate", { method: "POST", credentials: "include" });
      }
      toast({ title: "Refresh started", description: `${suggestion.name} is being refreshed` });
      queryClient.invalidateQueries({ queryKey: ["/api/analysis"] });
      queryClient.invalidateQueries({ queryKey: ["/api/battlecards"] });
      queryClient.invalidateQueries({ queryKey: ["/api/baseline/recommendations/gtm_plan"] });
      queryClient.invalidateQueries({ queryKey: ["/api/baseline/recommendations/messaging_framework"] });
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-profile"] });
    } catch {
      toast({ title: "Error", description: "Failed to start refresh", variant: "destructive" });
    } finally {
      setRefreshingIds(prev => {
        const next = new Set(prev);
        next.delete(suggestion.id);
        return next;
      });
    }
  };

  const getIcon = (category: string) => {
    switch (category) {
      case "baseline": return <Building2 className="w-3.5 h-3.5" />;
      case "competitor": return <Globe className="w-3.5 h-3.5" />;
      case "social": return <Linkedin className="w-3.5 h-3.5" />;
      case "analysis": return <BarChart2 className="w-3.5 h-3.5" />;
      case "battlecard": return <Swords className="w-3.5 h-3.5" />;
      case "gtm": return <Rocket className="w-3.5 h-3.5" />;
      case "messaging": return <MessageCircle className="w-3.5 h-3.5" />;
      default: return <AlertTriangle className="w-3.5 h-3.5" />;
    }
  };

  if (suggestions.length === 0) return null;

  const sourceIssues = suggestions.filter(s => s.type === "source");
  const artifactIssues = suggestions.filter(s => s.type === "artifact");

  return (
    <Card className={`border-amber-200 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/10 ${className}`} data-testid="card-needs-attention">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Needs Attention
            <Badge variant="secondary" className="text-xs">{suggestions.length}</Badge>
          </CardTitle>
          <Link href="/app/refresh-center">
            <Button variant="ghost" size="sm" className="text-xs h-7" data-testid="link-intelligence-health">
              View All <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {sourceIssues.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Stale Sources</p>
            {sourceIssues.slice(0, 3).map(suggestion => (
              <div key={suggestion.id} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md bg-background/60" data-testid={`attention-item-${suggestion.id}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-1 rounded bg-amber-500/10 text-amber-600 shrink-0">{getIcon(suggestion.category)}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{suggestion.name}</p>
                    <p className="text-xs text-muted-foreground">{suggestion.message}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1 h-7 text-xs shrink-0"
                  onClick={() => handleRefresh(suggestion)}
                  disabled={refreshingIds.has(suggestion.id)}
                  data-testid={`btn-refresh-${suggestion.id}`}
                >
                  {refreshingIds.has(suggestion.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Refresh
                </Button>
              </div>
            ))}
            {sourceIssues.length > 3 && (
              <p className="text-xs text-muted-foreground pl-2">+{sourceIssues.length - 3} more stale sources</p>
            )}
          </div>
        )}
        {artifactIssues.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Outdated Artifacts</p>
            {artifactIssues.slice(0, 3).map(suggestion => (
              <div key={suggestion.id} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md bg-background/60" data-testid={`attention-item-${suggestion.id}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-1 rounded bg-amber-500/10 text-amber-600 shrink-0">{getIcon(suggestion.category)}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{suggestion.name}</p>
                    <p className="text-xs text-muted-foreground">{suggestion.message}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1 h-7 text-xs shrink-0"
                  onClick={() => handleRefresh(suggestion)}
                  disabled={refreshingIds.has(suggestion.id)}
                  data-testid={`btn-rebuild-${suggestion.id}`}
                >
                  {refreshingIds.has(suggestion.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Rebuild
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SmartSuggestions() {
  return null;
}
