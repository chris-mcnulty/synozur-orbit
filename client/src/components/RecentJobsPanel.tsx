import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, Clock, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export default function RecentJobsPanel() {
  const { data: recentJobs = [], isLoading } = useQuery({
    queryKey: ["/api/jobs/recent"],
    queryFn: async () => {
      const res = await fetch("/api/jobs/recent?limit=10", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "running":
        return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
      case "completed":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "failed":
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
      running: { variant: "default", label: "Running" },
      completed: { variant: "secondary", label: "Completed" },
      failed: { variant: "destructive", label: "Failed" },
      pending: { variant: "outline", label: "Pending" },
    };
    const config = variants[status] || variants.pending;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const formatJobType = (jobType: string): string => {
    const labels: Record<string, string> = {
      websiteCrawl: "Website Crawl",
      socialMonitor: "Social Monitor",
      websiteMonitor: "Website Monitor",
      productMonitor: "Product Monitor",
      fullRegeneration: "Full Regeneration",
    };
    return labels[jobType] || jobType;
  };

  const formatDuration = (startedAt: string | null, completedAt: string | null): string => {
    if (!startedAt) return "-";
    const start = new Date(startedAt).getTime();
    const end = completedAt ? new Date(completedAt).getTime() : Date.now();
    const duration = Math.floor((end - start) / 1000);
    
    if (duration < 60) return `${duration}s`;
    const minutes = Math.floor(duration / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5" />
            Recent Jobs
          </CardTitle>
          <CardDescription>Your recent refresh and analysis jobs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="w-5 h-5" />
          Recent Jobs
        </CardTitle>
        <CardDescription>Your recent refresh and analysis jobs</CardDescription>
      </CardHeader>
      <CardContent>
        {recentJobs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">No recent jobs</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentJobs.map((job: any) => (
              <div
                key={job.id}
                className={cn(
                  "flex items-center justify-between p-3 rounded-lg border",
                  job.status === "running" && "bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800"
                )}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {getStatusIcon(job.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{formatJobType(job.jobType)}</span>
                      {getStatusBadge(job.status)}
                    </div>
                    {job.targetName && (
                      <p className="text-xs text-muted-foreground truncate">{job.targetName}</p>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <p className="text-xs text-muted-foreground">
                    {formatDuration(job.startedAt, job.completedAt)}
                  </p>
                  {job.completedAt && (
                    <p className="text-xs text-muted-foreground">
                      {new Date(job.completedAt).toLocaleTimeString()}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
