import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  RefreshCw,
  Target,
  BarChart3,
  Settings2,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScoringRule {
  id: string;
  name: string;
  ruleType: "property" | "event";
  conditionJson: Record<string, any>;
  points: number;
  isActive: boolean;
}

interface LifecycleThreshold {
  stage: string;
  minScore: number;
}

interface DistributionRow {
  lifecycleStage: string;
  count: number;
  avgScore: number;
  minScore: number;
  maxScore: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STAGE_COLORS: Record<string, string> = {
  subscriber: "bg-slate-100 text-slate-700",
  lead: "bg-blue-100 text-blue-700",
  mql: "bg-indigo-100 text-indigo-700",
  sql: "bg-purple-100 text-purple-700",
  opportunity: "bg-amber-100 text-amber-700",
  customer: "bg-green-100 text-green-700",
  evangelist: "bg-pink-100 text-pink-700",
};

const STAGE_LABELS: Record<string, string> = {
  subscriber: "Subscriber",
  lead: "Lead",
  mql: "MQL",
  sql: "SQL",
  opportunity: "Opportunity",
  customer: "Customer",
  evangelist: "Evangelist",
};

const THRESHOLD_STAGES = ["lead", "mql", "sql", "opportunity", "customer"];

const PROPERTY_FIELDS = [
  { value: "jobTitle", label: "Job Title" },
  { value: "company", label: "Company" },
  { value: "email", label: "Email" },
  { value: "source", label: "Source" },
];

const PROPERTY_OPS = [
  { value: "not_empty", label: "is not empty" },
  { value: "contains", label: "contains" },
  { value: "equals", label: "equals" },
];

const EVENT_TYPES = [
  { value: "form_submit", label: "Form submission" },
  { value: "page_view", label: "Page view" },
  { value: "email_open", label: "Email open" },
  { value: "email_click", label: "Email click" },
  { value: "link_click", label: "Link click" },
  { value: "social_engage", label: "Social engagement" },
];

function describeCondition(rule: ScoringRule): string {
  const c = rule.conditionJson;
  if (rule.ruleType === "event") {
    const label = EVENT_TYPES.find((e) => e.value === c.eventType)?.label ?? c.eventType;
    return `${label} ≥ ${c.minCount ?? 1}×`;
  }
  const fieldLabel = PROPERTY_FIELDS.find((f) => f.value === c.field)?.label ?? c.field;
  if (c.operator === "not_empty") return `${fieldLabel} is filled`;
  return `${fieldLabel} ${c.operator} "${c.value}"`;
}

// ---------------------------------------------------------------------------
// Rule form dialog
// ---------------------------------------------------------------------------

const EMPTY_FORM = {
  name: "",
  ruleType: "event" as "property" | "event",
  propField: "jobTitle",
  propOp: "not_empty",
  propValue: "",
  eventType: "form_submit",
  eventMinCount: 1,
  points: 10,
  isActive: true,
};

function RuleDialog({
  open,
  onClose,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  initial?: ScoringRule | null;
  onSave: (data: any) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(() => {
    if (!initial) return EMPTY_FORM;
    const c = initial.conditionJson;
    return {
      name: initial.name,
      ruleType: initial.ruleType,
      propField: c.field ?? "jobTitle",
      propOp: c.operator ?? "not_empty",
      propValue: c.value ?? "",
      eventType: c.eventType ?? "form_submit",
      eventMinCount: c.minCount ?? 1,
      points: initial.points,
      isActive: initial.isActive,
    };
  });

  const handleSubmit = () => {
    if (!form.name.trim()) return;
    const conditionJson =
      form.ruleType === "property"
        ? { field: form.propField, operator: form.propOp, ...(form.propOp !== "not_empty" ? { value: form.propValue } : {}) }
        : { eventType: form.eventType, minCount: form.eventMinCount };
    onSave({ name: form.name, ruleType: form.ruleType, conditionJson, points: form.points, isActive: form.isActive });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit rule" : "Add scoring rule"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Rule name</Label>
            <Input
              placeholder="e.g. Job title is VP or above"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>

          <div>
            <Label>Rule type</Label>
            <Select value={form.ruleType} onValueChange={(v: any) => setForm((f) => ({ ...f, ruleType: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="property">Contact property</SelectItem>
                <SelectItem value="event">Engagement event</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.ruleType === "property" ? (
            <div className="space-y-3">
              <div>
                <Label>Field</Label>
                <Select value={form.propField} onValueChange={(v) => setForm((f) => ({ ...f, propField: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROPERTY_FIELDS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Condition</Label>
                <Select value={form.propOp} onValueChange={(v) => setForm((f) => ({ ...f, propOp: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROPERTY_OPS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {form.propOp !== "not_empty" && (
                <div>
                  <Label>Value</Label>
                  <Input
                    placeholder="e.g. VP, Director, CTO"
                    value={form.propValue}
                    onChange={(e) => setForm((f) => ({ ...f, propValue: e.target.value }))}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label>Event type</Label>
                <Select value={form.eventType} onValueChange={(v) => setForm((f) => ({ ...f, eventType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map((e) => (
                      <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Minimum occurrences</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.eventMinCount}
                  onChange={(e) => setForm((f) => ({ ...f, eventMinCount: Math.max(1, parseInt(e.target.value) || 1) }))}
                />
              </div>
            </div>
          )}

          <div>
            <Label>Points</Label>
            <Input
              type="number"
              value={form.points}
              onChange={(e) => setForm((f) => ({ ...f, points: parseInt(e.target.value) || 0 }))}
            />
            <p className="text-xs text-muted-foreground mt-1">Points added to the contact's score when this rule matches.</p>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={form.isActive}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
            />
            <Label>Active</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving || !form.name.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {initial ? "Save changes" : "Add rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function LeadScoringPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [showRuleDialog, setShowRuleDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<ScoringRule | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);
  const [thresholdEdits, setThresholdEdits] = useState<Record<string, string>>({});
  const [thresholdsDirty, setThresholdsDirty] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: rules = [], isLoading: rulesLoading } = useQuery<ScoringRule[]>({
    queryKey: ["/api/lead-scoring/rules"],
  });

  const { data: thresholds = [], isLoading: thresholdsLoading } = useQuery<LifecycleThreshold[]>({
    queryKey: ["/api/lead-scoring/thresholds"],
  });

  const { data: distribution = [], isLoading: distLoading } = useQuery<DistributionRow[]>({
    queryKey: ["/api/lead-scoring/distribution"],
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const createRule = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/lead-scoring/rules", data).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/lead-scoring/rules"] }); setShowRuleDialog(false); toast({ title: "Rule added" }); },
    onError: () => toast({ title: "Failed to add rule", variant: "destructive" }),
  });

  const updateRule = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      apiRequest("PUT", `/api/lead-scoring/rules/${id}`, data).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/lead-scoring/rules"] });
      setEditingRule(null);
      toast({ title: "Rule updated" });
    },
    onError: () => toast({ title: "Failed to update rule", variant: "destructive" }),
  });

  const deleteRule = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/lead-scoring/rules/${id}`).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/lead-scoring/rules"] });
      setDeletingRuleId(null);
      toast({ title: "Rule deleted" });
    },
    onError: () => toast({ title: "Failed to delete rule", variant: "destructive" }),
  });

  const toggleRule = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PUT", `/api/lead-scoring/rules/${id}`, { isActive }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/lead-scoring/rules"] }),
    onError: () => toast({ title: "Failed to update rule", variant: "destructive" }),
  });

  const suggestRules = useMutation({
    mutationFn: () => apiRequest("POST", "/api/lead-scoring/suggest").then((r) => r.json()),
    onSuccess: async (data: any) => {
      const suggestions = data?.suggestions ?? [];
      // Batch-create all suggested rules
      await Promise.all(
        suggestions.map((s: any) =>
          apiRequest("POST", "/api/lead-scoring/rules", s),
        ),
      );
      qc.invalidateQueries({ queryKey: ["/api/lead-scoring/rules"] });
      toast({ title: `${suggestions.length} AI rules added`, description: "Review and adjust points as needed." });
    },
    onError: () => toast({ title: "AI suggestion failed", variant: "destructive" }),
  });

  const saveThresholds = useMutation({
    mutationFn: () => {
      const thresholdList = THRESHOLD_STAGES.map((stage) => ({
        stage,
        minScore: parseInt(thresholdEdits[stage] ?? String(thresholds.find((t) => t.stage === stage)?.minScore ?? 0), 10) || 0,
      }));
      return apiRequest("PUT", "/api/lead-scoring/thresholds", { thresholds: thresholdList }).then((r) => r.json());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/lead-scoring/thresholds"] });
      setThresholdsDirty(false);
      setThresholdEdits({});
      toast({ title: "Thresholds saved" });
    },
    onError: () => toast({ title: "Failed to save thresholds", variant: "destructive" }),
  });

  const recompute = useMutation({
    mutationFn: () => apiRequest("POST", "/api/lead-scoring/recompute").then((r) => r.json()),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/lead-scoring/distribution"] });
      qc.invalidateQueries({ queryKey: ["/api/marketing-contacts"] });
      toast({
        title: "Scores recomputed",
        description: `${data?.updated ?? 0} contacts updated, ${data?.stageChanges ?? 0} stage changes.`,
      });
    },
    onError: () => toast({ title: "Recompute failed", variant: "destructive" }),
  });

  // ── Score distribution total ──────────────────────────────────────────────
  const totalContacts = distribution.reduce((s, r) => s + r.count, 0);

  // ── Threshold helper ──────────────────────────────────────────────────────
  function thresholdValue(stage: string): string {
    if (thresholdEdits[stage] !== undefined) return thresholdEdits[stage];
    const t = thresholds.find((t) => t.stage === stage);
    return String(t?.minScore ?? "");
  }

  function handleThresholdChange(stage: string, val: string) {
    setThresholdEdits((prev) => ({ ...prev, [stage]: val }));
    setThresholdsDirty(true);
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Target className="h-6 w-6 text-primary" />
              Lead Scoring
            </h1>
            <p className="text-muted-foreground mt-1">
              Rule-based scoring that drives lifecycle stage transitions and syncs to HubSpot.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
          >
            {recompute.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Recompute all scores
          </Button>
        </div>

        {/* Score distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Score distribution
            </CardTitle>
            <CardDescription>
              {distLoading ? "Loading…" : `${totalContacts} contacts across all lifecycle stages.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {distLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : distribution.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contacts yet.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {distribution
                  .sort((a, b) => {
                    const order = ["subscriber", "lead", "mql", "sql", "opportunity", "customer", "evangelist"];
                    return order.indexOf(a.lifecycleStage) - order.indexOf(b.lifecycleStage);
                  })
                  .map((row) => (
                    <div key={row.lifecycleStage} className="rounded-lg border p-3 space-y-1">
                      <Badge className={STAGE_COLORS[row.lifecycleStage] ?? "bg-slate-100 text-slate-700"}>
                        {STAGE_LABELS[row.lifecycleStage] ?? row.lifecycleStage}
                      </Badge>
                      <p className="text-2xl font-bold">{row.count}</p>
                      <p className="text-xs text-muted-foreground">avg score: {row.avgScore}</p>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Lifecycle stage thresholds */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Settings2 className="h-4 w-4" />
                  Stage thresholds
                </CardTitle>
                <CardDescription>
                  Minimum score required for a contact to enter each lifecycle stage. Stages only advance — never downgrade.
                </CardDescription>
              </div>
              {thresholdsDirty && (
                <Button size="sm" onClick={() => saveThresholds.mutate()} disabled={saveThresholds.isPending}>
                  {saveThresholds.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                  Save
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {thresholdsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                {THRESHOLD_STAGES.map((stage) => (
                  <div key={stage} className="space-y-1">
                    <Label className="capitalize">{STAGE_LABELS[stage] ?? stage}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={thresholdValue(stage)}
                      onChange={(e) => handleThresholdChange(stage, e.target.value)}
                      className="w-full"
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Scoring rules */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Scoring rules
                </CardTitle>
                <CardDescription>
                  Each active rule adds points when its condition matches. Scores recompute on every contact event.
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => suggestRules.mutate()}
                  disabled={suggestRules.isPending}
                >
                  {suggestRules.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Suggest rules
                </Button>
                <Button
                  size="sm"
                  onClick={() => { setEditingRule(null); setShowRuleDialog(true); }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add rule
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {rulesLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : rules.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <Target className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p>No scoring rules yet.</p>
                <p className="mt-1">Add rules manually or click <strong>Suggest rules</strong> to let AI generate a starter set based on your ICP personas.</p>
              </div>
            ) : (
              <div className="divide-y">
                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    className={`flex items-center gap-4 px-6 py-3 ${!rule.isActive ? "opacity-50" : ""}`}
                  >
                    <Switch
                      checked={rule.isActive}
                      onCheckedChange={(v) => toggleRule.mutate({ id: rule.id, isActive: v })}
                      aria-label="Toggle rule"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{rule.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{describeCondition(rule)}</p>
                    </div>
                    <Badge variant="outline" className="shrink-0 font-mono">
                      +{rule.points} pts
                    </Badge>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => { setEditingRule(rule); setShowRuleDialog(true); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => setDeletingRuleId(rule.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info card */}
        <Card className="border-dashed bg-muted/30">
          <CardContent className="flex items-start gap-3 py-4">
            <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <p className="text-sm text-muted-foreground">
              Scores are pushed to the <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">orbit_lead_score</code> and{" "}
              <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">orbit_lifecycle_stage</code> properties on matching
              HubSpot contacts during the nightly sync. Create these custom contact properties in your HubSpot portal if they don't exist yet.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Rule dialog */}
      <RuleDialog
        open={showRuleDialog || editingRule !== null}
        onClose={() => { setShowRuleDialog(false); setEditingRule(null); }}
        initial={editingRule}
        saving={createRule.isPending || updateRule.isPending}
        onSave={(data) => {
          if (editingRule) {
            updateRule.mutate({ id: editingRule.id, data });
          } else {
            createRule.mutate(data);
          }
        }}
      />

      {/* Delete confirm */}
      <AlertDialog open={!!deletingRuleId} onOpenChange={(o) => !o && setDeletingRuleId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete scoring rule?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the rule. Existing contact scores won't change until you click "Recompute all scores".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingRuleId && deleteRule.mutate(deletingRuleId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
