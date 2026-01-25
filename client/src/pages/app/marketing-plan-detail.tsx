import { useState, useEffect } from "react";
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
import { ArrowLeft, ArrowRight, Plus, Trash2, Calendar, CheckCircle, Clock, AlertCircle, Loader2, GripVertical, Sparkles, Settings, ListChecks, LayoutGrid, List, X, Edit2, FileDown } from "lucide-react";
import { exportToCSV, type CSVExportItem } from "@/lib/csv-export";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

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
}

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
    mutationFn: async () => {
      const response = await fetch(`/api/marketing-plans/${id}/generate-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          categories: selectedCategories,
          periods: selectedPeriods,
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

  const filteredTasks = tasks.filter(task => {
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
      row[q.value] = tasks.filter(t => t.activityGroup === cat.value && t.timeframe === q.value);
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

  if (planLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!plan) {
    return (
      <AppLayout>
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold mb-2">Plan Not Found</h2>
          <p className="text-muted-foreground mb-4">The marketing plan you're looking for doesn't exist.</p>
          <Button onClick={() => navigate("/app/marketing-planner")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Plans
          </Button>
        </div>
      </AppLayout>
    );
  }

  if (!isConfigured && !isConfiguring) {
    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/app/marketing-planner")}>
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
      <AppLayout>
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
                    <Button 
                      onClick={() => {
                        setIsGenerating(true);
                        saveConfig.mutate();
                        generateTasks.mutate();
                      }} 
                      disabled={selectedPeriods.length === 0 || saveConfig.isPending || generateTasks.isPending}
                      data-testid="button-generate-tasks"
                    >
                      {(saveConfig.isPending || generateTasks.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      <Sparkles className="w-4 h-4 mr-2" />
                      Generate AI Suggestions
                    </Button>
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
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/app/marketing-planner")}>
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
                const csvItems: CSVExportItem[] = tasks.map(task => ({
                  title: task.title,
                  description: task.description || "",
                  category: categoryLookup[task.activityGroup] || task.activityGroup,
                }));
                exportToCSV(csvItems, `${plan.name}_marketing_plan`);
                toast({ title: "Exported", description: `${tasks.length} tasks exported to CSV.` });
              }}
              disabled={tasks.length === 0}
              data-testid="button-export-csv"
            >
              <FileDown className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
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
            {viewMode === "list" ? `${filteredTasks.length} of ${tasks.length}` : tasks.length} task{tasks.length !== 1 ? "s" : ""}
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
                <Button onClick={() => generateTasks.mutate()} disabled={generateTasks.isPending}>
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
    </AppLayout>
  );
}
