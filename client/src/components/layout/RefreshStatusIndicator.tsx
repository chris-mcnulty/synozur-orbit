import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Loader2, Clock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ActiveJob {
  id: string;
  type: string;
  target: string | null;
  startedAt: string;
  duration: number; // seconds
}

interface ActiveJobsResponse {
  active: ActiveJob[];
  count: number;
}

const getJobLabel = (jobType: string): string => {
  const labels: Record<string, string> = {
    websiteCrawl: "Website Crawl",
    socialMonitor: "Social Monitor",
    websiteMonitor: "Website Monitor",
    productMonitor: "Product Monitor",
    trialReminder: "Trial Reminder",
    weeklyDigest: "Weekly Digest",
    fullRegeneration: "Full Regeneration",
  };
  return labels[jobType] || jobType;
};

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
};

export default function RefreshStatusIndicator() {
  const [isOpen, setIsOpen] = useState(false);

  const { data, isLoading } = useQuery<ActiveJobsResponse>({
    queryKey: ["/api/jobs/active"],
    queryFn: async () => {
      const res = await fetch("/api/jobs/active", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch active jobs");
      return res.json();
    },
    refetchInterval: 5000, // Refresh every 5 seconds
    enabled: true,
  });

  const activeCount = data?.count || 0;
  const hasActiveJobs = activeCount > 0;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative",
            hasActiveJobs && "text-primary"
          )}
          data-testid="refresh-status-indicator"
        >
          {hasActiveJobs ? (
            <RefreshCw className={cn("h-5 w-5", hasActiveJobs && "animate-spin")} />
          ) : (
            <RefreshCw className="h-5 w-5" />
          )}
          {hasActiveJobs && (
            <Badge
              variant="default"
              className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
            >
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Active Jobs</h3>
            {hasActiveJobs && (
              <Badge variant="secondary" className="text-xs">
                {activeCount} running
              </Badge>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : hasActiveJobs && data ? (
            <div className="space-y-2">
              {data.active.map((job) => (
                <div
                  key={job.id}
                  className="p-2 rounded-lg bg-muted/50 border border-border/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Loader2 className="h-3 w-3 animate-spin text-primary flex-shrink-0" />
                        <span className="text-xs font-medium truncate">
                          {getJobLabel(job.type)}
                        </span>
                      </div>
                      {job.target && (
                        <p className="text-xs text-muted-foreground truncate">
                          {job.target}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                      <Clock className="h-3 w-3" />
                      <span>{formatDuration(job.duration)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No active jobs</p>
              <p className="text-xs mt-1">All operations completed</p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
