import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  Users,
  Search,
  Mail,
  Building2,
  Calendar,
  Globe,
  MousePointerClick,
  MailOpen,
  Send,
  FileText,
  Share2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  GitMerge,
  Filter,
  Plus,
  Trash2,
  Eye,
  Pencil,
  CheckCircle2,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MarketingContact {
  id: string;
  tenantDomain: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  lifecycleStage: string;
  hubspotContactId: string | null;
  source: string;
  lastEventAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ContactEvent {
  id: string;
  contactId: string;
  tenantDomain: string;
  eventType: string;
  source: string | null;
  occurredAt: string;
  metadata: Record<string, unknown> | null;
}

interface ContactsResponse {
  data: MarketingContact[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface SegmentRule {
  field: string;
  op: string;
  value: string | string[] | number;
}
const LIFECYCLE_STAGES = [
  { value: "subscriber", label: "Subscriber", color: "bg-slate-500" },
  { value: "lead", label: "Lead", color: "bg-blue-500" },
  { value: "mql", label: "MQL", color: "bg-violet-500" },
  { value: "sql", label: "SQL", color: "bg-orange-500" },
  { value: "opportunity", label: "Opportunity", color: "bg-yellow-500" },
  { value: "customer", label: "Customer", color: "bg-green-500" },
  { value: "evangelist", label: "Evangelist", color: "bg-pink-500" },
];

const EVENT_TYPE_CONFIG: Record<
  string,
  { icon: React.ElementType; label: string; color: string }
> = {
  form_submit: { icon: FileText, label: "Form submitted", color: "text-blue-400" },
  page_view: { icon: Globe, label: "Page viewed", color: "text-slate-400" },
  email_sent: { icon: Send, label: "Email sent", color: "text-slate-400" },
  email_open: { icon: MailOpen, label: "Email opened", color: "text-green-400" },
  email_click: { icon: MousePointerClick, label: "Email link clicked", color: "text-violet-400" },
  link_click: { icon: MousePointerClick, label: "Link clicked", color: "text-orange-400" },
  social_engage: { icon: Share2, label: "Social engagement", color: "text-pink-400" },
};

const RULE_FIELD_OPTIONS = [
  { value: "lifecycleStage", label: "Lifecycle stage" },
  { value: "source", label: "Source" },
  { value: "company", label: "Company" },
  { value: "domain", label: "Email domain" },
  { value: "eventType", label: "Activity type" },
  { value: "lastEventAt", label: "Last activity" },
];
function LifecycleBadge({ stage }: { stage: string }) {
  const config = LIFECYCLE_STAGES.find((s) => s.value === stage);
  return (
    <Badge
      variant="outline"
      className={`text-xs capitalize border-0 text-white ${config?.color ?? "bg-slate-500"}`}
    >
      {config?.label ?? stage}
    </Badge>
  );
}

function ContactDisplayName({ contact }: { contact: MarketingContact }) {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  return <span className="font-medium">{name || contact.email}</span>;
}

function EventIcon({ eventType }: { eventType: string }) {
  const config = EVENT_TYPE_CONFIG[eventType];
  if (!config) return <Globe className="h-3.5 w-3.5 text-slate-400" />;
  const Icon = config.icon;
  return <Icon className={`h-3.5 w-3.5 ${config.color}`} />;
}

type AttributionModel = "first-touch" | "last-touch" | "linear" | "position-based";

const ATTRIBUTION_MODEL_LABELS: Record<AttributionModel, string> = {
  "first-touch": "First Touch",
  "last-touch": "Last Touch",
  "linear": "Linear",
  "position-based": "Position-Based",
};

interface JourneyStep {
  id: string;
  occurredAt: string;
  eventType: string;
  channel: string;
  source: string | null;
  campaignId: string | null;
  campaignName: string | null;
  isConversion: boolean;
  credit: number | null;
  creditPct: string | null;
  metadata: Record<string, unknown> | null;
}

interface JourneyResult {
  contact: MarketingContact;
  model: AttributionModel;
  journey: JourneyStep[];
  hasConversion: boolean;
  conversionCount: number;
}

function CustomerJourneyTab({ contact }: { contact: MarketingContact }) {
  const [model, setModel] = useState<AttributionModel>("last-touch");

  const { data, isLoading } = useQuery<JourneyResult | null>({
    queryKey: ["/api/marketing-contacts", contact.id, "journey", model],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-contacts/${contact.id}/journey?model=${model}`);
      if (!res.ok) throw new Error("Failed to load journey");
      return res.json();
    },
  });

  return (
    <div className="space-y-3">
      {/* Model selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Attribution:</span>
        <Select value={model} onValueChange={(v) => setModel(v as AttributionModel)}>
          <SelectTrigger className="h-7 text-xs w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.entries(ATTRIBUTION_MODEL_LABELS) as [AttributionModel, string][]).map(([k, label]) => (
              <SelectItem key={k} value={k} className="text-xs">{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data || data.journey.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No touchpoints recorded yet.</p>
      ) : (
        <>
          {data.hasConversion && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {data.conversionCount} conversion{data.conversionCount !== 1 ? "s" : ""} detected — credit allocated using {ATTRIBUTION_MODEL_LABELS[model]}
            </div>
          )}
          {!data.hasConversion && (
            <p className="text-xs text-muted-foreground">No conversion events found. Showing full touchpoint sequence.</p>
          )}
          <ol className="relative border-l border-border ml-2 space-y-3">
            {data.journey.map((step) => {
              const config = EVENT_TYPE_CONFIG[step.eventType];
              const Icon = step.isConversion ? CheckCircle2 : (config?.icon ?? Globe);
              const iconColor = step.isConversion ? "text-emerald-500" : (config?.color ?? "text-slate-400");
              return (
                <li key={step.id} className="ml-4">
                  <span className={`absolute -left-2 flex h-4 w-4 items-center justify-center rounded-full border border-border ${step.isConversion ? "bg-emerald-50 dark:bg-emerald-950" : "bg-muted"}`}>
                    <Icon className={`h-2.5 w-2.5 ${iconColor}`} />
                  </span>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <p className={`text-sm font-medium leading-tight ${step.isConversion ? "text-emerald-600" : ""}`}>
                        {step.isConversion ? "Conversion" : (config?.label ?? step.eventType)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(step.occurredAt), { addSuffix: true })}
                        {" · "}{step.channel}
                        {step.campaignName && <span className="text-primary"> · {step.campaignName}</span>}
                      </p>
                    </div>
                    {step.creditPct && (
                      <Badge variant="secondary" className="shrink-0 text-xs font-mono">
                        {step.creditPct}
                      </Badge>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}

function TimelinePanel({
  contact,
  open,
  onClose,
}: {
  contact: MarketingContact | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: events, isLoading } = useQuery<ContactEvent[]>({
    queryKey: ["/api/marketing-contacts", contact?.id, "events"],
    queryFn: async () => {
      if (!contact) return [];
      const res = await fetch(`/api/marketing-contacts/${contact.id}/events`);
      if (!res.ok) throw new Error("Failed to load events");
      return res.json();
    },
    enabled: !!contact && open,
  });

  const name = contact
    ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email
    : "";

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-[420px] sm:w-[520px] overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            {name}
          </SheetTitle>
          <SheetDescription>
            <span className="text-xs text-muted-foreground">{contact?.email}</span>
          </SheetDescription>
          {contact && (
            <div className="flex flex-col gap-1 pt-1">
              <LifecycleBadge stage={contact.lifecycleStage} />
              {contact.company && (
                <span className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                  <Building2 className="h-3 w-3" /> {contact.company}
                  {contact.jobTitle ? ` · ${contact.jobTitle}` : ""}
                </span>
              )}
              {contact.lastEventAt && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Last activity{" "}
                  {formatDistanceToNow(new Date(contact.lastEventAt), { addSuffix: true })}
                </span>
              )}
            </div>
          )}
        </SheetHeader>

        <div className="pt-4">
          <Tabs defaultValue="timeline">
            <TabsList className="w-full mb-4">
              <TabsTrigger value="timeline" className="flex-1 text-xs">
                Activity Timeline
              </TabsTrigger>
              <TabsTrigger value="journey" className="flex-1 text-xs gap-1">
                <GitMerge className="h-3.5 w-3.5" />
                Customer Journey
              </TabsTrigger>
            </TabsList>

            <TabsContent value="timeline">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : !events || events.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No activity yet.</p>
              ) : (
                <ol className="relative border-l border-border ml-2 space-y-4">
                  {events.map((ev) => {
                    const config = EVENT_TYPE_CONFIG[ev.eventType];
                    const Icon = config?.icon ?? Globe;
                    return (
                      <li key={ev.id} className="ml-4">
                        <span className="absolute -left-2 flex h-4 w-4 items-center justify-center rounded-full bg-muted border border-border">
                          <Icon className={`h-2.5 w-2.5 ${config?.color ?? "text-slate-400"}`} />
                        </span>
                        <div className="flex flex-col gap-0.5">
                          <p className="text-sm font-medium leading-tight">
                            {config?.label ?? ev.eventType}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(ev.occurredAt), { addSuffix: true })}
                            {ev.source ? ` · via ${ev.source}` : ""}
                          </p>
                          {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                            <p className="text-xs text-muted-foreground font-mono truncate">
                              {JSON.stringify(ev.metadata).slice(0, 80)}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </TabsContent>

            <TabsContent value="journey">
              {contact && <CustomerJourneyTab contact={contact} />}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function RuleValueInput({
  rule,
  onChange,
}: {
  rule: SegmentRule;
  onChange: (value: string | string[] | number) => void;
}) {
  const { field, op } = rule;

  if (field === "lifecycleStage") {
    if (op === "eq") {
      return (
        <Select value={rule.value as string} onValueChange={onChange}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Choose stage" />
          </SelectTrigger>
          <SelectContent>
            {LIFECYCLE_STAGES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    // "in" — multi-select via comma-separated display
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap gap-1">
          {LIFECYCLE_STAGES.map((s) => {
            const selected = Array.isArray(rule.value) && (rule.value as string[]).includes(s.value);
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => {
                  const current = Array.isArray(rule.value) ? (rule.value as string[]) : [];
                  onChange(
                    selected ? current.filter((v) => v !== s.value) : [...current, s.value],
                  );
                }}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  selected
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:border-primary"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (field === "eventType") {
    return (
      <Select value={rule.value as string} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Choose activity" />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(EVENT_TYPE_CONFIG).map(([k, v]) => (
            <SelectItem key={k} value={k}>
              {v.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field === "lastEventAt") {
    return (
      <Input
        type="number"
        min={1}
        placeholder="days"
        className="h-8 text-xs w-24"
        value={rule.value as number}
        onChange={(e) => onChange(Math.max(1, parseInt(e.target.value, 10) || 1))}
      />
    );
  }

  // source, company, domain — text input
  if (op === "in") {
    return (
      <Input
        className="h-8 text-xs"
        placeholder="Comma-separated values"
        value={Array.isArray(rule.value) ? (rule.value as string[]).join(", ") : (rule.value as string)}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      />
    );
  }

  return (
    <Input
      className="h-8 text-xs"
      placeholder="Value"
      value={rule.value as string}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
export default function ContactsPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [lifecycle, setLifecycle] = useState<string>("");
  const [selectedContact, setSelectedContact] = useState<MarketingContact | null>(null);

  const debouncedQ = useDebouncedValue(q, 300);

  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (debouncedQ) params.set("q", debouncedQ);
  if (lifecycle) params.set("lifecycle", lifecycle);

  const { data, isLoading, isError } = useQuery<ContactsResponse>({
    queryKey: ["/api/marketing-contacts", page, debouncedQ, lifecycle],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-contacts?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load contacts");
      return res.json();
    },
  });

  const contacts = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <AppLayout>
      <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6 text-primary" />
              Contacts
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Marketing contacts with lifecycle stage, activity timeline, and saved segments.
            </p>
          </div>
        </div>

        <Tabs defaultValue="contacts">
          <TabsList className="mb-2">
            <TabsTrigger value="contacts" className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" /> Contacts
            </TabsTrigger>
            <TabsTrigger value="segments" className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5" /> Segments
            </TabsTrigger>
          </TabsList>

          {/* ── Contacts tab ── */}
          <TabsContent value="contacts">
            {/* Filters */}
            <div className="flex gap-3 flex-wrap mb-4">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search by name, email, or company…"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <Select
                value={lifecycle || "__all"}
                onValueChange={(v) => {
                  setLifecycle(v === "__all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[170px]">
                  <SelectValue placeholder="All stages" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All stages</SelectItem>
                  {LIFECYCLE_STAGES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {pagination ? `${pagination.total.toLocaleString()} contacts` : "Contacts"}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : isError ? (
                  <p className="text-center text-sm text-muted-foreground py-16">
                    Failed to load contacts.
                  </p>
                ) : contacts.length === 0 ? (
                  <div className="text-center py-16">
                    <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      {debouncedQ || lifecycle
                        ? "No contacts match your filters."
                        : "No contacts yet. Events from your website will appear here once the webhook is configured."}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                            Name / Email
                          </th>
                          <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden sm:table-cell">
                            Company
                          </th>
                          <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                            Stage
                          </th>
                          <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden md:table-cell">
                            Last activity
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {contacts.map((contact) => (
                          <tr
                            key={contact.id}
                            className="border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer transition-colors"
                            onClick={() => setSelectedContact(contact)}
                          >
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-0.5">
                                <ContactDisplayName contact={contact} />
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Mail className="h-3 w-3" />
                                  {contact.email}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">
                              {contact.company ? (
                                <span className="flex items-center gap-1">
                                  <Building2 className="h-3 w-3" />
                                  {contact.company}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <LifecycleBadge stage={contact.lifecycleStage} />
                            </td>
                            <td className="px-4 py-3 text-muted-foreground text-xs hidden md:table-cell">
                              {contact.lastEventAt ? (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {formatDistanceToNow(new Date(contact.lastEventAt), {
                                    addSuffix: true,
                                  })}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Pagination */}
                {pagination && pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                    <span className="text-xs text-muted-foreground">
                      Page {pagination.page} of {pagination.totalPages}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pagination.page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pagination.page >= pagination.totalPages}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Segments tab ── */}
          <TabsContent value="segments">
            <SegmentsPanel />
          </TabsContent>
        </Tabs>
      </div>

      {/* Slide-out timeline panel */}
      <TimelinePanel
        contact={selectedContact}
        open={!!selectedContact}
        onClose={() => setSelectedContact(null)}
      />
    </AppLayout>
  );
}

function SegmentsPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSegment, setEditingSegment] = useState<ContactSegment | null>(null);

  const { data: segments = [], isLoading } = useQuery<ContactSegment[]>({
    queryKey: ["/api/marketing-contacts/segments"],
    queryFn: async () => {
      const res = await fetch("/api/marketing-contacts/segments");
      if (!res.ok) throw new Error("Failed to load segments");
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/marketing-contacts/segments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/marketing-contacts/segments"] });
      toast({ title: "Segment deleted" });
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const openCreate = () => {
    setEditingSegment(null);
    setDialogOpen(true);
  };

  const openEdit = (seg: ContactSegment) => {
    setEditingSegment(seg);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingSegment(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          Saved segments let you create named audiences from filter rules and target them in email sends.
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" /> New segment
        </Button>
      </div>

      {segments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <Filter className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground text-center">
              No segments yet. Create one to filter contacts by lifecycle, activity, source, or
              company.
            </p>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1.5" /> Create your first segment
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {segments.map((seg) => (
            <Card key={seg.id} className="hover:border-primary/40 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{seg.name}</p>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {seg.rules?.length ?? 0} rule{(seg.rules?.length ?? 0) !== 1 ? "s" : ""}
                      </Badge>
                      {seg.previewCount !== null && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {seg.previewCount.toLocaleString()} contacts
                        </Badge>
                      )}
                    </div>
                    {seg.description && (
                      <p className="text-xs text-muted-foreground">{seg.description}</p>
                    )}
                    {/* Rule summary */}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(seg.rules ?? []).slice(0, 4).map((r, i) => {
                        const fieldLabel = RULE_FIELD_OPTIONS.find((o) => o.value === r.field)?.label ?? r.field;
                        const opLabel =
                          (OP_OPTIONS_BY_FIELD[r.field] ?? []).find((o) => o.value === r.op)?.label ??
                          r.op;
                        const valLabel = Array.isArray(r.value)
                          ? (r.value as string[]).join(", ")
                          : String(r.value);
                        return (
                          <span
                            key={i}
                            className="text-xs bg-muted rounded px-1.5 py-0.5 text-muted-foreground"
                          >
                            {fieldLabel} {opLabel} <strong className="text-foreground">{valLabel}</strong>
                          </span>
                        );
                      })}
                      {(seg.rules?.length ?? 0) > 4 && (
                        <span className="text-xs text-muted-foreground px-1.5 py-0.5">
                          +{(seg.rules?.length ?? 0) - 4} more
                        </span>
                      )}
                    </div>
                    {seg.previewedAt && (
                      <p className="text-xs text-muted-foreground">
                        Last evaluated{" "}
                        {formatDistanceToNow(new Date(seg.previewedAt), { addSuffix: true })}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => openEdit(seg)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => {
                        if (confirm(`Delete segment "${seg.name}"?`)) {
                          deleteMutation.mutate(seg.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SegmentDialog open={dialogOpen} segment={editingSegment} onClose={closeDialog} />
    </>
  );
}

interface ContactSegment {
  id: string;
  tenantDomain: string;
  name: string;
  description: string | null;
  rules: SegmentRule[];
  previewCount: number | null;
  previewedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function SegmentDialog({
  open,
  segment,
  onClose,
}: {
  open: boolean;
  segment: ContactSegment | null; // null = create mode
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [name, setName] = useState(segment?.name ?? "");
  const [description, setDescription] = useState(segment?.description ?? "");
  const [rules, setRules] = useState<SegmentRule[]>(
    segment?.rules?.length ? segment.rules : [{ ...EMPTY_RULE }],
  );
  const [preview, setPreview] = useState<SegmentPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Reset when the dialog opens with a new segment (or null for create)
  const resetTo = (seg: ContactSegment | null) => {
    setName(seg?.name ?? "");
    setDescription(seg?.description ?? "");
    setRules(seg?.rules?.length ? seg.rules : [{ ...EMPTY_RULE }]);
    setPreview(null);
  };

  // Sync state when segment prop changes (dialog reopening)
  const [lastSegmentId, setLastSegmentId] = useState<string | null>(segment?.id ?? null);
  if (segment?.id !== lastSegmentId) {
    setLastSegmentId(segment?.id ?? null);
    resetTo(segment);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), description: description.trim(), rules };
      if (segment) {
        return apiRequest("PUT", `/api/marketing-contacts/segments/${segment.id}`, body);
      }
      return apiRequest("POST", "/api/marketing-contacts/segments", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/marketing-contacts/segments"] });
      toast({ title: segment ? "Segment updated" : "Segment created" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err?.message, variant: "destructive" });
    },
  });

  const handlePreview = async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      const res = await apiRequest("POST", "/api/marketing-contacts/segments/preview", { rules });
      const data = await res.json();
      setPreview(data);
    } catch {
      toast({ title: "Preview failed", variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  };

  const updateRule = (i: number, r: SegmentRule) => {
    setRules((prev) => prev.map((x, idx) => (idx === i ? r : x)));
    setPreview(null);
  };
  const removeRule = (i: number) => {
    setRules((prev) => prev.filter((_, idx) => idx !== i));
    setPreview(null);
  };
  const addRule = () => {
    setRules((prev) => [...prev, { ...EMPTY_RULE }]);
    setPreview(null);
  };

  const isValid = name.trim().length > 0 && rules.length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" />
            {segment ? "Edit segment" : "New segment"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Segment name</Label>
            <Input
              placeholder="e.g. Active MQLs from webinar"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              placeholder="Who is this segment for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>

          {/* Rules */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Filter rules</Label>
              <span className="text-xs text-muted-foreground">All rules must match (AND)</span>
            </div>
            <div className="flex flex-col gap-2 p-3 rounded-md border border-border bg-muted/20">
              {rules.map((rule, i) => (
                <RuleRow
                  key={i}
                  rule={rule}
                  index={i}
                  onUpdate={updateRule}
                  onRemove={removeRule}
                />
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start text-xs text-muted-foreground mt-1"
                onClick={addRule}
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Add rule
              </Button>
            </div>
          </div>

          {/* Preview */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handlePreview}
                disabled={previewing || rules.length === 0}
              >
                {previewing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5 mr-1.5" />
                )}
                Preview matches
              </Button>
              {preview !== null && (
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <strong>{preview.count.toLocaleString()}</strong> contact{preview.count !== 1 ? "s" : ""} match
                </span>
              )}
            </div>
            {preview && preview.contacts.length > 0 && (
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border">
                      <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Name / Email</th>
                      <th className="text-left px-3 py-1.5 font-medium text-muted-foreground hidden sm:table-cell">Stage</th>
                      <th className="text-left px-3 py-1.5 font-medium text-muted-foreground hidden sm:table-cell">Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.contacts.slice(0, 10).map((c) => {
                      const n = [c.firstName, c.lastName].filter(Boolean).join(" ");
                      return (
                        <tr key={c.id} className="border-b border-border last:border-0">
                          <td className="px-3 py-1.5">
                            <div className="flex flex-col">
                              <span className="font-medium">{n || c.email}</span>
                              {n && <span className="text-muted-foreground">{c.email}</span>}
                            </div>
                          </td>
                          <td className="px-3 py-1.5 hidden sm:table-cell">
                            <LifecycleBadge stage={c.lifecycleStage} />
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground hidden sm:table-cell">
                            {c.lastEventAt
                              ? formatDistanceToNow(new Date(c.lastEventAt), { addSuffix: true })
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {preview.count > 10 && (
                  <p className="text-xs text-muted-foreground text-center py-2 border-t border-border">
                    Showing first 10 of {preview.count.toLocaleString()}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!isValid || saveMutation.isPending}
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            {segment ? "Save changes" : "Create segment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const OP_OPTIONS_BY_FIELD: Record<string, { value: string; label: string }[]> = {
  lifecycleStage: [
    { value: "eq", label: "is" },
    { value: "in", label: "is any of" },
  ],
  source: [
    { value: "eq", label: "is" },
    { value: "in", label: "is any of" },
  ],
  company: [
    { value: "contains", label: "contains" },
    { value: "eq", label: "is exactly" },
  ],
  domain: [
    { value: "eq", label: "is" },
    { value: "in", label: "is any of" },
  ],
  eventType: [
    { value: "seen", label: "has performed" },
    { value: "not_seen", label: "has never performed" },
  ],
  lastEventAt: [
    { value: "within_days", label: "within last N days" },
    { value: "older_than_days", label: "more than N days ago" },
  ],
};

const EMPTY_RULE: SegmentRule = { field: "lifecycleStage", op: "eq", value: "" };

interface SegmentPreviewResult {
  count: number;
  contacts: MarketingContact[];
}

function RuleRow({
  rule,
  index,
  onUpdate,
  onRemove,
}: {
  rule: SegmentRule;
  index: number;
  onUpdate: (index: number, r: SegmentRule) => void;
  onRemove: (index: number) => void;
}) {
  const opsForField = OP_OPTIONS_BY_FIELD[rule.field] ?? [{ value: "eq", label: "is" }];

  const handleFieldChange = (field: string) => {
    const firstOp = (OP_OPTIONS_BY_FIELD[field] ?? [{ value: "eq" }])[0].value;
    const defaultVal = field === "lastEventAt" ? 30 : field === "lifecycleStage" && firstOp === "in" ? [] : "";
    onUpdate(index, { field, op: firstOp, value: defaultVal });
  };

  const handleOpChange = (op: string) => {
    const defaultVal =
      op === "in" ? (Array.isArray(rule.value) ? rule.value : [])
      : op === "within_days" || op === "older_than_days" ? 30
      : typeof rule.value === "string" ? rule.value
      : "";
    onUpdate(index, { ...rule, op, value: defaultVal });
  };

  return (
    <div className="flex items-start gap-2 flex-wrap">
      <Select value={rule.field} onValueChange={handleFieldChange}>
        <SelectTrigger className="h-8 text-xs w-[150px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RULE_FIELD_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={rule.op} onValueChange={handleOpChange}>
        <SelectTrigger className="h-8 text-xs w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opsForField.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex-1 min-w-[140px]">
        <RuleValueInput
          rule={rule}
          onChange={(value) => onUpdate(index, { ...rule, value })}
        />
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground"
        onClick={() => onRemove(index)}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
