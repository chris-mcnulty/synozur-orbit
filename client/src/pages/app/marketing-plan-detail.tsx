import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import AppLayout from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ArrowRight, Plus, Trash2, Calendar, CheckCircle, Clock, AlertCircle, Loader2, GripVertical, Sparkles, Settings, ListChecks, LayoutGrid, List, X, Edit2, FileDown, RefreshCw, Link2, Link2Off } from "lucide-react";
import { exportToCSV, type CSVExportItem } from "@/lib/csv-export";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { PlannerSyncDialog } from "@/components/PlannerSyncDialog";
import { useUser } from "@/lib/userContext";

const ACTIVITY_CATEGORIES = [
  { value: "events", label: "Events & Trade Shows", description: "Trade shows, conferences, industry events" },
  { value: "digital_marketing", label: "Digital Marketing", description: "Paid ads, display, programmatic" },
  { value: "outbound_campaigns", label: "Outbound Campaigns", description: "Cold outreach, ABM campaigns" },
  { value: "content_marketing", label: "Content Marketing", description: "Blog posts, whitepapers, ebooks" },
  { value: "social_media", label: "Social Media", description: "Organic social, community building" },
  { value: "email_marketing", label: "Email Marketing", description: "Newsletters, nurture sequences" },
  { value: "seo_sem", label: "SEO/SEM", description: "Search optimization, paid search" },
  { value: "pr_comms", label: "PR & Communications", description: "Press releases, media relations" },
  { value: "analyst_relations", label: "Analyst Relations", description: "Analyst briefings, research" },
  { value: "partner_marketing", label: "Partner Marketing", description: "Co-marketing, channel programs" },
  { value: "customer_marketing", label: "Customer Marketing", description: "Case studies, advocacy, upsell" },
  { value: "product_marketing", label: "Product Marketing", description: "Launches, positioning, messaging" },
  { value: "brand", label: "Brand", description: "Brand campaigns, awareness" },
  { value: "website", label: "Website", description: "Web updates, landing pages" },
  { value: "webinars", label: "Webinars", description: "Live and on-demand webinars" },
  { value: "podcasts", label: "Podcasts", description: "Podcast appearances, hosting" },
  { value: "video", label: "Video", description: "Video content, YouTube" },
  { value: "research", label: "Research & Insights", description: "Market research, surveys" },
  { value: "other", label: "Other", description: "Other marketing activities" },
];

const QUARTER_OPTIONS = [
  { value: "steady_state", label: "Steady State", description: "Ongoing activities" },
  { value: "Q1", label: "Q1", description: "January - March" },
  { value: "Q2", label: "Q2", description: "April - June" },
  { value: "Q3", label: "Q3", description: "July - September" },
  { value: "Q4", label: "Q4", description: "October - December" },
  { value: "future", label: "Future", description: "Beyond this fiscal year" },
];

const PRIORITY_OPTIONS = [
  { value: "high", label: "High", color: "text-red-500" },
  { value: "medium", label: "Medium", color: "text-yellow-500" },
  { value: "low", label: "Low", color: "text-green-500" },
];

const STATUS_OPTIONS = [
  { value: "accepted", label: "Accepted", icon: CheckCircle },
  { value: "planned", label: "Planned", icon: Clock },
  { value: "in_progress", label: "In Progress", icon: Loader2 },
  { value: "completed", label: "Completed", icon: CheckCircle },
  { value: "cancelled", label: "Cancelled", icon: AlertCircle },
];

interface MarketingTask {
  id: string;
  planId: string;
  title: string;
  description: string | null;
  activityGroup: string;
  priority: string;
  status: string;
  dueDate: string | null;
  timeframe: string | null;
  aiGenerated: boolean;
  createdAt: string;
  plannerTaskId?: string | null;
  sourceGenerationId?: string | null;
  sourceGenerationLabel?: string | null;
}

interface PlannerStatus {
  connected: boolean;
  plannerGroupId: string | null;
  plannerGroupName: string | null;
  plannerPlanId: string | null;
  plannerPlanName: string | null;
  plannerBucketId: string | null;
  plannerBucketName: string | null;
  plannerLastSyncAt: string | null;
  plannerLastSyncError: string | null;
  deepLink: string | null;
  taskDeepLinkTemplate: string | null;
  subscription: {
    subscriptionId: string;
    expiresAt: string;
    lastRenewedAt: string | null;
    lastError: string | null;
    healthy: boolean;
  } | null;
  categoryMappings: Array<{ activityCategory: string; bucketId: string; bucketName: string }>;
  recentLog: Array<{
    occurredAt: string;
    direction: "pull" | "push" | "reconcile" | "webhook";
    taskId: string | null;
    plannerTaskId: string | null;
    fields: Record<string, unknown> | null;
    success: boolean;
    errorMessage: string | null;
  }>;
}

const INCOMING_DIRECTIONS = new Set(["pull", "reconcile", "webhook"]);

interface PlanConfig {
  selectedCategories: string[];
  selectedPeriods: string[];
  configured: boolean;
}

interface MarketingPlan {
  id: string;
  name: string;
  description: string | null;
  fiscalYear: string;
  status: string;
  configMatrix: {
    selectedQuarters?: string[];
    quarters?: string[];
    selectedCategories?: string[];
    selectedPeriods?: string[];
    configured?: boolean;
  } | null;
  createdAt: string;
  plannerGroupId?: string | null;
  plannerGroupName?: string | null;
  plannerPlanId?: string | null;
  plannerPlanName?: string | null;
  plannerBucketId?: string | null;
  plannerBucketName?: string | null;
  plannerSyncEnabled?: boolean | null;
  plannerLastSyncAt?: string | null;
  plannerLastSyncError?: string | null;
  vegaLastPushAt?: string | null;
  vegaLastPushStatus?: string | null;
  vegaLastPushError?: string | null;
  vegaLastPushBundleId?: string | null;
}

interface VegaAuthStatus {
  configured: boolean;
  url: string | null;
  workspaceId: string | null;
  connectedAt: string | null;
  hasApiKey: boolean;
}

export default function MarketingPlanDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [configStep, setConfigStep] = useState(1);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedPeriods, setSelectedPeriods] = useState<string[]>([]);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  
  const [isAddTaskOpen, setIsAddTaskOpen] = useState(false);
  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    activityGroup: "other",
    priority: "medium",
    dueDate: "",
    timeframe: "",
  });
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterTimeframe, setFilterTimeframe] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"list" | "matrix">("list");
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>([]);
  const [selectedTask, setSelectedTask] = useState<MarketingTask | null>(null);
  const [editingTask, setEditingTask] = useState<MarketingTask | null>(null);
  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    activityGroup: "other",
    priority: "medium",
    timeframe: "",
    dueDate: "",
  });
  const [plannerDialogOpen, setPlannerDialogOpen] = useState(false);
  // Stable label derived from plan id so the queued/running state survives
  // reloads, other tabs, and scheduled background sweeps.
  const plannerSyncJobLabel = id ? `planner-sync:${id}` : null;

  type JobStatusResponse = {
    status: "active" | "pending" | "not_found";
    progress?: { phase?: string; percent?: number };
    runningSec?: number;
    queuePosition?: number;
    pendingAhead?: number;
    type?: string;
  };
  const { data: plannerSyncJob } = useQuery<JobStatusResponse>({
    queryKey: ["planner-sync-job", id],
    queryFn: async () => {
      const res = await fetch(`/api/queue/job-status?label=${encodeURIComponent(plannerSyncJobLabel!)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load job status");
      return res.json();
    },
    enabled: !!plannerSyncJobLabel,
    refetchInterval: 2000,
  });

  const plannerSyncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/marketing-plans/${id}/planner/sync`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Sync failed");
      }
      return res.json() as Promise<{ queued: true; label: string; status: "active" | "pending"; queuePosition?: number; pendingAhead?: number }>;
    },
    onSuccess: (result) => {
      toast({
        title: result.status === "active" ? "Sync in progress" : "Sync queued",
        description: result.status === "pending" && result.queuePosition
          ? `Position ${result.queuePosition} in the Planner queue — running in the background.`
          : "Running in the background — this banner will update when it finishes.",
      });
      queryClient.invalidateQueries({ queryKey: ["planner-sync-job", id] });
    },
    onError: (err: any) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  // Track transitions from active/pending → not_found so we can refresh the
  // plan + status (which carry the final `plannerLastSyncAt` /
  // `plannerLastSyncError` fields) regardless of whether the sync was
  // initiated from this tab, another tab, or a scheduled sweep.
  const prevSyncJobStatus = useRef<JobStatusResponse["status"] | undefined>(undefined);
  useEffect(() => {
    const cur = plannerSyncJob?.status;
    const prev = prevSyncJobStatus.current;
    if ((prev === "active" || prev === "pending") && cur === "not_found") {
      queryClient.invalidateQueries({ queryKey: [`/api/marketing-plans/${id}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/marketing-plans/${id}/planner/status`] });
      queryClient.invalidateQueries({ queryKey: [`/api/marketing-plans/${id}/tasks`] });
    }
    prevSyncJobStatus.current = cur;
  }, [plannerSyncJob?.status, id, queryClient]);

  const plannerSyncBusy = plannerSyncMutation.isPending
    || plannerSyncJob?.status === "active"
    || plannerSyncJob?.status === "pending";

  const { data: plannerStatus } = useQuery<PlannerStatus>({
    queryKey: [`/api/marketing-plans/${id}/planner/status`],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-plans/${id}/planner/status`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load Planner status");
      return res.json();
    },
    enabled: !!id,
    refetchInterval: 60_000,
  });

  const resubscribeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/marketing-plans/${id}/planner/resubscribe`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Resubscribe failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Webhook subscription refreshed" });
      queryClient.invalidateQueries({ queryKey: [`/api/marketing-plans/${id}/planner/status`] });
    },
    onError: (err: any) => {
      toast({ title: "Resubscribe failed", description: err.message, variant: "destructive" });
    },
  });

  const { user } = useUser();
  const isAdmin = user?.role === "Domain Admin" || user?.role === "Global Admin";

  const [vegaExportOpen, setVegaExportOpen] = useState(false);
  const [vegaExporting, setVegaExporting] = useState(false);
  const [vegaCredsOpen, setVegaCredsOpen] = useState(false);
  const [vegaCredsForm, setVegaCredsForm] = useState({ url: "", apiKey: "", workspaceId: "" });
  const [vegaCredsSaving, setVegaCredsSaving] = useState(false);

  const { data: vegaAuth, refetch: refetchVegaAuth } = useQuery<VegaAuthStatus>({
    queryKey: ["/api/vega/auth/status"],
    queryFn: async () => {
      const res = await fetch("/api/vega/auth/status", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load Vega connection status");
      return res.json();
    },
  });

  const saveVegaCreds = async () => {
    setVegaCredsSaving(true);
    try {
      const res = await fetch("/api/vega/auth/config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: vegaCredsForm.url.trim(),
          apiKey: vegaCredsForm.apiKey.trim(),
          workspaceId: vegaCredsForm.workspaceId.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save Vega credentials");
      }
      toast({ title: "Vega Launchpad connected" });
      setVegaCredsOpen(false);
      setVegaCredsForm({ url: "", apiKey: "", workspaceId: "" });
      await refetchVegaAuth();
    } catch (err: any) {
      toast({ title: "Failed to connect", description: err.message, variant: "destructive" });
    } finally {
      setVegaCredsSaving(false);
    }
  };

  const disconnectVega = async () => {
    try {
      const res = await fetch("/api/vega/auth/config", { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to disconnect");
      }
      toast({ title: "Vega Launchpad disconnected" });
      await refetchVegaAuth();
    } catch (err: any) {
      toast({ title: "Failed to disconnect", description: err.message, variant: "destructive" });
    }
  };

  const vegaPushMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/marketing-plans/${id}/vega/push`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        throw new Error(body.error || `Push failed (${res.status})`);
      }
      return body;
    },
    onSuccess: () => {
      toast({ title: "Pushed to Vega Launchpad" });
      queryClient.invalidateQueries({ queryKey: [`/api/marketing-plans/${id}`] });
    },
    onError: (err: any) => {
      toast({ title: "Push to Vega failed", description: err.message, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: [`/api/marketing-plans/${id}`] });
    },
  });

  const exportVega = async (format: "zip" | "json") => {
    setVegaExporting(true);
    try {
      const res = await fetch(`/api/marketing-plans/${id}/vega-export?format=${format}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("Content-Disposition") || "";
      const match = cd.match(/filename="([^"]+)"/);
      a.download = match?.[1] || `vega-export-${id}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Vega export ready", description: "Bundle downloaded to your computer." });
      setVegaExportOpen(false);
    } catch (err: any) {
      toast({ title: "Vega export failed", description: err.message, variant: "destructive" });
    } finally {
      setVegaExporting(false);
    }
  };

  const { data: plan, isLoading: planLoading } = useQuery<MarketingPlan>({
    queryKey: [`/api/marketing-plans/${id}`],
    queryFn: async () => {
      const response = await fetch(`/api/marketing-plans/${id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch plan");
      return response.json();
    },
    enabled: !!id,
  });

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<MarketingTask[]>({
    queryKey: [`/api/marketing-plans/${id}/tasks`],
    queryFn: async () => {
      const response = await fetch(`/api/marketing-plans/${id}/tasks`, { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!id,
  });

  const planQuarters = plan?.configMatrix?.selectedQuarters || plan?.configMatrix?.quarters || ["steady_state", "Q1", "Q2", "Q3", "Q4"];
  const availablePeriods = QUARTER_OPTIONS.filter(q => 
    planQuarters.includes(q.value) || q.value === "future"
  );
  const isConfigured = plan?.configMatrix?.configured === true;

  useEffect(() => {
    if (plan?.configMatrix) {
      setSelectedCategories(plan.configMatrix.selectedCategories || []);
      setSelectedPeriods(plan.configMatrix.selectedPeriods || []);
    }
  }, [plan]);

  const saveConfig = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/marketing-plans/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          configMatrix: {
            ...plan?.configMatrix,
            selectedCategories,
            selectedPeriods,
            configured: true,
          },
        }),
      });
      if (!response.ok) throw new Error("Failed to save configuration");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/marketing-plans/${id}`] });
      setIsConfiguring(false);
      toast({ title: "Configuration Saved", description: "Your marketing plan is now configured." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const generateTasks = useMutation({
    mutationFn: async ({ deleteExisting }: { deleteExisting: boolean }) => {
      const response = await fetch(`/api/marketing-plans/${id}/generate-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          categories: selectedCategories,
          periods: selectedPeriods,
          deleteExisting,
        }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to generate tasks");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/marketing-plans/${id}/tasks`] });
      setIsGenerating(false);
      toast({ 
        title: "Tasks Generated", 
        description: `${data.tasksCreated || 0} tasks have been added to your plan.` 
      });
    },
    onError: (error: Error) => {
      setIsGenerating(false);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createTask = useMutation({
    mutationFn: async (data: typeof taskForm) => {
      const response = await fetch(`/api/marketing-plans/${id}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...data,
          dueDate: data.dueDate || null,
          timeframe: data.timeframe || null,
        }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to create task");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/marketing-plans/${id}/tasks`] });
      setIsAddTaskOpen(false);
      setTaskForm({ title: "", description: "", activityGroup: "other", priority: "medium", dueDate: "", timeframe: "" });
      toast({ title: "Task Created", description: "Your task has been added to the plan." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateTaskStatus = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: string }) => {
      const response = await fetch(`/api/marketing-plans/${id}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Failed to update task");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/marketing-plans/${id}/tasks`] });
    },
  });

  const bulkUpdateStatus = useMutation({
    mutationFn: async ({ taskIds, status }: { taskIds: string[]; status: string }) => {
      const response = await fetch(`/api/marketing-plans/${id}/tasks/bulk-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ taskIds, status }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update tasks");
      }
      return response.json() as Promise<{ updated: number }>;
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: [`/api/marketing-plans/${id}/tasks`] });
      setSelectedSuggestionIds([]);
      toast({
        title: vars.status === "accepted" ? "Suggestions accepted" : "Suggestions dismissed",
        description: `${data.updated} task${data.updated === 1 ? "" : "s"} ${vars.status === "accepted" ? "accepted" : "dismissed"}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteTask = useMutation({
    mutationFn: async (taskId: string) => {
      const response = await fetch(`/api/marketing-plans/${id}/tasks/${taskId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete task");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/marketing-plans/${id}/tasks`] });
      toast({ title: "Task Deleted" });
    },
  });

  const updateTask = useMutation({
    mutationFn: async ({ taskId, data }: { taskId: string; data: typeof editForm }) => {
      const response = await fetch(`/api/marketing-plans/${id}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...data,
          dueDate: data.dueDate || null,
          timeframe: data.timeframe || null,
        }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to update task");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/marketing-plans/${id}/tasks`] });
      setEditingTask(null);
      toast({ title: "Task Updated", description: "Your task has been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const openEditDialog = (task: MarketingTask) => {
    setEditingTask(task);
    // Normalize priority to lowercase to match PRIORITY_OPTIONS values
    const normalizedPriority = task.priority?.toLowerCase() || "medium";
    setEditForm({
      title: task.title,
      description: task.description || "",
      activityGroup: task.activityGroup,
      priority: normalizedPriority,
      timeframe: task.timeframe || "",
      dueDate: task.dueDate ? task.dueDate.split("T")[0] : "",
    });
  };

  const toggleCategory = (category: string) => {
    setSelectedCategories(prev => 
      prev.includes(category) 
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const togglePeriod = (period: string) => {
    setSelectedPeriods(prev => 
      prev.includes(period) 
        ? prev.filter(p => p !== period)
        : [...prev, period]
    );
  };

  const selectAllCategories = () => {
    setSelectedCategories(ACTIVITY_CATEGORIES.map(c => c.value));
  };

  const clearCategories = () => {
    setSelectedCategories([]);
  };

  // AI suggestions awaiting review live in their own queue, not the main views.
  const suggestedTasks = tasks.filter(t => t.aiGenerated && t.status === "suggested");
  const visibleTasks = tasks.filter(t => !(t.aiGenerated && (t.status === "suggested" || t.status === "dismissed")));

  const filteredTasks = visibleTasks.filter(task => {
    if (filterCategory !== "all" && task.activityGroup !== filterCategory) return false;
    if (filterTimeframe !== "all" && task.timeframe !== filterTimeframe) return false;
    if (filterPriority !== "all" && task.priority?.toLowerCase() !== filterPriority.toLowerCase()) return false;
    return true;
  });

  const clearFilters = () => {
    setFilterCategory("all");
    setFilterTimeframe("all");
    setFilterPriority("all");
  };

  const hasActiveFilters = filterCategory !== "all" || filterTimeframe !== "all" || filterPriority !== "all";

  const groupedTasks = ACTIVITY_CATEGORIES.reduce((acc, cat) => {
    const categoryTasks = filteredTasks.filter(t => t.activityGroup === cat.value);
    if (categoryTasks.length > 0) {
      acc[cat.value] = { label: cat.label, tasks: categoryTasks };
    }
    return acc;
  }, {} as Record<string, { label: string; tasks: MarketingTask[] }>);

  // Matrix columns: use configured plan quarters or default to all
  const matrixColumns = QUARTER_OPTIONS.filter(q => 
    planQuarters.includes(q.value) || q.value === "future"
  );

  // Matrix data: tasks organized by category (row) and timeframe (column)
  const matrixData = ACTIVITY_CATEGORIES.filter(cat => selectedCategories.includes(cat.value)).map(cat => {
    const row: Record<string, MarketingTask[]> = {};
    matrixColumns.forEach(q => {
      row[q.value] = visibleTasks.filter(t => t.activityGroup === cat.value && t.timeframe === q.value);
    });
    return { category: cat, tasks: row };
  });

  const getMatrixPriorityColor = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case "high": return "bg-red-500/20 border-red-500/50 text-red-700 dark:text-red-300";
      case "medium": return "bg-yellow-500/20 border-yellow-500/50 text-yellow-700 dark:text-yellow-300";
      case "low": return "bg-green-500/20 border-green-500/50 text-green-700 dark:text-green-300";
      default: return "bg-muted border-border";
    }
  };

  const getStatusBadge = (status: string) => {
    const opt = STATUS_OPTIONS.find(s => s.value === status);
    if (!opt) return <Badge variant="outline">{status}</Badge>;
    const Icon = opt.icon;
    return (
      <Badge variant={status === "completed" ? "default" : status === "cancelled" ? "destructive" : "secondary"}>
        <Icon className="w-3 h-3 mr-1" />
        {opt.label}
      </Badge>
    );
  };

  const getPriorityBadge = (priority: string) => {
    const opt = PRIORITY_OPTIONS.find(p => p.value === priority);
    return (
      <Badge variant="outline" className={opt?.color}>
        {opt?.label || priority}
      </Badge>
    );
  };

  const planBreadcrumbs = [
    { label: "Marketing Projects", href: "/app/marketing/projects" },
    { label: plan?.name || "Loading..." },
  ];

  if (planLoading) {
    return (
      <AppLayout breadcrumbs={planBreadcrumbs}>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!plan) {
    return (
      <AppLayout breadcrumbs={[{ label: "Marketing Projects", href: "/app/marketing/projects" }, { label: "Not Found" }]}>
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold mb-2">Plan Not Found</h2>
          <p className="text-muted-foreground mb-4">The marketing plan you're looking for doesn't exist.</p>
          <Button onClick={() => navigate("/app/marketing/projects")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Plans
          </Button>
        </div>
      </AppLayout>
    );
  }

  if (!isConfigured && !isConfiguring) {
    return (
      <AppLayout breadcrumbs={planBreadcrumbs}>
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/app/marketing/projects")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{plan.name}</h1>
              <p className="text-sm text-muted-foreground">
                {plan.fiscalYear} • {planQuarters.length === 5 ? "Full Year" : planQuarters.map(q => q === "steady_state" ? "Steady State" : q).join(", ")}
              </p>
            </div>
          </div>

          <Card>
            <CardHeader className="text-center pb-2">
              <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                <Settings className="w-8 h-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">Configure Your Marketing Plan</CardTitle>
              <CardDescription className="text-base">
                Select the activity areas and time periods you want to focus on. 
                We'll help you generate a structured plan based on your selections.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <Button 
                size="lg" 
                className="w-full" 
                onClick={() => setIsConfiguring(true)}
                data-testid="button-start-configuration"
              >
                <Sparkles className="w-5 h-5 mr-2" />
                Start Configuration
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  if (isConfiguring) {
    return (
      <AppLayout breadcrumbs={planBreadcrumbs}>
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setIsConfiguring(false)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Configure: {plan.name}</h1>
              <p className="text-sm text-muted-foreground">Step {configStep} of 2</p>
            </div>
          </div>

          <div className="flex gap-2 mb-6">
            <div className={`h-2 flex-1 rounded-full ${configStep >= 1 ? "bg-primary" : "bg-muted"}`} />
            <div className={`h-2 flex-1 rounded-full ${configStep >= 2 ? "bg-primary" : "bg-muted"}`} />
          </div>

          {configStep === 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ListChecks className="w-5 h-5" />
                  Select Activity Categories
                </CardTitle>
                <CardDescription>
                  Choose the marketing activities you want to include in this plan. 
                  You can select multiple categories.
                </CardDescription>
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={selectAllCategories}>Select All</Button>
                  <Button variant="outline" size="sm" onClick={clearCategories}>Clear All</Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {ACTIVITY_CATEGORIES.map((cat) => (
                    <div
                      key={cat.value}
                      onClick={() => toggleCategory(cat.value)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        selectedCategories.includes(cat.value)
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                      data-testid={`category-${cat.value}`}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox 
                          checked={selectedCategories.includes(cat.value)}
                          onCheckedChange={() => toggleCategory(cat.value)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{cat.label}</p>
                          <p className="text-xs text-muted-foreground">{cat.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-6">
                  <Button variant="outline" onClick={() => setIsConfiguring(false)}>Cancel</Button>
                  <Button 
                    onClick={() => setConfigStep(2)} 
                    disabled={selectedCategories.length === 0}
                    data-testid="button-next-step"
                  >
                    Next: Select Time Periods
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {configStep === 2 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  Select Time Periods
                </CardTitle>
                <CardDescription>
                  Choose which periods to plan for in {plan.fiscalYear}. You can select from the quarters included in your plan.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {availablePeriods.map((period) => (
                    <div
                      key={period.value}
                      onClick={() => togglePeriod(period.value)}
                      className={`p-4 rounded-lg border cursor-pointer transition-all text-center ${
                        selectedPeriods.includes(period.value)
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                      data-testid={`period-${period.value}`}
                    >
                      <div className="flex items-center justify-center gap-2">
                        <Checkbox 
                          checked={selectedPeriods.includes(period.value)}
                          onCheckedChange={() => togglePeriod(period.value)}
                        />
                        <span className="font-medium">{period.label}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 p-4 bg-muted/50 rounded-lg">
                  <h4 className="font-medium mb-2">Summary</h4>
                  <p className="text-sm text-muted-foreground">
                    You've selected <strong>{selectedCategories.length}</strong> activity categories
                    across <strong>{selectedPeriods.length}</strong> time period{selectedPeriods.length !== 1 ? "s" : ""}.
                  </p>
                </div>

                <div className="flex justify-between mt-6">
                  <Button variant="outline" onClick={() => setConfigStep(1)}>
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back
                  </Button>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline"
                      onClick={() => saveConfig.mutate()} 
                      disabled={selectedPeriods.length === 0 || saveConfig.isPending}
                    >
                      {saveConfig.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Save & Add Tasks Manually
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button 
                          disabled={selectedPeriods.length === 0 || saveConfig.isPending || generateTasks.isPending}
                          data-testid="button-generate-tasks-trigger"
                        >
                          {(saveConfig.isPending || generateTasks.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                          <Sparkles className="w-4 h-4 mr-2" />
                          Generate AI Suggestions
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Generate Marketing Plan Tasks</AlertDialogTitle>
                          <AlertDialogDescription>
                            Would you like to keep any existing tasks in this plan, or delete them and start fresh?
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction 
                            onClick={() => {
                              setIsGenerating(true);
                              saveConfig.mutate(undefined, {
                                onSuccess: () => generateTasks.mutate({ deleteExisting: false })
                              });
                            }}
                          >
                            Keep Existing Data
                          </AlertDialogAction>
                          <AlertDialogAction 
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                              setIsGenerating(true);
                              saveConfig.mutate(undefined, {
                                onSuccess: () => generateTasks.mutate({ deleteExisting: true })
                              });
                            }}
                          >
                            Delete & Start Fresh
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumbs={planBreadcrumbs}>
      <PlannerSyncDialog
        open={plannerDialogOpen}
        onOpenChange={setPlannerDialogOpen}
        marketingPlanId={plan.id}
        activityCategories={ACTIVITY_CATEGORIES.filter(c => selectedCategories.includes(c.value))}
        currentMapping={{
          plannerGroupId: plan.plannerGroupId,
          plannerGroupName: plan.plannerGroupName,
          plannerPlanId: plan.plannerPlanId,
          plannerPlanName: plan.plannerPlanName,
          plannerBucketId: plan.plannerBucketId,
          plannerBucketName: plan.plannerBucketName,
        }}
        currentCategoryMappings={plannerStatus?.categoryMappings || []}
      />
      <div className="space-y-6">
        {plan.plannerSyncEnabled && (
          <div className="flex flex-col gap-2 px-3 py-2 border border-border rounded-md bg-muted/30 text-sm" data-testid="banner-planner-status">
            <div className="flex items-center gap-3">
              <Link2 className="w-4 h-4 text-primary shrink-0" />
              <div className="flex-1">
                Connected to <strong>{plan.plannerPlanName}</strong> in <strong>{plan.plannerGroupName}</strong>
                {plan.plannerBucketName && <> • default bucket <strong>{plan.plannerBucketName}</strong></>}
                {(plannerStatus?.plannerLastSyncAt || plan.plannerLastSyncAt) && (
                  <span className="text-muted-foreground"> • Last synced {new Date(plannerStatus?.plannerLastSyncAt || plan.plannerLastSyncAt!).toLocaleString()}</span>
                )}
                {plannerSyncJob?.status === "active" && (
                  <span className="ml-2 text-primary" data-testid="status-planner-sync-running">
                    • Syncing now{plannerSyncJob.runningSec ? ` (${plannerSyncJob.runningSec}s)` : "…"}
                  </span>
                )}
                {plannerSyncJob?.status === "pending" && (
                  <span className="ml-2 text-muted-foreground" data-testid="status-planner-sync-queued">
                    • Queued{plannerSyncJob.queuePosition ? ` (position ${plannerSyncJob.queuePosition})` : "…"}
                  </span>
                )}
              </div>
              {plannerStatus?.deepLink && (
                <a
                  href={plannerStatus.deepLink}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs underline"
                  data-testid="link-open-plan-in-planner"
                >
                  Open in Planner
                </a>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground pl-7">
              {plannerStatus?.subscription ? (
                plannerStatus.subscription.healthy ? (
                  <span data-testid="status-subscription-healthy">
                    Webhook active · expires {new Date(plannerStatus.subscription.expiresAt).toLocaleString()}
                  </span>
                ) : (
                  <span className="text-destructive" data-testid="status-subscription-unhealthy">
                    Webhook unhealthy: {plannerStatus.subscription.lastError || "expired"}
                  </span>
                )
              ) : (
                <span data-testid="status-subscription-missing">No incoming-change subscription</span>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => resubscribeMutation.mutate()}
                disabled={resubscribeMutation.isPending}
                data-testid="button-resubscribe-planner"
              >
                {resubscribeMutation.isPending ? "Refreshing…" : "Refresh subscription"}
              </Button>
              {plannerStatus?.recentLog?.find(r => INCOMING_DIRECTIONS.has(r.direction)) && (
                <span data-testid="text-last-incoming">
                  Last incoming change {new Date(plannerStatus.recentLog.find(r => INCOMING_DIRECTIONS.has(r.direction))!.occurredAt).toLocaleString()}
                </span>
              )}
            </div>
            {(plannerStatus?.plannerLastSyncError || plan.plannerLastSyncError) && (
              <span className="text-xs text-destructive pl-7">{plannerStatus?.plannerLastSyncError || plan.plannerLastSyncError}</span>
            )}
          </div>
        )}
        {(plan.vegaLastPushAt || vegaAuth?.configured) && (
          <div
            className="flex flex-wrap items-center gap-3 px-3 py-2 border border-border rounded-md bg-muted/30 text-sm"
            data-testid="banner-vega-status"
          >
            <Link2 className="w-4 h-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              {vegaAuth?.configured ? (
                <>
                  Vega Launchpad: <strong className="break-all">{vegaAuth.url}</strong>
                  {vegaAuth.workspaceId && <> • workspace <strong>{vegaAuth.workspaceId}</strong></>}
                </>
              ) : (
                <>Vega Launchpad not connected — historical push only</>
              )}
              {plan.vegaLastPushAt && (
                <div className="text-xs text-muted-foreground mt-0.5" data-testid="text-vega-last-push">
                  Last push {new Date(plan.vegaLastPushAt).toLocaleString()}
                  {" • "}
                  {plan.vegaLastPushStatus === "success" ? (
                    <span className="text-emerald-600 dark:text-emerald-400">success</span>
                  ) : (
                    <span className="text-destructive">failure</span>
                  )}
                  {plan.vegaLastPushBundleId && <> • bundle <code>{plan.vegaLastPushBundleId}</code></>}
                </div>
              )}
              {plan.vegaLastPushError && plan.vegaLastPushStatus !== "success" && (
                <div className="text-xs text-destructive mt-0.5" data-testid="text-vega-last-error">
                  {plan.vegaLastPushError}
                </div>
              )}
            </div>
            {vegaAuth?.configured && isAdmin && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => disconnectVega()}
                data-testid="button-vega-disconnect"
              >
                Disconnect
              </Button>
            )}
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/app/marketing/projects")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{plan.name}</h1>
              <p className="text-sm text-muted-foreground">
                {plan.fiscalYear} • {selectedCategories.length} categories • {selectedPeriods.length} period{selectedPeriods.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const categoryLookup = ACTIVITY_CATEGORIES.reduce((acc, cat) => {
                  acc[cat.value] = cat.label;
                  return acc;
                }, {} as Record<string, string>);
                const csvItems: CSVExportItem[] = visibleTasks.map(task => ({
                  title: task.title,
                  description: task.description || "",
                  category: categoryLookup[task.activityGroup] || task.activityGroup,
                }));
                exportToCSV(csvItems, `${plan.name}_marketing_plan`);
                toast({ title: "Exported", description: `${visibleTasks.length} tasks exported to CSV.` });
              }}
              disabled={visibleTasks.length === 0}
              data-testid="button-export-csv"
            >
              <FileDown className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => setVegaExportOpen(true)}
              disabled={tasks.length === 0}
              data-testid="button-vega-export"
              title="Open the Vega Launchpad export dialog"
            >
              <FileDown className="w-4 h-4 mr-2" />
              Export for Vega
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!vegaAuth?.configured) {
                  if (!isAdmin) {
                    toast({
                      title: "Admin access required",
                      description: "Ask a Domain Admin to connect Vega Launchpad before pushing plans.",
                      variant: "destructive",
                    });
                    return;
                  }
                  setVegaCredsOpen(true);
                  return;
                }
                vegaPushMutation.mutate();
              }}
              disabled={
                vegaPushMutation.isPending ||
                (!vegaAuth?.configured && !isAdmin) ||
                (vegaAuth?.configured && tasks.length === 0)
              }
              data-testid="button-vega-push"
              title={
                vegaAuth?.configured
                  ? `Push this plan to ${vegaAuth.url}`
                  : isAdmin
                  ? "Connect to Vega Launchpad to enable direct push"
                  : "A Domain Admin must connect Vega Launchpad before plans can be pushed"
              }
            >
              {vegaPushMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Link2 className="w-4 h-4 mr-2" />
              )}
              {vegaAuth?.configured ? "Push to Vega" : "Connect Vega"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setPlannerDialogOpen(true)}
              data-testid="button-planner-configure"
              title={plan.plannerSyncEnabled ? `Connected to ${plan.plannerPlanName} • bucket: ${plan.plannerBucketName || "default"}` : "Connect to Microsoft Planner"}
            >
              <Link2 className="w-4 h-4 mr-2" />
              {plan.plannerSyncEnabled ? "Planner Settings" : "Connect Planner"}
            </Button>
            {plan.plannerSyncEnabled && (
              <Button
                variant="outline"
                onClick={() => plannerSyncMutation.mutate()}
                disabled={plannerSyncBusy || tasks.length === 0}
                data-testid="button-planner-sync"
              >
                {plannerSyncBusy ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                {plannerSyncJob?.status === "active"
                  ? "Syncing…"
                  : plannerSyncJob?.status === "pending"
                  ? "Queued…"
                  : "Sync to Planner"}
              </Button>
            )}
            <Button variant="outline" onClick={() => setIsConfiguring(true)}>
              <Settings className="w-4 h-4 mr-2" />
              Reconfigure
            </Button>
            <Dialog open={isAddTaskOpen} onOpenChange={setIsAddTaskOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-task">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Task
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Marketing Task</DialogTitle>
                  <DialogDescription>Create a new task for this marketing plan.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <label className="text-sm font-medium">Title</label>
                    <Input
                      value={taskForm.title}
                      onChange={(e) => setTaskForm(prev => ({ ...prev, title: e.target.value }))}
                      placeholder="Task title"
                      data-testid="input-task-title"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Description</label>
                    <Textarea
                      value={taskForm.description}
                      onChange={(e) => setTaskForm(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Task description (optional)"
                      data-testid="input-task-description"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">Activity Group</label>
                      <Select value={taskForm.activityGroup} onValueChange={(v) => setTaskForm(prev => ({ ...prev, activityGroup: v }))}>
                        <SelectTrigger data-testid="select-task-category">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ACTIVITY_CATEGORIES.filter(cat => selectedCategories.includes(cat.value) || cat.value === "other").map(cat => (
                            <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Priority</label>
                      <Select value={taskForm.priority} onValueChange={(v) => setTaskForm(prev => ({ ...prev, priority: v }))}>
                        <SelectTrigger data-testid="select-task-priority">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRIORITY_OPTIONS.map(p => (
                            <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">Time Period</label>
                      <Select value={taskForm.timeframe} onValueChange={(v) => setTaskForm(prev => ({ ...prev, timeframe: v }))}>
                        <SelectTrigger data-testid="select-task-period">
                          <SelectValue placeholder="Select period" />
                        </SelectTrigger>
                        <SelectContent>
                          {availablePeriods.filter(p => selectedPeriods.includes(p.value)).map(p => (
                            <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Due Date (optional)</label>
                      <Input
                        type="date"
                        value={taskForm.dueDate}
                        onChange={(e) => setTaskForm(prev => ({ ...prev, dueDate: e.target.value }))}
                        data-testid="input-task-due-date"
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddTaskOpen(false)}>Cancel</Button>
                  <Button 
                    onClick={() => createTask.mutate(taskForm)} 
                    disabled={!taskForm.title.trim() || createTask.isPending}
                    data-testid="button-create-task"
                  >
                    {createTask.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Create Task
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Edit Task Dialog */}
            <Dialog open={!!editingTask} onOpenChange={(open) => !open && setEditingTask(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit Task</DialogTitle>
                  <DialogDescription>Update the task details, reschedule, or reprioritize.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <label className="text-sm font-medium">Title</label>
                    <Input
                      value={editForm.title}
                      onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                      placeholder="Task title"
                      data-testid="input-edit-task-title"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Description</label>
                    <Textarea
                      value={editForm.description}
                      onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Task description (optional)"
                      data-testid="input-edit-task-description"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">Activity Group</label>
                      <Select value={editForm.activityGroup} onValueChange={(v) => setEditForm(prev => ({ ...prev, activityGroup: v }))}>
                        <SelectTrigger data-testid="select-edit-task-category">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ACTIVITY_CATEGORIES.map(cat => (
                            <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Priority</label>
                      <Select value={editForm.priority} onValueChange={(v) => setEditForm(prev => ({ ...prev, priority: v }))}>
                        <SelectTrigger data-testid="select-edit-task-priority">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRIORITY_OPTIONS.map(p => (
                            <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">Time Period</label>
                      <Select value={editForm.timeframe} onValueChange={(v) => setEditForm(prev => ({ ...prev, timeframe: v }))}>
                        <SelectTrigger data-testid="select-edit-task-period">
                          <SelectValue placeholder="Select period" />
                        </SelectTrigger>
                        <SelectContent>
                          {QUARTER_OPTIONS.map(p => (
                            <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Due Date (optional)</label>
                      <Input
                        type="date"
                        value={editForm.dueDate}
                        onChange={(e) => setEditForm(prev => ({ ...prev, dueDate: e.target.value }))}
                        data-testid="input-edit-task-due-date"
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setEditingTask(null)}>Cancel</Button>
                  <Button 
                    onClick={() => editingTask && updateTask.mutate({ taskId: editingTask.id, data: editForm })} 
                    disabled={!editForm.title.trim() || updateTask.isPending}
                    data-testid="button-update-task"
                  >
                    {updateTask.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Update Task
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {plan.description && (
          <Card>
            <CardContent className="pt-4">
              <p className="text-muted-foreground">{plan.description}</p>
            </CardContent>
          </Card>
        )}

        {suggestedTasks.length > 0 && (
          <Card className="border-primary/40" data-testid="card-suggested-queue">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    Suggested Tasks
                    <Badge variant="secondary">{suggestedTasks.length}</Badge>
                  </CardTitle>
                  <CardDescription>
                    AI-generated suggestions awaiting your review. Only accepted tasks sync to Microsoft Planner.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={bulkUpdateStatus.isPending}
                    onClick={() => bulkUpdateStatus.mutate({
                      taskIds: selectedSuggestionIds.length > 0 ? selectedSuggestionIds : suggestedTasks.map(t => t.id),
                      status: "accepted",
                    })}
                    data-testid="button-bulk-accept"
                  >
                    <CheckCircle className="w-4 h-4 mr-1" />
                    Accept {selectedSuggestionIds.length > 0 ? `(${selectedSuggestionIds.length})` : "All"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={bulkUpdateStatus.isPending}
                    onClick={() => bulkUpdateStatus.mutate({
                      taskIds: selectedSuggestionIds.length > 0 ? selectedSuggestionIds : suggestedTasks.map(t => t.id),
                      status: "dismissed",
                    })}
                    data-testid="button-bulk-dismiss"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Dismiss {selectedSuggestionIds.length > 0 ? `(${selectedSuggestionIds.length})` : "All"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {suggestedTasks.map(task => (
                  <div
                    key={task.id}
                    className="flex items-start gap-3 p-3 rounded-lg border bg-card"
                    data-testid={`suggested-task-${task.id}`}
                  >
                    <Checkbox
                      className="mt-1"
                      checked={selectedSuggestionIds.includes(task.id)}
                      onCheckedChange={(checked) => {
                        setSelectedSuggestionIds(prev =>
                          checked ? [...prev, task.id] : prev.filter(x => x !== task.id)
                        );
                      }}
                      data-testid={`checkbox-suggestion-${task.id}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-medium">{task.title}</span>
                        {getPriorityBadge(task.priority)}
                        {task.timeframe && <Badge variant="outline">{task.timeframe.toUpperCase()}</Badge>}
                        <Badge variant="outline" className="text-xs">
                          {ACTIVITY_CATEGORIES.find(c => c.value === task.activityGroup)?.label || task.activityGroup}
                        </Badge>
                      </div>
                      {task.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2">{task.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1" data-testid={`text-why-suggested-${task.id}`}>
                        <Sparkles className="w-3 h-3 inline mr-1" />
                        Suggested by {task.sourceGenerationLabel || "AI task generation"}
                        {task.createdAt ? ` on ${new Date(task.createdAt).toLocaleDateString()}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-primary"
                        disabled={updateTaskStatus.isPending}
                        onClick={() => updateTaskStatus.mutate({ taskId: task.id, status: "accepted" })}
                        data-testid={`button-accept-task-${task.id}`}
                      >
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Accept
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-primary"
                        onClick={() => openEditDialog(task)}
                        data-testid={`button-edit-suggestion-${task.id}`}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        disabled={updateTaskStatus.isPending}
                        onClick={() => updateTaskStatus.mutate({ taskId: task.id, status: "dismissed" })}
                        data-testid={`button-dismiss-task-${task.id}`}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center border rounded-lg p-1">
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
              className="h-8 px-3"
              data-testid="button-view-list"
            >
              <List className="w-4 h-4 mr-1" />
              List
            </Button>
            <Button
              variant={viewMode === "matrix" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("matrix")}
              className="h-8 px-3"
              data-testid="button-view-matrix"
            >
              <LayoutGrid className="w-4 h-4 mr-1" />
              Matrix
            </Button>
          </div>
          {viewMode === "list" && (
            <>
              <Select value={filterTimeframe} onValueChange={setFilterTimeframe}>
                <SelectTrigger className="w-40" data-testid="select-filter-timeframe">
                  <SelectValue placeholder="Time Period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Periods</SelectItem>
                  {QUARTER_OPTIONS.map(q => (
                    <SelectItem key={q.value} value={q.value}>{q.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="w-52" data-testid="select-filter-category">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {ACTIVITY_CATEGORIES.filter(cat => selectedCategories.includes(cat.value)).map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterPriority} onValueChange={setFilterPriority}>
                <SelectTrigger className="w-36" data-testid="select-filter-priority">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priorities</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                  Clear filters
                </Button>
              )}
            </>
          )}
          <span className="text-sm text-muted-foreground ml-auto">
            {viewMode === "list" ? `${filteredTasks.length} of ${visibleTasks.length}` : visibleTasks.length} task{visibleTasks.length !== 1 ? "s" : ""}
          </span>
          {isGenerating && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating tasks...
            </div>
          )}
        </div>

        {tasksLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Tasks Yet</h3>
              <p className="text-muted-foreground mb-4">Start by adding your first marketing task or generate AI suggestions.</p>
              <div className="flex justify-center gap-2">
                <Button variant="outline" onClick={() => setIsAddTaskOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Task Manually
                </Button>
                <Button onClick={() => generateTasks.mutate({ deleteExisting: false })} disabled={generateTasks.isPending}>
                  {generateTasks.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  Generate AI Suggestions
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : viewMode === "matrix" ? (
          <TooltipProvider>
            <Card>
              <CardContent className="p-0">
                <ScrollArea className="w-full">
                  <div className="min-w-[900px]">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="w-48 font-semibold sticky left-0 bg-muted/50 z-10">Activity</TableHead>
                          {matrixColumns.map(q => (
                            <TableHead key={q.value} className="text-center min-w-[140px] font-semibold">
                              {q.label}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {matrixData.map(({ category, tasks: rowTasks }) => (
                          <TableRow key={category.value} className="hover:bg-muted/30">
                            <TableCell className="font-medium text-sm sticky left-0 bg-background z-10 border-r">
                              {category.label}
                            </TableCell>
                            {matrixColumns.map(q => {
                              const cellTasks = rowTasks[q.value] || [];
                              return (
                                <TableCell key={q.value} className="p-2 align-top">
                                  <div className="space-y-1 min-h-[40px]">
                                    {cellTasks.length === 0 ? (
                                      <div className="text-xs text-muted-foreground/50 text-center py-2">-</div>
                                    ) : (
                                      cellTasks.map(task => (
                                        <Tooltip key={task.id}>
                                          <TooltipTrigger asChild>
                                            <div
                                              className={`text-xs px-2 py-1.5 rounded border cursor-pointer truncate ${getMatrixPriorityColor(task.priority)} ${task.status === "completed" ? "line-through opacity-60" : ""}`}
                                              onClick={() => setSelectedTask(task)}
                                              data-testid={`matrix-task-${task.id}`}
                                            >
                                              {task.title}
                                            </div>
                                          </TooltipTrigger>
                                          <TooltipContent side="top" className="max-w-xs">
                                            <div className="space-y-1">
                                              <p className="font-medium">{task.title}</p>
                                              {task.description && (
                                                <p className="text-xs text-muted-foreground">{task.description}</p>
                                              )}
                                              <div className="flex gap-2 text-xs">
                                                <span>Priority: {task.priority}</span>
                                                <span>Status: {task.status}</span>
                                              </div>
                                            </div>
                                          </TooltipContent>
                                        </Tooltip>
                                      ))
                                    )}
                                  </div>
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Task Detail Dialog for Matrix View */}
            <Dialog open={!!selectedTask} onOpenChange={(open) => !open && setSelectedTask(null)}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    {selectedTask?.title}
                    {selectedTask && getPriorityBadge(selectedTask.priority)}
                  </DialogTitle>
                  {selectedTask?.description && (
                    <DialogDescription>{selectedTask.description}</DialogDescription>
                  )}
                </DialogHeader>
                {selectedTask && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Category:</span>
                        <p className="font-medium">{ACTIVITY_CATEGORIES.find(c => c.value === selectedTask.activityGroup)?.label}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Time Period:</span>
                        <p className="font-medium">{QUARTER_OPTIONS.find(q => q.value === selectedTask.timeframe)?.label || "Not set"}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Status:</span>
                        <div className="mt-1">
                          <Select 
                            value={selectedTask.status} 
                            onValueChange={(status) => {
                              updateTaskStatus.mutate({ taskId: selectedTask.id, status });
                              setSelectedTask({ ...selectedTask, status });
                            }}
                          >
                            <SelectTrigger className="w-full h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map(s => (
                                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {selectedTask.dueDate && (
                        <div>
                          <span className="text-muted-foreground">Due Date:</span>
                          <p className="font-medium">{new Date(selectedTask.dueDate).toLocaleDateString()}</p>
                        </div>
                      )}
                      {selectedTask.plannerTaskId && plannerStatus?.taskDeepLinkTemplate && (
                        <div className="col-span-2">
                          <a
                            href={plannerStatus.taskDeepLinkTemplate.replace(
                              "{taskId}",
                              encodeURIComponent(selectedTask.plannerTaskId),
                            )}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-xs underline text-primary"
                            data-testid={`link-open-task-in-planner-${selectedTask.id}`}
                          >
                            Open in Microsoft Planner ↗
                          </a>
                        </div>
                      )}
                    </div>
                    <div className="flex justify-between pt-4 border-t">
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => {
                            openEditDialog(selectedTask);
                            setSelectedTask(null);
                          }}
                          data-testid="button-edit-task-matrix"
                        >
                          <Edit2 className="w-4 h-4 mr-2" />
                          Edit Task
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm">
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Task?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete "{selectedTask.title}". This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => {
                                  deleteTask.mutate(selectedTask.id);
                                  setSelectedTask(null);
                                }}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                        </AlertDialog>
                      </div>
                      <Button variant="outline" onClick={() => setSelectedTask(null)}>Close</Button>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TooltipProvider>
        ) : Object.keys(groupedTasks).length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Tasks Match Filters</h3>
              <p className="text-muted-foreground mb-4">Try adjusting your filters or add new tasks.</p>
              <Button variant="ghost" onClick={clearFilters}>Clear Filters</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedTasks).map(([category, { label, tasks: categoryTasks }]) => (
              <Card key={category}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    {label}
                    <Badge variant="secondary">{categoryTasks.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {categoryTasks.map(task => (
                      <div 
                        key={task.id} 
                        className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                        data-testid={`task-item-${task.id}`}
                      >
                        <GripVertical className="w-4 h-4 text-muted-foreground mt-1 cursor-grab" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{task.title}</span>
                            {getPriorityBadge(task.priority)}
                            {task.timeframe && (
                              <Badge variant="outline">{task.timeframe.toUpperCase()}</Badge>
                            )}
                          </div>
                          {task.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2">{task.description}</p>
                          )}
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                            {task.dueDate && (
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {new Date(task.dueDate).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Select 
                            value={task.status} 
                            onValueChange={(status) => updateTaskStatus.mutate({ taskId: task.id, status })}
                          >
                            <SelectTrigger className="w-36 h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map(s => (
                                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                            onClick={() => openEditDialog(task)}
                            data-testid={`button-edit-task-${task.id}`}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Task?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete "{task.title}". This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteTask.mutate(task.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={vegaExportOpen} onOpenChange={(open) => !vegaExporting && setVegaExportOpen(open)}>
        <DialogContent data-testid="dialog-vega-export">
          <DialogHeader>
            <DialogTitle>Export for Vega Launchpad</DialogTitle>
            <DialogDescription>
              Vega Launchpad consumes a Big-Rocks + OKRs bundle (schema {`vega-export/2.0`}) so it can render this plan as
              an executable strategy. The bundle includes the plan metadata, quarterly objectives derived from your
              tasks, one Big Rock per quarter and activity-category cluster, and any GTM plan or messaging framework
              context that has been generated for this company.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm py-2">
            <div className="rounded-md border p-3">
              <p className="font-medium">JSON only</p>
              <p className="text-muted-foreground text-xs mt-1">
                A single <code>plan.json</code> file. Best for programmatic ingestion into Vega Launchpad or another
                tool.
              </p>
            </div>
            <div className="rounded-md border p-3">
              <p className="font-medium">JSON + Markdown (zip)</p>
              <p className="text-muted-foreground text-xs mt-1">
                A zip containing <code>plan.json</code> and a human-readable <code>plan.md</code> runbook. Choose this
                if you also want a printable summary.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => exportVega("json")}
              disabled={vegaExporting}
              data-testid="button-vega-export-json"
            >
              {vegaExporting ? "Preparing…" : "Download JSON"}
            </Button>
            <Button
              onClick={() => exportVega("zip")}
              disabled={vegaExporting}
              data-testid="button-vega-export-zip"
            >
              {vegaExporting ? "Preparing…" : "Download JSON + Markdown (.zip)"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={vegaCredsOpen} onOpenChange={(open) => !vegaCredsSaving && setVegaCredsOpen(open)}>
        <DialogContent data-testid="dialog-vega-credentials">
          <DialogHeader>
            <DialogTitle>Connect Vega Launchpad</DialogTitle>
            <DialogDescription>
              Enter the Vega Launchpad API base URL and an API key. Orbit will verify the credentials by hitting
              {" "}
              <code>/api/v1/health</code> before saving them. Domain Admins can update or remove these any time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">API Base URL</label>
              <Input
                placeholder="https://launchpad.vega.example.com"
                value={vegaCredsForm.url}
                onChange={(e) => setVegaCredsForm((p) => ({ ...p, url: e.target.value }))}
                data-testid="input-vega-url"
              />
            </div>
            <div>
              <label className="text-sm font-medium">API Key</label>
              <Input
                type="password"
                placeholder="vega_pk_..."
                value={vegaCredsForm.apiKey}
                onChange={(e) => setVegaCredsForm((p) => ({ ...p, apiKey: e.target.value }))}
                data-testid="input-vega-api-key"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Workspace ID (optional)</label>
              <Input
                placeholder="ws_..."
                value={vegaCredsForm.workspaceId}
                onChange={(e) => setVegaCredsForm((p) => ({ ...p, workspaceId: e.target.value }))}
                data-testid="input-vega-workspace"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVegaCredsOpen(false)} disabled={vegaCredsSaving}>
              Cancel
            </Button>
            <Button
              onClick={() => saveVegaCreds()}
              disabled={
                vegaCredsSaving ||
                !vegaCredsForm.url.trim() ||
                vegaCredsForm.apiKey.trim().length < 8
              }
              data-testid="button-vega-save-credentials"
            >
              {vegaCredsSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save & Verify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
