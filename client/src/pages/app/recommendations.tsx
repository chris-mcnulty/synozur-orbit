import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThumbsUp, ThumbsDown, EyeOff, Sparkles, Star, RotateCcw, Filter, Download } from "lucide-react";
import { exportToCSV, type CSVExportItem } from "@/lib/csv-export";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Recommendation {
  id: string;
  title: string;
  description: string;
  area: string;
  impact: string;
  status: string;
  rationale?: string;
  thumbsUp: number;
  thumbsDown: number;
  isPriority: boolean;
  dismissedReason?: string;
  createdAt: string;
}

export default function Recommendations() {
  const queryClient = useQueryClient();
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterImpact, setFilterImpact] = useState<string>("all");

  const { data: recommendations = [], isLoading } = useQuery<Recommendation[]>({
    queryKey: ["/api/recommendations"],
    queryFn: async () => {
      const response = await fetch("/api/recommendations", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const voteMutation = useMutation({
    mutationFn: async ({ id, vote }: { id: string; vote: "up" | "down" }) => {
      const response = await fetch(`/api/recommendations/${id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ vote }),
      });
      if (!response.ok) throw new Error("Failed to vote");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
    },
  });

  const priorityMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/recommendations/${id}/priority`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to toggle priority");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
    },
  });

  const hideMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const response = await fetch(`/api/recommendations/${id}/hide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) throw new Error("Failed to hide");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/recommendations/${id}/restore`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to restore");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
    },
  });

  const activeRecs = recommendations.filter((r) => r.status !== "dismissed");
  const dismissedRecs = recommendations.filter((r) => r.status === "dismissed");

  const uniqueCategories = Array.from(new Set(activeRecs.map(r => r.area).filter(Boolean))).sort();
  const uniqueImpacts = Array.from(new Set(activeRecs.map(r => r.impact).filter(Boolean))).sort((a, b) => {
    const order: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
    return (order[a] ?? 3) - (order[b] ?? 3);
  });

  const filteredRecs = activeRecs
    .filter((r) => filterPriority === "all" || (filterPriority === "priority" && r.isPriority))
    .filter((r) => filterCategory === "all" || r.area === filterCategory)
    .filter((r) => filterImpact === "all" || r.impact === filterImpact)
    .sort((a, b) => {
      if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
      const impactOrder = { High: 0, Medium: 1, Low: 2 };
      const aImpact = impactOrder[a.impact as keyof typeof impactOrder] ?? 3;
      const bImpact = impactOrder[b.impact as keyof typeof impactOrder] ?? 3;
      if (aImpact !== bImpact) return aImpact - bImpact;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading recommendations...</p>
        </div>
      </AppLayout>
    );
  }

  const renderRecommendationCard = (rec: Recommendation, isDismissed: boolean = false) => (
    <Card 
      key={rec.id} 
      className={`group transition-colors ${isDismissed ? "opacity-60" : "hover:border-primary/50"} ${rec.isPriority && !isDismissed ? "border-amber-500/50 bg-amber-500/5" : ""}`}
      data-testid={`recommendation-card-${rec.id}`}
    >
      <CardHeader>
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="text-xs uppercase">
                {rec.area}
              </Badge>
              <Badge variant={rec.impact === "High" ? "destructive" : rec.impact === "Medium" ? "default" : "secondary"} className="text-xs">
                {rec.impact} Impact
              </Badge>
              {rec.isPriority && !isDismissed && (
                <Badge variant="default" className="bg-amber-500 text-xs">
                  <Star className="h-3 w-3 mr-1 fill-current" />
                  Priority
                </Badge>
              )}
            </div>
            <CardTitle className="text-xl">{rec.title}</CardTitle>
          </div>
          {!isDismissed && (
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => voteMutation.mutate({ id: rec.id, vote: "up" })}
                disabled={voteMutation.isPending}
                data-testid={`vote-up-${rec.id}`}
              >
                <ThumbsUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => voteMutation.mutate({ id: rec.id, vote: "down" })}
                disabled={voteMutation.isPending}
                data-testid={`vote-down-${rec.id}`}
              >
                <ThumbsDown className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`hide-menu-${rec.id}`}>
                    <EyeOff className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => hideMutation.mutate({ id: rec.id, reason: "already_done" })}>
                    Already done
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => hideMutation.mutate({ id: rec.id, reason: "not_relevant" })}>
                    Not relevant
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => hideMutation.mutate({ id: rec.id, reason: "duplicate" })}>
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => hideMutation.mutate({ id: rec.id, reason: "other" })}>
                    Other
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">{rec.description}</p>

        {rec.rationale && (
          <div className="mt-4 p-4 bg-muted/50 rounded-md text-sm border border-border">
            <span className="font-semibold text-foreground">Rationale:</span> {rec.rationale}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between items-center">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <ThumbsUp className="h-3 w-3" />
            {rec.thumbsUp || 0}
          </span>
          <span className="flex items-center gap-1">
            <ThumbsDown className="h-3 w-3" />
            {rec.thumbsDown || 0}
          </span>
        </div>
        {isDismissed ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => restoreMutation.mutate(rec.id)}
            disabled={restoreMutation.isPending}
            data-testid={`restore-${rec.id}`}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Restore
          </Button>
        ) : (
          <Button
            variant={rec.isPriority ? "default" : "outline"}
            size="sm"
            onClick={() => priorityMutation.mutate(rec.id)}
            disabled={priorityMutation.isPending}
            className={rec.isPriority ? "bg-amber-500 hover:bg-amber-600" : ""}
            data-testid={`priority-toggle-${rec.id}`}
          >
            <Star className={`h-4 w-4 mr-2 ${rec.isPriority ? "fill-current" : ""}`} />
            {rec.isPriority ? "Priority" : "Mark Priority"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );

  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-2">
          <Sparkles className="text-primary h-8 w-8" />
          AI Recommendations
        </h1>
        <p className="text-muted-foreground">Actionable insights generated from your competitive data.</p>
      </div>

      <Tabs defaultValue="active" className="space-y-6">
        <div className="flex justify-between items-center">
          <TabsList>
            <TabsTrigger value="active" data-testid="tab-active">
              Active ({activeRecs.length})
            </TabsTrigger>
            <TabsTrigger value="dismissed" data-testid="tab-dismissed">
              Dismissed ({dismissedRecs.length})
            </TabsTrigger>
          </TabsList>

          <div className="flex gap-2">
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[150px]" data-testid="filter-category">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {uniqueCategories.map(cat => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterImpact} onValueChange={setFilterImpact}>
              <SelectTrigger className="w-[130px]" data-testid="filter-impact">
                <SelectValue placeholder="Impact" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Impacts</SelectItem>
                {uniqueImpacts.map(impact => (
                  <SelectItem key={impact} value={impact}>{impact} Impact</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger className="w-[150px]" data-testid="filter-priority">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="priority">Priority Only</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const recsToExport: CSVExportItem[] = filteredRecs.map(rec => ({
                  title: rec.title,
                  description: rec.description,
                  category: rec.area,
                }));
                exportToCSV(recsToExport, "AI_Recommendations");
              }}
              disabled={filteredRecs.length === 0}
              data-testid="export-csv"
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>

        <TabsContent value="active">
          {filteredRecs.length === 0 ? (
            <Card className="p-12 text-center">
              <Sparkles className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-2">
                {activeRecs.length === 0 
                  ? "No recommendations yet." 
                  : "No priority recommendations."}
              </p>
              <p className="text-sm text-muted-foreground">
                {activeRecs.length === 0 
                  ? "Add competitors and run analysis to generate AI-powered recommendations."
                  : "Mark recommendations as priority to see them here."}
              </p>
            </Card>
          ) : (
            <div className="grid gap-6">
              {filteredRecs.map((rec) => renderRecommendationCard(rec, false))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="dismissed">
          {dismissedRecs.length === 0 ? (
            <Card className="p-12 text-center">
              <EyeOff className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No dismissed recommendations.</p>
            </Card>
          ) : (
            <div className="grid gap-6">
              {dismissedRecs.map((rec) => renderRecommendationCard(rec, true))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
