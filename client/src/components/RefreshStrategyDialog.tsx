import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Globe, Linkedin, Newspaper, Loader2, Clock, Zap, Info } from "lucide-react";
import { getFullStalenessInfo } from "@/lib/staleness";
import StalenessDot from "@/components/ui/StalenessDot";

interface RefreshSource {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  lastUpdated: string | null;
  estimatedTime: string;
  selected: boolean;
  recommended?: boolean;
}

interface RefreshStrategyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityName: string;
  entityType: "competitor" | "company";
  sources: {
    website?: { lastUpdated: string | null };
    social?: { lastUpdated: string | null };
    news?: { lastUpdated: string | null };
  };
  onConfirm: (selectedSources: string[], timing: "now" | "tonight" | "schedule") => Promise<void>;
}

export default function RefreshStrategyDialog({
  open,
  onOpenChange,
  entityName,
  entityType,
  sources,
  onConfirm,
}: RefreshStrategyDialogProps) {
  const [refreshTiming, setRefreshTiming] = useState<"now" | "tonight" | "schedule">("now");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const availableSources: RefreshSource[] = [];

  if (sources.website !== undefined) {
    const staleness = getFullStalenessInfo(sources.website.lastUpdated);
    availableSources.push({
      id: "website",
      label: "Website Pages",
      description: "Crawl all pages for updated content",
      icon: <Globe className="w-4 h-4" />,
      lastUpdated: sources.website.lastUpdated,
      estimatedTime: "3-5 min",
      selected: staleness.level === "stale" || staleness.level === "never",
      recommended: staleness.level === "stale" || staleness.level === "never",
    });
  }

  if (sources.social !== undefined) {
    const staleness = getFullStalenessInfo(sources.social.lastUpdated);
    availableSources.push({
      id: "social",
      label: "Social Media",
      description: "LinkedIn profile updates",
      icon: <Linkedin className="w-4 h-4" />,
      lastUpdated: sources.social.lastUpdated,
      estimatedTime: "~30s",
      selected: staleness.level === "stale" || staleness.level === "aging",
      recommended: staleness.level === "stale",
    });
  }

  if (sources.news !== undefined) {
    const staleness = getFullStalenessInfo(sources.news.lastUpdated);
    availableSources.push({
      id: "news",
      label: "News Mentions",
      description: "Search for recent news articles",
      icon: <Newspaper className="w-4 h-4" />,
      lastUpdated: sources.news.lastUpdated,
      estimatedTime: "~1 min",
      selected: staleness.level === "stale" || staleness.level === "aging",
      recommended: staleness.level === "stale",
    });
  }

  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    new Set(availableSources.filter((s) => s.selected).map((s) => s.id))
  );

  const toggleSource = (sourceId: string) => {
    setSelectedSources((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(sourceId)) {
        newSet.delete(sourceId);
      } else {
        newSet.add(sourceId);
      }
      return newSet;
    });
  };

  const calculateTotalTime = () => {
    let totalMinutes = 0;
    selectedSources.forEach((id) => {
      const source = availableSources.find((s) => s.id === id);
      if (!source) return;
      
      if (id === "website") totalMinutes += 4; // Average of 3-5 min
      if (id === "social") totalMinutes += 0.5;
      if (id === "news") totalMinutes += 1;
    });
    
    if (totalMinutes < 1) return "< 1 min";
    if (totalMinutes < 60) return `~${Math.ceil(totalMinutes)} min`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = Math.ceil(totalMinutes % 60);
    return `~${hours}h ${mins}m`;
  };

  const getSmartRecommendation = () => {
    const freshSources = availableSources.filter((s) => {
      const staleness = getFullStalenessInfo(s.lastUpdated);
      return staleness.level === "fresh" && selectedSources.has(s.id);
    });

    if (freshSources.length > 0) {
      return `💡 Tip: ${freshSources[0].label} is fresh. Uncheck to save ${freshSources[0].estimatedTime}`;
    }

    const staleSources = availableSources.filter((s) => {
      const staleness = getFullStalenessInfo(s.lastUpdated);
      return staleness.level === "stale" && !selectedSources.has(s.id);
    });

    if (staleSources.length > 0) {
      return `⚠️ Recommendation: ${staleSources[0].label} is stale (${getFullStalenessInfo(staleSources[0].lastUpdated).timeAgo}). Consider refreshing.`;
    }

    return null;
  };

  const handleConfirm = async () => {
    if (selectedSources.size === 0) return;
    
    setIsRefreshing(true);
    try {
      await onConfirm(Array.from(selectedSources), refreshTiming);
      onOpenChange(false);
      // Reset timing for next time
      setRefreshTiming("now");
    } catch (error) {
      console.error("Refresh failed:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const recommendation = getSmartRecommendation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Refresh {entityName}</DialogTitle>
          <DialogDescription>
            Choose which data sources to refresh for this {entityType}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-3">
            <h4 className="text-sm font-medium">What will be refreshed:</h4>
            {availableSources.map((source) => {
              const staleness = getFullStalenessInfo(source.lastUpdated);
              return (
                <div
                  key={source.id}
                  className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <Checkbox
                    id={source.id}
                    checked={selectedSources.has(source.id)}
                    onCheckedChange={() => toggleSource(source.id)}
                  />
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      {source.icon}
                      <Label htmlFor={source.id} className="font-medium cursor-pointer">
                        {source.label}
                      </Label>
                      {source.recommended && (
                        <Badge variant="secondary" className="text-xs">
                          Recommended
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{source.description}</p>
                    <div className="flex items-center gap-3 text-xs">
                      <div className="flex items-center gap-1.5">
                        <StalenessDot lastUpdated={source.lastUpdated} size="sm" />
                        <span className="text-muted-foreground">
                          Last: {staleness.timeAgo}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        <span className="text-muted-foreground">{source.estimatedTime}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {selectedSources.size > 0 && (
            <div className="p-3 rounded-lg bg-muted/50 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Estimated time:</span>
                <span>{calculateTotalTime()}</span>
              </div>
              {recommendation && (
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <p>{recommendation}</p>
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            <h4 className="text-sm font-medium">When should this run?</h4>
            <RadioGroup value={refreshTiming} onValueChange={(value: any) => setRefreshTiming(value)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="now" id="now" />
                <Label htmlFor="now" className="flex items-center gap-2 cursor-pointer">
                  <Zap className="w-4 h-4" />
                  Run now
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="tonight" id="tonight" disabled />
                <Label htmlFor="tonight" className="flex items-center gap-2 cursor-not-allowed opacity-50">
                  <Clock className="w-4 h-4" />
                  Schedule for tonight (2am)
                  <Badge variant="outline" className="text-xs">Coming Soon</Badge>
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isRefreshing}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={selectedSources.size === 0 || isRefreshing}
          >
            {isRefreshing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Starting...
              </>
            ) : (
              `Start Refresh`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
