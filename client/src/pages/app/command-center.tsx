import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  Zap, RefreshCw, AlertCircle, CheckCircle, XCircle, 
  TrendingUp, Users, Building2, Package, Target, 
  ArrowRight, Clock, User, ChevronRight, Loader2
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/lib/userContext";
import AppLayout from "@/components/layout/AppLayout";

interface CommandCenterData {
  summary: {
    totalProjects: number;
    activeProjects: number;
    totalCompetitors: number;
    totalProducts: number;
    pendingActions: number;
    averageHealthScore: number | null;
    competitorsNeedingCrawl: number;
    productsNeedingAnalysis: number;
  };
  actionItems: Array<{
    id: string;
    title: string;
    description: string;
    area: string;
    impact: string;
    status: string;
    assignedTo: string | null;
    projectId: string | null;
    competitorId: string | null;
    productId: string | null;
    createdAt: string;
  }>;
  recentActivity: Array<{
    id: string;
    type: string;
    competitorName: string;
    description: string;
    date: string;
    impact: string;
  }>;
  competitorScores: Array<{
    id: string;
    name: string;
    score: number;
    lastAnalysis: string | null;
  }>;
  projects: Array<{
    id: string;
    name: string;
    clientName: string;
    status: string;
    analysisType: string;
  }>;
  tenantUsers: Array<{
    id: string;
    name: string;
    email: string;
  }>;
}

interface RebuildResult {
  success: boolean;
  jobId: string;
  message: string;
  totalItems: number;
  competitors: number;
  products: number;
  projects: number;
}

const hasAdminAccess = (role: string) => 
  role === "Global Admin" || role === "Domain Admin";

export default function CommandCenterPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const [isRebuilding, setIsRebuilding] = useState(false);
  
  const isAdmin = user ? hasAdminAccess(user.role) : false;

  const { data, isLoading, error } = useQuery<CommandCenterData>({
    queryKey: ["/api/command-center"],
    queryFn: async () => {
      const res = await fetch("/api/command-center", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load command center");
      return res.json();
    },
  });

  const rebuildAll = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/rebuild-all", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to start rebuild");
      }
      return res.json() as Promise<RebuildResult>;
    },
    onSuccess: (result) => {
      setIsRebuilding(true);
      toast({
        title: "Rebuild Started",
        description: `Processing ${result.totalItems} items (${result.competitors} competitors, ${result.products} products)`,
      });
      setTimeout(() => {
        setIsRebuilding(false);
        queryClient.invalidateQueries({ queryKey: ["/api/command-center"] });
        toast({
          title: "Rebuild Complete",
          description: "All competitive intelligence has been refreshed.",
        });
      }, 30000);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateRecommendation = useMutation({
    mutationFn: async ({ id, status, assignedTo }: { id: string; status?: string; assignedTo?: string | null }) => {
      const res = await fetch(`/api/recommendations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, assignedTo }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/command-center"] });
      toast({ title: "Updated", description: "Action item updated successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update action item.", variant: "destructive" });
    },
  });

  const getImpactColor = (impact: string) => {
    switch (impact.toLowerCase()) {
      case "high": return "text-red-400 bg-red-400/10";
      case "medium": return "text-yellow-400 bg-yellow-400/10";
      default: return "text-green-400 bg-green-400/10";
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-400";
    if (score >= 60) return "text-yellow-400";
    return "text-red-400";
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (error || !data) {
    return (
      <AppLayout>
        <div className="flex-1 p-8">
          <Card>
            <CardContent className="py-16 text-center">
              <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
              <p className="text-lg font-medium">Failed to load Command Center</p>
              <p className="text-muted-foreground mt-2">Please try again later.</p>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Zap className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Command Center</h1>
              <p className="text-muted-foreground text-sm">Your competitive intelligence at a glance</p>
            </div>
          </div>
          {isAdmin ? (
            <Button
              size="lg"
              onClick={() => rebuildAll.mutate()}
              disabled={isRebuilding || rebuildAll.isPending}
              data-testid="button-rebuild-all"
              className="gap-2"
            >
              {isRebuilding || rebuildAll.isPending ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Rebuilding...
                </>
              ) : (
                <>
                  <RefreshCw className="h-5 w-5" />
                  Rebuild All Intelligence
                </>
              )}
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="lg"
                  disabled
                  data-testid="button-rebuild-all-disabled"
                  className="gap-2"
                >
                  <RefreshCw className="h-5 w-5" />
                  Rebuild All Intelligence
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Admin access required to rebuild all intelligence</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Health Score</p>
                  <p className={`text-3xl font-bold ${data.summary.averageHealthScore ? getScoreColor(data.summary.averageHealthScore) : 'text-muted-foreground'}`}>
                    {data.summary.averageHealthScore ?? "—"}
                  </p>
                </div>
                <div className="p-3 rounded-full bg-primary/10">
                  <TrendingUp className="h-6 w-6 text-primary" />
                </div>
              </div>
              {data.summary.averageHealthScore && (
                <Progress value={data.summary.averageHealthScore} className="mt-3 h-2" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Projects</p>
                  <p className="text-3xl font-bold">{data.summary.activeProjects}</p>
                </div>
                <div className="p-3 rounded-full bg-blue-500/10">
                  <Building2 className="h-6 w-6 text-blue-500" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {data.summary.totalProjects} total projects
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Competitors</p>
                  <p className="text-3xl font-bold">{data.summary.totalCompetitors}</p>
                </div>
                <div className="p-3 rounded-full bg-orange-500/10">
                  <Target className="h-6 w-6 text-orange-500" />
                </div>
              </div>
              {data.summary.competitorsNeedingCrawl > 0 && (
                <p className="text-xs text-yellow-400 mt-2">
                  {data.summary.competitorsNeedingCrawl} need refresh
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Pending Actions</p>
                  <p className="text-3xl font-bold">{data.summary.pendingActions}</p>
                </div>
                <div className="p-3 rounded-full bg-red-500/10">
                  <AlertCircle className="h-6 w-6 text-red-500" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Items needing attention
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader className="border-b border-border">
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-primary" />
                Action Queue
              </CardTitle>
              <CardDescription>Recommendations and items needing your attention</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[400px]">
                {data.actionItems.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground">
                    <CheckCircle className="h-12 w-12 mx-auto mb-3 text-green-500" />
                    <p>All caught up! No pending action items.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {data.actionItems.map((item) => (
                      <div key={item.id} className="p-4 hover:bg-muted/50 transition-colors" data-testid={`action-item-${item.id}`}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium truncate">{item.title}</span>
                              <Badge variant="outline" className={getImpactColor(item.impact)}>
                                {item.impact}
                              </Badge>
                              <Badge variant="secondary">{item.area}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {item.description}
                            </p>
                            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {new Date(item.createdAt).toLocaleDateString()}
                              </span>
                              {item.assignedTo && (
                                <span className="flex items-center gap-1">
                                  <User className="h-3 w-3" />
                                  Assigned
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Select
                              value={item.assignedTo || "unassigned"}
                              onValueChange={(value) => 
                                updateRecommendation.mutate({ 
                                  id: item.id, 
                                  assignedTo: value === "unassigned" ? null : value 
                                })
                              }
                            >
                              <SelectTrigger className="w-32 h-8 text-xs">
                                <SelectValue placeholder="Assign" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unassigned">Unassigned</SelectItem>
                                {data.tenantUsers.map((user) => (
                                  <SelectItem key={user.id} value={user.id}>
                                    {user.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-green-500 hover:text-green-400 hover:bg-green-500/10"
                              onClick={() => updateRecommendation.mutate({ id: item.id, status: "accepted" })}
                              data-testid={`button-accept-${item.id}`}
                            >
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                              onClick={() => updateRecommendation.mutate({ id: item.id, status: "dismissed" })}
                              data-testid={`button-dismiss-${item.id}`}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader className="border-b border-border pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Target className="h-5 w-5 text-primary" />
                  Competitor Rankings
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[180px]">
                  {data.competitorScores.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground text-sm">
                      No competitor scores yet
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {data.competitorScores.map((comp, index) => (
                        <div key={comp.id} className="px-4 py-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-medium text-muted-foreground w-4">
                              {index + 1}
                            </span>
                            <span className="font-medium truncate max-w-[140px]">{comp.name}</span>
                          </div>
                          <span className={`font-bold ${getScoreColor(comp.score)}`}>
                            {comp.score}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b border-border pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  Projects
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[180px]">
                  {data.projects.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground text-sm">
                      <Link href="/app/projects">
                        <Button variant="outline" size="sm">Create First Project</Button>
                      </Link>
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {data.projects.map((project) => (
                        <Link key={project.id} href={`/app/projects/${project.id}`}>
                          <div className="px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors cursor-pointer">
                            <div>
                              <p className="font-medium truncate max-w-[180px]">{project.name}</p>
                              <p className="text-xs text-muted-foreground">{project.clientName}</p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Recent Activity
            </CardTitle>
            <CardDescription>Latest updates across all your competitive intelligence</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {data.recentActivity.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                No recent activity
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.recentActivity.map((activity) => (
                  <div key={activity.id} className="px-6 py-4 flex items-center gap-4">
                    <div className={`p-2 rounded-full ${getImpactColor(activity.impact)}`}>
                      <AlertCircle className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{activity.competitorName}</p>
                      <p className="text-sm text-muted-foreground truncate">{activity.description}</p>
                    </div>
                    <div className="text-xs text-muted-foreground flex-shrink-0">
                      {activity.date}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
