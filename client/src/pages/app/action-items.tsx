import React, { useState, useMemo, useCallback } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import {
  Lightbulb,
  Target,
  Package,
  Search,
  Star,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Clock,
  BarChart2,
  Download,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { exportToCSV, type CSVExportItem } from "@/lib/csv-export";
import { useToast } from "@/hooks/use-toast";

interface ActionItem {
  id: string;
  type: "recommendation" | "feature_recommendation" | "gap";
  title: string;
  description: string;
  area: string;
  impact: string;
  status: string;
  isPriority: boolean;
  thumbsUp: number;
  thumbsDown: number;
  source: string;
  sourceId: string | null;
  productName: string | null;
  opportunity?: string;
  suggestedQuarter?: string;
  assignedTo: string | null;
  createdAt: string | null;
}

type DismissTarget = { mode: "single"; item: ActionItem } | { mode: "bulk" };

const DISMISS_REASONS = [
  { value: "not_relevant", label: "Not relevant to our strategy" },
  { value: "already_done", label: "Already addressed" },
  { value: "duplicate", label: "Duplicate of another item" },
  { value: "low_priority", label: "Too low priority right now" },
  { value: "other", label: "Other" },
];

function ImpactBadge({ impact }: { impact: string }) {
  const colors: Record<string, string> = {
    High: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    Medium: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    Low: "bg-gray-500/20 text-gray-300 border-gray-500/30",
  };
  return (
    <Badge variant="outline" className={colors[impact] || colors.Low} data-testid={`badge-impact-${impact}`}>
      {impact}
    </Badge>
  );
}

function SourceBadge({ source }: { source: string }) {
  const config: Record<string, { icon: typeof Lightbulb; color: string }> = {
    "Competitive Intelligence": { icon: Lightbulb, color: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30" },
    "Product Roadmap": { icon: Package, color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
    "Gap Analysis": { icon: Target, color: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  };
  const { icon: Icon, color } = config[source] || config["Competitive Intelligence"];
  return (
    <Badge variant="outline" className={color} data-testid={`badge-source-${source.replace(/\s/g, "-")}`}>
      <Icon className="w-3 h-3 mr-1" />
      {source}
    </Badge>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "accepted":
      return <CheckCircle2 className="w-4 h-4 text-green-400" />;
    case "dismissed":
      return <XCircle className="w-4 h-4 text-red-400" />;
    default:
      return <Clock className="w-4 h-4 text-yellow-400" />;
  }
}

export default function ActionItems() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterSource, setFilterSource] = useState("all");
  const [filterImpact, setFilterImpact] = useState("all");
  const [filterStatus, setFilterStatus] = useState("active");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [dismissDialogOpen, setDismissDialogOpen] = useState(false);
  const [dismissTarget, setDismissTarget] = useState<DismissTarget | null>(null);
  const [dismissReason, setDismissReason] = useState("not_relevant");

  const { data: actionItems = [], isLoading } = useQuery<ActionItem[]>({
    queryKey: ["/api/action-items"],
    queryFn: async () => {
      const response = await fetch("/api/action-items", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ item, newStatus, reason }: { item: ActionItem; newStatus: string; reason?: string }) => {
      if (item.type === "recommendation") {
        const endpoint = newStatus === "dismissed"
          ? `/api/recommendations/${item.id}/hide`
          : `/api/recommendations/${item.id}`;
        const method = newStatus === "dismissed" ? "POST" : "PATCH";
        const body = newStatus === "dismissed"
          ? { reason: reason || "not_relevant" }
          : { status: newStatus };
        const response = await fetch(endpoint, {
          method,
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error("Failed to update status");
        return response.json();
      } else if (item.type === "feature_recommendation") {
        if (!item.sourceId) throw new Error("Feature recommendation missing product reference");
        const response = await fetch(`/api/products/${item.sourceId}/recommendations/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ status: newStatus }),
        });
        if (!response.ok) throw new Error("Failed to update status");
        return response.json();
      } else if (item.type === "gap") {
        const endpoint = newStatus === "dismissed"
          ? `/api/gap-items/${encodeURIComponent(item.id)}/dismiss`
          : `/api/gap-items/${encodeURIComponent(item.id)}/accept`;
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ title: item.title, reason: reason || "not_relevant" }),
        });
        if (!response.ok) throw new Error("Failed to update status");
        return response.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/action-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
      toast({ title: "Status updated" });
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ action, reason }: { action: "accept" | "dismiss"; reason?: string }) => {
      const selectedActionItems = actionItems.filter(item => selectedItems.has(item.id));
      const items = selectedActionItems.map(item => ({
        id: item.id,
        type: item.type,
        title: item.title,
        sourceId: item.sourceId,
      }));
      const response = await fetch("/api/action-items/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ items, action, reason: reason || "not_relevant" }),
      });
      if (!response.ok) throw new Error("Failed to bulk update");
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/action-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
      setSelectedItems(new Set());
      toast({ title: `${data.updated} items updated` });
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
      queryClient.invalidateQueries({ queryKey: ["/api/action-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
    },
  });

  const toggleExpanded = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openDismissDialog = useCallback((target: DismissTarget) => {
    setDismissTarget(target);
    setDismissReason("not_relevant");
    setDismissDialogOpen(true);
  }, []);

  const handleDismissConfirm = useCallback(() => {
    if (!dismissTarget) return;
    if (dismissTarget.mode === "single") {
      updateStatusMutation.mutate({ item: dismissTarget.item, newStatus: "dismissed", reason: dismissReason });
    } else {
      bulkUpdateMutation.mutate({ action: "dismiss", reason: dismissReason });
    }
    setDismissDialogOpen(false);
    setDismissTarget(null);
  }, [dismissTarget, dismissReason, updateStatusMutation, bulkUpdateMutation]);

  const filteredItems = useMemo(() => {
    return actionItems.filter(item => {
      if (filterSource !== "all" && item.source !== filterSource) return false;
      if (filterImpact !== "all" && item.impact !== filterImpact) return false;
      if (filterStatus === "active" && (item.status === "dismissed" || item.status === "hidden")) return false;
      if (filterStatus === "accepted" && item.status !== "accepted") return false;
      if (filterStatus === "dismissed" && item.status !== "dismissed" && item.status !== "hidden") return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          (item.productName || "").toLowerCase().includes(q) ||
          item.area.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [actionItems, filterSource, filterImpact, filterStatus, searchQuery]);

  const allFilteredSelected = filteredItems.length > 0 && filteredItems.every(item => selectedItems.has(item.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map(item => item.id)));
    }
  };

  const stats = useMemo(() => {
    const active = actionItems.filter(i => i.status !== "dismissed" && i.status !== "hidden");
    return {
      total: active.length,
      highImpact: active.filter(i => i.impact === "High").length,
      priorities: active.filter(i => i.isPriority).length,
      bySource: {
        recommendations: active.filter(i => i.type === "recommendation").length,
        features: active.filter(i => i.type === "feature_recommendation").length,
        gaps: active.filter(i => i.type === "gap").length,
      },
    };
  }, [actionItems]);

  const handleExportCSV = () => {
    const items: CSVExportItem[] = filteredItems.map(item => ({
      title: item.title,
      description: item.description,
      category: `${item.source} - ${item.area}`,
    }));
    exportToCSV(items, "action-items");
    toast({ title: "Exported", description: `${items.length} action items exported to CSV` });
  };

  const isItemActionable = (item: ActionItem) => {
    return item.status !== "dismissed" && item.status !== "hidden";
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading action items...</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">Action Items</h1>
            <p className="text-muted-foreground">Consolidated view of all recommendations, gaps, and roadmap suggestions</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-csv">
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <Card className="border-border/50" data-testid="card-stat-total">
          <CardContent className="p-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">Active Items</div>
          </CardContent>
        </Card>
        <Card className="border-border/50" data-testid="card-stat-high-impact">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-purple-400">{stats.highImpact}</div>
            <div className="text-xs text-muted-foreground">High Impact</div>
          </CardContent>
        </Card>
        <Card className="border-border/50" data-testid="card-stat-priorities">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-amber-400">{stats.priorities}</div>
            <div className="text-xs text-muted-foreground">Starred Priorities</div>
          </CardContent>
        </Card>
        <Card className="border-border/50" data-testid="card-stat-sources">
          <CardContent className="p-4">
            <div className="flex gap-2 text-xs">
              <span className="text-indigo-400">{stats.bySource.recommendations} recs</span>
              <span className="text-emerald-400">{stats.bySource.features} product</span>
              <span className="text-amber-400">{stats.bySource.gaps} gaps</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">By Source</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search action items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search"
          />
        </div>
        <Select value={filterSource} onValueChange={setFilterSource}>
          <SelectTrigger className="w-[180px]" data-testid="select-source">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="Competitive Intelligence">Competitive Intel</SelectItem>
            <SelectItem value="Product Roadmap">Product Roadmap</SelectItem>
            <SelectItem value="Gap Analysis">Gap Analysis</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterImpact} onValueChange={setFilterImpact}>
          <SelectTrigger className="w-[140px]" data-testid="select-impact">
            <SelectValue placeholder="Impact" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Impact</SelectItem>
            <SelectItem value="High">High</SelectItem>
            <SelectItem value="Medium">Medium</SelectItem>
            <SelectItem value="Low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Tabs value={filterStatus} onValueChange={setFilterStatus} className="w-auto">
          <TabsList className="h-9">
            <TabsTrigger value="active" className="text-xs" data-testid="tab-active">Active ({actionItems.filter(i => i.status !== "dismissed" && i.status !== "hidden").length})</TabsTrigger>
            <TabsTrigger value="accepted" className="text-xs" data-testid="tab-accepted">Accepted</TabsTrigger>
            <TabsTrigger value="dismissed" className="text-xs" data-testid="tab-dismissed">Dismissed</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {selectedItems.size > 0 && (
        <div className="flex items-center gap-3 mb-4 p-3 bg-muted/50 border border-border/50 rounded-lg" data-testid="bulk-toolbar">
          <span className="text-sm font-medium" data-testid="text-selected-count">{selectedItems.size} selected</span>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => bulkUpdateMutation.mutate({ action: "accept" })}
            disabled={bulkUpdateMutation.isPending}
            data-testid="button-bulk-accept"
          >
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Accept All
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => openDismissDialog({ mode: "bulk" })}
            disabled={bulkUpdateMutation.isPending}
            data-testid="button-bulk-dismiss"
          >
            <XCircle className="w-3 h-3 mr-1" />
            Dismiss All
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={() => setSelectedItems(new Set())}
            data-testid="button-clear-selection"
          >
            Clear
          </Button>
        </div>
      )}

      {filteredItems.length === 0 ? (
        <Card className="p-8 text-center" data-testid="card-empty-state">
          <BarChart2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No action items found</h3>
          <p className="text-muted-foreground text-sm">
            {actionItems.length === 0
              ? "Run a competitive analysis to generate recommendations and identify gaps."
              : "Try adjusting your filters or search query."}
          </p>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="list-action-items">
          <div className="flex items-center gap-2 px-1">
            <Checkbox
              checked={allFilteredSelected}
              onCheckedChange={toggleSelectAll}
              data-testid="checkbox-select-all"
            />
            <span className="text-xs text-muted-foreground">Select all</span>
          </div>
          {filteredItems.map((item) => {
            const isExpanded = expandedItems.has(item.id);
            const isSelected = selectedItems.has(item.id);
            return (
              <Card
                key={item.id}
                className={`border-border/50 transition-all ${item.isPriority ? "border-l-2 border-l-amber-500" : ""} ${isSelected ? "ring-1 ring-primary/50" : ""}`}
                data-testid={`card-action-item-${item.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-1 flex items-center gap-2">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelected(item.id)}
                        data-testid={`checkbox-item-${item.id}`}
                      />
                      <StatusIcon status={item.status} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <button
                          onClick={() => toggleExpanded(item.id)}
                          className="text-left flex-1"
                          data-testid={`button-toggle-${item.id}`}
                        >
                          <h3 className="font-semibold text-sm leading-tight hover:text-primary transition-colors">
                            {item.title}
                          </h3>
                        </button>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <ImpactBadge impact={item.impact} />
                          <SourceBadge source={item.source} />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                        <span>{item.area}</span>
                        {item.productName && (
                          <>
                            <span>·</span>
                            <span className="text-primary/70">{item.productName}</span>
                          </>
                        )}
                        {item.suggestedQuarter && (
                          <>
                            <span>·</span>
                            <span>Target: {item.suggestedQuarter}</span>
                          </>
                        )}
                      </div>
                      {!isExpanded && item.description && (
                        <p className="text-xs text-muted-foreground line-clamp-1">{item.description}</p>
                      )}
                      {isExpanded && (
                        <div className="mt-3 space-y-3">
                          <p className="text-sm text-muted-foreground">{item.description}</p>
                          {item.opportunity && (
                            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                              <div className="text-xs font-medium text-emerald-400 mb-1">Opportunity</div>
                              <p className="text-sm text-muted-foreground">{item.opportunity}</p>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            {isItemActionable(item) && (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs h-7"
                                  onClick={() => updateStatusMutation.mutate({ item, newStatus: "accepted" })}
                                  data-testid={`button-accept-${item.id}`}
                                >
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  Accept
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs h-7"
                                  onClick={() => openDismissDialog({ mode: "single", item })}
                                  data-testid={`button-dismiss-${item.id}`}
                                >
                                  <XCircle className="w-3 h-3 mr-1" />
                                  Dismiss
                                </Button>
                              </>
                            )}
                            {item.type === "recommendation" && isItemActionable(item) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs h-7"
                                onClick={() => priorityMutation.mutate(item.id)}
                                data-testid={`button-priority-${item.id}`}
                              >
                                <Star className={`w-3 h-3 mr-1 ${item.isPriority ? "fill-amber-400 text-amber-400" : ""}`} />
                                {item.isPriority ? "Unstar" : "Star"}
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => toggleExpanded(item.id)}
                      className="text-muted-foreground hover:text-foreground transition-colors p-1"
                      data-testid={`button-expand-${item.id}`}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-4 text-xs text-muted-foreground text-center">
        Showing {filteredItems.length} of {actionItems.length} action items
      </div>

      <AlertDialog open={dismissDialogOpen} onOpenChange={setDismissDialogOpen}>
        <AlertDialogContent data-testid="dialog-dismiss-reason">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dismissTarget?.mode === "bulk"
                ? `Dismiss ${selectedItems.size} items`
                : "Dismiss item"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dismissTarget?.mode === "single" && (
                <span className="block mb-2 font-medium text-foreground">
                  {dismissTarget.item.title}
                </span>
              )}
              Select a reason for dismissing. This helps improve future recommendations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Select value={dismissReason} onValueChange={setDismissReason}>
              <SelectTrigger className="w-full" data-testid="select-dismiss-reason">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {DISMISS_REASONS.map(r => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDismissDialogOpen(false);
                setDismissTarget(null);
              }}
              data-testid="button-dismiss-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDismissConfirm}
              data-testid="button-dismiss-confirm"
            >
              Dismiss
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
