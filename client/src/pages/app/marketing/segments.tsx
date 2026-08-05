import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Plus,
  RefreshCw,
  Trash2,
  Users,
  Filter,
  Pencil,
  ChevronRight,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ───────────────────────────────────────────────────────────────────

type FieldOperator =
  | "eq" | "neq"
  | "contains" | "not_contains"
  | "starts_with" | "ends_with"
  | "is_null" | "is_not_null";

type EventOperator = "has_done" | "has_not_done";

interface FieldCondition {
  type: "field";
  field: string;
  operator: FieldOperator;
  value?: string;
}

interface EventCondition {
  type: "event";
  eventType: string;
  operator: EventOperator;
  withinDays?: number;
}

type Condition = FieldCondition | EventCondition;

interface SegmentRule {
  logic: "AND" | "OR";
  conditions: Condition[];
}

interface Segment {
  id: string;
  name: string;
  description: string | null;
  ruleJson: SegmentRule;
  refreshIntervalMinutes: number;
  lastRefreshedAt: string | null;
  hubspotListId: string | null;
  isActive: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FIELD_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "company", label: "Company" },
  { value: "jobTitle", label: "Job title" },
  { value: "lifecycleStage", label: "Lifecycle stage" },
  { value: "source", label: "Source" },
];

const LIFECYCLE_VALUES = [
  "subscriber", "lead", "mql", "sql", "opportunity", "customer", "evangelist",
];

const TEXT_OPERATORS: { value: FieldOperator; label: string }[] = [
  { value: "eq", label: "is" },
  { value: "neq", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "is_null", label: "is empty" },
  { value: "is_not_null", label: "is not empty" },
];

const EVENT_TYPES = [
  "email_sent", "email_open", "email_click",
  "form_submit", "page_view", "link_click", "social_engage",
];

const EVENT_OPERATORS: { value: EventOperator; label: string }[] = [
  { value: "has_done", label: "has done" },
  { value: "has_not_done", label: "has not done" },
];

const REFRESH_OPTIONS = [
  { value: 15, label: "Every 15 minutes" },
  { value: 60, label: "Every hour" },
  { value: 360, label: "Every 6 hours" },
  { value: 1440, label: "Daily" },
  { value: 0, label: "Manual only" },
];

// ─── Condition Builder ────────────────────────────────────────────────────────

function ConditionRow({
  condition,
  index,
  onChange,
  onRemove,
}: {
  condition: Condition;
  index: number;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  const needsValue = (op: string) => !["is_null", "is_not_null"].includes(op);

  if (condition.type === "field") {
    const fc = condition as FieldCondition;
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
        <span className="text-xs text-muted-foreground min-w-[14px]">{index + 1}.</span>
        <Select
          value={fc.field}
          onValueChange={(v) => onChange({ ...fc, field: v, value: "" })}
        >
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_OPTIONS.map((f) => (
              <SelectItem key={f.value} value={f.value} className="text-xs">
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={fc.operator}
          onValueChange={(v) => onChange({ ...fc, operator: v as FieldOperator })}
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TEXT_OPERATORS.map((op) => (
              <SelectItem key={op.value} value={op.value} className="text-xs">
                {op.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {needsValue(fc.operator) && (
          fc.field === "lifecycleStage" ? (
            <Select
              value={fc.value ?? ""}
              onValueChange={(v) => onChange({ ...fc, value: v })}
            >
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue placeholder="Select stage" />
              </SelectTrigger>
              <SelectContent>
                {LIFECYCLE_VALUES.map((v) => (
                  <SelectItem key={v} value={v} className="text-xs capitalize">
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              className="h-8 w-40 text-xs"
              placeholder="Value"
              value={fc.value ?? ""}
              onChange={(e) => onChange({ ...fc, value: e.target.value })}
            />
          )
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={onRemove}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  // Event condition
  const ec = condition as EventCondition;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
      <span className="text-xs text-muted-foreground min-w-[14px]">{index + 1}.</span>
      <span className="text-xs font-medium">Contact</span>
      <Select
        value={ec.operator}
        onValueChange={(v) => onChange({ ...ec, operator: v as EventOperator })}
      >
        <SelectTrigger className="h-8 w-32 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EVENT_OPERATORS.map((op) => (
            <SelectItem key={op.value} value={op.value} className="text-xs">
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={ec.eventType}
        onValueChange={(v) => onChange({ ...ec, eventType: v })}
      >
        <SelectTrigger className="h-8 w-36 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EVENT_TYPES.map((t) => (
            <SelectItem key={t} value={t} className="text-xs">
              {t.replace(/_/g, " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        className="h-8 w-24 text-xs"
        type="number"
        placeholder="within N days"
        value={ec.withinDays ?? ""}
        onChange={(e) => onChange({ ...ec, withinDays: e.target.value ? parseInt(e.target.value, 10) : undefined })}
      />
      {ec.withinDays ? <span className="text-xs text-muted-foreground">days</span> : null}
      <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={onRemove}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ─── Rule Builder ─────────────────────────────────────────────────────────────

function RuleBuilder({
  rule,
  onChange,
  previewCount,
  isPreviewLoading,
}: {
  rule: SegmentRule;
  onChange: (r: SegmentRule) => void;
  previewCount: number | null;
  isPreviewLoading: boolean;
}) {
  const addField = () => {
    onChange({
      ...rule,
      conditions: [
        ...rule.conditions,
        { type: "field", field: "lifecycleStage", operator: "eq", value: "lead" } as FieldCondition,
      ],
    });
  };

  const addEvent = () => {
    onChange({
      ...rule,
      conditions: [
        ...rule.conditions,
        { type: "event", eventType: "email_open", operator: "has_done" } as EventCondition,
      ],
    });
  };

  const updateCondition = (index: number, cond: Condition) => {
    const conditions = [...rule.conditions];
    conditions[index] = cond;
    onChange({ ...rule, conditions });
  };

  const removeCondition = (index: number) => {
    const conditions = rule.conditions.filter((_, i) => i !== index);
    onChange({ ...rule, conditions });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Match</span>
        <Select
          value={rule.logic}
          onValueChange={(v) => onChange({ ...rule, logic: v as "AND" | "OR" })}
        >
          <SelectTrigger className="h-8 w-20 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AND" className="text-xs">ALL</SelectItem>
            <SelectItem value="OR" className="text-xs">ANY</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">of the following conditions</span>
        <div className="ml-auto text-sm">
          {isPreviewLoading ? (
            <span className="text-muted-foreground">Counting…</span>
          ) : previewCount !== null ? (
            <span className="font-semibold text-primary">{previewCount.toLocaleString()} contacts match</span>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        {rule.conditions.length === 0 && (
          <p className="text-xs text-muted-foreground py-2 text-center border rounded-md">
            No conditions — add one below
          </p>
        )}
        {rule.conditions.map((cond, i) => (
          <ConditionRow
            key={i}
            condition={cond}
            index={i}
            onChange={(c) => updateCondition(i, c)}
            onRemove={() => removeCondition(i)}
          />
        ))}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="text-xs h-7" onClick={addField}>
          <Plus className="h-3 w-3 mr-1" /> Add property filter
        </Button>
        <Button variant="outline" size="sm" className="text-xs h-7" onClick={addEvent}>
          <Plus className="h-3 w-3 mr-1" /> Add event filter
        </Button>
      </div>
    </div>
  );
}

// ─── Segment Dialog ───────────────────────────────────────────────────────────

function SegmentDialog({
  open,
  onClose,
  segment,
}: {
  open: boolean;
  onClose: () => void;
  segment?: Segment;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isEdit = !!segment;
  const [name, setName] = useState(segment?.name ?? "");
  const [description, setDescription] = useState(segment?.description ?? "");
  const [rule, setRule] = useState<SegmentRule>(
    segment?.ruleJson ?? { logic: "AND", conditions: [] },
  );
  const [refreshInterval, setRefreshInterval] = useState(
    segment?.refreshIntervalMinutes ?? 60,
  );
  const [hubspotListId, setHubspotListId] = useState(segment?.hubspotListId ?? "");
  const [previewCount, setPreviewCount] = useState<number | null>(
    segment ? segment.memberCount : null,
  );
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const debouncedPreview = (() => {
    let timer: ReturnType<typeof setTimeout>;
    return (r: SegmentRule) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        setIsPreviewLoading(true);
        try {
          const res = await apiRequest("POST", "/api/marketing-segments/preview", { ruleJson: r });
          const data = await res.json();
          setPreviewCount(data.count ?? 0);
        } catch { /* ignore */ }
        finally { setIsPreviewLoading(false); }
      }, 600);
    };
  })();

  const handleRuleChange = (r: SegmentRule) => {
    setRule(r);
    debouncedPreview(r);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name,
        description: description || null,
        ruleJson: rule,
        refreshIntervalMinutes: refreshInterval,
        hubspotListId: hubspotListId || null,
      };
      if (isEdit) {
        return apiRequest("PATCH", `/api/marketing-segments/${segment!.id}`, body).then((r) => r.json());
      } else {
        return apiRequest("POST", "/api/marketing-segments", body).then((r) => r.json());
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing-segments"] });
      toast({ title: isEdit ? "Segment updated" : "Segment created" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Segment" : "Create Segment"}</DialogTitle>
          <DialogDescription>
            Define rule-based conditions to automatically build a contact list.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input
                placeholder="e.g. Hot leads this month"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Refresh cadence</Label>
              <Select
                value={String(refreshInterval)}
                onValueChange={(v) => setRefreshInterval(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REFRESH_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              placeholder="Optional description…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Rules</Label>
            <RuleBuilder
              rule={rule}
              onChange={handleRuleChange}
              previewCount={previewCount}
              isPreviewLoading={isPreviewLoading}
            />
          </div>

          <Separator />

          <div className="space-y-1.5">
            <Label>HubSpot list ID (optional)</Label>
            <Input
              placeholder="e.g. 12345"
              value={hubspotListId}
              onChange={(e) => setHubspotListId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              When set, segment members are mirrored to this HubSpot static list after each refresh.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!name.trim() || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Create segment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Lifecycle badge ──────────────────────────────────────────────────────────

const LIFECYCLE_COLORS: Record<string, string> = {
  subscriber: "bg-slate-100 text-slate-700",
  lead: "bg-blue-100 text-blue-700",
  mql: "bg-indigo-100 text-indigo-700",
  sql: "bg-purple-100 text-purple-700",
  opportunity: "bg-yellow-100 text-yellow-700",
  customer: "bg-green-100 text-green-700",
  evangelist: "bg-pink-100 text-pink-700",
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SegmentsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [editSegment, setEditSegment] = useState<Segment | undefined>();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const { data: segments = [], isLoading } = useQuery<Segment[]>({
    queryKey: ["/api/marketing-segments"],
  });

  const { data: membersData } = useQuery<{
    members: any[];
    total: number;
    page: number;
    limit: number;
  }>({
    queryKey: ["/api/marketing-segments", selectedId, "members"],
    queryFn: () =>
      fetch(`/api/marketing-segments/${selectedId}/members?limit=50`).then((r) => r.json()),
    enabled: !!selectedId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/marketing-segments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing-segments"] });
      if (selectedId === deleteId) setSelectedId(null);
      toast({ title: "Segment deleted" });
      setDeleteId(null);
    },
    onError: () => toast({ title: "Failed to delete segment", variant: "destructive" }),
  });

  const refreshSegment = async (id: string) => {
    setRefreshingId(id);
    try {
      const res = await apiRequest("POST", `/api/marketing-segments/${id}/refresh`);
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/marketing-segments"] });
      if (selectedId === id) {
        queryClient.invalidateQueries({ queryKey: ["/api/marketing-segments", id, "members"] });
      }
      toast({ title: `Refreshed — ${data.memberCount.toLocaleString()} members` });
    } catch {
      toast({ title: "Refresh failed", variant: "destructive" });
    } finally {
      setRefreshingId(null);
    }
  };

  const selectedSegment = segments.find((s) => s.id === selectedId);

  return (
    <AppLayout>
      <div className="flex h-full">
        {/* ── Left: Segment list ───────────────────────────────────────────── */}
        <div className="flex-shrink-0 w-80 border-r flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div>
              <h1 className="text-base font-semibold">Segments</h1>
              <p className="text-xs text-muted-foreground">Rule-based contact lists</p>
            </div>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1" />
              New
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
                ))}
              </div>
            ) : segments.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <Filter className="h-8 w-8 mx-auto mb-2 opacity-40" />
                No segments yet. Create one to get started.
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {segments.map((seg) => (
                  <button
                    key={seg.id}
                    className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors hover:bg-accent ${
                      selectedId === seg.id ? "bg-accent" : ""
                    }`}
                    onClick={() => setSelectedId(seg.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{seg.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Users className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <span className="text-xs text-muted-foreground">
                            {seg.memberCount.toLocaleString()} contacts
                          </span>
                          {!seg.isActive && (
                            <Badge variant="secondary" className="text-[10px] px-1 py-0">
                              Paused
                            </Badge>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Detail panel ──────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {!selectedSegment ? (
            <div className="h-full flex items-center justify-center text-center p-8">
              <div>
                <Filter className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-40" />
                <p className="text-sm text-muted-foreground">
                  Select a segment to view its members and rules.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">{selectedSegment.name}</h2>
                  {selectedSegment.description && (
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {selectedSegment.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5">
                    <Badge variant="secondary" className="text-xs">
                      <Users className="h-3 w-3 mr-1" />
                      {selectedSegment.memberCount.toLocaleString()} members
                    </Badge>
                    {selectedSegment.lastRefreshedAt && (
                      <span className="text-xs text-muted-foreground">
                        Refreshed {formatDistanceToNow(new Date(selectedSegment.lastRefreshedAt), { addSuffix: true })}
                      </span>
                    )}
                    {selectedSegment.hubspotListId && (
                      <Badge variant="outline" className="text-xs">
                        HubSpot list #{selectedSegment.hubspotListId}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refreshSegment(selectedSegment.id)}
                    disabled={refreshingId === selectedSegment.id}
                  >
                    <RefreshCw
                      className={`h-4 w-4 mr-1.5 ${refreshingId === selectedSegment.id ? "animate-spin" : ""}`}
                    />
                    Refresh
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditSegment(selectedSegment)}
                  >
                    <Pencil className="h-4 w-4 mr-1.5" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteId(selectedSegment.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Rules summary */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Filter className="h-4 w-4" />
                    Rules
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Match <strong>{selectedSegment.ruleJson?.logic === "OR" ? "ANY" : "ALL"}</strong> of the following
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {(!selectedSegment.ruleJson?.conditions?.length) ? (
                    <p className="text-xs text-muted-foreground">No conditions defined — segment matches no contacts.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {selectedSegment.ruleJson.conditions.map((cond, i) => (
                        <li key={i} className="text-xs flex items-center gap-2 rounded bg-muted/50 px-3 py-1.5">
                          {cond.type === "field" ? (
                            <>
                              <span className="font-medium capitalize">{(cond as FieldCondition).field}</span>
                              <span className="text-muted-foreground">{(cond as FieldCondition).operator.replace(/_/g, " ")}</span>
                              {(cond as FieldCondition).value && (
                                <span className="font-medium">{(cond as FieldCondition).value}</span>
                              )}
                            </>
                          ) : (
                            <>
                              <span className="text-muted-foreground">Contact</span>
                              <span className="font-medium">{(cond as EventCondition).operator.replace(/_/g, " ")}</span>
                              <span className="text-muted-foreground">{(cond as EventCondition).eventType.replace(/_/g, " ")}</span>
                              {(cond as EventCondition).withinDays && (
                                <span className="text-muted-foreground">
                                  within {(cond as EventCondition).withinDays} days
                                </span>
                              )}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {/* Members table */}
              <div>
                <h3 className="text-sm font-medium mb-3">
                  Members
                  {membersData && (
                    <span className="ml-2 text-muted-foreground font-normal">
                      ({membersData.total.toLocaleString()})
                    </span>
                  )}
                </h3>
                {!membersData ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-10 rounded bg-muted animate-pulse" />
                    ))}
                  </div>
                ) : membersData.members.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                    No members yet. Try refreshing the segment.
                  </p>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 text-xs text-muted-foreground">
                          <th className="text-left px-3 py-2 font-medium">Email</th>
                          <th className="text-left px-3 py-2 font-medium">Name</th>
                          <th className="text-left px-3 py-2 font-medium">Company</th>
                          <th className="text-left px-3 py-2 font-medium">Stage</th>
                          <th className="text-left px-3 py-2 font-medium">Added</th>
                        </tr>
                      </thead>
                      <tbody>
                        {membersData.members.map((m: any) => (
                          <tr
                            key={m.contactId}
                            className="border-t hover:bg-muted/30 transition-colors"
                          >
                            <td className="px-3 py-2 text-xs font-mono">{m.email}</td>
                            <td className="px-3 py-2 text-xs">
                              {[m.firstName, m.lastName].filter(Boolean).join(" ") || "—"}
                            </td>
                            <td className="px-3 py-2 text-xs">{m.company || "—"}</td>
                            <td className="px-3 py-2">
                              <span
                                className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                                  LIFECYCLE_COLORS[m.lifecycleStage] ?? "bg-muted text-foreground"
                                }`}
                              >
                                {m.lifecycleStage}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(m.addedAt), { addSuffix: true })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {membersData.total > membersData.members.length && (
                      <p className="text-xs text-muted-foreground text-center py-2 border-t">
                        Showing {membersData.members.length} of {membersData.total.toLocaleString()} members
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create dialog */}
      {showCreate && (
        <SegmentDialog open onClose={() => setShowCreate(false)} />
      )}

      {/* Edit dialog */}
      {editSegment && (
        <SegmentDialog
          open
          onClose={() => setEditSegment(undefined)}
          segment={editSegment}
        />
      )}

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete segment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the segment and its membership table. Email sends
              already queued against this segment will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
