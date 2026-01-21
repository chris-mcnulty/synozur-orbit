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
import { ArrowLeft, ArrowRight, Plus, Trash2, Calendar, CheckCircle, Clock, AlertCircle, Loader2, GripVertical, Sparkles, Settings, ListChecks } from "lucide-react";

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

const TIMEFRAME_PERIODS: Record<string, { value: string; label: string }[]> = {
  quarterly: [
    { value: "q1", label: "Q1" },
    { value: "q2", label: "Q2" },
    { value: "q3", label: "Q3" },
    { value: "q4", label: "Q4" },
  ],
  half_year: [
    { value: "h1", label: "H1 (First Half)" },
    { value: "h2", label: "H2 (Second Half)" },
  ],
  annual: [
    { value: "annual", label: "Full Year" },
  ],
};

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
    timeframeSelection?: string;
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
    priority: "Medium",
    dueDate: "",
    timeframe: "",
  });
  const [filterCategory, setFilterCategory] = useState<string>("all");

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

  const timeframeType = plan?.configMatrix?.timeframeSelection || "annual";
  const availablePeriods = TIMEFRAME_PERIODS[timeframeType] || TIMEFRAME_PERIODS.annual;
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
      setTaskForm({ title: "", description: "", activityGroup: "other", priority: "Medium", dueDate: "", timeframe: "" });
      toast({ title: "Task Created", description: "Your task has been added to the plan." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateTaskStatus = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: string }) => {
      const response = await fetch(`/api/marketing-tasks/${taskId}`, {
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
      const response = await fetch(`/api/marketing-tasks/${taskId}`, {
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

  const filteredTasks = filterCategory === "all" 
    ? tasks 
    : tasks.filter(t => t.activityGroup === filterCategory);

  const groupedTasks = ACTIVITY_CATEGORIES.reduce((acc, cat) => {
    const categoryTasks = filteredTasks.filter(t => t.activityGroup === cat.value);
    if (categoryTasks.length > 0) {
      acc[cat.value] = { label: cat.label, tasks: categoryTasks };
    }
    return acc;
  }, {} as Record<string, { label: string; tasks: MarketingTask[] }>);

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
                {plan.fiscalYear} • {timeframeType === "quarterly" ? "Quarterly" : timeframeType === "half_year" ? "Half-Year" : "Annual"} Plan
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
                  Choose which {timeframeType === "quarterly" ? "quarters" : timeframeType === "half_year" ? "half-years" : "period"} to plan for in {plan.fiscalYear}.
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
          </div>
        </div>

        {plan.description && (
          <Card>
            <CardContent className="pt-4">
              <p className="text-muted-foreground">{plan.description}</p>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center gap-4">
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-64" data-testid="select-filter-category">
              <SelectValue placeholder="Filter by category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {ACTIVITY_CATEGORIES.filter(cat => selectedCategories.includes(cat.value)).map(cat => (
                <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {filteredTasks.length} task{filteredTasks.length !== 1 ? "s" : ""}
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
        ) : Object.keys(groupedTasks).length === 0 ? (
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
