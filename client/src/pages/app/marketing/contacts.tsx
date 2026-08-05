import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
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
  CheckCircle2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

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
              Marketing contacts with lifecycle stage and activity timeline.
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
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
