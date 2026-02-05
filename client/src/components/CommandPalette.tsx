import React, { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  RefreshCw,
  Globe,
  Linkedin,
  Newspaper,
  Building2,
  Target,
  Swords,
  FileText,
  Sparkles,
  Clock,
} from "lucide-react";
import { useLocation } from "wouter";
import { getFullStalenessInfo } from "@/lib/staleness";

interface RefreshAction {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  category: string;
  action: () => Promise<void>;
  lastUpdated?: string | null;
  staleness?: string;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [, setLocation] = useLocation();
  const [recentActions, setRecentActions] = useState<string[]>([]);

  // Load recent actions from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("recentRefreshActions");
    if (stored) {
      try {
        setRecentActions(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse recent actions", e);
      }
    }
  }, []);

  // Save action to recent list
  const trackAction = useCallback((actionId: string) => {
    setRecentActions((prev) => {
      const updated = [actionId, ...prev.filter((id) => id !== actionId)].slice(0, 5);
      localStorage.setItem("recentRefreshActions", JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Fetch data for staleness checking
  const { data: competitors = [] } = useQuery({
    queryKey: ["/api/competitors"],
    queryFn: async () => {
      const res = await fetch("/api/competitors", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open,
  });

  const { data: companyProfile } = useQuery({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const res = await fetch("/api/company-profile", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: open,
  });

  const { data: newsData } = useQuery({
    queryKey: ["/api/data-sources/news"],
    queryFn: async () => {
      const res = await fetch("/api/data-sources/news", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: open,
  });

  // Build action list with staleness info
  const actions: RefreshAction[] = [];

  // Global actions
  if (newsData) {
    const newsLastFetched = newsData.results?.[0]?.fetchedAt;
    const staleness = getFullStalenessInfo(newsLastFetched);
    actions.push({
      id: "refresh-news",
      label: "Refresh News Mentions",
      description: `Last updated: ${staleness.timeAgo}`,
      icon: <Newspaper className="w-4 h-4" />,
      category: "Global",
      lastUpdated: newsLastFetched,
      staleness: staleness.label,
      action: async () => {
        await fetch("/api/data-sources/news/refresh", {
          method: "POST",
          credentials: "include",
        });
        trackAction("refresh-news");
        onOpenChange(false);
      },
    });
  }

  // Company baseline actions
  if (companyProfile) {
    const companyStaleness = getFullStalenessInfo(companyProfile.lastCrawl);
    actions.push({
      id: "refresh-baseline-website",
      label: `Refresh ${companyProfile.name} Website`,
      description: `Last updated: ${companyStaleness.timeAgo} • ~3-5 min`,
      icon: <Globe className="w-4 h-4" />,
      category: "Company Baseline",
      lastUpdated: companyProfile.lastCrawl,
      staleness: companyStaleness.label,
      action: async () => {
        await fetch(`/api/company-profile/${companyProfile.id}/refresh`, {
          method: "POST",
          credentials: "include",
        });
        trackAction("refresh-baseline-website");
        onOpenChange(false);
      },
    });

    if (companyProfile.linkedInUrl) {
      actions.push({
        id: "refresh-baseline-social",
        label: `Refresh ${companyProfile.name} Social Media`,
        description: "LinkedIn only • ~30s",
        icon: <Linkedin className="w-4 h-4" />,
        category: "Company Baseline",
        action: async () => {
          await fetch(`/api/company-profile/${companyProfile.id}/refresh-social`, {
            method: "POST",
            credentials: "include",
          });
          trackAction("refresh-baseline-social");
          onOpenChange(false);
        },
      });
    }
  }

  // Competitor actions
  competitors.forEach((competitor: any) => {
    const compStaleness = getFullStalenessInfo(competitor.lastCrawl);
    actions.push({
      id: `refresh-competitor-${competitor.id}`,
      label: `Refresh ${competitor.name}`,
      description: `Last updated: ${compStaleness.timeAgo}`,
      icon: <Target className="w-4 h-4" />,
      category: "Competitors",
      lastUpdated: competitor.lastCrawl,
      staleness: compStaleness.label,
      action: async () => {
        await fetch(`/api/competitors/${competitor.id}/crawl`, {
          method: "POST",
          credentials: "include",
        });
        trackAction(`refresh-competitor-${competitor.id}`);
        onOpenChange(false);
      },
    });
  });

  // Navigation actions
  const navigationActions: RefreshAction[] = [
    {
      id: "nav-data-sources",
      label: "Go to Data Sources",
      description: "View all data sources and refresh status",
      icon: <Globe className="w-4 h-4" />,
      category: "Navigation",
      action: async () => {
        setLocation("/app/data-sources");
        onOpenChange(false);
      },
    },
    {
      id: "nav-competitors",
      label: "Go to Competitors",
      description: "View and manage competitors",
      icon: <Target className="w-4 h-4" />,
      category: "Navigation",
      action: async () => {
        setLocation("/app/competitors");
        onOpenChange(false);
      },
    },
    {
      id: "nav-company-baseline",
      label: "Go to Company Baseline",
      description: "View your company profile",
      icon: <Building2 className="w-4 h-4" />,
      category: "Navigation",
      action: async () => {
        setLocation("/app/company-profile");
        onOpenChange(false);
      },
    },
  ];

  // Group actions by staleness (stale first)
  const staleActions = actions.filter((a) => a.staleness === "Stale");
  const agingActions = actions.filter((a) => a.staleness === "Aging");
  const freshActions = actions.filter((a) => a.staleness === "Fresh");
  const otherActions = actions.filter((a) => !a.staleness);

  const recentActionObjects = recentActions
    .map((id) => actions.find((a) => a.id === id))
    .filter(Boolean) as RefreshAction[];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search for refresh actions..." />
      <CommandList>
        <CommandEmpty>No actions found.</CommandEmpty>

        {recentActionObjects.length > 0 && (
          <>
            <CommandGroup heading="Recent">
              {recentActionObjects.map((action) => (
                <CommandItem
                  key={action.id}
                  onSelect={() => action.action()}
                  className="flex items-center gap-3"
                >
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="font-medium">{action.label}</div>
                    <div className="text-xs text-muted-foreground">{action.description}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {staleActions.length > 0 && (
          <>
            <CommandGroup heading="🔴 Needs Attention (Stale)">
              {staleActions.map((action) => (
                <CommandItem
                  key={action.id}
                  onSelect={() => action.action()}
                  className="flex items-center gap-3"
                >
                  {action.icon}
                  <div className="flex-1">
                    <div className="font-medium">{action.label}</div>
                    <div className="text-xs text-muted-foreground">{action.description}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {agingActions.length > 0 && (
          <>
            <CommandGroup heading="🟡 Soon to Refresh (Aging)">
              {agingActions.map((action) => (
                <CommandItem
                  key={action.id}
                  onSelect={() => action.action()}
                  className="flex items-center gap-3"
                >
                  {action.icon}
                  <div className="flex-1">
                    <div className="font-medium">{action.label}</div>
                    <div className="text-xs text-muted-foreground">{action.description}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {(freshActions.length > 0 || otherActions.length > 0) && (
          <CommandGroup heading="All Refresh Actions">
            {[...freshActions, ...otherActions].map((action) => (
              <CommandItem
                key={action.id}
                onSelect={() => action.action()}
                className="flex items-center gap-3"
              >
                {action.icon}
                <div className="flex-1">
                  <div className="font-medium">{action.label}</div>
                  <div className="text-xs text-muted-foreground">{action.description}</div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        <CommandGroup heading="Navigation">
          {navigationActions.map((action) => (
            <CommandItem
              key={action.id}
              onSelect={() => action.action()}
              className="flex items-center gap-3"
            >
              {action.icon}
              <div className="flex-1">
                <div className="font-medium">{action.label}</div>
                <div className="text-xs text-muted-foreground">{action.description}</div>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
