import { useEffect, useRef, useState } from "react";
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
  DialogDescription,
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
  Briefcase,
  TrendingUp,
  ExternalLink,
  BookOpen,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  Upload,
  Linkedin,
  UserPlus,
  CloudDownload,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { parseCSV } from "@/lib/csv-export";
import { useUser } from "@/lib/userContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CampaignMembership {
  prospectId: string;
  status: string | null;
  icpScore: number | null;
  campaignId: string | null;
  campaignName: string | null;
  updatedAt: string | null;
}

interface MarketingContact {
  id: string;
  tenantDomain: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  linkedinUrl: string | null;
  lifecycleStage: string;
  hubspotContactId: string | null;
  source: string;
  sourceProspectId: string | null;
  lastEventAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Sales context (null when contact has no linked prospect)
  prospectStatus: string | null;
  prospectIcpScore: number | null;
  outreachCampaignId: string | null;
  outreachCampaignName: string | null;
  // Full membership list — only populated on the single-contact endpoint
  campaignMemberships?: CampaignMembership[];
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
  // Sales outreach events surfaced from the outreach pipeline
  sales_outreach: { icon: Briefcase, label: "Sales outreach", color: "text-amber-500" },
};

// ---------------------------------------------------------------------------
// Origin / source helpers
// ---------------------------------------------------------------------------

const ORIGIN_CONFIG: Record<string, { label: string; color: string }> = {
  // Marketing ingest paths
  manual:          { label: "Manual",              color: "bg-slate-500" },
  hubspot:         { label: "HubSpot",             color: "bg-orange-500" },
  webbase:         { label: "Website",             color: "bg-blue-500" },
  import:          { label: "Import",              color: "bg-teal-500" },
  apollo:          { label: "Outbound discovery",  color: "bg-violet-600" },
  linkedin:        { label: "LinkedIn",            color: "bg-sky-600" },
  sendgrid:        { label: "SendGrid",            color: "bg-cyan-600" },
  // Sales-originated contacts (promoted from prospects)
  outreach:        { label: "Sales outreach",      color: "bg-rose-500" },
  sales_manual:    { label: "Sales manual",        color: "bg-rose-400" },
  sales_import:    { label: "Sales import",        color: "bg-rose-600" },
  sales_discovery: { label: "Sales discovery",     color: "bg-amber-600" },
  sales_hubspot:   { label: "Sales HubSpot",       color: "bg-orange-600" },
  sales_backfill:  { label: "Sales backfill",      color: "bg-slate-600" },
  salesnav:        { label: "Sales Navigator",     color: "bg-indigo-600" },
};

const ORIGIN_FILTER_OPTIONS = [
  // Marketing ingest
  { value: "manual",          label: "Manual" },
  { value: "hubspot",         label: "HubSpot" },
  { value: "webbase",         label: "Website" },
  { value: "import",          label: "Import" },
  { value: "apollo",          label: "Outbound discovery" },
  { value: "linkedin",        label: "LinkedIn" },
  // Sales-originated
  { value: "outreach",        label: "Sales outreach" },
  { value: "sales_manual",    label: "Sales manual" },
  { value: "sales_import",    label: "Sales import" },
  { value: "sales_discovery", label: "Sales discovery" },
  { value: "sales_hubspot",   label: "Sales HubSpot" },
  { value: "salesnav",        label: "Sales Navigator" },
];

function OriginBadge({ source }: { source: string }) {
  const config = ORIGIN_CONFIG[source];
  return (
    <Badge
      variant="outline"
      className={`text-xs border-0 text-white shrink-0 ${config?.color ?? "bg-slate-500"}`}
    >
      {config?.label ?? source}
    </Badge>
  );
}

const PROSPECT_STATUS_LABELS: Record<string, string> = {
  new:          "New",
  researching:  "Researching",
  ready:        "Ready",
  contacted:    "Contacted",
  engaged:      "Engaged",
  meeting_set:  "Meeting set",
  disqualified: "Disqualified",
  converted:    "Converted",
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

// ---------------------------------------------------------------------------
// Prospect dossier — read-only modal for marketing users
// ---------------------------------------------------------------------------

interface ProspectDossier {
  id: string;
  name: string;
  title: string | null;
  companyName: string | null;
  email: string | null;
  icpScore: number | null;
  scoreBreakdown: {
    signals?: { key: string; label: string; weight: number; matched: boolean; note?: string }[];
    total?: number;
    threshold?: number;
    matchedPersonaName?: string | null;
  } | null;
  status: string;
  disqualifiedReason: string | null;
  researchDossier: string | null;
  signals: { discoveryConfidence?: "verified" | "reconfirm" | null; [key: string]: unknown } | null;
}

function ProspectDossierModal({
  prospectId,
  open,
  onClose,
}: {
  prospectId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: dossier, isLoading, error } = useQuery<ProspectDossier>({
    queryKey: ["/api/sales-outreach/prospects", prospectId],
    queryFn: async () => {
      const res = await fetch(`/api/sales-outreach/prospects/${prospectId}`);
      if (!res.ok) throw new Error("Failed to load dossier");
      return res.json();
    },
    enabled: !!prospectId && open,
  });

  const hasSignals =
    dossier?.scoreBreakdown?.signals && dossier.scoreBreakdown.signals.length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            Prospect dossier
          </DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive py-4">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Could not load prospect dossier.
          </div>
        )}

        {dossier && (
          <div className="space-y-4">
            {/* Identity */}
            <div className="flex flex-col gap-0.5">
              <p className="font-semibold text-base leading-tight">{dossier.name}</p>
              {(dossier.title || dossier.companyName) && (
                <p className="text-sm text-muted-foreground">
                  {[dossier.title, dossier.companyName].filter(Boolean).join(" · ")}
                </p>
              )}
              {dossier.icpScore != null && (
                <p className="text-xs text-amber-600 font-medium flex items-center gap-1 mt-0.5">
                  <TrendingUp className="h-3 w-3" />
                  ICP score: {dossier.icpScore}/100
                </p>
              )}
              {dossier.scoreBreakdown?.matchedPersonaName && (
                <p className="text-xs text-primary font-medium mt-0.5">
                  Best-match ICP: {dossier.scoreBreakdown.matchedPersonaName}
                </p>
              )}
              {dossier.signals?.discoveryConfidence && (
                <div className="mt-1">
                  {dossier.signals.discoveryConfidence === "verified" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                      <ShieldCheck className="h-3.5 w-3.5" /> Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-yellow-600 font-medium">
                      <AlertCircle className="h-3.5 w-3.5" /> Needs reconfirmation
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Disqualified reason */}
            {dossier.disqualifiedReason && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
                {dossier.disqualifiedReason}
              </div>
            )}

            {/* Research dossier */}
            {dossier.researchDossier ? (
              <div className="border rounded-md p-3 bg-muted/30">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Research summary
                </p>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                  {dossier.researchDossier}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No research dossier available yet.
              </p>
            )}

            {/* ICP score signals */}
            {hasSignals && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  ICP signal breakdown
                </p>
                <div className="space-y-1.5">
                  {dossier.scoreBreakdown!.signals!.map((sig) => (
                    <div key={sig.key} className="flex items-start gap-2 text-xs">
                      <span
                        className={`mt-0.5 shrink-0 h-3.5 w-3.5 rounded-full flex items-center justify-center ${
                          sig.matched
                            ? "bg-emerald-100 text-emerald-600"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {sig.matched ? "✓" : "—"}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className={sig.matched ? "text-foreground font-medium" : "text-muted-foreground"}>
                          {sig.label}
                        </span>
                        {sig.note && (
                          <span className="text-muted-foreground"> · {sig.note}</span>
                        )}
                      </span>
                      <span className="text-muted-foreground shrink-0">×{sig.weight}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CampaignMembershipList({
  memberships,
  onViewDossier,
}: {
  memberships: CampaignMembership[];
  onViewDossier: (prospectId: string) => void;
}) {
  if (memberships.length === 0) return null;

  return (
    <div className="mt-4 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 flex flex-col gap-2">
      <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
        <Briefcase className="h-3.5 w-3.5" />
        Campaign memberships ({memberships.length})
      </p>
      <div className="flex flex-col gap-2.5">
        {memberships.map((m, idx) => (
          <div
            key={m.prospectId}
            className={`flex flex-col gap-1 ${idx > 0 ? "pt-2 border-t border-amber-200 dark:border-amber-800" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5 min-w-0">
                {m.campaignName ? (
                  <a
                    href={`/app/sales/outreach/${m.campaignId}`}
                    className="text-xs font-medium text-primary hover:underline flex items-center gap-0.5 truncate"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {m.campaignName}
                    <ExternalLink className="h-3 w-3 opacity-60 shrink-0" />
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground italic">No campaign</span>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  {m.status && (
                    <span className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Status:</span>{" "}
                      {PROSPECT_STATUS_LABELS[m.status] ?? m.status}
                    </span>
                  )}
                  {m.icpScore != null && (
                    <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                      <TrendingUp className="h-3 w-3 text-amber-500" />
                      <span className="font-medium text-foreground">ICP:</span>{" "}
                      {m.icpScore}/100
                    </span>
                  )}
                  {m.updatedAt && (
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(m.updatedAt), { addSuffix: true })}
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-xs shrink-0 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                onClick={() => onViewDossier(m.prospectId)}
              >
                <BookOpen className="h-3 w-3 mr-1" />
                Dossier
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelinePanel({
  contact,
  open,
  onClose,
  onEditContact,
}: {
  contact: MarketingContact | null;
  open: boolean;
  onClose: () => void;
  onEditContact: (contact: MarketingContact) => void;
}) {
  const [dossierProspectId, setDossierProspectId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch the full contact detail to get all campaign memberships.
  // The list endpoint only returns the latest membership.
  const { data: fullContact } = useQuery<MarketingContact>({
    queryKey: ["/api/marketing-contacts", contact?.id, "detail"],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-contacts/${contact!.id}`);
      if (!res.ok) throw new Error("Failed to load contact detail");
      return res.json();
    },
    enabled: !!contact && open,
  });

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

  const syncHubspotMutation = useMutation({
    mutationFn: async () => {
      if (!contact) throw new Error("No contact selected");
      const res = await fetch(`/api/marketing-contacts/${contact.id}/sync-hubspot`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "HubSpot sync failed");
      return body as { status: "matched" | "not_found"; email: string; hubspotContactId?: string };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing-contacts"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/marketing-contacts", contact?.id, "detail"],
      });
      if (result.status === "matched") {
        toast({
          title: "HubSpot contact linked",
          description: "A match was found. Missing contact details were filled without replacing Orbit values.",
        });
      } else {
        toast({
          title: "No HubSpot match found",
          description: `${result.email} is not a contact in this organization's connected HubSpot portal.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Could not sync this contact",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const displayedContact = fullContact ?? contact;
  const name = displayedContact
    ? [displayedContact.firstName, displayedContact.lastName].filter(Boolean).join(" ") || displayedContact.email
    : "";

  const memberships = fullContact?.campaignMemberships ?? [];

  return (
    <>
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
          {displayedContact && (
            <div className="flex flex-col gap-1.5 pt-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <LifecycleBadge stage={displayedContact.lifecycleStage} />
                <OriginBadge source={displayedContact.source} />
                <Badge variant="outline" className="text-xs">
                  {displayedContact.hubspotContactId ? "HubSpot linked" : "Not linked to HubSpot"}
                </Badge>
              </div>
              {displayedContact.company && (
                <span className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Building2 className="h-3 w-3" /> {displayedContact.company}
                  {displayedContact.jobTitle ? ` · ${displayedContact.jobTitle}` : ""}
                </span>
              )}
              {displayedContact.lastEventAt && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Last activity{" "}
                  {formatDistanceToNow(new Date(displayedContact.lastEventAt), { addSuffix: true })}
                </span>
              )}
              <div className="pt-1">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onEditContact(displayedContact)}
                    data-testid="button-edit-contact"
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    Edit contact
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => syncHubspotMutation.mutate()}
                    disabled={syncHubspotMutation.isPending || !displayedContact.email}
                    data-testid="button-sync-contact-hubspot"
                  >
                    {syncHubspotMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Sync with HubSpot
                  </Button>
                </div>
              </div>
              {displayedContact.linkedinUrl && (
                <a
                  href={displayedContact.linkedinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary inline-flex items-center gap-1 w-fit hover:underline"
                >
                  <Linkedin className="h-3.5 w-3.5" />
                  View LinkedIn profile
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}
        </SheetHeader>

        {/* All campaign memberships — replaces the old single-membership amber panel */}
        <CampaignMembershipList
          memberships={memberships}
          onViewDossier={(id) => setDossierProspectId(id)}
        />

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
                    const isSalesOutreach = ev.eventType === "sales_outreach";
                    const Icon = config?.icon ?? Globe;
                    const evMeta = ev.metadata as Record<string, unknown> | null;
                    const campaignName = evMeta?.campaignName as string | undefined;
                    return (
                      <li key={ev.id} className="ml-4">
                        <span className={`absolute -left-2 flex h-4 w-4 items-center justify-center rounded-full border ${isSalesOutreach ? "bg-amber-50 dark:bg-amber-950 border-amber-300 dark:border-amber-700" : "bg-muted border-border"}`}>
                          <Icon className={`h-2.5 w-2.5 ${config?.color ?? "text-slate-400"}`} />
                        </span>
                        <div className="flex flex-col gap-0.5">
                          <p className={`text-sm font-medium leading-tight ${isSalesOutreach ? "text-amber-700 dark:text-amber-400" : ""}`}>
                            {config?.label ?? ev.eventType}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(ev.occurredAt), { addSuffix: true })}
                            {ev.source && !isSalesOutreach ? ` · via ${ev.source}` : ""}
                            {campaignName && (
                              <span className="text-amber-600 dark:text-amber-400"> · {campaignName}</span>
                            )}
                          </p>
                          {evMeta && !isSalesOutreach && Object.keys(evMeta).length > 0 && (
                            <p className="text-xs text-muted-foreground font-mono truncate">
                              {JSON.stringify(evMeta).slice(0, 80)}
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
    <ProspectDossierModal
      prospectId={dossierProspectId}
      open={!!dossierProspectId}
      onClose={() => setDossierProspectId(null)}
    />
    </>
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
  const [origin, setOrigin] = useState<string>("");
  const [selectedContact, setSelectedContact] = useState<MarketingContact | null>(null);
  const [contactEditorOpen, setContactEditorOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<MarketingContact | null>(null);
  const [hubspotImportOpen, setHubspotImportOpen] = useState(false);
  const [hubspotFullRefreshOpen, setHubspotFullRefreshOpen] = useState(false);
  const [csvImport, setCsvImport] = useState<CsvImportData | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useUser();
  const canRefreshAllHubSpotContacts = user?.role === "Domain Admin" || user?.role === "Global Admin";

  const debouncedQ = useDebouncedValue(q, 300);

  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (debouncedQ) params.set("q", debouncedQ);
  if (lifecycle) params.set("lifecycle", lifecycle);
  if (origin) params.set("source", origin);

  const { data, isLoading, isError } = useQuery<ContactsResponse>({
    queryKey: ["/api/marketing-contacts", page, debouncedQ, lifecycle, origin],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-contacts?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load contacts");
      return res.json();
    },
  });

  const contacts = data?.data ?? [];
  const pagination = data?.pagination;

  const refreshContacts = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/marketing-contacts"] });
  };

  const openAddContact = () => {
    setEditingContact(null);
    setContactEditorOpen(true);
  };

  const openEditContact = (contact: MarketingContact) => {
    setEditingContact(contact);
    setContactEditorOpen(true);
  };

  const prepareCsvImport = async (file: File) => {
    const rows = parseCSV(await file.text());
    if (!rows.length) {
      toast({
        title: "No contacts found",
        description: "Choose a CSV with a header row and at least one contact.",
        variant: "destructive",
      });
      return;
    }
    setCsvImport({ fileName: file.name, rows });
  };

  return (
    <AppLayout>
      <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
        {/* Header */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6 text-primary" />
              Contacts
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Marketing contacts with lifecycle stage, activity timeline, and saved segments.
            </p>
          </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  prepareCsvImport(file).catch((error: Error) => toast({
                    title: "CSV import failed",
                    description: error.message,
                    variant: "destructive",
                  }));
                }}
                data-testid="input-import-marketing-contacts-csv"
              />
              <Button variant="outline" size="sm" onClick={() => csvInputRef.current?.click()} data-testid="button-import-marketing-contacts-csv">
                <Upload className="h-4 w-4 mr-1.5" />
                Import CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => setHubspotImportOpen(true)} data-testid="button-import-marketing-contacts-hubspot">
                <CloudDownload className="h-4 w-4 mr-1.5" />
                Import HubSpot
              </Button>
              {canRefreshAllHubSpotContacts && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setHubspotFullRefreshOpen(true)}
                  data-testid="button-full-refresh-marketing-contacts-hubspot"
                >
                  <RefreshCw className="h-4 w-4 mr-1.5" />
                  Full HubSpot refresh
                </Button>
              )}
              <Button size="sm" onClick={openAddContact} data-testid="button-add-marketing-contact">
                <UserPlus className="h-4 w-4 mr-1.5" />
                Add contact
              </Button>
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
                <SelectTrigger className="w-[160px]">
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
              <Select
                value={origin || "__all"}
                onValueChange={(v) => {
                  setOrigin(v === "__all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[175px]">
                  <SelectValue placeholder="All origins" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All origins</SelectItem>
                  {ORIGIN_FILTER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
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
                      {debouncedQ || lifecycle || origin
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
                           <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden lg:table-cell">
                             LinkedIn
                           </th>
                          <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                            Stage
                          </th>
                          <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden lg:table-cell">
                            Origin
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
                             <td className="px-4 py-3 hidden lg:table-cell">
                               {contact.linkedinUrl ? (
                                 <a
                                   href={contact.linkedinUrl}
                                   target="_blank"
                                   rel="noreferrer"
                                   onClick={(event) => event.stopPropagation()}
                                   className="inline-flex items-center gap-1 text-primary hover:underline"
                                 >
                                   <Linkedin className="h-3.5 w-3.5" />
                                   Profile
                                 </a>
                               ) : (
                                 <span className="text-muted-foreground/40">—</span>
                               )}
                             </td>
                            <td className="px-4 py-3">
                              <LifecycleBadge stage={contact.lifecycleStage} />
                            </td>
                            <td className="px-4 py-3 hidden lg:table-cell">
                              <OriginBadge source={contact.source} />
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
        onEditContact={openEditContact}
      />
      <ContactEditorDialog
        open={contactEditorOpen}
        contact={editingContact}
        onClose={() => setContactEditorOpen(false)}
        onSaved={(contactId) => {
          refreshContacts();
          if (selectedContact?.id === contactId) {
            queryClient.invalidateQueries({
              queryKey: ["/api/marketing-contacts", contactId, "detail"],
            });
          }
          setContactEditorOpen(false);
        }}
      />
      <HubspotContactImportDialog
        open={hubspotImportOpen}
        onClose={() => setHubspotImportOpen(false)}
        onImported={() => {
          refreshContacts();
          setHubspotImportOpen(false);
        }}
      />
      {canRefreshAllHubSpotContacts && (
        <FullHubSpotRefreshDialog
          open={hubspotFullRefreshOpen}
          onClose={() => setHubspotFullRefreshOpen(false)}
          onFinished={refreshContacts}
        />
      )}
      <CsvContactImportDialog
        data={csvImport}
        onClose={() => setCsvImport(null)}
        onImported={() => {
          refreshContacts();
          setCsvImport(null);
        }}
      />
    </AppLayout>
  );
}

type CsvImportData = {
  fileName: string;
  rows: Record<string, string>[];
};

type CsvMappingKey = "email" | "firstName" | "lastName" | "company" | "jobTitle" | "linkedinUrl" | "lifecycleStage";

const CSV_MAPPING_FIELDS: { key: CsvMappingKey; label: string; aliases: string[] }[] = [
  { key: "email", label: "Email", aliases: ["email", "emailaddress"] },
  { key: "firstName", label: "First name", aliases: ["firstname", "first"] },
  { key: "lastName", label: "Last name", aliases: ["lastname", "last"] },
  { key: "company", label: "Company", aliases: ["company", "companyname", "organization"] },
  { key: "jobTitle", label: "Job title", aliases: ["jobtitle", "title", "role"] },
  { key: "linkedinUrl", label: "LinkedIn profile", aliases: ["linkedin", "linkedinurl", "linkedinprofile"] },
  { key: "lifecycleStage", label: "Lifecycle stage", aliases: ["lifecyclestage", "lifecycle"] },
];

function compactCsvHeader(header: string) {
  return header.toLowerCase().replace(/[\s_-]/g, "");
}

function initialCsvMapping(headers: string[]): Record<CsvMappingKey, string> {
  return Object.fromEntries(CSV_MAPPING_FIELDS.map((field) => [
    field.key,
    headers.find((header) => field.aliases.includes(compactCsvHeader(header))) ?? "",
  ])) as Record<CsvMappingKey, string>;
}

function CsvContactImportDialog({
  data,
  onClose,
  onImported,
}: {
  data: CsvImportData | null;
  onClose: () => void;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const headers = data?.rows[0] ? Object.keys(data.rows[0]) : [];
  const [mapping, setMapping] = useState<Record<CsvMappingKey, string>>(() => initialCsvMapping(headers));

  useEffect(() => {
    setMapping(initialCsvMapping(headers));
  }, [data?.fileName]);

  const contacts = (data?.rows ?? []).map((row) => ({
    email: mapping.email ? row[mapping.email] ?? "" : "",
    firstName: mapping.firstName ? row[mapping.firstName] ?? "" : "",
    lastName: mapping.lastName ? row[mapping.lastName] ?? "" : "",
    company: mapping.company ? row[mapping.company] ?? "" : "",
    jobTitle: mapping.jobTitle ? row[mapping.jobTitle] ?? "" : "",
    linkedinUrl: mapping.linkedinUrl ? row[mapping.linkedinUrl] ?? "" : "",
    lifecycleStage: mapping.lifecycleStage ? row[mapping.lifecycleStage] ?? "" : "",
  })).filter((contact) => contact.email.trim() || contact.linkedinUrl.trim());

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/marketing-contacts/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ contacts }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || "CSV import failed");
      return result as { created: number; updated: number; skipped: number };
    },
    onSuccess: (result) => {
      toast({
        title: "CSV import complete",
        description: `${result.created} added · ${result.updated} updated · ${result.skipped} skipped`,
      });
      onImported();
    },
    onError: (error: Error) => toast({
      title: "CSV import failed",
      description: error.message,
      variant: "destructive",
    }),
  });

  return (
    <Dialog open={!!data} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Map CSV columns</DialogTitle>
          <SheetDescription>
            Review the columns from {data?.fileName ?? "your CSV"} before importing. An email or LinkedIn profile is required for each contact.
          </SheetDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {CSV_MAPPING_FIELDS.map((field) => (
            <div key={field.key}>
              <Label>{field.label}</Label>
              <Select
                value={mapping[field.key] || "__ignore"}
                onValueChange={(value) => setMapping({ ...mapping, [field.key]: value === "__ignore" ? "" : value })}
              >
                <SelectTrigger><SelectValue placeholder="Do not import" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ignore">Do not import</SelectItem>
                  {headers.map((header) => (
                    <SelectItem key={header} value={header}>{header}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {contacts.length.toLocaleString()} of {(data?.rows.length ?? 0).toLocaleString()} rows have an email or LinkedIn profile and will be imported. Existing email or LinkedIn matches are updated.
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => importMutation.mutate()}
            disabled={!contacts.length || importMutation.isPending}
          >
            {importMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Import {contacts.length.toLocaleString()} contacts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ContactForm = {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  jobTitle: string;
  linkedinUrl: string;
  lifecycleStage: string;
};

function formFromContact(contact: MarketingContact | null): ContactForm {
  return {
    email: contact?.email ?? "",
    firstName: contact?.firstName ?? "",
    lastName: contact?.lastName ?? "",
    company: contact?.company ?? "",
    jobTitle: contact?.jobTitle ?? "",
    linkedinUrl: contact?.linkedinUrl ?? "",
    lifecycleStage: contact?.lifecycleStage ?? "subscriber",
  };
}

function ContactEditorDialog({
  open,
  contact,
  onClose,
  onSaved,
}: {
  open: boolean;
  contact: MarketingContact | null;
  onClose: () => void;
  onSaved: (contactId: string) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<ContactForm>(() => formFromContact(contact));

  useEffect(() => {
    if (open) setForm(formFromContact(contact));
  }, [open, contact?.id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const endpoint = contact
        ? `/api/marketing-contacts/${contact.id}`
        : "/api/marketing-contacts";
      const res = await fetch(endpoint, {
        method: contact ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save contact");
      return body as { contactId?: string; contact?: { id: string } };
    },
    onSuccess: (result) => {
      toast({ title: contact ? "Contact updated" : "Contact added" });
      const contactId = result.contact?.id ?? result.contactId;
      if (contactId) onSaved(contactId);
      else onClose();
    },
    onError: (error: Error) => toast({
      title: "Could not save contact",
      description: error.message,
      variant: "destructive",
    }),
  });

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit contact" : "Add contact"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="contact-email">Email</Label>
            <Input
              id="contact-email"
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              placeholder="name@company.com"
            />
          </div>
          <div>
            <Label htmlFor="contact-first-name">First name</Label>
            <Input
              id="contact-first-name"
              value={form.firstName}
              onChange={(event) => setForm({ ...form, firstName: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="contact-last-name">Last name</Label>
            <Input
              id="contact-last-name"
              value={form.lastName}
              onChange={(event) => setForm({ ...form, lastName: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="contact-company">Company</Label>
            <Input
              id="contact-company"
              value={form.company}
              onChange={(event) => setForm({ ...form, company: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="contact-job-title">Job title</Label>
            <Input
              id="contact-job-title"
              value={form.jobTitle}
              onChange={(event) => setForm({ ...form, jobTitle: event.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="contact-linkedin">LinkedIn profile</Label>
            <Input
              id="contact-linkedin"
              type="url"
              value={form.linkedinUrl}
              onChange={(event) => setForm({ ...form, linkedinUrl: event.target.value })}
              placeholder="https://www.linkedin.com/in/name"
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Lifecycle stage</Label>
            <Select
              value={form.lifecycleStage}
              onValueChange={(lifecycleStage) => setForm({ ...form, lifecycleStage })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIFECYCLE_STAGES.map((stage) => (
                  <SelectItem key={stage.value} value={stage.value}>{stage.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || (!form.email.trim() && !form.linkedinUrl.trim())}
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {contact ? "Save changes" : "Add contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface HubSpotContactOption {
  hubspotContactId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  name: string;
  jobTitle: string | null;
  company: string | null;
  linkedinUrl: string | null;
}

interface FullHubSpotRefreshJob {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  result: {
    scope?: string;
    pages?: number;
    processed?: number;
    created?: number;
    updated?: number;
    skipped?: number;
    failed?: number;
    rateLimited?: number;
  } | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

function FullHubSpotRefreshDialog({
  open,
  onClose,
  onFinished,
}: {
  open: boolean;
  onClose: () => void;
  onFinished: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const completedJobId = useRef<string | null>(null);
  const { data, refetch } = useQuery<{ job: FullHubSpotRefreshJob | null }>({
    queryKey: ["/api/marketing-contacts/hubspot/full-refresh/status"],
    queryFn: async () => {
      const res = await fetch("/api/marketing-contacts/hubspot/full-refresh/status", { credentials: "include" });
      if (!res.ok) throw new Error("Could not load HubSpot refresh status");
      return res.json();
    },
    enabled: open,
    refetchInterval: open ? 2000 : false,
  });
  const job = data?.job ?? null;
  const active = job?.status === "pending" || job?.status === "running";
  const counts = job?.result ?? {};

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/marketing-contacts/hubspot/full-refresh", {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not start the full HubSpot contact refresh");
      return body;
    },
    onSuccess: async () => {
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/marketing-contacts/hubspot/full-refresh/status"] });
      toast({ title: "Full HubSpot refresh started", description: "Orbit is paging through every contact in the connected portal." });
    },
    onError: (error: Error) => toast({
      title: "Full HubSpot refresh did not start",
      description: error.message,
      variant: "destructive",
    }),
  });

  const completed = job?.status === "completed";
  const failed = job?.status === "failed";

  useEffect(() => {
    if (job?.status === "completed" && completedJobId.current !== job.id) {
      completedJobId.current = job.id;
      onFinished();
    }
  }, [job?.id, job?.status, onFinished]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Refresh all HubSpot contacts</DialogTitle>
          <DialogDescription>
            This imports the complete population from the connected HubSpot portal. It creates or safely updates
            Marketing Contacts, fills missing Orbit fields, and never deletes local contacts.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
          <p className="font-medium">This is separate from daily enrichment and Settings → Sync now.</p>
          <p className="text-muted-foreground">
            HubSpot is read in pages with automatic rate-limit retries. Leave this dialog open to follow progress.
          </p>
        </div>

        {job && (
          <div className="rounded-md border p-3 space-y-3" data-testid="hubspot-full-refresh-progress">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">
                {active ? "Refresh in progress" : completed ? "Refresh complete" : "Refresh failed"}
              </span>
              {active && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <span className="text-muted-foreground">Pages read</span><span className="text-right">{counts.pages ?? 0}</span>
              <span className="text-muted-foreground">Contacts processed</span><span className="text-right">{counts.processed ?? 0}</span>
              <span className="text-muted-foreground">Created</span><span className="text-right">{counts.created ?? 0}</span>
              <span className="text-muted-foreground">Updated</span><span className="text-right">{counts.updated ?? 0}</span>
              <span className="text-muted-foreground">Skipped</span><span className="text-right">{counts.skipped ?? 0}</span>
              <span className="text-muted-foreground">Failed records</span><span className="text-right">{counts.failed ?? 0}</span>
            </div>
            {(counts.rateLimited ?? 0) > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                HubSpot rate limits interrupted this refresh after its retry window ({counts.rateLimited}).
              </p>
            )}
            {failed && <p className="text-sm text-destructive">{job.errorMessage || "The refresh stopped before completion."}</p>}
            {completed && <p className="text-sm text-emerald-700 dark:text-emerald-400">No local Marketing Contacts were deleted.</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {!active && (
            <Button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              data-testid="button-confirm-hubspot-full-refresh"
            >
              {startMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              {completed ? "Start another full refresh" : "Start full refresh"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HubspotContactImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HubSpotContactOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);

  const search = async () => {
    setSearching(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/marketing-contacts/hubspot/search?${params.toString()}`, {
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not search HubSpot");
      setResults(data.contacts ?? []);
      setSelectedIds(new Set());
    } catch (error: any) {
      toast({ title: "Could not search HubSpot", description: error.message, variant: "destructive" });
    } finally {
      setSearching(false);
    }
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/marketing-contacts/hubspot/import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: [...selectedIds] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "HubSpot import failed");
      return body as { created: number; updated: number; skipped: number };
    },
    onSuccess: (result) => {
      toast({
        title: "HubSpot contacts imported",
        description: `${result.created} added · ${result.updated} updated · ${result.skipped} skipped`,
      });
      onImported();
    },
    onError: (error: Error) => toast({
      title: "HubSpot import failed",
      description: error.message,
      variant: "destructive",
    }),
  });

  const toggle = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import contacts from HubSpot</DialogTitle>
          <SheetDescription>
            Search the connected HubSpot portal, select people, and add them to Marketing Contacts.
          </SheetDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                search();
              }
            }}
            placeholder="Search name, email, or company"
          />
          <Button variant="outline" onClick={search} disabled={searching}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span className="sr-only">Search HubSpot</span>
          </Button>
        </div>
        {results.length > 0 ? (
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="w-10 px-3 py-2" />
                  <th className="text-left px-3 py-2">Contact</th>
                  <th className="text-left px-3 py-2 hidden sm:table-cell">Company</th>
                  <th className="text-left px-3 py-2 hidden md:table-cell">Title</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr
                    key={result.hubspotContactId}
                    className="border-t hover:bg-muted/30 cursor-pointer"
                    onClick={() => toggle(result.hubspotContactId)}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(result.hubspotContactId)}
                        onChange={() => toggle(result.hubspotContactId)}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Select ${result.name || result.email || "contact"}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{result.name || result.email || "Unnamed contact"}</div>
                      {result.email && <div className="text-xs text-muted-foreground">{result.email}</div>}
                    </td>
                    <td className="px-3 py-2 hidden sm:table-cell">{result.company || "—"}</td>
                    <td className="px-3 py-2 hidden md:table-cell">{result.jobTitle || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">
            Search HubSpot to choose contacts to import.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => importMutation.mutate()}
            disabled={selectedIds.size === 0 || importMutation.isPending}
          >
            {importMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Import {selectedIds.size || ""} selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const segmentId = segment?.id ?? null;
  const [lastSegmentId, setLastSegmentId] = useState<string | null>(segmentId);
  if (segmentId !== lastSegmentId) {
    setLastSegmentId(segmentId);
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
