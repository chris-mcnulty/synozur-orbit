import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Globe,
  Linkedin,
  Newspaper,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronUp,
  Clock,
  Calendar,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getFullStalenessInfo } from "@/lib/staleness";
import StalenessDot from "@/components/ui/StalenessDot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface SourceStatus {
  type: "website" | "social" | "news";
  label: string;
  lastUpdated: string | null;
  icon: React.ReactNode;
  entityName?: string;
}

export interface DataFreshnessBarProps {
  mode: "entity" | "global";
  entityName?: string;
  entityType?: "competitor" | "company";
  websiteLastUpdated?: string | null;
  socialLastUpdated?: string | null;
  newsLastUpdated?: string | null;
  autoRefreshAllowed?: boolean;
  tenantPlan?: string;
  onRefresh: (sources: string[]) => Promise<void>;
  onSchedule?: (sources: string[], timing: string) => void;
  className?: string;
}

export default function DataFreshnessBar({
  mode,
  entityName,
  websiteLastUpdated,
  socialLastUpdated,
  newsLastUpdated,
  autoRefreshAllowed = false,
  tenantPlan,
  onRefresh,
  onSchedule,
  className,
}: DataFreshnessBarProps) {
  const [isRefreshing, setIsRefreshing] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<boolean | null>(null);

  const sources: SourceStatus[] = [];

  if (websiteLastUpdated !== undefined) {
    sources.push({
      type: "website",
      label: "Website",
      lastUpdated: websiteLastUpdated ?? null,
      icon: <Globe className="w-4 h-4 text-blue-500" />,
    });
  }

  if (socialLastUpdated !== undefined) {
    sources.push({
      type: "social",
      label: "Social",
      lastUpdated: socialLastUpdated ?? null,
      icon: <Linkedin className="w-4 h-4 text-purple-500" />,
    });
  }

  if (newsLastUpdated !== undefined) {
    sources.push({
      type: "news",
      label: "News",
      lastUpdated: newsLastUpdated ?? null,
      icon: <Newspaper className="w-4 h-4 text-orange-500" />,
    });
  }

  if (sources.length === 0) return null;

  const staleSources = sources.filter((s) => {
    const info = getFullStalenessInfo(s.lastUpdated);
    return info.level === "stale" || info.level === "never";
  });

  const agingSources = sources.filter((s) => {
    const info = getFullStalenessInfo(s.lastUpdated);
    return info.level === "aging";
  });

  const hasStaleData = staleSources.length > 0;
  const hasAgingData = agingSources.length > 0;
  const allFresh = !hasStaleData && !hasAgingData;

  // Auto-expand when stale, collapse when fresh, but allow manual override
  const isExpanded = expanded !== null ? expanded : hasStaleData;

  const handleRefreshSource = async (sourceType: string) => {
    setIsRefreshing((prev) => new Set(prev).add(sourceType));
    try {
      await onRefresh([sourceType]);
    } finally {
      setIsRefreshing((prev) => {
        const next = new Set(prev);
        next.delete(sourceType);
        return next;
      });
    }
  };

  const handleRefreshAllStale = async () => {
    const types = staleSources.map((s) => s.type);
    if (types.length === 0) return;
    setIsRefreshing(new Set(types));
    try {
      await onRefresh(types);
    } finally {
      setIsRefreshing(new Set());
    }
  };

  const handleSchedule = (timing: string) => {
    if (!onSchedule) return;
    const types = staleSources.length > 0
      ? staleSources.map((s) => s.type)
      : sources.map((s) => s.type);
    onSchedule(types, timing);
  };

  const summaryLabel = allFresh
    ? "All data sources are fresh"
    : hasStaleData
    ? `${staleSources.length} source${staleSources.length !== 1 ? "s" : ""} need${staleSources.length === 1 ? "s" : ""} refreshing`
    : `${agingSources.length} source${agingSources.length !== 1 ? "s" : ""} aging`;

  const borderColor = hasStaleData
    ? "border-red-200 dark:border-red-800/50 bg-red-50/50 dark:bg-red-950/10"
    : hasAgingData
    ? "border-yellow-200 dark:border-yellow-800/50 bg-yellow-50/50 dark:bg-yellow-950/10"
    : "border-green-200 dark:border-green-800/50 bg-green-50/50 dark:bg-green-950/10";

  return (
    <div
      className={cn("rounded-lg border p-3", borderColor, className)}
      data-testid="data-freshness-bar"
    >
      {/* Summary row - always visible */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => setExpanded(!isExpanded)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <div className="flex items-center gap-1.5">
            {sources.map((source) => (
              <StalenessDot
                key={source.type}
                lastUpdated={source.lastUpdated}
                size="sm"
              />
            ))}
          </div>
          <span className="text-sm font-medium truncate">
            {mode === "entity" && entityName
              ? `${entityName}: ${summaryLabel.charAt(0).toLowerCase() + summaryLabel.slice(1)}`
              : summaryLabel}
          </span>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
        </button>

        <div className="flex items-center gap-2 shrink-0">
          {hasStaleData && (
            <Button
              size="sm"
              variant="default"
              className="gap-1.5 h-7 text-xs"
              onClick={handleRefreshAllStale}
              disabled={isRefreshing.size > 0}
              data-testid="refresh-all-stale-button"
            >
              {isRefreshing.size > 0 ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              Refresh {staleSources.length === sources.length ? "All" : "Stale"}
            </Button>
          )}

          {onSchedule && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 h-7 text-xs"
                >
                  <Calendar className="w-3 h-3" />
                  Schedule
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleSchedule("tonight")}>
                  <Clock className="w-3.5 h-3.5 mr-2" />
                  Schedule for tonight (2am)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {autoRefreshAllowed ? (
                  <DropdownMenuItem onClick={() => handleSchedule("weekly")}>
                    <Calendar className="w-3.5 h-3.5 mr-2" />
                    Set up weekly auto-refresh
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled className="opacity-100">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Lock className="w-3.5 h-3.5" />
                      <span className="text-xs">
                        Auto-refresh requires {tenantPlan === "free" || tenantPlan === "trial" ? "Pro" : "Enterprise"}+
                      </span>
                      <a
                        href="mailto:contactus@synozur.com"
                        className="text-primary hover:underline text-xs ml-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Upgrade
                      </a>
                    </div>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Expanded detail rows */}
      {isExpanded && (
        <div className="mt-3 space-y-2 pt-3 border-t border-border/50">
          {sources.map((source) => {
            const staleness = getFullStalenessInfo(source.lastUpdated);
            const isSourceRefreshing = isRefreshing.has(source.type);

            return (
              <div
                key={source.type}
                className="flex items-center justify-between gap-3 py-1.5"
                data-testid={`freshness-source-${source.type}`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {source.icon}
                  <span className="text-sm font-medium">{source.label}</span>
                  <StalenessDot
                    lastUpdated={source.lastUpdated}
                    showLabel
                    showTime
                    size="sm"
                  />
                </div>

                <Button
                  size="sm"
                  variant={staleness.level === "stale" || staleness.level === "never" ? "default" : "ghost"}
                  className="gap-1.5 h-7 text-xs shrink-0"
                  onClick={() => handleRefreshSource(source.type)}
                  disabled={isSourceRefreshing}
                  data-testid={`refresh-source-${source.type}`}
                >
                  {isSourceRefreshing ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  Refresh
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
