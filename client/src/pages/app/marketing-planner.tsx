import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, MoreHorizontal, Gem, Edit2, Loader2, Trash2, Calendar, CheckCircle, Clock, Archive, FileText, Sparkles } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface MarketingPlan {
  id: string;
  name: string;
  fiscalYear: string;
  description: string | null;
  configMatrix: any;
  status: string;
  createdBy: string;
  tenantDomain: string;
  marketId: string | null;
  createdAt: string;
  updatedAt: string;
  tasks?: MarketingTask[];
}

interface MarketingTask {
  id: string;
  planId: string;
  title: string;
  description: string | null;
  activityGroup: string;
  timeframe: string;
  priority: string;
  status: string;
  aiGenerated: boolean;
  sourceRecommendationId: string | null;
  assignedTo: string | null;
  dueDate: string | null;
  createdAt: string;
}

const QUARTER_OPTIONS = [
  { value: "steady_state", label: "Steady State", description: "Ongoing activities throughout the year" },
  { value: "Q1", label: "Q1", description: "January - March" },
  { value: "Q2", label: "Q2", description: "April - June" },
  { value: "Q3", label: "Q3", description: "July - September" },
  { value: "Q4", label: "Q4", description: "October - December" },
];

function formatSelectedQuarters(quarters: string[]): string {
  if (quarters.length === 0) return "No periods selected";
  if (quarters.length === 5) return "All periods";
  
  const sorted = [...quarters].sort((a, b) => {
    const order = ["steady_state", "Q1", "Q2", "Q3", "Q4"];
    return order.indexOf(a) - order.indexOf(b);
  });
  
  return sorted.map(q => q === "steady_state" ? "Steady State" : q).join(", ");
}

const ACTIVITY_CATEGORIES = [
  "Market Research",
  "Messaging & Positioning",
  "Pricing & Packaging",
  "Content & Thought Leadership",
  "Digital & Web",
  "Email & Nurture",
  "Social Media",
  "Events & Conferences",
  "Partner & Channel",
  "Sales Enablement",
  "Demand Generation",
  "Brand & Advertising",
  "Customer Marketing",
  "Analyst & PR",
];

const currentYear = new Date().getFullYear();
const FISCAL_YEARS = [
  String(currentYear),
  String(currentYear + 1),
  String(currentYear + 2),
];

function getStatusBadge(status: string) {
  switch (status) {
    case "draft":
      return <Badge variant="secondary" data-testid="badge-status-draft"><Clock className="w-3 h-3 mr-1" />Draft</Badge>;
    case "active":
      return <Badge className="bg-green-600" data-testid="badge-status-active"><CheckCircle className="w-3 h-3 mr-1" />Active</Badge>;
    case "archived":
      return <Badge variant="outline" data-testid="badge-status-archived"><Archive className="w-3 h-3 mr-1" />Archived</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export default function MarketingPlanner() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    fiscalYear: String(currentYear),
    description: "",
    selectedQuarters: ["steady_state", "Q1", "Q2", "Q3", "Q4"] as string[],
  });

  const toggleQuarter = (quarter: string) => {
    setFormData(prev => ({
      ...prev,
      selectedQuarters: prev.selectedQuarters.includes(quarter)
        ? prev.selectedQuarters.filter(q => q !== quarter)
        : [...prev.selectedQuarters, quarter],
    }));
  };

  const { data: tenantSettings } = useQuery<{ plan: string }>({
    queryKey: ["/api/tenant/settings"],
    queryFn: async () => {
      const response = await fetch("/api/tenant/settings", { credentials: "include" });
      if (!response.ok) return { plan: "free" };
      return response.json();
    },
  });

  const isEnterprise = tenantSettings?.plan === "enterprise" || tenantSettings?.plan === "unlimited";

  const { data: plans = [], isLoading, error } = useQuery<MarketingPlan[]>({
    queryKey: ["/api/marketing-plans"],
    queryFn: async () => {
      const response = await fetch("/api/marketing-plans", {
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to fetch marketing plans");
      }
      return response.json();
    },
    enabled: isEnterprise,
    retry: false,
  });

  const createPlan = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await fetch("/api/marketing-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          fiscalYear: data.fiscalYear,
          description: data.description || null,
          configMatrix: {
            selectedQuarters: data.selectedQuarters,
            quarters: data.selectedQuarters,
            categories: {},
          },
        }),
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to create marketing plan");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing-plans"] });
      setIsDialogOpen(false);
      setFormData({ name: "", fiscalYear: String(currentYear), description: "", selectedQuarters: ["steady_state", "Q1", "Q2", "Q3", "Q4"] });
      toast({
        title: "Plan Created",
        description: "Your marketing plan has been created.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deletePlan = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/marketing-plans/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to delete plan");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing-plans"] });
      toast({
        title: "Plan Deleted",
        description: "The marketing plan has been deleted.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updatePlanStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const response = await fetch(`/api/marketing-plans/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to update plan status");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing-plans"] });
      toast({
        title: "Status Updated",
        description: "The plan status has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (!isEnterprise) {
    return (
      <AppLayout>
        <div className="p-6 max-w-7xl mx-auto">
          <div className="flex items-center justify-center min-h-[60vh]">
            <Card className="max-w-md text-center">
              <CardHeader>
                <div className="mx-auto mb-4 p-4 bg-primary/10 rounded-full w-fit">
                  <Gem className="w-12 h-12 text-primary" />
                </div>
                <CardTitle className="text-2xl">Marketing Planner</CardTitle>
                <CardDescription className="text-base">
                  Generate AI-powered marketing plans based on your competitive intelligence and strategic documents.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">
                  This feature is available on the Enterprise plan. Upgrade to unlock:
                </p>
                <ul className="text-sm text-left space-y-2 text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    AI-generated marketing task plans
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    Quarterly, half-year, or annual planning
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    14 activity categories with priorities
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    Tasks linked to competitive insights
                  </li>
                </ul>
                <Button className="w-full" asChild>
                  <a href="mailto:contactus@synozur.com?subject=Enterprise%20Plan%20Inquiry">
                    Contact Sales
                  </a>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="page-title">
              <Gem className="w-6 h-6 text-primary" />
              Marketing Planner
            </h1>
            <p className="text-muted-foreground mt-1">
              Generate AI-powered marketing plans based on your competitive intelligence
            </p>
          </div>

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-plan">
                <Plus className="w-4 h-4 mr-2" />
                New Plan
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Create Marketing Plan</DialogTitle>
                <DialogDescription>
                  Set up a new marketing plan. You'll configure activity priorities after creation.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); createPlan.mutate(formData); }}>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Plan Name</Label>
                    <Input
                      id="name"
                      placeholder="e.g., 2026 Go-to-Market Plan"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                      data-testid="input-plan-name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="fiscalYear">Fiscal Year</Label>
                    <Select
                      value={formData.fiscalYear}
                      onValueChange={(value) => setFormData({ ...formData, fiscalYear: value })}
                    >
                      <SelectTrigger data-testid="select-fiscal-year">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FISCAL_YEARS.map((year) => (
                          <SelectItem key={year} value={year}>{year}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-3">
                    <Label>Planning Periods</Label>
                    <p className="text-xs text-muted-foreground">Select which periods this plan covers. Tasks will be generated for selected periods.</p>
                    <div className="space-y-2">
                      {QUARTER_OPTIONS.map((option) => (
                        <div key={option.value} className="flex items-center space-x-3">
                          <Checkbox
                            id={`quarter-${option.value}`}
                            checked={formData.selectedQuarters.includes(option.value)}
                            onCheckedChange={() => toggleQuarter(option.value)}
                            data-testid={`checkbox-quarter-${option.value}`}
                          />
                          <div className="flex-1">
                            <label
                              htmlFor={`quarter-${option.value}`}
                              className="text-sm font-medium cursor-pointer"
                            >
                              {option.label}
                            </label>
                            <p className="text-xs text-muted-foreground">{option.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    {formData.selectedQuarters.length === 0 && (
                      <p className="text-xs text-destructive">Please select at least one period</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description (Optional)</Label>
                    <Textarea
                      id="description"
                      placeholder="Brief description of this marketing plan..."
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      rows={3}
                      data-testid="input-plan-description"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createPlan.isPending || !formData.name || formData.selectedQuarters.length === 0}>
                    {createPlan.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      "Create Plan"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-destructive">{(error as Error).message}</p>
            </CardContent>
          </Card>
        ) : plans.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Gem className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
              <h3 className="text-lg font-medium mb-2">No Marketing Plans Yet</h3>
              <p className="text-muted-foreground mb-4">
                Create your first marketing plan to generate AI-powered tasks based on your competitive intelligence.
              </p>
              <Button onClick={() => setIsDialogOpen(true)} data-testid="button-create-first-plan">
                <Plus className="w-4 h-4 mr-2" />
                Create Your First Plan
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => (
              <Card key={plan.id} className="hover:border-primary/50 transition-colors" data-testid={`card-plan-${plan.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-lg">{plan.name}</CardTitle>
                      <CardDescription className="flex items-center gap-2">
                        <Calendar className="w-3 h-3" />
                        {plan.fiscalYear}
                        {plan.configMatrix?.selectedQuarters && (
                          <span className="text-xs">
                            ({formatSelectedQuarters(plan.configMatrix.selectedQuarters)})
                          </span>
                        )}
                      </CardDescription>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-plan-menu-${plan.id}`}>
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => updatePlanStatus.mutate({ id: plan.id, status: "active" })}>
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Set Active
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => updatePlanStatus.mutate({ id: plan.id, status: "archived" })}>
                          <Archive className="w-4 h-4 mr-2" />
                          Archive
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Marketing Plan?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete "{plan.name}" and all its tasks. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deletePlan.mutate(plan.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {plan.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{plan.description}</p>
                    )}
                    <div className="flex items-center justify-between">
                      {getStatusBadge(plan.status)}
                      <span className="text-xs text-muted-foreground">
                        Created {new Date(plan.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="pt-2 border-t">
                      <Button variant="outline" className="w-full" asChild>
                        <a href={`/app/marketing-planner/${plan.id}`}>
                          <Sparkles className="w-4 h-4 mr-2" />
                          Configure & Generate
                        </a>
                      </Button>
                    </div>
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
