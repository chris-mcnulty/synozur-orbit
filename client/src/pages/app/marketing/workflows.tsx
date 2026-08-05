import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Play,
  Pause,
  Trash2,
  ChevronRight,
  Users,
  Zap,
  Clock,
  GitBranch,
  Mail,
  Bell,
  Settings2,
  CheckCircle2,
  XCircle,
  Loader2,
  ListTree,
  Sparkles,
  BarChart2,
  MousePointerClick,
  Eye,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Workflow {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused";
  triggerJson: any;
  reEnrollPolicy: string;
  reEnrollDays: number | null;
  createdAt: string;
  updatedAt: string;
  activeEnrollments: number;
  totalEnrollments: number;
  stepCount: number;
}

interface WorkflowStep {
  id: string;
  workflowId: string;
  stepType: string;
  configJson: any;
  stepOrder: number;
  nextStepId: string | null;
  branchNoStepId: string | null;
}

interface Enrollment {
  id: string;
  contactId: string;
  status: string;
  enrolledAt: string;
  completedAt: string | null;
  exitedAt: string | null;
  contact: { id: string; firstName: string | null; lastName: string | null; email: string } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  active: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  paused: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
};

const ENROLLMENT_STATUS_COLORS: Record<string, string> = {
  active: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  completed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  exited: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  paused: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
};

const STEP_ICONS: Record<string, React.ReactNode> = {
  send_email: <Mail className="w-4 h-4" />,
  wait: <Clock className="w-4 h-4" />,
  branch: <GitBranch className="w-4 h-4" />,
  set_property: <Settings2 className="w-4 h-4" />,
  create_task: <CheckCircle2 className="w-4 h-4" />,
  notify: <Bell className="w-4 h-4" />,
};

const STEP_LABELS: Record<string, string> = {
  send_email: "Send Email",
  wait: "Wait / Delay",
  branch: "If / Then Branch",
  set_property: "Set Contact Property",
  create_task: "Create Planner Task",
  notify: "Send Notification",
};

function triggerLabel(trigger: any): string {
  if (!trigger) return "Manual";
  if (trigger.type === "segment_membership") return `Segment: ${trigger.segmentId ?? "—"}`;
  if (trigger.type === "contact_event") return `Event: ${trigger.eventType ?? "any"}`;
  if (trigger.type === "lead_score_threshold") return `Lead Score ${trigger.direction} ${trigger.threshold}`;
  return "Manual";
}

function stepSummary(step: WorkflowStep): string {
  const cfg = step.configJson ?? {};
  if (step.stepType === "wait") return `Wait ${cfg.amount ?? 1} ${cfg.unit ?? "days"}`;
  if (step.stepType === "send_email") return cfg.generatedEmailId ? `Email #${cfg.generatedEmailId.slice(0, 8)}` : "Email (unconfigured)";
  if (step.stepType === "branch") return cfg.condition?.field ? `If ${cfg.condition.field} ${cfg.condition.op} "${cfg.condition.value}"` : "Branch (unconfigured)";
  if (step.stepType === "set_property") return cfg.field ? `Set ${cfg.field} = "${cfg.value}"` : "Set Property";
  if (step.stepType === "create_task") return cfg.title ? `Task: ${cfg.title}` : "Create Task";
  if (step.stepType === "notify") return cfg.message ? cfg.message.slice(0, 50) : "Notification";
  return step.stepType;
}

// ─── Branch path helpers ──────────────────────────────────────────────────────

/** Short label for a step used in the branch summary line. */
function stepShortLabel(step: WorkflowStep): string {
  return `Step ${step.stepOrder + 1} (${STEP_LABELS[step.stepType] ?? step.stepType})`;
}

/** Summary line shown below a branch step card. */
function BranchPathSummary({ step, steps }: { step: WorkflowStep; steps: WorkflowStep[] }) {
  const yesStep = step.nextStepId ? steps.find((s) => s.id === step.nextStepId) : null;
  const noStep = step.branchNoStepId ? steps.find((s) => s.id === step.branchNoStepId) : null;

  if (!yesStep && !noStep) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <span className="inline-flex items-center justify-center rounded px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 font-semibold text-[10px] leading-none">
          Yes →
        </span>
        {yesStep ? stepShortLabel(yesStep) : <span className="italic">not set</span>}
      </span>
      <span className="text-border">·</span>
      <span className="flex items-center gap-1">
        <span className="inline-flex items-center justify-center rounded px-1.5 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-semibold text-[10px] leading-none">
          No →
        </span>
        {noStep ? stepShortLabel(noStep) : <span className="italic">not set</span>}
      </span>
    </div>
  );
}

// ─── Step Config Editor ───────────────────────────────────────────────────────

function StepConfigEditor({
  stepType,
  config,
  onChange,
  steps,
  currentStepId,
  nextStepId,
  branchNoStepId,
  onNextStepIdChange,
  onBranchNoStepIdChange,
}: {
  stepType: string;
  config: any;
  onChange: (cfg: any) => void;
  steps?: WorkflowStep[];
  currentStepId?: string | null;
  nextStepId?: string | null;
  branchNoStepId?: string | null;
  onNextStepIdChange?: (id: string | null) => void;
  onBranchNoStepIdChange?: (id: string | null) => void;
}) {
  if (stepType === "wait") {
    return (
      <div className="flex gap-2">
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground">Amount</Label>
          <Input
            type="number"
            min={1}
            value={config.amount ?? 1}
            onChange={(e) => onChange({ ...config, amount: Number(e.target.value) })}
          />
        </div>
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground">Unit</Label>
          <Select value={config.unit ?? "days"} onValueChange={(v) => onChange({ ...config, unit: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="hours">Hours</SelectItem>
              <SelectItem value="days">Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  if (stepType === "send_email") {
    return (
      <div>
        <Label className="text-xs text-muted-foreground">Generated Email ID</Label>
        <Input
          placeholder="Paste a generated email ID…"
          value={config.generatedEmailId ?? ""}
          onChange={(e) => onChange({ ...config, generatedEmailId: e.target.value })}
        />
        <p className="text-xs text-muted-foreground mt-1">The email will be sent to the enrolled contact.</p>
      </div>
    );
  }

  if (stepType === "branch") {
    const cond = config.condition ?? {};
    const otherSteps = (steps ?? []).filter((s) => s.id !== currentStepId);
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">If condition is true → yes branch; otherwise → no branch.</p>
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">Field</Label>
            <Select value={cond.field ?? ""} onValueChange={(v) => onChange({ ...config, condition: { ...cond, field: v } })}>
              <SelectTrigger><SelectValue placeholder="Choose field" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lifecycleStage">Lifecycle Stage</SelectItem>
                <SelectItem value="company">Company</SelectItem>
                <SelectItem value="jobTitle">Job Title</SelectItem>
                <SelectItem value="country">Country</SelectItem>
                <SelectItem value="leadScore">Lead Score</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Op</Label>
            <Select value={cond.op ?? "eq"} onValueChange={(v) => onChange({ ...config, condition: { ...cond, op: v } })}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="eq">equals</SelectItem>
                <SelectItem value="neq">≠</SelectItem>
                <SelectItem value="contains">contains</SelectItem>
                <SelectItem value="gte">≥</SelectItem>
                <SelectItem value="lte">≤</SelectItem>
                <SelectItem value="is_null">is empty</SelectItem>
                <SelectItem value="is_not_null">is set</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">Value</Label>
            <Input
              placeholder="Value"
              value={cond.value ?? ""}
              onChange={(e) => onChange({ ...config, condition: { ...cond, value: e.target.value } })}
            />
          </div>
        </div>
        {otherSteps.length > 0 && (
          <div className="grid grid-cols-2 gap-2 border rounded-md p-3 bg-muted/40">
            <div>
              <Label className="text-xs font-semibold text-green-700 dark:text-green-400">Yes → go to</Label>
              <Select
                value={nextStepId ?? "__end__"}
                onValueChange={(v) => onNextStepIdChange?.(v === "__end__" ? null : v)}
              >
                <SelectTrigger className="mt-1"><SelectValue placeholder="End of workflow" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__end__">End of workflow</SelectItem>
                  {otherSteps.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      Step {s.stepOrder + 1} — {STEP_LABELS[s.stepType] ?? s.stepType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold text-red-700 dark:text-red-400">No → go to</Label>
              <Select
                value={branchNoStepId ?? "__end__"}
                onValueChange={(v) => onBranchNoStepIdChange?.(v === "__end__" ? null : v)}
              >
                <SelectTrigger className="mt-1"><SelectValue placeholder="End of workflow" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__end__">End of workflow</SelectItem>
                  {otherSteps.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      Step {s.stepOrder + 1} — {STEP_LABELS[s.stepType] ?? s.stepType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (stepType === "set_property") {
    return (
      <div className="flex gap-2">
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground">Field</Label>
          <Select value={config.field ?? ""} onValueChange={(v) => onChange({ ...config, field: v })}>
            <SelectTrigger><SelectValue placeholder="Choose field" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="lifecycleStage">Lifecycle Stage</SelectItem>
              <SelectItem value="company">Company</SelectItem>
              <SelectItem value="jobTitle">Job Title</SelectItem>
              <SelectItem value="country">Country</SelectItem>
              <SelectItem value="source">Source</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground">Value</Label>
          <Input
            placeholder="New value"
            value={config.value ?? ""}
            onChange={(e) => onChange({ ...config, value: e.target.value })}
          />
        </div>
      </div>
    );
  }

  if (stepType === "create_task") {
    return (
      <div className="space-y-2">
        <div>
          <Label className="text-xs text-muted-foreground">Task Title</Label>
          <Input
            placeholder="Follow up with {{contact.firstName}}"
            value={config.title ?? ""}
            onChange={(e) => onChange({ ...config, title: e.target.value })}
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Description (optional)</Label>
          <Textarea
            rows={2}
            value={config.description ?? ""}
            onChange={(e) => onChange({ ...config, description: e.target.value })}
          />
        </div>
      </div>
    );
  }

  if (stepType === "notify") {
    return (
      <div>
        <Label className="text-xs text-muted-foreground">Notification message</Label>
        <Textarea
          rows={2}
          placeholder="A contact completed your workflow…"
          value={config.message ?? ""}
          onChange={(e) => onChange({ ...config, message: e.target.value })}
        />
      </div>
    );
  }

  return <p className="text-xs text-muted-foreground">No configuration required for this step type.</p>;
}

// ─── Workflow Detail Panel ────────────────────────────────────────────────────

function WorkflowDetail({
  workflowId,
  onBack,
}: {
  workflowId: string;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addStepOpen, setAddStepOpen] = useState(false);
  const [editStep, setEditStep] = useState<WorkflowStep | null>(null);
  const [newStepType, setNewStepType] = useState("wait");
  const [newStepConfig, setNewStepConfig] = useState<any>({});
  const [editStepConfig, setEditStepConfig] = useState<any>({});
  const [editStepNextStepId, setEditStepNextStepId] = useState<string | null>(null);
  const [editStepBranchNoStepId, setEditStepBranchNoStepId] = useState<string | null>(null);
  const [enrollTab, setEnrollTab] = useState("active");
  const [manualEnrollOpen, setManualEnrollOpen] = useState(false);
  const [manualEnrollEmail, setManualEnrollEmail] = useState("");
  const [contactSearch, setContactSearch] = useState<any[]>([]);
  const [selectedContact, setSelectedContact] = useState<any | null>(null);

  const { data: wf, isLoading } = useQuery<Workflow & { steps: WorkflowStep[] }>({
    queryKey: ["/api/marketing-workflows", workflowId],
    queryFn: () => apiRequest("GET", `/api/marketing-workflows/${workflowId}`).then((r) => r.json()),
  });

  const { data: enrollmentsData } = useQuery<{ enrollments: Enrollment[]; total: number }>({
    queryKey: ["/api/marketing-workflows", workflowId, "enrollments", enrollTab],
    queryFn: () =>
      apiRequest("GET", `/api/marketing-workflows/${workflowId}/enrollments?status=${enrollTab}&limit=50`).then((r) => r.json()),
  });

  const activateMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/marketing-workflows/${workflowId}/activate`).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/marketing-workflows"] });
      qc.invalidateQueries({ queryKey: ["/api/marketing-workflows", workflowId] });
      toast({ title: "Workflow activated" });
    },
    onError: () => toast({ title: "Failed to activate", variant: "destructive" }),
  });

  const pauseMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/marketing-workflows/${workflowId}/pause`).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/marketing-workflows"] });
      qc.invalidateQueries({ queryKey: ["/api/marketing-workflows", workflowId] });
      toast({ title: "Workflow paused" });
    },
    onError: () => toast({ title: "Failed to pause", variant: "destructive" }),
  });

  const addStepMutation = useMutation({
    mutationFn: (data: { stepType: string; configJson: any }) =>
      apiRequest("POST", `/api/marketing-workflows/${workflowId}/steps`, data).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/marketing-workflows", workflowId] });
      setAddStepOpen(false);
      setNewStepType("wait");
      setNewStepConfig({});
      toast({ title: "Step added" });
    },
    onError: () => toast({ title: "Failed to add step", variant: "destructive" }),
  });

  const updateStepMutation = useMutation({
    mutationFn: (data: { stepId: string; configJson: any; stepType: string; nextStepId?: string | null; branchNoStepId?: string | null }) =>
      apiRequest("PATCH", `/api/marketing-workflows/${workflowId}/steps/${data.stepId}`, {
        configJson: data.configJson,
        stepType: data.stepType,
        nextStepId: data.nextStepId,
        branchNoStepId: data.branchNoStepId,
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/marketing-workflows", workflowId] });
      setEditStep(null);
      toast({ title: "Step updated" });
    },
    onError: () => toast({ title: "Failed to update step", variant: "destructive" }),
  });

  const deleteStepMutation = useMutation({
    mutationFn: (stepId: string) =>
      apiRequest("DELETE", `/api/marketing-workflows/${workflowId}/steps/${stepId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/marketing-workflows", workflowId] });
      toast({ title: "Step removed" });
    },
    onError: () => toast({ title: "Failed to remove step", variant: "destructive" }),
  });

  const exitEnrollmentMutation = useMutation({
    mutationFn: (eid: string) =>
      apiRequest("DELETE", `/api/marketing-workflows/${workflowId}/enrollments/${eid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/marketing-workflows", workflowId, "enrollments"] });
      toast({ title: "Contact removed from workflow" });
    },
  });

  const manualEnrollMutation = useMutation({
    mutationFn: (contactId: string) =>
      apiRequest("POST", `/api/marketing-workflows/${workflowId}/enroll`, { contactId }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/marketing-workflows", workflowId, "enrollments"] });
      qc.invalidateQueries({ queryKey: ["/api/marketing-workflows", workflowId] });
      setManualEnrollOpen(false);
      setManualEnrollEmail("");
      setContactSearch([]);
      setSelectedContact(null);
      toast({ title: "Contact enrolled" });
    },
    onError: (err: any) => toast({ title: err?.message ?? "Failed to enroll contact", variant: "destructive" }),
  });

  async function searchContacts(query: string) {
    if (!query.trim()) { setContactSearch([]); return; }
    try {
      const r = await apiRequest("GET", `/api/marketing-contacts?search=${encodeURIComponent(query)}&limit=10`);
      const data = await r.json();
      setContactSearch(data.contacts ?? data ?? []);
    } catch { setContactSearch([]); }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!wf) return null;

  const steps = wf.steps ?? [];
  const enrollments = enrollmentsData?.enrollments ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2"
            onClick={onBack}
          >
            ← All workflows
          </button>
          <h2 className="text-xl font-semibold">{wf.name}</h2>
          {wf.description && <p className="text-sm text-muted-foreground mt-1">{wf.description}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge className={STATUS_COLORS[wf.status]}>{wf.status}</Badge>
          {wf.status !== "active" ? (
            <Button size="sm" onClick={() => activateMutation.mutate()} disabled={activateMutation.isPending}>
              <Play className="w-3.5 h-3.5 mr-1" />Activate
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => pauseMutation.mutate()} disabled={pauseMutation.isPending}>
              <Pause className="w-3.5 h-3.5 mr-1" />Pause
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Active enrollments</p>
            <p className="text-2xl font-bold mt-1">{wf.activeEnrollments ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Total enrolled</p>
            <p className="text-2xl font-bold mt-1">{wf.totalEnrollments ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Steps</p>
            <p className="text-2xl font-bold mt-1">{steps.length}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="steps">
        <TabsList>
          <TabsTrigger value="steps">Steps</TabsTrigger>
          <TabsTrigger value="enrollments">Enrollments</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* ── Steps ──────────────────────────────────────────────────────── */}
        <TabsContent value="steps" className="space-y-4 mt-4">
          {/* Trigger */}
          <Card className="border-dashed">
            <CardContent className="pt-4 pb-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
                <Zap className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Trigger</p>
                <p className="text-sm font-medium">{triggerLabel(wf.triggerJson)}</p>
              </div>
            </CardContent>
          </Card>

          {/* Step list */}
          {steps.map((step, i) => (
            <div key={step.id} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step.stepType === "branch" ? "bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400" : "bg-muted text-muted-foreground"}`}>
                  {STEP_ICONS[step.stepType] ?? <Settings2 className="w-4 h-4" />}
                </div>
                {i < steps.length - 1 && <div className="w-px h-6 bg-border mt-1" />}
              </div>
              <Card className="flex-1">
                <CardContent className="py-3 flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground">{STEP_LABELS[step.stepType] ?? step.stepType}</p>
                    <p className="text-sm font-medium">{stepSummary(step)}</p>
                    {step.stepType === "branch" && (
                      <BranchPathSummary step={step} steps={steps} />
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => {
                        setEditStep(step);
                        setEditStepConfig(step.configJson ?? {});
                        setEditStepNextStepId(step.nextStepId ?? null);
                        setEditStepBranchNoStepId(step.branchNoStepId ?? null);
                      }}
                    >
                      <Settings2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => deleteStepMutation.mutate(step.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          ))}

          <Button variant="outline" className="w-full" onClick={() => setAddStepOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />Add step
          </Button>
        </TabsContent>

        {/* ── Enrollments ────────────────────────────────────────────────── */}
        <TabsContent value="enrollments" className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex gap-2">
              {["active", "completed", "exited"].map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={enrollTab === s ? "default" : "outline"}
                  onClick={() => setEnrollTab(s)}
                  className="capitalize"
                >
                  {s}
                </Button>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={() => setManualEnrollOpen(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" />Enroll contact
            </Button>
          </div>
          {enrollments.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No {enrollTab} enrollments yet.
            </div>
          ) : (
            <div className="space-y-2">
              {enrollments.map((e) => (
                <Card key={e.id}>
                  <CardContent className="py-3 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {e.contact
                          ? `${e.contact.firstName ?? ""} ${e.contact.lastName ?? ""}`.trim() || e.contact.email
                          : e.contactId}
                      </p>
                      {e.contact && (
                        <p className="text-xs text-muted-foreground">{e.contact.email}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Enrolled {new Date(e.enrolledAt).toLocaleDateString()}
                        {e.completedAt && ` · Completed ${new Date(e.completedAt).toLocaleDateString()}`}
                        {e.exitedAt && ` · Exited ${new Date(e.exitedAt).toLocaleDateString()}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={ENROLLMENT_STATUS_COLORS[e.status]}>{e.status}</Badge>
                      {e.status === "active" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          onClick={() => exitEnrollmentMutation.mutate(e.id)}
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Settings ───────────────────────────────────────────────────── */}
        <TabsContent value="settings" className="mt-4">
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Trigger</p>
                <p className="text-sm">{triggerLabel(wf.triggerJson)}</p>
              </div>
              <Separator />
              <div>
                <p className="text-xs text-muted-foreground">Re-enrollment policy</p>
                <p className="text-sm capitalize">{wf.reEnrollPolicy.replace(/_/g, " ")}</p>
                {wf.reEnrollPolicy === "once_per_days" && wf.reEnrollDays && (
                  <p className="text-xs text-muted-foreground">Every {wf.reEnrollDays} days</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Manual enroll dialog */}
      <Dialog open={manualEnrollOpen} onOpenChange={(o) => { setManualEnrollOpen(o); if (!o) { setManualEnrollEmail(""); setContactSearch([]); setSelectedContact(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enroll a contact</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Search by name or email</Label>
              <Input
                placeholder="jane@example.com"
                value={manualEnrollEmail}
                onChange={(e) => {
                  setManualEnrollEmail(e.target.value);
                  setSelectedContact(null);
                  searchContacts(e.target.value);
                }}
              />
            </div>
            {contactSearch.length > 0 && (
              <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                {contactSearch.map((c: any) => (
                  <button
                    key={c.id}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${selectedContact?.id === c.id ? "bg-primary/10" : ""}`}
                    onClick={() => setSelectedContact(c)}
                  >
                    <p className="font-medium">{`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email}</p>
                    <p className="text-xs text-muted-foreground">{c.email}</p>
                  </button>
                ))}
              </div>
            )}
            {selectedContact && (
              <div className="rounded-md bg-muted px-3 py-2 text-sm">
                <p className="font-medium">Selected: {`${selectedContact.firstName ?? ""} ${selectedContact.lastName ?? ""}`.trim() || selectedContact.email}</p>
                <p className="text-xs text-muted-foreground">{selectedContact.email}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualEnrollOpen(false)}>Cancel</Button>
            <Button
              disabled={!selectedContact || manualEnrollMutation.isPending}
              onClick={() => selectedContact && manualEnrollMutation.mutate(selectedContact.id)}
            >
              {manualEnrollMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Enroll
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add step dialog */}
      <Dialog open={addStepOpen} onOpenChange={setAddStepOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add step</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground">Step type</Label>
              <Select
                value={newStepType}
                onValueChange={(v) => {
                  setNewStepType(v);
                  setNewStepConfig({});
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STEP_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <StepConfigEditor
              stepType={newStepType}
              config={newStepConfig}
              onChange={setNewStepConfig}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddStepOpen(false)}>Cancel</Button>
            <Button
              onClick={() => addStepMutation.mutate({ stepType: newStepType, configJson: newStepConfig })}
              disabled={addStepMutation.isPending}
            >
              {addStepMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Add step
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit step dialog */}
      <Dialog open={!!editStep} onOpenChange={(o) => !o && setEditStep(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit step — {editStep ? STEP_LABELS[editStep.stepType] : ""}</DialogTitle>
          </DialogHeader>
          {editStep && (
            <StepConfigEditor
              stepType={editStep.stepType}
              config={editStepConfig}
              onChange={setEditStepConfig}
              steps={steps}
              currentStepId={editStep.id}
              nextStepId={editStepNextStepId}
              branchNoStepId={editStepBranchNoStepId}
              onNextStepIdChange={setEditStepNextStepId}
              onBranchNoStepIdChange={setEditStepBranchNoStepId}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStep(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!editStep) return;
                updateStepMutation.mutate({
                  stepId: editStep.id,
                  configJson: editStepConfig,
                  stepType: editStep.stepType,
                  nextStepId: editStep.stepType === "branch" ? editStepNextStepId : undefined,
                  branchNoStepId: editStep.stepType === "branch" ? editStepBranchNoStepId : undefined,
                });
              }}
              disabled={updateStepMutation.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Nurture Wizard ───────────────────────────────────────────────────────────

interface NurtureTemplate {
  id: string;
  name: string;
  description: string;
  emailCount: number;
  stepSpecs: Array<{
    type: "email" | "wait";
    delayAmount?: number;
    delayUnit?: string;
    emailPrompt?: { stepName: string; goal: string };
  }>;
}

interface NurtureStepDraft {
  stepName: string;
  subject: string;
  body: string;
  loading: boolean;
}

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  welcome: <Sparkles className="w-5 h-5 text-violet-500" />,
  onboarding: <CheckCircle2 className="w-5 h-5 text-green-500" />,
  "re-engagement": <Zap className="w-5 h-5 text-amber-500" />,
  "post-event": <Bell className="w-5 h-5 text-blue-500" />,
};

function NurtureWizardDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (workflowId: string) => void;
}) {
  const { toast } = useToast();
  const [wizardStep, setWizardStep] = useState(0);
  // Step 0: pick template
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  // Step 1: trigger + name
  const [sequenceName, setSequenceName] = useState("");
  const [triggerType, setTriggerType] = useState("manual");
  const [segmentId, setSegmentId] = useState("");
  const [persona, setPersona] = useState("");
  const [solutionArea, setSolutionArea] = useState("");
  // Step 2: email drafts
  const [stepDrafts, setStepDrafts] = useState<NurtureStepDraft[]>([]);
  const [draftsGenerated, setDraftsGenerated] = useState(false);
  // Step 3: creating
  const [creating, setCreating] = useState(false);

  const { data: templates = [] } = useQuery<NurtureTemplate[]>({
    queryKey: ["/api/marketing-workflows/nurture-templates"],
    queryFn: () => apiRequest("GET", "/api/marketing-workflows/nurture-templates").then((r) => r.json()),
    enabled: open,
  });

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;

  function resetWizard() {
    setWizardStep(0);
    setSelectedTemplateId(null);
    setSequenceName("");
    setTriggerType("manual");
    setSegmentId("");
    setPersona("");
    setSolutionArea("");
    setStepDrafts([]);
    setDraftsGenerated(false);
    setCreating(false);
  }

  async function generateDrafts() {
    if (!selectedTemplate) return;
    const emailSpecs = selectedTemplate.stepSpecs.filter((s) => s.type === "email");
    const initial: NurtureStepDraft[] = emailSpecs.map((s) => ({
      stepName: s.emailPrompt?.stepName ?? "Email",
      subject: "",
      body: "",
      loading: true,
    }));
    setStepDrafts(initial);
    setDraftsGenerated(true);

    // Generate AI drafts for each email step in sequence
    for (let i = 0; i < emailSpecs.length; i++) {
      try {
        const r = await apiRequest("POST", "/api/marketing-workflows/nurture-draft", {
          templateId: selectedTemplate.id,
          stepIndex: i,
          persona: persona.trim() || undefined,
          solutionArea: solutionArea.trim() || undefined,
        });
        const data = await r.json();
        setStepDrafts((prev) =>
          prev.map((d, idx) =>
            idx === i ? { ...d, subject: data.subject ?? "", body: data.body ?? "", loading: false } : d,
          ),
        );
      } catch {
        setStepDrafts((prev) =>
          prev.map((d, idx) =>
            idx === i ? { ...d, subject: `${emailSpecs[i].emailPrompt?.stepName ?? "Email"} — edit me`, body: "", loading: false } : d,
          ),
        );
      }
    }
  }

  async function handleCreate() {
    if (!selectedTemplate || !sequenceName.trim()) return;
    setCreating(true);
    try {
      // 1. Build trigger
      const triggerJson: any =
        triggerType === "segment_membership"
          ? { type: "segment_membership", segmentId, nurtureTemplate: selectedTemplate.id }
          : { type: triggerType === "manual" ? "manual" : triggerType, nurtureTemplate: selectedTemplate.id };

      // 2. Create workflow
      const wfRes = await apiRequest("POST", "/api/marketing-workflows", {
        name: sequenceName.trim(),
        description: selectedTemplate.description,
        triggerJson,
        reEnrollPolicy: "never",
        reEnrollDays: null,
      });
      const wf = await wfRes.json();

      // 3. Add steps — interleave email drafts with wait steps
      let emailIdx = 0;
      for (const spec of selectedTemplate.stepSpecs) {
        if (spec.type === "wait") {
          await apiRequest("POST", `/api/marketing-workflows/${wf.id}/steps`, {
            stepType: "wait",
            configJson: { amount: spec.delayAmount ?? 1, unit: spec.delayUnit ?? "days" },
          });
        } else if (spec.type === "email") {
          const draft = stepDrafts[emailIdx];
          emailIdx++;
          await apiRequest("POST", `/api/marketing-workflows/${wf.id}/steps`, {
            stepType: "send_email",
            configJson: {
              generatedEmailId: null,
              draftSubject: draft?.subject ?? "",
              draftBody: draft?.body ?? "",
              stepName: spec.emailPrompt?.stepName ?? "Email",
            },
          });
        }
      }

      toast({ title: "Nurture sequence created", description: "Add your email IDs to each step to activate." });
      onCreated(wf.id);
      resetWizard();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Failed to create sequence", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  // Wizard navigation
  function goNext() {
    if (wizardStep === 0 && !selectedTemplateId) {
      toast({ title: "Choose a template to continue", variant: "destructive" });
      return;
    }
    if (wizardStep === 1 && !sequenceName.trim()) {
      toast({ title: "Name your sequence", variant: "destructive" });
      return;
    }
    if (wizardStep === 1) {
      setWizardStep(2);
      if (!draftsGenerated) generateDrafts();
      return;
    }
    if (wizardStep === 2) {
      setWizardStep(3);
      return;
    }
    setWizardStep((s) => Math.min(s + 1, 3));
  }

  const STEP_LABELS = ["Choose template", "Configure", "Customize emails", "Review & create"];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetWizard(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-500" />
            New Nurture Sequence
          </DialogTitle>
          {/* Progress indicators */}
          <div className="flex items-center gap-1 mt-2">
            {STEP_LABELS.map((label, i) => (
              <div key={i} className="flex items-center gap-1">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                    i === wizardStep
                      ? "bg-violet-600 text-white"
                      : i < wizardStep
                      ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {i < wizardStep ? "✓" : i + 1}
                </div>
                <span className={`text-xs hidden sm:inline ${i === wizardStep ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  {label}
                </span>
                {i < STEP_LABELS.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
              </div>
            ))}
          </div>
        </DialogHeader>

        <div className="py-2 space-y-4">
          {/* ── Step 0: Choose template ───────────────────────────────── */}
          {wizardStep === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Pick a pre-built template. You can customise every step after creation.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    className={`text-left p-4 rounded-lg border-2 transition-colors ${
                      selectedTemplateId === t.id
                        ? "border-violet-500 bg-violet-50 dark:bg-violet-900/20"
                        : "border-border hover:border-violet-300"
                    }`}
                    onClick={() => setSelectedTemplateId(t.id)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {TEMPLATE_ICONS[t.id] ?? <Mail className="w-5 h-5 text-muted-foreground" />}
                      <span className="font-semibold text-sm">{t.name}</span>
                      <Badge variant="secondary" className="text-xs ml-auto">{t.emailCount} emails</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{t.description}</p>
                    {/* Step preview */}
                    <div className="flex items-center gap-1 mt-2 flex-wrap">
                      {t.stepSpecs.map((s, i) => (
                        <span
                          key={i}
                          className={`inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded ${
                            s.type === "email"
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                          }`}
                        >
                          {s.type === "email" ? <Mail className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                          {s.type === "email" ? s.emailPrompt?.stepName : `${s.delayAmount}d`}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 1: Configure ─────────────────────────────────────── */}
          {wizardStep === 1 && (
            <div className="space-y-4">
              <div>
                <Label>Sequence name</Label>
                <Input
                  className="mt-1"
                  placeholder={`${selectedTemplate?.name ?? "Nurture"} sequence`}
                  value={sequenceName}
                  onChange={(e) => setSequenceName(e.target.value)}
                />
              </div>
              <Separator />
              <div>
                <Label>Enrollment trigger</Label>
                <Select value={triggerType} onValueChange={setTriggerType}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual (enroll contacts by hand)</SelectItem>
                    <SelectItem value="segment_membership">Segment membership</SelectItem>
                    <SelectItem value="contact_event">Contact event</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {triggerType === "segment_membership" && (
                <div>
                  <Label>Segment ID</Label>
                  <Input
                    className="mt-1"
                    placeholder="Paste segment ID…"
                    value={segmentId}
                    onChange={(e) => setSegmentId(e.target.value)}
                  />
                </div>
              )}
              <Separator />
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">AI email context (optional)</p>
              <div>
                <Label>Target persona</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. Marketing managers at mid-market SaaS companies"
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                />
              </div>
              <div>
                <Label>Product / solution area</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. AI-powered marketing automation platform"
                  value={solutionArea}
                  onChange={(e) => setSolutionArea(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* ── Step 2: Customise email drafts ────────────────────────── */}
          {wizardStep === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                AI-drafted subject lines and body copy for each email step. Edit them here or in the workflow builder after creation.
              </p>
              {stepDrafts.map((draft, i) => (
                <Card key={i}>
                  <CardHeader className="py-3 pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Mail className="w-4 h-4 text-violet-500" />
                      Email {i + 1}: {draft.stepName}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 pt-0 pb-3">
                    {draft.loading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Drafting with AI…
                      </div>
                    ) : (
                      <>
                        <div>
                          <Label className="text-xs">Subject line</Label>
                          <Input
                            className="mt-1 text-sm"
                            value={draft.subject}
                            onChange={(e) =>
                              setStepDrafts((prev) =>
                                prev.map((d, idx) => (idx === i ? { ...d, subject: e.target.value } : d)),
                              )
                            }
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Email body</Label>
                          <Textarea
                            className="mt-1 text-sm"
                            rows={4}
                            value={draft.body}
                            onChange={(e) =>
                              setStepDrafts((prev) =>
                                prev.map((d, idx) => (idx === i ? { ...d, body: e.target.value } : d)),
                              )
                            }
                          />
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              ))}
              <p className="text-xs text-muted-foreground">
                Note: the sequence will use these drafts as starting copy. You'll still need to link a generated email template to each send step before activating.
              </p>
            </div>
          )}

          {/* ── Step 3: Review ────────────────────────────────────────── */}
          {wizardStep === 3 && selectedTemplate && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Review the sequence before creating. You can further edit steps in the workflow builder.</p>
              <Card>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-24">Name</span>
                    <span className="text-sm font-medium">{sequenceName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-24">Template</span>
                    <span className="text-sm">{selectedTemplate.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-24">Trigger</span>
                    <span className="text-sm">
                      {triggerType === "segment_membership" ? `Segment ${segmentId || "(unset)"}` : triggerType === "contact_event" ? "Contact event" : "Manual"}
                    </span>
                  </div>
                </CardContent>
              </Card>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Steps</p>
                {selectedTemplate.stepSpecs.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    {s.type === "email" ? (
                      <Mail className="w-4 h-4 text-violet-500 shrink-0" />
                    ) : (
                      <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <span className={s.type === "email" ? "font-medium" : "text-muted-foreground"}>
                      {s.type === "email" ? `Send "${s.emailPrompt?.stepName}"` : `Wait ${s.delayAmount} ${s.delayUnit}`}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                HubSpot timeline events (email_sent, email_open, email_click) will be logged automatically for each enrolled contact.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => {
              if (wizardStep === 0) { resetWizard(); onOpenChange(false); }
              else setWizardStep((s) => s - 1);
            }}
          >
            {wizardStep === 0 ? "Cancel" : "Back"}
          </Button>
          {wizardStep < 3 ? (
            <Button onClick={goNext}>
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              Create sequence
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sequence Stats Row ───────────────────────────────────────────────────────

interface SequenceStat {
  workflowId: string;
  totalSent: number;
  totalOpens: number;
  totalClicks: number;
  openRate: number;
  clickRate: number;
}

function MiniRateBar({ rate, color }: { rate: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(rate, 100)}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-8">{rate}%</span>
    </div>
  );
}

// ─── Workflow Card ────────────────────────────────────────────────────────────

function WorkflowCard({
  wf,
  onSelect,
  onDelete,
}: {
  wf: Workflow;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Card
      className="cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() => onSelect(wf.id)}
    >
      <CardContent className="py-4 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {(wf.triggerJson as any)?.nurtureTemplate && (
              <Sparkles className="w-4 h-4 text-violet-500 shrink-0" />
            )}
            <p className="font-medium">{wf.name}</p>
            <Badge className={STATUS_COLORS[wf.status]}>{wf.status}</Badge>
          </div>
          {wf.description && (
            <p className="text-sm text-muted-foreground mt-0.5 truncate">{wf.description}</p>
          )}
          <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />{triggerLabel(wf.triggerJson)}
            </span>
            <span className="flex items-center gap-1">
              <ListTree className="w-3 h-3" />{wf.stepCount} step{wf.stepCount !== 1 ? "s" : ""}
            </span>
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />{wf.activeEnrollments} active · {wf.totalEnrollments} total
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(wf.id);
            }}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorkflowsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [nurtureWizardOpen, setNurtureWizardOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pageTab, setPageTab] = useState("all");

  // Create form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formTriggerType, setFormTriggerType] = useState("manual");
  const [formSegmentId, setFormSegmentId] = useState("");
  const [formEventType, setFormEventType] = useState("form_submit");
  const [formScoreThreshold, setFormScoreThreshold] = useState("50");
  const [formScoreDirection, setFormScoreDirection] = useState("above");
  const [formReEnrollPolicy, setFormReEnrollPolicy] = useState("never");
  const [formReEnrollDays, setFormReEnrollDays] = useState("30");

  const { data: workflows = [], isLoading } = useQuery<Workflow[]>({
    queryKey: ["/api/marketing-workflows"],
    queryFn: () => apiRequest("GET", "/api/marketing-workflows").then((r) => r.json()),
  });

  const { data: sequenceStats = [] } = useQuery<SequenceStat[]>({
    queryKey: ["/api/marketing-workflows/sequence-stats"],
    queryFn: () => apiRequest("GET", "/api/marketing-workflows/sequence-stats").then((r) => r.json()),
    enabled: pageTab === "sequences",
  });

  // Nurture sequences: workflows whose triggerJson contains a nurtureTemplate field
  const sequences = workflows.filter((wf) => (wf.triggerJson as any)?.nurtureTemplate);
  const statsMap = new Map(sequenceStats.map((s) => [s.workflowId, s]));

  const createMutation = useMutation({
    mutationFn: (body: any) =>
      apiRequest("POST", "/api/marketing-workflows", body).then((r) => r.json()),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["/api/marketing-workflows"] });
      setCreateOpen(false);
      resetForm();
      setSelectedId(created.id);
      toast({ title: "Workflow created" });
    },
    onError: () => toast({ title: "Failed to create workflow", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/marketing-workflows/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/marketing-workflows"] });
      toast({ title: "Workflow deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  function resetForm() {
    setFormName("");
    setFormDescription("");
    setFormTriggerType("manual");
    setFormSegmentId("");
    setFormEventType("form_submit");
    setFormScoreThreshold("50");
    setFormScoreDirection("above");
    setFormReEnrollPolicy("never");
    setFormReEnrollDays("30");
  }

  function buildTrigger() {
    if (formTriggerType === "segment_membership") return { type: "segment_membership", segmentId: formSegmentId };
    if (formTriggerType === "contact_event") return { type: "contact_event", eventType: formEventType };
    if (formTriggerType === "lead_score_threshold") return { type: "lead_score_threshold", threshold: Number(formScoreThreshold), direction: formScoreDirection };
    return { type: "manual" };
  }

  function handleCreate() {
    if (!formName.trim()) return toast({ title: "Name is required", variant: "destructive" });
    createMutation.mutate({
      name: formName.trim(),
      description: formDescription.trim() || null,
      triggerJson: buildTrigger(),
      reEnrollPolicy: formReEnrollPolicy,
      reEnrollDays: formReEnrollPolicy === "once_per_days" ? Number(formReEnrollDays) : null,
    });
  }

  if (selectedId) {
    return (
      <AppLayout>
        <div className="p-6 max-w-3xl mx-auto">
          <WorkflowDetail workflowId={selectedId} onBack={() => setSelectedId(null)} />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <ListTree className="w-6 h-6 text-violet-500" />
              Marketing Workflows
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Automate multi-step sequences: enroll contacts based on segments, events, or lead score, then send emails, wait, branch, and update properties.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" onClick={() => setNurtureWizardOpen(true)}>
              <Sparkles className="w-4 h-4 mr-2 text-violet-500" />New nurture sequence
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />New workflow
            </Button>
          </div>
        </div>

        {/* Page tabs */}
        <Tabs value={pageTab} onValueChange={setPageTab}>
          <TabsList>
            <TabsTrigger value="all">All workflows</TabsTrigger>
            <TabsTrigger value="sequences" className="flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" />Sequences
              {sequences.length > 0 && (
                <Badge variant="secondary" className="text-xs ml-1">{sequences.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── All workflows tab ───────────────────────────────────── */}
          <TabsContent value="all" className="mt-4">
            {isLoading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : workflows.length === 0 ? (
              <Card>
                <CardContent className="py-20 text-center">
                  <ListTree className="w-10 h-10 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground text-sm">No workflows yet.</p>
                  <div className="flex justify-center gap-2 mt-4">
                    <Button variant="outline" onClick={() => setNurtureWizardOpen(true)}>
                      <Sparkles className="w-4 h-4 mr-2" />New nurture sequence
                    </Button>
                    <Button onClick={() => setCreateOpen(true)}>
                      <Plus className="w-4 h-4 mr-2" />Create workflow from scratch
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {workflows.map((wf) => (
                  <WorkflowCard
                    key={wf.id}
                    wf={wf}
                    onSelect={setSelectedId}
                    onDelete={(id) => deleteMutation.mutate(id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Sequences tab ───────────────────────────────────────── */}
          <TabsContent value="sequences" className="mt-4">
            {sequences.length === 0 ? (
              <Card>
                <CardContent className="py-20 text-center">
                  <Sparkles className="w-10 h-10 mx-auto text-violet-400 mb-4" />
                  <p className="font-medium mb-1">No nurture sequences yet</p>
                  <p className="text-muted-foreground text-sm mb-4">
                    Use the wizard to create a pre-built welcome, onboarding, re-engagement, or post-event sequence.
                  </p>
                  <Button onClick={() => setNurtureWizardOpen(true)}>
                    <Sparkles className="w-4 h-4 mr-2" />New nurture sequence
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {sequences.map((wf) => {
                  const stats = statsMap.get(wf.id);
                  return (
                    <Card
                      key={wf.id}
                      className="cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => setSelectedId(wf.id)}
                    >
                      <CardContent className="py-4 flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Sparkles className="w-4 h-4 text-violet-500 shrink-0" />
                            <p className="font-medium">{wf.name}</p>
                            <Badge className={STATUS_COLORS[wf.status]}>{wf.status}</Badge>
                            <Badge variant="outline" className="text-xs">
                              {(wf.triggerJson as any)?.nurtureTemplate ?? "sequence"}
                            </Badge>
                          </div>
                          {wf.description && (
                            <p className="text-sm text-muted-foreground mt-0.5 truncate">{wf.description}</p>
                          )}
                          <div className="flex items-center gap-4 mt-2 flex-wrap">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Users className="w-3 h-3" />
                              {wf.activeEnrollments} active · {wf.totalEnrollments} total
                            </span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <ListTree className="w-3 h-3" />{wf.stepCount} steps
                            </span>
                            {stats && stats.totalSent > 0 && (
                              <>
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Eye className="w-3 h-3" />
                                  <MiniRateBar rate={stats.openRate} color="bg-blue-500" />
                                  open
                                </span>
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <MousePointerClick className="w-3 h-3" />
                                  <MiniRateBar rate={stats.clickRate} color="bg-green-500" />
                                  click
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {stats.totalSent.toLocaleString()} sent
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteMutation.mutate(wf.id);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Nurture wizard */}
      <NurtureWizardDialog
        open={nurtureWizardOpen}
        onOpenChange={setNurtureWizardOpen}
        onCreated={(id) => {
          qc.invalidateQueries({ queryKey: ["/api/marketing-workflows"] });
          setSelectedId(id);
        }}
      />

      {/* Create blank workflow dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                placeholder="Welcome new subscribers"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Textarea
                rows={2}
                placeholder="What does this workflow do?"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>

            <Separator />
            <div>
              <Label>Enrollment trigger</Label>
              <Select value={formTriggerType} onValueChange={setFormTriggerType}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual (enroll contacts by hand)</SelectItem>
                  <SelectItem value="segment_membership">Segment membership</SelectItem>
                  <SelectItem value="contact_event">Contact event</SelectItem>
                  <SelectItem value="lead_score_threshold">Lead score threshold</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formTriggerType === "segment_membership" && (
              <div>
                <Label>Segment ID</Label>
                <Input
                  placeholder="Paste segment ID…"
                  value={formSegmentId}
                  onChange={(e) => setFormSegmentId(e.target.value)}
                />
              </div>
            )}
            {formTriggerType === "contact_event" && (
              <div>
                <Label>Event type</Label>
                <Select value={formEventType} onValueChange={setFormEventType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="form_submit">Form submit</SelectItem>
                    <SelectItem value="link_click">Link click</SelectItem>
                    <SelectItem value="email_open">Email open</SelectItem>
                    <SelectItem value="page_view">Page view</SelectItem>
                    <SelectItem value="*">Any event</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {formTriggerType === "lead_score_threshold" && (
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label>Direction</Label>
                  <Select value={formScoreDirection} onValueChange={setFormScoreDirection}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="above">Above</SelectItem>
                      <SelectItem value="below">Below</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label>Threshold</Label>
                  <Input
                    type="number"
                    value={formScoreThreshold}
                    onChange={(e) => setFormScoreThreshold(e.target.value)}
                  />
                </div>
              </div>
            )}

            <Separator />
            <div>
              <Label>Re-enrollment policy</Label>
              <Select value={formReEnrollPolicy} onValueChange={setFormReEnrollPolicy}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Never (once per contact)</SelectItem>
                  <SelectItem value="always">Always re-enroll</SelectItem>
                  <SelectItem value="once_per_days">Once per N days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formReEnrollPolicy === "once_per_days" && (
              <div>
                <Label>Interval (days)</Label>
                <Input
                  type="number"
                  min={1}
                  value={formReEnrollDays}
                  onChange={(e) => setFormReEnrollDays(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Create workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
