import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import AppLayout from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2, Calendar, CheckCircle, Clock, AlertCircle, Loader2, GripVertical } from "lucide-react";

const ACTIVITY_CATEGORIES = [
  { value: "events", label: "Events & Trade Shows" },
  { value: "digital_marketing", label: "Digital Marketing" },
  { value: "outbound_campaigns", label: "Outbound Campaigns" },
  { value: "content_marketing", label: "Content Marketing" },
  { value: "social_media", label: "Social Media" },
  { value: "email_marketing", label: "Email Marketing" },
  { value: "seo_sem", label: "SEO/SEM" },
  { value: "pr_comms", label: "PR & Communications" },
  { value: "analyst_relations", label: "Analyst Relations" },
  { value: "partner_marketing", label: "Partner Marketing" },
  { value: "customer_marketing", label: "Customer Marketing" },
  { value: "product_marketing", label: "Product Marketing" },
  { value: "brand", label: "Brand" },
  { value: "website", label: "Website" },
  { value: "webinars", label: "Webinars" },
  { value: "podcasts", label: "Podcasts" },
  { value: "video", label: "Video" },
  { value: "research", label: "Research & Insights" },
  { value: "other", label: "Other" },
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
  category: string;
  priority: string;
  status: string;
  dueDate: string | null;
  createdAt: string;
}

interface MarketingPlan {
  id: string;
  name: string;
  description: string | null;
  fiscalYear: string;
  status: string;
  configMatrix: { timeframeSelection?: string } | null;
  createdAt: string;
}

export default function MarketingPlanDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [isAddTaskOpen, setIsAddTaskOpen] = useState(false);
  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    category: "other",
    priority: "medium",
    dueDate: "",
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

  const createTask = useMutation({
    mutationFn: async (data: typeof taskForm) => {
      const response = await fetch(`/api/marketing-plans/${id}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...data,
          dueDate: data.dueDate || null,
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
      setTaskForm({ title: "", description: "", category: "other", priority: "medium", dueDate: "" });
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

  const filteredTasks = filterCategory === "all" 
    ? tasks 
    : tasks.filter(t => t.category === filterCategory);

  const groupedTasks = ACTIVITY_CATEGORIES.reduce((acc, cat) => {
    const categoryTasks = filteredTasks.filter(t => t.category === cat.value);
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
                {plan.fiscalYear} {plan.configMatrix?.timeframeSelection && `• ${plan.configMatrix.timeframeSelection}`}
              </p>
            </div>
          </div>
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
                    <label className="text-sm font-medium">Category</label>
                    <Select value={taskForm.category} onValueChange={(v) => setTaskForm(prev => ({ ...prev, category: v }))}>
                      <SelectTrigger data-testid="select-task-category">
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
              {ACTIVITY_CATEGORIES.map(cat => (
                <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {filteredTasks.length} task{filteredTasks.length !== 1 ? "s" : ""}
          </span>
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
              <p className="text-muted-foreground mb-4">Start by adding your first marketing task to this plan.</p>
              <Button onClick={() => setIsAddTaskOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add First Task
              </Button>
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
