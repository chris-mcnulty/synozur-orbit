import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
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

// ─── Step Config Editor ───────────────────────────────────────────────────────

function StepConfigEditor({
  stepType,
  config,
  onChange,
}: {
  stepType: string;
  config: any;
  onChange: (cfg: any) => void;
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
    return (
      <div className="space-y-2">
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
    mutationFn: (data: { stepId: string; configJson: any; stepType: string }) =>
      apiRequest("PATCH", `/api/marketing-workflows/${workflowId}/steps/${data.stepId}`, {
        configJson: data.configJson,
        stepType: data.stepType,
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
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                  {STEP_ICONS[step.stepType] ?? <Settings2 className="w-4 h-4" />}
                </div>
                {i < steps.length - 1 && <div className="w-px h-6 bg-border mt-1" />}
              </div>
              <Card className="flex-1">
                <CardContent className="py-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">{STEP_LABELS[step.stepType] ?? step.stepType}</p>
                    <p className="text-sm font-medium">{stepSummary(step)}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => {
                        setEditStep(step);
                        setEditStepConfig(step.configJson ?? {});
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
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStep(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!editStep) return;
                updateStepMutation.mutate({ stepId: editStep.id, configJson: editStepConfig, stepType: editStep.stepType });
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorkflowsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <ListTree className="w-6 h-6 text-violet-500" />
              Marketing Workflows
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Automate multi-step sequences: enroll contacts based on segments, events, or lead score, then send emails, wait, branch, and update properties.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />New workflow
          </Button>
        </div>

        {/* Workflow list */}
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : workflows.length === 0 ? (
          <Card>
            <CardContent className="py-20 text-center">
              <ListTree className="w-10 h-10 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-sm">No workflows yet.</p>
              <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />Create your first workflow
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {workflows.map((wf) => (
              <Card
                key={wf.id}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => setSelectedId(wf.id)}
              >
                <CardContent className="py-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
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
                        deleteMutation.mutate(wf.id);
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
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
