import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/lib/userContext";
import {
  RefreshCw,
  Globe,
  Newspaper,
  Linkedin,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Target,
  Building2,
  Calendar,
  History,
  Play,
  AlertCircle,
  Square,
  Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getFullStalenessInfo } from "@/lib/staleness";
import StalenessDot from "@/components/ui/StalenessDot";

interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  count: number;
  lastUpdated: string | null;
  action: () => Promise<void>;
  loading: boolean;
}

export default function RefreshCenter() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const [loadingActions, setLoadingActions] = useState<Set<string>>(new Set());
  const [cancellingJobs, setCancellingJobs] = useState<Set<string>>(new Set());

  const isAdmin = user?.role === "Global Admin" || user?.role === "Domain Admin";

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

  const { data: activeJobs = { active: [], count: 0 } } = useQuery({
    queryKey: ["/api/jobs/active"],
    queryFn: async () => {
      const res = await fetch("/api/jobs/active", { credentials: "include" });
      if (!res.ok) return { active: [], count: 0 };
      return res.json();
    },
    refetchInterval: 3000,
  });

  const { data: recentJobs = [] } = useQuery({
    queryKey: ["/api/jobs/recent"],
    queryFn: async () => {
      const res = await fetch("/api/jobs/recent?limit=20", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 5000,
  });

  const setActionLoading = (id: string, loading: boolean) => {
    setLoadingActions((prev) => {
      const next = new Set(prev);
      if (loading) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const refreshCompetitorWebsites = async () => {
    setActionLoading("websites", true);
    try {
      for (const competitor of competitors) {
        await fetch(`/api/competitors/${competitor.id}/crawl`, {
          method: "POST",
          credentials: "include",
        });
      }
      toast({ title: "Website crawls started", description: `Queued ${competitors.length} competitor websites for refresh` });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/recent"] });
    } catch (error) {
      toast({ title: "Error", description: "Failed to start website crawls", variant: "destructive" });
    } finally {
      setActionLoading("websites", false);
    }
  };

  const refreshCompetitorSocial = async () => {
    setActionLoading("social", true);
    try {
      for (const competitor of competitors) {
        await fetch(`/api/competitors/${competitor.id}/refresh-social`, {
          method: "POST",
          credentials: "include",
        });
      }
      toast({ title: "Social refresh started", description: `Queued ${competitors.length} competitor social profiles for refresh` });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/recent"] });
    } catch (error) {
      toast({ title: "Error", description: "Failed to start social refresh", variant: "destructive" });
    } finally {
      setActionLoading("social", false);
    }
  };

  const refreshCompanyProfile = async () => {
    if (!companyProfile) return;
    setActionLoading("baseline", true);
    try {
      await fetch(`/api/company-profile/${companyProfile.id}/crawl`, {
        method: "POST",
        credentials: "include",
      });
      toast({ title: "Baseline refresh started", description: "Your company profile is being refreshed" });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/recent"] });
    } catch (error) {
      toast({ title: "Error", description: "Failed to start baseline refresh", variant: "destructive" });
    } finally {
      setActionLoading("baseline", false);
    }
  };

  const refreshAllData = async () => {
    setActionLoading("all", true);
    try {
      if (companyProfile) {
        await fetch(`/api/company-profile/${companyProfile.id}/crawl`, {
          method: "POST",
          credentials: "include",
        });
      }
      for (const competitor of competitors) {
        await fetch(`/api/competitors/${competitor.id}/crawl`, {
          method: "POST",
          credentials: "include",
        });
      }
      toast({ 
        title: "Full refresh started", 
        description: `Queued baseline + ${competitors.length} competitors for refresh` 
      });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/recent"] });
    } catch (error) {
      toast({ title: "Error", description: "Failed to start full refresh", variant: "destructive" });
    } finally {
      setActionLoading("all", false);
    }
  };

  const cancelJobById = async (jobId: string, jobType: string) => {
    setCancellingJobs((prev) => new Set(prev).add(jobId));
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/cancel`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to cancel job");
      }
      toast({ title: "Job cancelled", description: `${formatJobType(jobType)} has been stopped` });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/recent"] });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to cancel job", variant: "destructive" });
    } finally {
      setCancellingJobs((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  const cancelAllJobs = async () => {
    const jobTypes = ["websiteCrawl", "socialMonitor", "websiteMonitor", "productMonitor"];
    let cancelled = 0;
    let failed = 0;

    for (const jobType of jobTypes) {
      try {
        await fetch("/api/admin/jobs/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ jobType }),
        });
      } catch {}
    }

    for (const job of activeJobs.active) {
      try {
        const res = await fetch(`/api/admin/jobs/${job.id}/cancel`, {
          method: "POST",
          credentials: "include",
        });
        if (res.ok) {
          cancelled++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    if (failed > 0 && cancelled > 0) {
      toast({ title: "Partial success", description: `Stopped ${cancelled} job(s), ${failed} could not be cancelled` });
    } else if (failed > 0) {
      toast({ title: "Error", description: "Failed to stop jobs", variant: "destructive" });
    } else {
      toast({ title: "All jobs cancelled", description: "All running operations have been stopped" });
    }

    queryClient.invalidateQueries({ queryKey: ["/api/jobs/active"] });
    queryClient.invalidateQueries({ queryKey: ["/api/jobs/recent"] });
  };

  const getOldestUpdate = (items: any[], field: string): string | null => {
    if (!items.length) return null;
    const dates = items
      .map((i) => i[field])
      .filter(Boolean)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    return dates[0] || null;
  };

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
      trialReminder: "Trial Reminder",
      weeklyDigest: "Weekly Digest",
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

  const formatTimeAgo = (date: string): string => {
    const now = new Date();
    const then = new Date(date);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const jobStats = {
    running: recentJobs.filter((j: any) => j.status === "running").length,
    completed: recentJobs.filter((j: any) => j.status === "completed").length,
    failed: recentJobs.filter((j: any) => j.status === "failed").length,
  };

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <RefreshCw className="w-6 h-6" />
              Refresh Center
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage all your data refresh operations in one place
            </p>
          </div>
          <Button 
            onClick={refreshAllData} 
            disabled={loadingActions.has("all")}
            className="gap-2"
            data-testid="refresh-all-button"
          >
            {loadingActions.has("all") ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            Refresh Everything
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card 
            className={cn(
              "cursor-pointer transition-all hover:border-primary/50",
              loadingActions.has("baseline") && "opacity-75"
            )}
            onClick={() => !loadingActions.has("baseline") && refreshCompanyProfile()}
            data-testid="quick-action-baseline"
          >
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <Building2 className="w-6 h-6 text-blue-500" />
                </div>
                {loadingActions.has("baseline") ? (
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                ) : (
                  <StalenessDot lastUpdated={companyProfile?.lastCrawledAt} />
                )}
              </div>
              <h3 className="font-semibold mt-4">Refresh Baseline</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Your company profile
              </p>
            </CardContent>
          </Card>

          <Card 
            className={cn(
              "cursor-pointer transition-all hover:border-primary/50",
              loadingActions.has("websites") && "opacity-75"
            )}
            onClick={() => !loadingActions.has("websites") && refreshCompetitorWebsites()}
            data-testid="quick-action-websites"
          >
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div className="p-2 bg-green-500/10 rounded-lg">
                  <Globe className="w-6 h-6 text-green-500" />
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{competitors.length}</Badge>
                  {loadingActions.has("websites") ? (
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  ) : (
                    <StalenessDot lastUpdated={getOldestUpdate(competitors, "lastCrawledAt")} />
                  )}
                </div>
              </div>
              <h3 className="font-semibold mt-4">Refresh Websites</h3>
              <p className="text-sm text-muted-foreground mt-1">
                All competitor websites
              </p>
            </CardContent>
          </Card>

          <Card 
            className={cn(
              "cursor-pointer transition-all hover:border-primary/50",
              loadingActions.has("social") && "opacity-75"
            )}
            onClick={() => !loadingActions.has("social") && refreshCompetitorSocial()}
            data-testid="quick-action-social"
          >
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div className="p-2 bg-purple-500/10 rounded-lg">
                  <Linkedin className="w-6 h-6 text-purple-500" />
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{competitors.length}</Badge>
                  {loadingActions.has("social") ? (
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  ) : (
                    <StalenessDot lastUpdated={getOldestUpdate(competitors, "socialLastFetchedAt")} />
                  )}
                </div>
              </div>
              <h3 className="font-semibold mt-4">Refresh Social</h3>
              <p className="text-sm text-muted-foreground mt-1">
                LinkedIn profiles
              </p>
            </CardContent>
          </Card>

          <Card className="bg-muted/30">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div className="p-2 bg-orange-500/10 rounded-lg">
                  <History className="w-6 h-6 text-orange-500" />
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold">{activeJobs.count}</div>
                  <div className="text-xs text-muted-foreground">Active</div>
                </div>
              </div>
              <h3 className="font-semibold mt-4">Job Queue</h3>
              <div className="flex items-center gap-3 mt-2 text-sm">
                <span className="flex items-center gap-1 text-green-500">
                  <CheckCircle2 className="w-3 h-3" /> {jobStats.completed}
                </span>
                <span className="flex items-center gap-1 text-red-500">
                  <XCircle className="w-3 h-3" /> {jobStats.failed}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="active" className="space-y-4">
          <TabsList>
            <TabsTrigger value="active" className="gap-2">
              <Play className="w-4 h-4" />
              Active Jobs
              {activeJobs.count > 0 && (
                <Badge variant="default" className="ml-1">{activeJobs.count}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="w-4 h-4" />
              Job History
            </TabsTrigger>
            <TabsTrigger value="schedule" className="gap-2">
              <Calendar className="w-4 h-4" />
              Scheduled
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Active Jobs</CardTitle>
                    <CardDescription>Currently running refresh operations</CardDescription>
                  </div>
                  {isAdmin && activeJobs.active.length > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={cancelAllJobs}
                      className="gap-2"
                      data-testid="stop-all-jobs-button"
                    >
                      <Square className="w-3.5 h-3.5" />
                      Stop All
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {activeJobs.active.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No active jobs</p>
                    <p className="text-sm mt-1">All operations are complete</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {activeJobs.active.map((job: any) => (
                      <div key={job.id} className="p-4 rounded-lg border bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                            <div>
                              <span className="font-medium">{formatJobType(job.type)}</span>
                              {job.target && (
                                <p className="text-sm text-muted-foreground">{job.target}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-muted-foreground">
                              {formatDuration(job.startedAt, null)}
                            </span>
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cancelJobById(job.id, job.type);
                                }}
                                disabled={cancellingJobs.has(job.id)}
                                className="gap-1.5 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 h-8 px-2"
                                data-testid={`cancel-job-${job.id}`}
                              >
                                {cancellingJobs.has(job.id) ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Square className="w-3.5 h-3.5" />
                                )}
                                Stop
                              </Button>
                            )}
                          </div>
                        </div>
                        <Progress value={50} className="h-2" />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Job History</CardTitle>
                <CardDescription>Recent refresh operations and their results</CardDescription>
              </CardHeader>
              <CardContent>
                {recentJobs.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No job history</p>
                    <p className="text-sm mt-1">Run a refresh to see history here</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recentJobs.map((job: any) => (
                      <div
                        key={job.id}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-lg border",
                          job.status === "running" && "bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800",
                          job.status === "failed" && "bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
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
                            {job.errorMessage && (
                              <p className="text-xs text-red-500 truncate mt-1">{job.errorMessage}</p>
                            )}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-4">
                          <p className="text-xs text-muted-foreground">
                            {formatDuration(job.startedAt, job.completedAt)}
                          </p>
                          {job.completedAt && (
                            <p className="text-xs text-muted-foreground">
                              {formatTimeAgo(job.completedAt)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="schedule">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Scheduled Operations</CardTitle>
                <CardDescription>Automatic refresh schedules</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-500/10 rounded-lg">
                        <Globe className="w-5 h-5 text-blue-500" />
                      </div>
                      <div>
                        <p className="font-medium">Website Monitor</p>
                        <p className="text-sm text-muted-foreground">Checks for competitor website changes</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="secondary">Every 6 hours</Badge>
                      <p className="text-xs text-muted-foreground mt-1">Automatic</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-purple-500/10 rounded-lg">
                        <Linkedin className="w-5 h-5 text-purple-500" />
                      </div>
                      <div>
                        <p className="font-medium">Social Monitor</p>
                        <p className="text-sm text-muted-foreground">Updates LinkedIn profiles</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="secondary">Every 12 hours</Badge>
                      <p className="text-xs text-muted-foreground mt-1">Automatic</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-green-500/10 rounded-lg">
                        <Newspaper className="w-5 h-5 text-green-500" />
                      </div>
                      <div>
                        <p className="font-medium">Weekly Digest</p>
                        <p className="text-sm text-muted-foreground">Email summary of competitor activity</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="secondary">Weekly</Badge>
                      <p className="text-xs text-muted-foreground mt-1">Mondays 9am</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
