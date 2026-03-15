import React, { useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { getFullStalenessInfo } from "@/lib/staleness";
import { Button } from "@/components/ui/button";
import { RefreshCw, AlertTriangle, Globe, Linkedin, Building2 } from "lucide-react";

interface StaleSuggestion {
  id: string;
  type: "competitor" | "baseline" | "social";
  name: string;
  message: string;
  lastUpdated: string | null;
  targetId?: string;
}

export default function SmartSuggestions() {
  const { toast } = useToast();
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  const shownToastsRef = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    const stored = localStorage.getItem("dismissedSuggestions");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const oneHourAgo = Date.now() - 3600000;
        const validDismissals = Object.entries(parsed)
          .filter(([_, timestamp]) => (timestamp as number) > oneHourAgo)
          .map(([id]) => id);
        setDismissedSuggestions(new Set(validDismissals));
      } catch (e) {
        console.error("Failed to parse dismissed suggestions", e);
      }
    }
  }, []);

  const dismissSuggestion = (id: string) => {
    setDismissedSuggestions((prev) => {
      const next = new Set(prev);
      next.add(id);
      const stored = localStorage.getItem("dismissedSuggestions");
      const existing = stored ? JSON.parse(stored) : {};
      existing[id] = Date.now();
      localStorage.setItem("dismissedSuggestions", JSON.stringify(existing));
      return next;
    });
  };

  const handleRefresh = async (suggestion: StaleSuggestion) => {
    try {
      if (suggestion.type === "baseline" && suggestion.targetId) {
        await fetch(`/api/company-profile/${suggestion.targetId}/crawl`, {
          method: "POST",
          credentials: "include",
        });
      } else if (suggestion.type === "competitor" && suggestion.targetId) {
        await fetch(`/api/competitors/${suggestion.targetId}/crawl`, {
          method: "POST",
          credentials: "include",
        });
      } else if (suggestion.type === "social" && suggestion.targetId) {
        await fetch(`/api/competitors/${suggestion.targetId}/refresh-social`, {
          method: "POST",
          credentials: "include",
        });
      }
      dismissSuggestion(suggestion.id);
      toast({
        title: "Refresh started",
        description: `${suggestion.name} is now being refreshed`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to start refresh",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    const suggestions: StaleSuggestion[] = [];

    // Only show toasts for critically stale data (14+ days)
    // Normal staleness (7-14 days) is now handled by the nav badge on Data Sources
    const isCriticallyStale = (lastUpdated: string | null) => {
      if (!lastUpdated) return false;
      const diffMs = Date.now() - new Date(lastUpdated).getTime();
      return diffMs > 14 * 24 * 60 * 60 * 1000;
    };

    if (companyProfile?.lastCrawledAt) {
      const staleness = getFullStalenessInfo(companyProfile.lastCrawledAt);
      if (isCriticallyStale(companyProfile.lastCrawledAt)) {
        suggestions.push({
          id: `baseline-${companyProfile.id}`,
          type: "baseline",
          name: "Your company profile",
          message: `Your baseline data is ${staleness.timeAgo} old. Refresh to keep intelligence current.`,
          lastUpdated: companyProfile.lastCrawledAt,
          targetId: companyProfile.id,
        });
      }
    }

    competitors.forEach((competitor: any) => {
      const websiteStaleness = getFullStalenessInfo(competitor.lastCrawledAt);
      if (isCriticallyStale(competitor.lastCrawledAt)) {
        suggestions.push({
          id: `competitor-website-${competitor.id}`,
          type: "competitor",
          name: competitor.name,
          message: `${competitor.name} website data is ${websiteStaleness.timeAgo} old.`,
          lastUpdated: competitor.lastCrawledAt,
          targetId: competitor.id,
        });
      }

      const socialStaleness = getFullStalenessInfo(competitor.socialLastFetchedAt);
      if (isCriticallyStale(competitor.socialLastFetchedAt) && competitor.linkedInUrl) {
        suggestions.push({
          id: `competitor-social-${competitor.id}`,
          type: "social",
          name: competitor.name,
          message: `${competitor.name} social data is ${socialStaleness.timeAgo} old.`,
          lastUpdated: competitor.socialLastFetchedAt,
          targetId: competitor.id,
        });
      }
    });

    const staleCount = suggestions.filter(
      (s) => !dismissedSuggestions.has(s.id) && !shownToastsRef.current.has(s.id)
    ).length;

    if (staleCount > 0 && staleCount <= 3) {
      suggestions
        .filter((s) => !dismissedSuggestions.has(s.id) && !shownToastsRef.current.has(s.id))
        .slice(0, 2)
        .forEach((suggestion) => {
          shownToastsRef.current.add(suggestion.id);
          
          const Icon = suggestion.type === "baseline" ? Building2 : 
                       suggestion.type === "social" ? Linkedin : Globe;

          toast({
            title: (
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                <span>Stale Data Detected</span>
              </div>
            ) as any,
            description: (
              <div className="mt-2 space-y-3">
                <div className="flex items-start gap-2">
                  <Icon className="w-4 h-4 mt-0.5 text-muted-foreground" />
                  <p className="text-sm">{suggestion.message}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    className="gap-1"
                    onClick={() => handleRefresh(suggestion)}
                  >
                    <RefreshCw className="w-3 h-3" />
                    Refresh Now
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => dismissSuggestion(suggestion.id)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            ) as any,
            duration: 15000,
          });
        });
    } else if (staleCount > 3 && !shownToastsRef.current.has("bulk-stale")) {
      shownToastsRef.current.add("bulk-stale");
      
      toast({
        title: (
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
            <span>Multiple Data Sources Stale</span>
          </div>
        ) as any,
        description: (
          <div className="mt-2 space-y-3">
            <p className="text-sm">
              {staleCount} data sources need refreshing. Visit the Refresh Center to update them all.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="default"
                className="gap-1"
                onClick={() => {
                  window.location.href = "/app/data-sources";
                }}
              >
                <RefreshCw className="w-3 h-3" />
                View Data Sources
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => dismissSuggestion("bulk-stale")}
              >
                Dismiss
              </Button>
            </div>
          </div>
        ) as any,
        duration: 20000,
      });
    }
  }, [competitors, companyProfile, dismissedSuggestions]);

  return null;
}
