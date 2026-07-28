import { useState, useRef, KeyboardEvent, useCallback, useMemo } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Plus,
  Sparkles,
  Loader2,
  CalendarDays,
  UserPlus,
  PenLine,
  Mail,
  Linkedin,
  ShieldAlert,
  ShieldCheck,
  Send,
  ExternalLink,
  Download,
  TrendingUp,
  Radar,
  Pencil,
  X,
  Search,
  Upload,
  Copy,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  UserSearch,
  Scissors,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { SharpenDiffPanel } from "@/components/SharpenDiffPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useUser } from "@/lib/userContext";
import { parseCSV } from "@/lib/csv-export";
import {
  buildLinkedInDeepLinks,
  linkedinCharLimit,
  isValidLinkedInProfileUrl,
  LINKEDIN_FORMAT_LABELS,
  type LinkedInFormat,
  type OutreachIntent,
} from "@shared/linkedin-outreach";

interface OutreachCampaign {
  id: string;
  name: string;
  goalType: string;
  salesGoal: string | null;
  status: string;
  channels: string[] | null;
  eventDate: string | null;
  productId: string | null;
  conferenceId: string | null;
  targetPersonaIds: string[] | null;
  targetingFilter: {
    geographies?: string[];
    industries?: string[];
    segments?: string[];
    namedAccounts?: string[];
    targetRoles?: string[];
  } | null;
  createdBy: string;
}

interface ConferenceSummary {
  id: string;
  name: string;
  startDate: string | null;
  location: string | null;
  status: string;
}

interface Product {
  id: string;
  name: string;
  isBaseline: boolean;
}

interface Persona {
  id: string;
  name: string;
  role: string | null;
  isIcp?: boolean;
}

/** Simple chip/tag input: press Enter or comma to add, X to remove. */
function TagInput({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  testId?: string;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function commit() {
    const trimmed = draft.trim().replace(/,$/, "").trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div
      className="flex flex-wrap gap-1.5 min-h-9 border rounded-md px-2.5 py-1.5 focus-within:ring-1 focus-within:ring-ring cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 bg-secondary text-secondary-foreground text-xs rounded px-1.5 py-0.5"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(value.filter((t) => t !== tag)); }}
            className="hover:text-destructive"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={value.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        data-testid={testId}
      />
    </div>
  );
}

interface Prospect {
  id: string;
  name: string;
  title: string | null;
  companyName: string | null;
  email: string | null;
  linkedinUrl: string | null;
  icpScore: number | null;
  status: string;
  source: string | null;
  hubspotContactId: string | null;
  disqualifiedReason: string | null;
  researchDossier: string | null;
}

interface HubspotContact {
  hubspotContactId: string;
  name: string;
  email: string | null;
  jobTitle: string | null;
  company: string | null;
  alreadyOnCampaign: boolean;
}

interface MarketingTouch {
  sendId: string;
  subject: string | null;
  sentAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  status: string;
}

interface ComplianceFlag {
  kind: "cliche" | "banned_phrase" | "suppression" | "self_email" | "can_spam";
  detail: string;
}
interface Compliance {
  pass: boolean;
  flags: ComplianceFlag[];
  suggestedFixes: string[];
}
interface Touch {
  id: string;
  channel: "email" | "linkedin";
  linkedinFormat?: LinkedInFormat | null;
  intent?: OutreachIntent | null;
  stepNumber: number;
  subject: string | null;
  body: string | null;
  status: string;
  complianceFlags: Compliance | null;
}

interface DiscoveryCandidate {
  name: string;
  title: string | null;
  companyName: string | null;
  email: string | null;
  linkedinUrl: string | null;
  geography: string | null;
  industry: string | null;
  segment: string | null;
  sourceUrl: string | null;
  confidence?: "verified" | "reconfirm" | null;
  source: "web" | "salesnav" | "apollo";
}
interface ScoredDiscoveryCandidate {
  candidate: DiscoveryCandidate;
  scored: { score: number; qualified: boolean; disqualified: boolean };
}
interface ApolloDiagnostics {
  personTitles: string[];
  locations: string[];
  industries: string[];
  employeeRanges: string[];
  namedAccounts: string[];
  skippedSegments: string[];
}
interface DiscoverResult {
  backend: "web" | "salesnav" | "apollo";
  candidates: ScoredDiscoveryCandidate[];
  foundCount: number;
  droppedCount: number;
  /** Set when the primary backend returned 0 results and was retried with a fallback. */
  fallbackReason?: string;
  /** Filters actually sent to Apollo when it returned 0 results. */
  apolloDiagnostics?: ApolloDiagnostics;
  expansionSummary?: { seedCompanies: string[]; expandedCount: number };
  /** Set when the strict query returned 0 and a broader retry produced results. */
  relaxationApplied?: string;
  /** What the intent-expansion pass added to the targeting before searching. */
  intentExpansion?: { addedGeographies: string[]; addedIndustries: string[]; addedRoles: string[]; method: "ai" | "static" | "none" };
  /** Companies-first (event campaigns): the fitting orgs that seeded the people lookup. */
  accountCluster?: string[];
}
interface DiscoveryBackend {
  id: "web" | "salesnav" | "apollo";
  label: string;
  available: boolean;
  reason: string;
}

const STATE_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  new: "outline",
  researched: "secondary",
  draft_pending_approval: "secondary",
  sent: "default",
  awaiting_reply: "default",
  replied: "default",
  cadence_step_due: "secondary",
  dormant: "destructive",
};

function scoreColor(score: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 70) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

const FLAG_HARD = new Set(["suppression", "self_email"]);

const STATUS_GROUPS: Record<string, string[]> = {
  all: [],
  new: ["new"],
  researched: ["researched", "draft_pending_approval", "sent"],
  action: ["awaiting_reply", "cadence_step_due"],
  replied: ["replied"],
  dormant: ["dormant"],
  disqualified: ["disqualified"],
};

const STATUS_TAB_LABELS: Record<string, string> = {
  all: "All",
  new: "New",
  researched: "In progress",
  action: "Action needed",
  replied: "Replied",
  dormant: "Dormant",
  disqualified: "Disqualified",
};

type ProspectSortKey = "name" | "company" | "score" | "status" | "source";

function SortIcon({ col, sortKey, sortDir }: { col: ProspectSortKey; sortKey: ProspectSortKey; sortDir: "asc" | "desc" }) {
  if (sortKey !== col) return <ChevronsUpDown className="ml-1 inline h-3 w-3 opacity-30" />;
  return sortDir === "asc"
    ? <ChevronUp className="ml-1 inline h-3 w-3" />
    : <ChevronDown className="ml-1 inline h-3 w-3" />;
}

function initEditForm(c: OutreachCampaign) {
  return {
    name: c.name,
    goalType: c.goalType,
    salesGoal: c.salesGoal ?? "",
    productId: c.productId ?? "",
    conferenceId: c.conferenceId ?? "",
    targetPersonaIds: c.targetPersonaIds ?? [],
    channels: c.channels ?? [],
    geographies: c.targetingFilter?.geographies ?? [],
    industries: c.targetingFilter?.industries ?? [],
    segments: c.targetingFilter?.segments ?? [],
    namedAccounts: c.targetingFilter?.namedAccounts ?? [],
    targetRoles: c.targetingFilter?.targetRoles ?? [],
  };
}

type EditForm = ReturnType<typeof initEditForm>;

// ---------------------------------------------------------------------------
// ApolloFallbackNotice — shown when Apollo returned 0 and we fell back to web
// ---------------------------------------------------------------------------

function ApolloFallbackNotice({
  reason,
  diagnostics,
}: {
  reason: string;
  diagnostics?: ApolloDiagnostics;
}) {
  const [expanded, setExpanded] = useState(false);

  const hints: string[] = [];
  if (diagnostics) {
    if (diagnostics.personTitles.length > 0) {
      hints.push(
        `Roles searched: ${diagnostics.personTitles.join(", ")} — try fewer or broader titles in your ICP persona.`,
      );
    }
    if (diagnostics.industries.length > 0) {
      hints.push(
        `Industries searched: ${diagnostics.industries.join(", ")} — try removing or simplifying the industry keywords.`,
      );
    }
    if (diagnostics.employeeRanges.length > 0) {
      hints.push(
        `Company size filter applied (${diagnostics.employeeRanges.join(", ")} employees) — try broadening the segment labels in your ICP.`,
      );
    }
    if (diagnostics.skippedSegments.length > 0) {
      hints.push(
        `Company size segments not sent to Apollo: ${diagnostics.skippedSegments.join(", ")} — Apollo filters by headcount, not AUM or revenue.`,
      );
    }
    if (diagnostics.locations.length > 0) {
      hints.push(
        `Location filter: ${diagnostics.locations.join(", ")} — try broadening or removing the geography filter.`,
      );
    }
    if (diagnostics.namedAccounts.length > 0) {
      hints.push(
        `Named accounts filter active (${diagnostics.namedAccounts.length} companies) — Apollo may not have contacts on file for all of them.`,
      );
    }
    if (hints.length === 0) {
      hints.push("No filters were sent — Apollo may simply have no contacts for this combination.");
    }
  }

  return (
    <div
      className="rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
      data-testid="discovery-fallback-notice"
    >
      <div className="flex items-start justify-between gap-2">
        <span>{reason}</span>
        {diagnostics && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 underline underline-offset-2 hover:no-underline font-medium"
            data-testid="discovery-fallback-why-toggle"
          >
            {expanded ? "Hide hints" : "Why?"}
          </button>
        )}
      </div>
      {expanded && hints.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-amber-200 dark:border-amber-700 pt-2 list-none" data-testid="discovery-fallback-hints">
          {hints.map((h, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="shrink-0 mt-0.5">•</span>
              <span>{h}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function OutreachCampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const [adding, setAdding] = useState(false);
  const [dossier, setDossier] = useState<Prospect | null>(null);
  const [marketingTouchesExpanded, setMarketingTouchesExpanded] = useState(true);
  const [form, setForm] = useState({ name: "", title: "", companyName: "", email: "", linkedinUrl: "" });

  // Edit campaign dialog state.
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);

  // Draft review dialog state.
  const [draft, setDraft] = useState<Touch | null>(null);
  const [draftProspect, setDraftProspect] = useState<Prospect | null>(null);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [sharpenResult, setSharpenResult] = useState<{ body: string; subject: string | null; changelog: string[] } | null>(null);
  const [sharpenOriginal, setSharpenOriginal] = useState<{ body: string; subject: string }>({ body: "", subject: "" });

  // Discovery dialog state.
  const [discovering, setDiscovering] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<DiscoverResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Prospect list filter / sort state.
  const [searchQ, setSearchQ] = useState("");
  const [statusTab, setStatusTab] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [scoreFilter, setScoreFilter] = useState("all"); // all | high | medium | low | unscored
  const [sortKey, setSortKey] = useState<ProspectSortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: ProspectSortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "score" ? "desc" : "asc"); }
  }

  // HubSpot import dialog state.
  const [hubspotOpen, setHubspotOpen] = useState(false);
  const [hubspotMode, setHubspotMode] = useState<"search" | "list">("search");
  const [hubspotQuery, setHubspotQuery] = useState("");
  const [hubspotContacts, setHubspotContacts] = useState<HubspotContact[] | null>(null);
  const [hubspotSearching, setHubspotSearching] = useState(false);
  const [hubspotSelected, setHubspotSelected] = useState<Set<string>>(new Set());
  const [hubspotNotConnected, setHubspotNotConnected] = useState(false);
  const [hubspotNeedsReconnect, setHubspotNeedsReconnect] = useState(false);
  const [hubspotLists, setHubspotLists] = useState<{ listId: string; name: string; memberCount: number }[] | null>(null);
  const [hubspotListsLoading, setHubspotListsLoading] = useState(false);
  const [hubspotSelectedList, setHubspotSelectedList] = useState<string | null>(null);

  // Apollo / CSV import dialog state.
  interface CsvProspectRow {
    name: string;
    title: string;
    companyName: string;
    email: string;
    linkedinUrl: string;
  }
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvProspectRow[]>([]);
  const [csvSelected, setCsvSelected] = useState<Set<number>>(new Set());
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState<{ imported: number; skipped: number } | null>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);

  const parseApolloCSV = useCallback((text: string): CsvProspectRow[] => {
    const parsed = parseCSV(text);
    return parsed
      .map((row) => {
        // Apollo export uses "First Name" / "Last Name".
        // Also support generic exports with a "Name" column.
        const firstName = (row["First Name"] || "").trim();
        const lastName = (row["Last Name"] || "").trim();
        const name = firstName || lastName
          ? [firstName, lastName].filter(Boolean).join(" ")
          : (row["Name"] || "").trim();

        // Email: blank out if Apollo marks it as Unavailable.
        const emailStatus = (row["Email Status"] || "").trim();
        const rawEmail = (row["Email"] || row["email"] || "").trim();
        const email = emailStatus === "Unavailable" ? "" : rawEmail;

        return {
          name,
          title: (row["Title"] || row["title"] || "").trim(),
          companyName: (row["Company Name"] || row["Company"] || row["company"] || "").trim(),
          email,
          linkedinUrl: (row["Person Linkedin Url"] || row["LinkedIn URL"] || row["linkedin_url"] || "").trim(),
        };
      })
      .filter((r) => r.name.length > 0);
  }, []);

  const onCsvFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseApolloCSV(text);
      if (rows.length === 0) {
        toast({ title: "No contacts found", description: "The CSV had no rows with a name. Check the file and try again.", variant: "destructive" });
        return;
      }
      setCsvRows(rows);
      setCsvSelected(new Set(rows.map((_, i) => i)));
      setCsvResult(null);
      setCsvOpen(true);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [parseApolloCSV, toast]);

  const importCsvProspects = useCallback(async () => {
    const rows = csvRows.filter((_, i) => csvSelected.has(i));
    if (rows.length === 0) return;
    setCsvImporting(true);
    try {
      const res = await fetch(`/api/sales-outreach/campaigns/${id}/import-csv`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setCsvResult({ imported: data.imported, skipped: data.skipped });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-outreach/campaigns", id, "prospects"] });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setCsvImporting(false);
    }
  }, [csvRows, csvSelected, id, queryClient, toast]);

  const prospectsKey = ["/api/sales-outreach/campaigns", id, "prospects"];
  const campaignKey = ["/api/sales-outreach/campaigns", id];

  const { data: campaign, isLoading } = useQuery<OutreachCampaign>({
    queryKey: campaignKey,
    queryFn: async () => {
      const r = await fetch(`/api/sales-outreach/campaigns/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Campaign not found");
      return r.json();
    },
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
    queryFn: async () => {
      const r = await fetch("/api/products", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: personas = [] } = useQuery<Persona[]>({
    queryKey: ["/api/personas"],
    queryFn: async () => {
      const r = await fetch("/api/personas", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: conferenceList = [] } = useQuery<ConferenceSummary[]>({
    queryKey: ["/api/conferences"],
    queryFn: async () => {
      const r = await fetch("/api/conferences", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: marketingTouches = [] } = useQuery<MarketingTouch[]>({
    queryKey: ["/api/sales-outreach/prospects", dossier?.id, "marketing-touches"],
    enabled: !!dossier?.id,
    queryFn: async () => {
      const r = await fetch(`/api/sales-outreach/prospects/${dossier!.id}/marketing-touches`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const editCampaign = useMutation({
    mutationFn: async (payload: object) => {
      const res = await apiRequest("PATCH", `/api/sales-outreach/campaigns/${id}`, payload);
      return res.json();
    },
    onSuccess: (updated: OutreachCampaign) => {
      queryClient.setQueryData(campaignKey, updated);
      setEditing(false);
      setEditForm(null);
      toast({ title: "Campaign updated" });
    },
    onError: (err: any) => toast({ title: "Couldn't save changes", description: err?.message, variant: "destructive" }),
  });

  function openEdit() {
    if (!campaign) return;
    setEditForm(initEditForm(campaign));
    setEditing(true);
  }

  function submitEdit() {
    if (!editForm) return;
    editCampaign.mutate({
      name: editForm.name,
      goalType: editForm.goalType,
      salesGoal: editForm.salesGoal,
      productId: editForm.productId || null,
      conferenceId: editForm.conferenceId || null,
      targetPersonaIds: editForm.targetPersonaIds,
      channels: editForm.channels,
      targetingFilter: {
        geographies: editForm.geographies,
        industries: editForm.industries,
        segments: editForm.segments,
        namedAccounts: editForm.namedAccounts,
        targetRoles: editForm.targetRoles,
      },
    });
  }

  const { data: prospects = [] } = useQuery<Prospect[]>({
    queryKey: prospectsKey,
    queryFn: async () => {
      const r = await fetch(`/api/sales-outreach/campaigns/${id}/prospects`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const uniqueSources = useMemo(() => {
    const s = new Set(prospects.map((p) => p.source).filter(Boolean) as string[]);
    return Array.from(s).sort();
  }, [prospects]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: prospects.length };
    for (const [tab, statuses] of Object.entries(STATUS_GROUPS)) {
      if (tab === "all") continue;
      counts[tab] = prospects.filter((p) => statuses.includes(p.status)).length;
    }
    return counts;
  }, [prospects]);

  const visibleProspects = useMemo(() => {
    let list = [...prospects];
    const q = searchQ.toLowerCase().trim();
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.companyName?.toLowerCase() ?? "").includes(q) || (p.title?.toLowerCase() ?? "").includes(q));
    const statuses = STATUS_GROUPS[statusTab] ?? [];
    if (statuses.length) list = list.filter((p) => statuses.includes(p.status));
    if (sourceFilter !== "all") list = list.filter((p) => p.source === sourceFilter);
    // Score buckets mirror the scoreColor thresholds (70+ / 50–69 / <50).
    if (scoreFilter !== "all") {
      list = list.filter((p) => {
        const s = p.icpScore;
        if (scoreFilter === "unscored") return s == null;
        if (s == null) return false;
        if (scoreFilter === "high") return s >= 70;
        if (scoreFilter === "medium") return s >= 50 && s < 70;
        return s < 50; // low
      });
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "score") cmp = (a.icpScore ?? -1) - (b.icpScore ?? -1);
      else if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "company") cmp = (a.companyName ?? "").localeCompare(b.companyName ?? "");
      else if (sortKey === "status") cmp = a.status.localeCompare(b.status);
      else if (sortKey === "source") cmp = (a.source ?? "").localeCompare(b.source ?? "");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [prospects, searchQ, statusTab, sourceFilter, scoreFilter, sortKey, sortDir]);

  const { data: performance } = useQuery<{
    contacted: number;
    replied: number;
    replyRate: number;
    signals: { key: string; label: string; matched: number; lift: number | null }[];
    recommendations: string[];
  }>({
    queryKey: ["/api/sales-outreach/campaigns", id, "performance"],
    queryFn: async () => {
      const r = await fetch(`/api/sales-outreach/campaigns/${id}/performance`, { credentials: "include" });
      if (!r.ok) return null as any;
      return r.json();
    },
  });

  function openDraft(t: Touch, p?: Prospect | null) {
    setDraft(t);
    setDraftProspect(p ?? null);
    setDraftSubject(t.subject ?? "");
    setDraftBody(t.body ?? "");
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: "Paste it into LinkedIn." });
    } catch {
      toast({ title: "Couldn't copy", description: "Select the text and copy manually.", variant: "destructive" });
    }
  }

  const addProspect = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sales-outreach/campaigns/${id}/prospects`, form);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: prospectsKey });
      setForm({ name: "", title: "", companyName: "", email: "", linkedinUrl: "" });
      setAdding(false);
      toast({ title: "Prospect added" });
    },
    onError: (err: any) => toast({ title: "Couldn't add prospect", description: err?.message, variant: "destructive" }),
  });

  const research = useMutation({
    mutationFn: async (prospectId: string) => {
      const res = await apiRequest("POST", `/api/sales-outreach/prospects/${prospectId}/research`, {});
      return res.json();
    },
    onSuccess: (data: { scored: { score: number; disqualified: boolean } }) => {
      queryClient.invalidateQueries({ queryKey: prospectsKey });
      toast({
        title: data.scored.disqualified ? "Prospect disqualified" : `Scored ${data.scored.score}/100`,
        description: "Dossier ready.",
      });
    },
    onError: (err: any) => toast({ title: "Research failed", description: err?.message, variant: "destructive" }),
  });

  const compose = useMutation({
    mutationFn: async (vars: { prospect: Prospect; channel?: "email" | "linkedin"; linkedinFormat?: LinkedInFormat; intent?: OutreachIntent }) => {
      const res = await apiRequest("POST", `/api/sales-outreach/prospects/${vars.prospect.id}/compose`, {
        channel: vars.channel,
        linkedinFormat: vars.linkedinFormat,
        intent: vars.intent,
      });
      return res.json();
    },
    onSuccess: (data: { touch: Touch }, vars) => {
      queryClient.invalidateQueries({ queryKey: prospectsKey });
      openDraft(data.touch, vars.prospect);
      toast({
        title: "Draft composed",
        description: vars.channel === "linkedin"
          ? "Review, then copy it into LinkedIn."
          : "Review and approve to send to Outlook.",
      });
    },
    onError: (err: any) => toast({ title: "Compose failed", description: err?.message, variant: "destructive" }),
  });

  // Backfill a prospect's missing LinkedIn URL / email from the public web.
  const enrich = useMutation({
    mutationFn: async (prospectId: string) => {
      const res = await apiRequest("POST", `/api/sales-outreach/prospects/${prospectId}/enrich`, {});
      return res.json();
    },
    onSuccess: (data: { prospect: Prospect; found: { linkedinUrl: boolean; email: boolean } }) => {
      queryClient.invalidateQueries({ queryKey: prospectsKey });
      // Keep the open draft dialog's prospect in sync so deep links light up.
      if (draftProspect && data.prospect.id === draftProspect.id) setDraftProspect(data.prospect);
      const found = [data.found.linkedinUrl && "LinkedIn", data.found.email && "email"].filter(Boolean) as string[];
      toast({
        title: found.length ? `Found ${found.join(" + ")}` : "No verified details found",
        description: found.length ? undefined : "Add the LinkedIn URL or email manually.",
      });
    },
    onError: (err: any) => toast({ title: "Enrichment failed", description: err?.message, variant: "destructive" }),
  });

  const saveDraft = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/sales-outreach/touches/${draft!.id}`, {
        subject: draftSubject,
        body: draftBody,
      });
      return res.json();
    },
    onSuccess: (data: { touch: Touch }) => {
      setDraft(data.touch);
      toast({ title: "Saved", description: "Compliance re-scanned." });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err?.message, variant: "destructive" }),
  });

  const sharpenTouch = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sales-outreach/touches/${draft!.id}/sharpen`, {
        body: draftBody,
        subject: draftSubject || undefined,
      });
      return res.json() as Promise<{ body: string; subject: string | null; changelog: string[] }>;
    },
    onSuccess: (data) => {
      setSharpenResult(data);
    },
    onError: (err: any) => toast({ title: "Sharpen failed", description: err?.message, variant: "destructive" }),
  });

  const markReplied = useMutation({
    mutationFn: async (prospectId: string) => {
      const res = await apiRequest("POST", `/api/sales-outreach/prospects/${prospectId}/mark-replied`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: prospectsKey });
      toast({ title: "Marked replied" });
    },
    onError: (err: any) => toast({ title: "Couldn't update", description: err?.message, variant: "destructive" }),
  });

  const tick = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sales-outreach/cadence/tick", {});
      return res.json();
    },
    onSuccess: (data: { prospectsAdvanced: number }) => {
      queryClient.invalidateQueries({ queryKey: prospectsKey });
      toast({ title: "Cadence refreshed", description: `${data.prospectsAdvanced} step(s) now due.` });
    },
    onError: (err: any) => toast({ title: "Cadence refresh failed", description: err?.message, variant: "destructive" }),
  });

  async function searchHubspot(q: string) {
    setHubspotSearching(true);
    setHubspotNotConnected(false);
    try {
      const res = await apiRequest("POST", `/api/sales-outreach/campaigns/${id}/preview-hubspot`, { query: q || undefined, limit: 50 });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "no_hubspot") {
          setHubspotNotConnected(true);
          return;
        }
        throw new Error(data.error || "Search failed");
      }
      setHubspotContacts(data.contacts ?? []);
      setHubspotSelected(new Set((data.contacts ?? []).filter((c: HubspotContact) => !c.alreadyOnCampaign).map((c: HubspotContact) => c.hubspotContactId)));
    } catch (err: any) {
      toast({ title: "HubSpot search failed", description: err?.message, variant: "destructive" });
    } finally {
      setHubspotSearching(false);
    }
  }

  async function loadHubspotLists() {
    if (hubspotLists !== null) return; // already loaded
    setHubspotListsLoading(true);
    try {
      const res = await fetch(`/api/sales-outreach/campaigns/${id}/hubspot-lists`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "no_hubspot") { setHubspotNotConnected(true); return; }
        if (data.code === "no_list_scopes") { setHubspotNeedsReconnect(true); return; }
        throw new Error(data.error || "Failed to load lists");
      }
      setHubspotNeedsReconnect(false);
      setHubspotLists(data.lists ?? []);
    } catch (err: any) {
      toast({ title: "Couldn't load HubSpot lists", description: err?.message, variant: "destructive" });
    } finally {
      setHubspotListsLoading(false);
    }
  }

  async function loadContactsFromList(listId: string) {
    setHubspotSearching(true);
    setHubspotContacts(null);
    setHubspotSelected(new Set());
    try {
      const res = await apiRequest("POST", `/api/sales-outreach/campaigns/${id}/preview-hubspot`, { listId, limit: 100 });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load list members");
      setHubspotContacts(data.contacts ?? []);
      setHubspotSelected(new Set((data.contacts ?? []).filter((c: HubspotContact) => !c.alreadyOnCampaign).map((c: HubspotContact) => c.hubspotContactId)));
    } catch (err: any) {
      toast({ title: "HubSpot list load failed", description: err?.message, variant: "destructive" });
    } finally {
      setHubspotSearching(false);
    }
  }

  function openHubspotDialog() {
    setHubspotContacts(null);
    setHubspotQuery("");
    setHubspotSelected(new Set());
    setHubspotNotConnected(false);
    setHubspotMode("search");
    setHubspotSelectedList(null);
    setHubspotOpen(true);
    searchHubspot("");
  }

  const importHubspotSelected = useMutation({
    mutationFn: async () => {
      const toImport = (hubspotContacts ?? []).filter((c) => hubspotSelected.has(c.hubspotContactId));
      const res = await apiRequest("POST", `/api/sales-outreach/campaigns/${id}/import-hubspot`, {
        contactIds: toImport.map((c) => c.hubspotContactId),
        contacts: toImport,
      });
      return res.json();
    },
    onSuccess: (data: { imported: number; skipped: number }) => {
      queryClient.invalidateQueries({ queryKey: prospectsKey });
      setHubspotOpen(false);
      toast({ title: `Imported ${data.imported} contact(s)`, description: data.skipped ? `${data.skipped} already on this campaign.` : "Ready to research." });
    },
    onError: (err: any) => toast({ title: "HubSpot import failed", description: err?.message, variant: "destructive" }),
  });

  const syncHubspot = useMutation({
    mutationFn: async (prospectId: string) => {
      const res = await apiRequest("POST", `/api/sales-outreach/prospects/${prospectId}/sync-hubspot`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: prospectsKey });
      toast({ title: "Synced to HubSpot" });
    },
    onError: (err: any) => toast({ title: "HubSpot sync failed", description: err?.message, variant: "destructive" }),
  });

  const deleteProspect = useMutation({
    mutationFn: async (prospectId: string) => {
      const res = await apiRequest("DELETE", `/api/sales-outreach/prospects/${prospectId}`);
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove prospect");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: prospectsKey });
      toast({ title: "Prospect removed" });
    },
    onError: (err: any) => toast({ title: "Could not remove prospect", description: err?.message, variant: "destructive" }),
  });

  const { data: discoveryStatus } = useQuery<{ backends: DiscoveryBackend[] }>({
    queryKey: ["/api/sales-outreach/discovery/status"],
    queryFn: async () => {
      const r = await fetch("/api/sales-outreach/discovery/status", { credentials: "include" });
      if (!r.ok) return { backends: [] };
      return r.json();
    },
  });
  const webBackend = discoveryStatus?.backends.find((b) => b.id === "web");
  const salesNavBackend = discoveryStatus?.backends.find((b) => b.id === "salesnav");
  const apolloBackend = discoveryStatus?.backends.find((b) => b.id === "apollo");

  const discover = useMutation({
    mutationFn: async () => {
      // Prefer Sales Navigator → Apollo → web.
      const backend = salesNavBackend?.available ? "salesnav" : apolloBackend?.available ? "apollo" : "web";
      const res = await apiRequest("POST", `/api/sales-outreach/campaigns/${id}/discover`, { limit: 25, backend });
      return res.json();
    },
    onSuccess: (data: DiscoverResult) => {
      setDiscoverResult(data);
      // Pre-select the candidates that clear the ICP threshold.
      setSelected(new Set(data.candidates.map((c, i) => (c.scored.qualified ? i : -1)).filter((i) => i >= 0)));
      if (data.candidates.length === 0) {
        toast({
          title: "No new prospects found",
          description: data.foundCount > 0
            ? "Everyone found is already on this campaign."
            : "Try widening the campaign's roles, industries, or geographies.",
        });
      }
    },
    onError: (err: any) => toast({ title: "Discovery failed", description: err?.message, variant: "destructive" }),
  });

  const importDiscovered = useMutation({
    mutationFn: async () => {
      const candidates = (discoverResult?.candidates ?? [])
        .filter((_, i) => selected.has(i))
        .map((c) => c.candidate);
      const res = await apiRequest("POST", `/api/sales-outreach/campaigns/${id}/discover/import`, { candidates });
      return res.json();
    },
    onSuccess: (data: { imported: number; skipped: number }) => {
      queryClient.invalidateQueries({ queryKey: prospectsKey });
      setDiscovering(false);
      setDiscoverResult(null);
      setSelected(new Set());
      toast({
        title: `Imported ${data.imported} prospect(s)`,
        description: data.skipped ? `${data.skipped} already on this campaign.` : "Ready to research.",
      });
    },
    onError: (err: any) => toast({ title: "Import failed", description: err?.message, variant: "destructive" }),
  });

  function openDiscovery() {
    setDiscoverResult(null);
    setSelected(new Set());
    setDiscovering(true);
    discover.mutate();
  }

  function toggleSelected(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  const approve = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sales-outreach/touches/${draft!.id}/approve`, {});
      return res.json();
    },
    onSuccess: (data: { webLink?: string; deliveryNote?: string }) => {
      queryClient.invalidateQueries({ queryKey: prospectsKey });
      setDraft(null);
      toast({
        title: "Approved",
        description: data.deliveryNote
          ? data.deliveryNote
          : data.webLink
            ? "Draft created in your Outlook — review and send."
            : "Draft approved.",
      });
    },
    onError: (err: any) => toast({ title: "Approval blocked", description: err?.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <AppLayout><p className="text-sm text-muted-foreground">Loading…</p></AppLayout>;
  }
  if (!campaign) {
    return <AppLayout><p className="text-sm text-muted-foreground">Campaign not found.</p></AppLayout>;
  }

  const isAdmin = user?.role === "Domain Admin" || user?.role === "Global Admin";
  const canEdit = isAdmin || campaign.createdBy === user?.id;
  // Channels offered in the compose menu — the campaign's, or both when unset.
  const composeChannels = campaign.channels?.length ? campaign.channels : ["email", "linkedin"];

  const draftFlags = draft?.complianceFlags;
  const draftHardBlocked = (draftFlags?.flags ?? []).some((f) => FLAG_HARD.has(f.kind));

  // LinkedIn paste-assist: char limit for the message shape, deep links into
  // LinkedIn, and whether we have a verified profile to act on.
  const isLinkedInDraft = draft?.channel === "linkedin";
  const draftLimit = isLinkedInDraft ? linkedinCharLimit(draft?.linkedinFormat) : null;
  const draftOverLimit = draftLimit != null && draftBody.length > draftLimit;
  const draftHasProfile = isValidLinkedInProfileUrl(draftProspect?.linkedinUrl);
  const draftDeepLinks = isLinkedInDraft
    ? buildLinkedInDeepLinks({
        profileUrl: draftProspect?.linkedinUrl,
        name: draftProspect?.name,
        companyName: draftProspect?.companyName,
      })
    : null;

  return (
    <AppLayout>
      <div className="space-y-6" data-testid="page-outreach-campaign-detail">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/app/sales/outreach"><ArrowLeft className="w-4 h-4 mr-1" /> Campaigns</Link>
        </Button>

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[11px] capitalize">{campaign.goalType.replace("_", " ")}</Badge>
              <Badge variant="secondary" className="text-[11px] capitalize">{campaign.status}</Badge>
              {campaign.eventDate && (
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <CalendarDays className="w-3.5 h-3.5" /> {new Date(campaign.eventDate).toLocaleDateString()}
                </span>
              )}
              {campaign.conferenceId && conferenceList.length > 0 && (() => {
                const conf = conferenceList.find((c) => c.id === campaign.conferenceId);
                if (!conf) return null;
                const dateStr = conf.startDate
                  ? new Date(conf.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
                  : null;
                return (
                  <Badge variant="outline" className="text-[11px] gap-1" data-testid="badge-linked-event">
                    <CalendarDays className="w-3 h-3" />
                    {conf.name}{dateStr ? ` · ${dateStr}` : ""}
                  </Badge>
                );
              })()}
            </div>
            <h1 className="text-2xl font-bold tracking-tight mt-1.5">{campaign.name}</h1>
            {campaign.salesGoal && <p className="text-muted-foreground mt-1 max-w-2xl">{campaign.salesGoal}</p>}
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button variant="outline" size="sm" onClick={openEdit} data-testid="button-edit-campaign">
                <Pencil className="w-4 h-4 mr-1.5" /> Edit campaign
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => tick.mutate()} disabled={tick.isPending} data-testid="button-refresh-cadence">
              {tick.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
              Refresh cadence
            </Button>
            {discoveryStatus?.backends?.some((b: DiscoveryBackend) => b.available) && (
              <Button variant="outline" onClick={openDiscovery} disabled={discover.isPending} data-testid="button-discover-prospects">
                {discover.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Radar className="w-4 h-4 mr-1.5" />}
                Discover prospects
              </Button>
            )}
            <Button variant="outline" onClick={openHubspotDialog} data-testid="button-import-hubspot">
              <Download className="w-4 h-4 mr-1.5" />
              Import from HubSpot
            </Button>
            <input
              ref={csvFileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={onCsvFileChange}
              data-testid="input-import-csv-prospects"
            />
            <Button variant="outline" onClick={() => csvFileRef.current?.click()} data-testid="button-import-csv-prospects">
              <Upload className="w-4 h-4 mr-1.5" />
              Import from CSV
            </Button>
            <Button onClick={() => setAdding((v) => !v)} data-testid="button-add-prospect">
              <UserPlus className="w-4 h-4 mr-1.5" /> Add prospect
            </Button>
          </div>
        </div>

        {adding && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">New prospect</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1"><Label htmlFor="p-name">Name</Label><Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-prospect-name" /></div>
                <div className="space-y-1"><Label htmlFor="p-title">Title</Label><Input id="p-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor="p-company">Company</Label><Input id="p-company" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor="p-email">Email</Label><Input id="p-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div className="space-y-1 sm:col-span-2"><Label htmlFor="p-li">LinkedIn URL</Label><Input id="p-li" value={form.linkedinUrl} onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })} /></div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
                <Button size="sm" onClick={() => addProspect.mutate()} disabled={!form.name.trim() || addProspect.isPending}>
                  {addProspect.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />} Add
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Prospects ({visibleProspects.length}{visibleProspects.length !== prospects.length ? ` of ${prospects.length}` : ""})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {prospects.length === 0 ? (
              <div className="py-8 text-center space-y-3">
                <p className="text-sm text-muted-foreground">No prospects yet.</p>
                <div className="flex justify-center gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={openHubspotDialog} data-testid="button-import-hubspot-empty">
                    <Download className="w-3.5 h-3.5 mr-1.5" /> Import from HubSpot
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => csvFileRef.current?.click()} data-testid="button-import-csv-prospects-empty">
                    <Upload className="w-3.5 h-3.5 mr-1.5" /> Import from CSV
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAdding(true)} data-testid="button-add-prospect-empty">
                    <UserPlus className="w-3.5 h-3.5 mr-1.5" /> Add manually
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {/* ── Filter bar ── */}
                <div className="mb-3 space-y-2">
                  <div className="flex flex-wrap gap-1">
                    {Object.keys(STATUS_GROUPS).map((tab) => {
                      const count = tabCounts[tab] ?? 0;
                      if (tab !== "all" && count === 0) return null;
                      return (
                        <button
                          key={tab}
                          onClick={() => setStatusTab(tab)}
                          data-testid={`tab-status-${tab}`}
                          className={`rounded-full px-3 py-0.5 text-xs font-medium transition-colors ${
                            statusTab === tab
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          }`}
                        >
                          {STATUS_TAB_LABELS[tab]}
                          <span className={`ml-1.5 ${statusTab === tab ? "opacity-80" : "opacity-60"}`}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <div className="relative flex-1 min-w-[180px]">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                      <input
                        type="text"
                        value={searchQ}
                        onChange={(e) => setSearchQ(e.target.value)}
                        placeholder="Search name, company, title…"
                        data-testid="input-prospect-search"
                        className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    {uniqueSources.length > 1 && (
                      <select
                        value={sourceFilter}
                        onChange={(e) => setSourceFilter(e.target.value)}
                        data-testid="select-source-filter"
                        className="rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring capitalize"
                      >
                        <option value="all">All sources</option>
                        {uniqueSources.map((s) => (
                          <option key={s} value={s} className="capitalize">{s}</option>
                        ))}
                      </select>
                    )}
                    <select
                      value={scoreFilter}
                      onChange={(e) => setScoreFilter(e.target.value)}
                      data-testid="select-score-filter"
                      className="rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="all">All scores</option>
                      <option value="high">High (70+)</option>
                      <option value="medium">Medium (50–69)</option>
                      <option value="low">Low (&lt;50)</option>
                      <option value="unscored">Unscored</option>
                    </select>
                  </div>
                </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer select-none whitespace-nowrap"
                      onClick={() => toggleSort("name")}
                      data-testid="th-sort-name"
                    >
                      Name <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none whitespace-nowrap"
                      onClick={() => toggleSort("company")}
                      data-testid="th-sort-company"
                    >
                      Company <SortIcon col="company" sortKey={sortKey} sortDir={sortDir} />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none text-center whitespace-nowrap"
                      onClick={() => toggleSort("score")}
                      data-testid="th-sort-score"
                    >
                      Score <SortIcon col="score" sortKey={sortKey} sortDir={sortDir} />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none whitespace-nowrap"
                      onClick={() => toggleSort("status")}
                      data-testid="th-sort-status"
                    >
                      State <SortIcon col="status" sortKey={sortKey} sortDir={sortDir} />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none whitespace-nowrap"
                      onClick={() => toggleSort("source")}
                      data-testid="th-sort-source"
                    >
                      Source <SortIcon col="source" sortKey={sortKey} sortDir={sortDir} />
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleProspects.length === 0 ? (
                    <TableRow>
                      <td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        No prospects match this filter.{" "}
                        <button className="underline" onClick={() => { setSearchQ(""); setStatusTab("all"); setSourceFilter("all"); }}>Clear filters</button>
                      </td>
                    </TableRow>
                  ) : null}
                  {visibleProspects.map((p) => (
                    <TableRow key={p.id} data-testid={`prospect-${p.id}`}>
                      <TableCell>
                        <div className="font-medium">{p.name}</div>
                        {p.title && <div className="text-xs text-muted-foreground">{p.title}</div>}
                      </TableCell>
                      <TableCell className="text-sm">{p.companyName ?? "—"}</TableCell>
                      <TableCell className={`text-center font-semibold ${scoreColor(p.icpScore)}`}>
                        {p.icpScore ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATE_VARIANT[p.status] ?? "outline"} className="text-[10px] capitalize">
                          {p.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {p.source && (
                          p.source === "hubspot" ? (
                            <Badge variant="outline" className="text-[10px] border-orange-400 text-orange-600 dark:text-orange-400" data-testid={`badge-source-hubspot-${p.id}`}>
                              From HubSpot
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] capitalize">
                              {p.source}
                            </Badge>
                          )
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-1 whitespace-nowrap">
                        {p.researchDossier && (
                          <Button variant="ghost" size="sm" onClick={() => setDossier(p)} data-testid={`view-dossier-${p.id}`}>Dossier</Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => research.mutate(p.id)}
                          disabled={research.isPending && research.variables === p.id}
                          data-testid={`research-${p.id}`}
                        >
                          {research.isPending && research.variables === p.id ? (
                            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5 mr-1" />
                          )}
                          {p.researchDossier ? "Re-score" : "Research"}
                        </Button>
                        {(p.status === "awaiting_reply" || p.status === "cadence_step_due") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => markReplied.mutate(p.id)}
                            disabled={markReplied.isPending && markReplied.variables === p.id}
                            data-testid={`mark-replied-${p.id}`}
                          >
                            Mark replied
                          </Button>
                        )}
                        {p.status !== "dormant" && p.status !== "replied" && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={compose.isPending && compose.variables?.prospect.id === p.id}
                                data-testid={`compose-${p.id}`}
                              >
                                {compose.isPending && compose.variables?.prospect.id === p.id ? (
                                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                                ) : (
                                  <PenLine className="w-3.5 h-3.5 mr-1" />
                                )}
                                Compose
                                <ChevronDown className="w-3 h-3 ml-1 opacity-60" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-60">
                              {composeChannels.includes("email") && (
                                <>
                                  <DropdownMenuLabel className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> Email</DropdownMenuLabel>
                                  <DropdownMenuItem onClick={() => compose.mutate({ prospect: p, channel: "email", intent: "outreach" })} data-testid={`compose-${p.id}-email-outreach`}>Outreach</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => compose.mutate({ prospect: p, channel: "email", intent: "engagement" })}>Engagement</DropdownMenuItem>
                                </>
                              )}
                              {composeChannels.includes("linkedin") && (
                                <>
                                  {composeChannels.includes("email") && <DropdownMenuSeparator />}
                                  <DropdownMenuLabel className="flex items-center gap-1.5"><Linkedin className="w-3.5 h-3.5" /> Connect request</DropdownMenuLabel>
                                  <DropdownMenuItem onClick={() => compose.mutate({ prospect: p, channel: "linkedin", linkedinFormat: "connect_request", intent: "outreach" })} data-testid={`compose-${p.id}-connect-outreach`}>Outreach</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => compose.mutate({ prospect: p, channel: "linkedin", linkedinFormat: "connect_request", intent: "engagement" })}>Engagement</DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuLabel className="flex items-center gap-1.5"><Linkedin className="w-3.5 h-3.5" /> Direct message</DropdownMenuLabel>
                                  <DropdownMenuItem onClick={() => compose.mutate({ prospect: p, channel: "linkedin", linkedinFormat: "direct_message", intent: "outreach" })} data-testid={`compose-${p.id}-dm-outreach`}>Outreach</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => compose.mutate({ prospect: p, channel: "linkedin", linkedinFormat: "direct_message", intent: "engagement" })}>Engagement</DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                        {(!p.email || !p.linkedinUrl) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => enrich.mutate(p.id)}
                            disabled={enrich.isPending && enrich.variables === p.id}
                            data-testid={`enrich-${p.id}`}
                            title="Find LinkedIn profile / email"
                            aria-label={`Find LinkedIn profile or email for ${p.name}`}
                          >
                            {enrich.isPending && enrich.variables === p.id
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <UserSearch className="w-3.5 h-3.5" />}
                          </Button>
                        )}
                        {p.hubspotContactId ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-orange-400 text-orange-600 dark:text-orange-400 cursor-default select-none"
                            data-testid={`badge-hubspot-linked-${p.id}`}
                            title={`HubSpot contact ID: ${p.hubspotContactId}`}
                          >
                            ✓ HubSpot
                          </Badge>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => syncHubspot.mutate(p.id)}
                            disabled={syncHubspot.isPending && syncHubspot.variables === p.id}
                            data-testid={`push-hubspot-${p.id}`}
                            title="Create or update this contact in HubSpot"
                            className="text-orange-600 border-orange-300 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-700 dark:hover:bg-orange-950"
                          >
                            {syncHubspot.isPending && syncHubspot.variables === p.id
                              ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                              : <Upload className="w-3.5 h-3.5 mr-1" />}
                            Add to HubSpot
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`Remove ${p.name} from this campaign?`)) {
                              deleteProspect.mutate(p.id);
                            }
                          }}
                          disabled={deleteProspect.isPending && deleteProspect.variables === p.id}
                          data-testid={`delete-prospect-${p.id}`}
                          title="Remove prospect"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          {deleteProspect.isPending && deleteProspect.variables === p.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <X className="w-3.5 h-3.5" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </>
            )}
          </CardContent>
        </Card>

        {/* Performance — conversion-first, feeds ICP targeting */}
        {performance && performance.contacted > 0 && (
          <Card data-testid="campaign-performance">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" /> Performance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-6 text-sm">
                <div><span className="text-2xl font-bold tabular-nums">{Math.round(performance.replyRate * 100)}%</span><div className="text-xs text-muted-foreground">reply rate</div></div>
                <div><span className="text-2xl font-bold tabular-nums">{performance.contacted}</span><div className="text-xs text-muted-foreground">contacted</div></div>
                <div><span className="text-2xl font-bold tabular-nums">{performance.replied}</span><div className="text-xs text-muted-foreground">replied</div></div>
              </div>
              {performance.signals.filter((s) => s.lift != null && s.matched >= 3).length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">What's converting</p>
                  <div className="space-y-1">
                    {performance.signals.filter((s) => s.lift != null && s.matched >= 3).slice(0, 4).map((s) => (
                      <div key={s.key} className="flex items-center justify-between text-sm">
                        <span>{s.label}</span>
                        <span className={`tabular-nums ${(s.lift ?? 0) > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                          {(s.lift ?? 0) > 0 ? "+" : ""}{Math.round((s.lift ?? 0) * 100)} pts
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {performance.recommendations.length > 0 && (
                <ul className="space-y-1 text-sm text-muted-foreground border-l-2 pl-3">
                  {performance.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Edit campaign dialog */}
      <Dialog open={editing} onOpenChange={(o) => { if (!o) { setEditing(false); setEditForm(null); } }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit campaign</DialogTitle>
            <DialogDescription>Update campaign details, goal, targeting, and channels.</DialogDescription>
          </DialogHeader>

          {editForm && (
            <div className="space-y-4">
              {/* Name */}
              <div className="space-y-1.5">
                <Label htmlFor="ec-name">Campaign name</Label>
                <Input
                  id="ec-name"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  data-testid="input-edit-campaign-name"
                />
              </div>

              {/* Goal type */}
              <div className="space-y-1.5">
                <Label htmlFor="ec-goal-type">Goal type</Label>
                <Select
                  value={editForm.goalType}
                  onValueChange={(v) => setEditForm({ ...editForm, goalType: v })}
                >
                  <SelectTrigger id="ec-goal-type" data-testid="select-edit-goal-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meeting">Meeting</SelectItem>
                    <SelectItem value="event_invite">Event invite</SelectItem>
                    <SelectItem value="intro">Intro</SelectItem>
                    <SelectItem value="nurture">Nurture</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Sales goal */}
              <div className="space-y-1.5">
                <Label htmlFor="ec-sales-goal">Sales goal</Label>
                <Textarea
                  id="ec-sales-goal"
                  value={editForm.salesGoal}
                  onChange={(e) => setEditForm({ ...editForm, salesGoal: e.target.value })}
                  rows={2}
                  placeholder="e.g. Book 10 discovery calls for Polaris"
                  data-testid="input-edit-sales-goal"
                />
              </div>

              {/* Linked event */}
              <div className="space-y-1.5">
                <Label htmlFor="ec-conference">Linked event</Label>
                <Select
                  value={editForm.conferenceId || "__none__"}
                  onValueChange={(v) => setEditForm({ ...editForm, conferenceId: v === "__none__" ? "" : v })}
                >
                  <SelectTrigger id="ec-conference" data-testid="select-edit-conference">
                    <SelectValue placeholder="No event linked" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No event linked</SelectItem>
                    {conferenceList.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {c.startDate && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {new Date(c.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  When an event is linked, generated messages use the real event name, date, and location — no invented details.
                </p>
              </div>

              {/* Product */}
              <div className="space-y-1.5">
                <Label htmlFor="ec-product">Product</Label>
                <Select
                  value={editForm.productId || "__none__"}
                  onValueChange={(v) => setEditForm({ ...editForm, productId: v === "__none__" ? "" : v })}
                >
                  <SelectTrigger id="ec-product" data-testid="select-edit-product">
                    <SelectValue placeholder="No product" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No product</SelectItem>
                    {products.filter((p) => p.isBaseline).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Target personas */}
              {personas.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Target personas</Label>
                  <div className="max-h-36 overflow-y-auto border rounded-md divide-y">
                    {personas.map((p) => (
                      <label
                        key={p.id}
                        className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-accent/40 text-sm"
                      >
                        <Checkbox
                          checked={editForm?.targetPersonaIds.includes(p.id) ?? false}
                          onCheckedChange={(checked) => {
                            if (!editForm) return;
                            const next = checked
                              ? [...editForm.targetPersonaIds, p.id]
                              : editForm.targetPersonaIds.filter((pid) => pid !== p.id);
                            setEditForm({ ...editForm, targetPersonaIds: next });
                          }}
                          data-testid={`checkbox-edit-persona-${p.id}`}
                        />
                        <span>
                          {p.name}
                          {p.role && <span className="text-muted-foreground ml-1">· {p.role}</span>}
                          {p.isIcp && <span className="ml-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">ICP</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Channels */}
              <div className="space-y-1.5">
                <Label>Channels</Label>
                <div className="flex items-center gap-4">
                  {(["email", "linkedin"] as const).map((ch) => (
                    <label key={ch} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={editForm.channels.includes(ch)}
                        onCheckedChange={(checked) => {
                          const next = checked
                            ? [...editForm.channels, ch]
                            : editForm.channels.filter((c) => c !== ch);
                          setEditForm({ ...editForm, channels: next });
                        }}
                        data-testid={`checkbox-edit-channel-${ch}`}
                      />
                      <span className="capitalize">{ch}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Targeting filter */}
              <div className="space-y-3 border rounded-md p-3">
                <div>
                  <p className="text-sm font-medium">Targeting</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Used for both Apollo prospect discovery and ICP fit scoring. Named accounts and target roles are the most impactful for scoring newly imported contacts.</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Geographies</Label>
                  <TagInput
                    value={editForm.geographies}
                    onChange={(v) => setEditForm({ ...editForm, geographies: v })}
                    placeholder="e.g. Toronto, New York… (Enter to add)"
                    testId="tag-input-geographies"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Industries</Label>
                  <TagInput
                    value={editForm.industries}
                    onChange={(v) => setEditForm({ ...editForm, industries: v })}
                    placeholder="e.g. Financial Services, Healthcare…"
                    testId="tag-input-industries"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Segments</Label>
                  <TagInput
                    value={editForm.segments}
                    onChange={(v) => setEditForm({ ...editForm, segments: v })}
                    placeholder="e.g. Mid-market, Enterprise…"
                    testId="tag-input-segments"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Named accounts</Label>
                  <TagInput
                    value={editForm.namedAccounts}
                    onChange={(v) => setEditForm({ ...editForm, namedAccounts: v })}
                    placeholder="e.g. Acme Corp, acme.com…"
                    testId="tag-input-named-accounts"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Target roles</Label>
                  <TagInput
                    value={editForm.targetRoles}
                    onChange={(v) => setEditForm({ ...editForm, targetRoles: v })}
                    placeholder="e.g. CIO, VP Engineering…"
                    testId="tag-input-target-roles"
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => { setEditing(false); setEditForm(null); }}
              disabled={editCampaign.isPending}
              data-testid="button-edit-campaign-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={submitEdit}
              disabled={!editForm?.name.trim() || editCampaign.isPending}
              data-testid="button-edit-campaign-save"
            >
              {editCampaign.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dossier dialog */}
      <Dialog open={!!dossier} onOpenChange={(o) => !o && setDossier(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{dossier?.name}</DialogTitle>
            <DialogDescription>
              {dossier?.title}{dossier?.companyName ? ` · ${dossier.companyName}` : ""}
              {dossier?.icpScore != null ? ` · ICP ${dossier.icpScore}/100` : ""}
            </DialogDescription>
          </DialogHeader>
          {dossier?.disqualifiedReason && <p className="text-sm text-destructive">{dossier.disqualifiedReason}</p>}
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{dossier?.researchDossier}</p>
          {marketingTouches.length > 0 && (
            <div className="border-t pt-3">
              <button
                className="flex items-center gap-1.5 text-sm font-medium w-full text-left mb-2"
                onClick={() => setMarketingTouchesExpanded(v => !v)}
                data-testid="button-marketing-touches-toggle"
              >
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                Marketing touches ({marketingTouches.length})
                <ChevronDown className={`w-3.5 h-3.5 ml-auto text-muted-foreground transition-transform ${marketingTouchesExpanded ? "" : "-rotate-90"}`} />
              </button>
              {marketingTouchesExpanded && (
                <div className="space-y-1.5" data-testid="marketing-touches-list">
                  {marketingTouches.map((t) => (
                    <div key={t.sendId} className="flex items-center gap-2 text-xs" data-testid={`marketing-touch-${t.sendId}`}>
                      <span className="flex-1 truncate text-muted-foreground">{t.subject ?? "(no subject)"}</span>
                      <span className="text-muted-foreground shrink-0">
                        {t.sentAt ? new Date(t.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                      </span>
                      {t.openedAt && <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300 shrink-0">opened</Badge>}
                      {t.clickedAt && <Badge variant="outline" className="text-[10px] text-indigo-600 border-indigo-300 shrink-0">clicked</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* HubSpot import dialog — search or browse by list, preview, select, import */}
      <Dialog open={hubspotOpen} onOpenChange={(o) => { if (!o) setHubspotOpen(false); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="w-4 h-4" /> Import from HubSpot
            </DialogTitle>
            <DialogDescription>
              Search contacts or pick a HubSpot list, choose who to add, then click Import. Contacts already on this campaign are shown greyed-out.
            </DialogDescription>
          </DialogHeader>

          {/* Not connected — inline prompt */}
          {hubspotNotConnected ? (
            <div className="rounded-md border border-amber-400/50 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-2" data-testid="hubspot-not-connected">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">HubSpot isn't connected</p>
              <p className="text-xs text-amber-700 dark:text-amber-400">Connect your HubSpot account in Settings to import contacts from your CRM.</p>
              <Button size="sm" variant="outline" asChild>
                <a href="/app/settings/integrations" data-testid="link-connect-hubspot">Go to Integrations →</a>
              </Button>
            </div>
          ) : (
            <>
              {/* Mode toggle: Search contacts | Browse by list */}
              <div className="flex items-center rounded-lg border border-border p-0.5 w-fit">
                <Button
                  variant={hubspotMode === "search" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => setHubspotMode("search")}
                  data-testid="hubspot-tab-search"
                >
                  <Search className="w-3.5 h-3.5 mr-1.5" /> Search contacts
                </Button>
                <Button
                  variant={hubspotMode === "list" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => {
                    setHubspotMode("list");
                    loadHubspotLists();
                  }}
                  data-testid="hubspot-tab-list"
                >
                  <ChevronDown className="w-3.5 h-3.5 mr-1.5" /> Browse by list
                </Button>
              </div>

              {/* Search mode */}
              {hubspotMode === "search" && (
                <div className="flex gap-2">
                  <Input
                    placeholder="Search by name, email, or company…"
                    value={hubspotQuery}
                    onChange={(e) => setHubspotQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && searchHubspot(hubspotQuery)}
                    data-testid="input-hubspot-search"
                    className="flex-1"
                  />
                  <Button variant="outline" onClick={() => searchHubspot(hubspotQuery)} disabled={hubspotSearching} data-testid="button-hubspot-search">
                    {hubspotSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </Button>
                </div>
              )}

              {/* List mode — picker */}
              {hubspotMode === "list" && (
                <div className="flex gap-2 items-center">
                  {hubspotNeedsReconnect ? (
                    <p className="text-sm text-amber-600 dark:text-amber-400 py-1">
                      HubSpot needs to be reconnected to enable list browsing — the{" "}
                      <strong>crm.lists.read</strong> permission wasn't granted when it was first connected.
                      Go to <strong>Settings → Connections</strong> and reconnect HubSpot to grant it.
                    </p>
                  ) : hubspotListsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading lists…
                    </div>
                  ) : (
                    <Select
                      value={hubspotSelectedList ?? ""}
                      onValueChange={(v) => {
                        setHubspotSelectedList(v);
                        loadContactsFromList(v);
                      }}
                    >
                      <SelectTrigger className="flex-1" data-testid="hubspot-list-picker">
                        <SelectValue placeholder="Choose a HubSpot list…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(hubspotLists ?? []).map((l) => (
                          <SelectItem key={l.listId} value={l.listId}>
                            {l.name}
                            {l.memberCount > 0 && (
                              <span className="ml-2 text-xs text-muted-foreground">({l.memberCount})</span>
                            )}
                          </SelectItem>
                        ))}
                        {hubspotLists?.length === 0 && (
                          <div className="px-3 py-4 text-center text-xs text-muted-foreground">No contact lists found in HubSpot.</div>
                        )}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {/* Contact list */}
              {hubspotSearching ? (
                <div className="py-10 flex flex-col items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" /> Searching HubSpot…
                </div>
              ) : hubspotContacts && hubspotContacts.length > 0 ? (
                <>
                  <div className="max-h-[50vh] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8">
                            <Checkbox
                              checked={hubspotContacts.filter((c) => !c.alreadyOnCampaign).length > 0 &&
                                hubspotContacts.filter((c) => !c.alreadyOnCampaign).every((c) => hubspotSelected.has(c.hubspotContactId))}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setHubspotSelected(new Set(hubspotContacts.filter((c) => !c.alreadyOnCampaign).map((c) => c.hubspotContactId)));
                                } else {
                                  setHubspotSelected(new Set());
                                }
                              }}
                              data-testid="hubspot-select-all"
                            />
                          </TableHead>
                          <TableHead>Name / Title</TableHead>
                          <TableHead>Company</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {hubspotContacts.map((c) => (
                          <TableRow
                            key={c.hubspotContactId}
                            className={c.alreadyOnCampaign ? "bg-muted/40" : ""}
                            data-testid={`hubspot-contact-${c.hubspotContactId}`}
                          >
                            <TableCell>
                              <Checkbox
                                checked={hubspotSelected.has(c.hubspotContactId)}
                                disabled={c.alreadyOnCampaign}
                                onCheckedChange={() => {
                                  if (c.alreadyOnCampaign) return;
                                  setHubspotSelected((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(c.hubspotContactId)) next.delete(c.hubspotContactId);
                                    else next.add(c.hubspotContactId);
                                    return next;
                                  });
                                }}
                                data-testid={`hubspot-select-${c.hubspotContactId}`}
                              />
                            </TableCell>
                            <TableCell>
                              <div className={`font-medium ${c.alreadyOnCampaign ? "text-muted-foreground" : ""}`}>{c.name}</div>
                              {c.jobTitle && <div className="text-xs text-muted-foreground">{c.jobTitle}</div>}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{c.company ?? "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{c.email ?? "—"}</TableCell>
                            <TableCell>
                              {c.alreadyOnCampaign && (
                                <Badge variant="secondary" className="text-[10px] whitespace-nowrap" data-testid={`hubspot-already-${c.hubspotContactId}`}>
                                  Already added
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <DialogFooter className="gap-2 items-center sm:justify-between">
                    <span className="text-xs text-muted-foreground">{hubspotSelected.size} selected</span>
                    <Button
                      onClick={() => importHubspotSelected.mutate()}
                      disabled={hubspotSelected.size === 0 || importHubspotSelected.isPending}
                      data-testid="button-import-hubspot-selected"
                    >
                      {importHubspotSelected.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
                      Import {hubspotSelected.size > 0 ? `${hubspotSelected.size} ` : ""}selected
                    </Button>
                  </DialogFooter>
                </>
              ) : hubspotContacts !== null ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No contacts found. Try a different search term.
                </div>
              ) : null}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Apollo / CSV import dialog — preview parsed rows, select, import */}
      <Dialog open={csvOpen} onOpenChange={(o) => { if (!o) { setCsvOpen(false); setCsvResult(null); } }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-4 h-4" /> Import from CSV
            </DialogTitle>
            <DialogDescription>
              {csvResult
                ? `Done — imported ${csvResult.imported} prospect${csvResult.imported !== 1 ? "s" : ""}, skipped ${csvResult.skipped} already on this campaign.`
                : `${csvRows.length} contact${csvRows.length !== 1 ? "s" : ""} found. Select which to import — contacts without an email address are still imported using their LinkedIn URL.`}
            </DialogDescription>
          </DialogHeader>

          {csvResult ? (
            <div className="py-6 text-center space-y-4">
              <p className="text-2xl font-semibold">{csvResult.imported} imported</p>
              {csvResult.skipped > 0 && (
                <p className="text-sm text-muted-foreground">{csvResult.skipped} skipped (already on campaign)</p>
              )}
              <Button onClick={() => { setCsvOpen(false); setCsvResult(null); }} data-testid="button-csv-done">Done</Button>
            </div>
          ) : (
            <>
              <div className="max-h-[55vh] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={csvSelected.size === csvRows.length && csvRows.length > 0}
                          onCheckedChange={(v) => setCsvSelected(v ? new Set(csvRows.map((_, i) => i)) : new Set())}
                          data-testid="checkbox-csv-select-all"
                        />
                      </TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Email</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {csvRows.map((row, i) => (
                      <TableRow key={i} className={!csvSelected.has(i) ? "opacity-50" : ""} data-testid={`csv-row-${i}`}>
                        <TableCell>
                          <Checkbox
                            checked={csvSelected.has(i)}
                            onCheckedChange={(v) => {
                              const s = new Set(csvSelected);
                              v ? s.add(i) : s.delete(i);
                              setCsvSelected(s);
                            }}
                            data-testid={`checkbox-csv-row-${i}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.title || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.companyName || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.email ? row.email : (
                            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                              <Linkedin className="w-3 h-3" /> LinkedIn only
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <DialogFooter className="gap-2 items-center sm:justify-between">
                <span className="text-xs text-muted-foreground">{csvSelected.size} of {csvRows.length} selected</span>
                <Button
                  onClick={importCsvProspects}
                  disabled={csvSelected.size === 0 || csvImporting}
                  data-testid="button-import-csv-confirm"
                >
                  {csvImporting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
                  Import {csvSelected.size > 0 ? `${csvSelected.size} ` : ""}prospect{csvSelected.size !== 1 ? "s" : ""}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Discovery dialog — review web-discovered candidates, then import selected */}
      <Dialog open={discovering} onOpenChange={(o) => { if (!o) { setDiscovering(false); setDiscoverResult(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Radar className="w-4 h-4" /> Discover prospects
              {discoverResult && (
                <Badge
                  variant="secondary"
                  className="text-[10px] font-normal ml-1"
                  data-testid="discovery-backend-badge"
                >
                  {discoverResult.backend === "apollo"
                    ? "Results via Apollo"
                    : discoverResult.backend === "salesnav"
                      ? "Results via Sales Navigator"
                      : "Results via web discovery"}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Net-new people matching this campaign's ICP, scored against your criteria. Pick who to add.
            </DialogDescription>
          </DialogHeader>

          {/* Fallback notice — shown when Apollo returned 0 and we retried with web */}
          {discoverResult?.fallbackReason && (
            <ApolloFallbackNotice
              reason={discoverResult.fallbackReason}
              diagnostics={discoverResult.apolloDiagnostics}
            />
          )}

          {/* Sales Navigator availability notice */}
          {salesNavBackend && !salesNavBackend.available && (
            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground" data-testid="salesnav-unavailable-notice">
              <span className="inline-flex items-center gap-1 shrink-0">
                <Linkedin className="w-3 h-3" />
                <span className="font-medium">Sales Navigator</span>
              </span>
              <span className="mx-1 text-border">·</span>
              <Badge variant="outline" className="text-[10px] shrink-0">Coming soon</Badge>
              <span className="text-muted-foreground/70">LinkedIn's API doesn't support direct access yet.</span>
            </div>
          )}

          {discover.isPending ? (
            <div className="py-10 flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              Searching{apolloBackend?.available ? " Apollo" : " public sources"}…
            </div>
          ) : discoverResult && discoverResult.candidates.length > 0 ? (
            <>
              <div className="max-h-[50vh] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead className="text-center">Score</TableHead>
                      <TableHead>Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {discoverResult.candidates.map((c, i) => (
                      <TableRow key={i} data-testid={`discovery-candidate-${i}`}>
                        <TableCell>
                          <Checkbox checked={selected.has(i)} onCheckedChange={() => toggleSelected(i)} data-testid={`discovery-select-${i}`} />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{c.candidate.name}</div>
                          {c.candidate.title && <div className="text-xs text-muted-foreground">{c.candidate.title}</div>}
                        </TableCell>
                        <TableCell className="text-sm">{c.candidate.companyName ?? "—"}</TableCell>
                        <TableCell className={`text-center font-semibold ${scoreColor(c.scored.score)}`}>
                          {c.scored.disqualified ? "DQ" : c.scored.score}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {c.candidate.sourceUrl ? (
                              <a href={c.candidate.sourceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline text-xs inline-flex items-center gap-1">
                                source <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                            {c.candidate.confidence === "verified" && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border-0" data-testid={`discovery-confidence-${i}`}>
                                verified
                              </Badge>
                            )}
                            {c.candidate.confidence === "reconfirm" && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700" data-testid={`discovery-confidence-${i}`}>
                                re-confirm
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <DialogFooter className="gap-2 items-center sm:justify-between">
                <span className="text-xs text-muted-foreground">{selected.size} of {discoverResult.candidates.length} selected</span>
                <Button onClick={() => importDiscovered.mutate()} disabled={selected.size === 0 || importDiscovered.isPending} data-testid="button-import-discovered">
                  {importDiscovered.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
                  Import selected
                </Button>
              </DialogFooter>
            </>
          ) : discoverResult ? (
            <div className="py-8 text-center space-y-1.5" data-testid="discovery-empty-state">
              <p className="text-sm font-medium">No new prospects found</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                {discoverResult.fallbackReason
                  ? "Apollo returned no matches and web discovery also found no results — try broadening the campaign's roles, industries, or geographies."
                  : "Everyone found is already on this campaign, or no matches were found — try widening the campaign's roles, industries, or geographies."}
              </p>
            </div>
          ) : null}
          {discoverResult?.relaxationApplied && (
            <p className="text-[11px] text-muted-foreground border-t pt-2" data-testid="discovery-relaxation-notice">
              The exact filters returned no one, so the search was automatically broadened: {discoverResult.relaxationApplied}.
            </p>
          )}
          {discoverResult?.intentExpansion && (
            <p className="text-[11px] text-muted-foreground border-t pt-2" data-testid="discovery-intent-expansion-notice">
              Targeting interpreted broadly
              {discoverResult.intentExpansion.addedGeographies.length > 0 && <> — nearby areas: {discoverResult.intentExpansion.addedGeographies.slice(0, 4).join(", ")}{discoverResult.intentExpansion.addedGeographies.length > 4 ? "…" : ""}</>}
              {discoverResult.intentExpansion.addedIndustries.length > 0 && <> — adjacent industries: {discoverResult.intentExpansion.addedIndustries.slice(0, 4).join(", ")}{discoverResult.intentExpansion.addedIndustries.length > 4 ? "…" : ""}</>}
              {discoverResult.intentExpansion.addedRoles.length > 0 && <> — title variants: {discoverResult.intentExpansion.addedRoles.slice(0, 4).join(", ")}{discoverResult.intentExpansion.addedRoles.length > 4 ? "…" : ""}</>}
            </p>
          )}
          {discoverResult?.accountCluster && discoverResult.accountCluster.length > 0 && (
            <p className="text-[11px] text-muted-foreground border-t pt-2" data-testid="discovery-account-cluster-notice">
              Included decision-makers from {discoverResult.accountCluster.length} fitting compan{discoverResult.accountCluster.length === 1 ? "y" : "ies"} in your target area (companies-first search for event invites).
            </p>
          )}
          {discoverResult?.expansionSummary && (
            <p className="text-[11px] text-muted-foreground border-t pt-2 flex items-center gap-1" data-testid="discovery-expansion-notice">
              <Search className="w-3 h-3 shrink-0" />
              Searched {discoverResult.expansionSummary.expandedCount} companies similar to{" "}
              {discoverResult.expansionSummary.seedCompanies.length === 1
                ? discoverResult.expansionSummary.seedCompanies[0]
                : discoverResult.expansionSummary.seedCompanies.slice(0, -1).join(", ") +
                  " & " +
                  discoverResult.expansionSummary.seedCompanies.at(-1)}
            </p>
          )}
          {discoverResult && discoverResult.droppedCount > 0 && (
            <p className="text-[11px] text-muted-foreground border-t pt-2" data-testid="discovery-dropped-notice">
              {discoverResult.droppedCount} candidate{discoverResult.droppedCount === 1 ? " was" : "s were"} filtered out — they appeared to be company names, role labels, or incomplete names rather than real people.
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* Draft review dialog */}
      <Dialog open={!!draft} onOpenChange={(o) => { if (!o) { setDraft(null); setSharpenResult(null); } }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isLinkedInDraft ? <Linkedin className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
              Review draft — step {draft?.stepNumber}
              {isLinkedInDraft && draft?.linkedinFormat && (
                <Badge variant="secondary" className="text-[10px]">{LINKEDIN_FORMAT_LABELS[draft.linkedinFormat]}</Badge>
              )}
              {isLinkedInDraft && draft?.intent === "engagement" && (
                <Badge variant="outline" className="text-[10px]">Engagement</Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {isLinkedInDraft
                ? "You send LinkedIn messages by hand: review, copy, then paste into LinkedIn. LinkedIn can't pre-fill the message for you."
                : "You approve every send. Approving creates a draft in your Outlook; you click Send there."}
            </DialogDescription>
          </DialogHeader>

          {draft?.channel === "email" && (
            <div className="space-y-1.5">
              <Label htmlFor="d-subject">Subject</Label>
              <Input id="d-subject" value={draftSubject} onChange={(e) => setDraftSubject(e.target.value)} data-testid="input-draft-subject" />
            </div>
          )}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="d-body">Body</Label>
              {draftLimit != null && (
                <span className={`text-[11px] tabular-nums ${draftOverLimit ? "text-destructive font-medium" : "text-muted-foreground"}`} data-testid="draft-char-count">
                  {draftBody.length}/{draftLimit}
                </span>
              )}
            </div>
            <Textarea id="d-body" value={draftBody} onChange={(e) => setDraftBody(e.target.value)} rows={9} data-testid="input-draft-body" />
            {draftOverLimit && (
              <p className="text-[11px] text-destructive">
                Over LinkedIn's {draftLimit}-character limit for a {draft?.linkedinFormat === "connect_request" ? "connection note" : "message"} — trim before sending.
              </p>
            )}
          </div>

          {/* LinkedIn paste-assist: copy + open the right LinkedIn screen. */}
          {isLinkedInDraft && (
            <div className="rounded-md border p-2.5 space-y-2">
              {!draftHasProfile ? (
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm">
                    <p className="font-medium">No LinkedIn profile on file</p>
                    <p className="text-xs text-muted-foreground">Find it to open the right screen, or add it on the prospect.</p>
                  </div>
                  {draftProspect && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => enrich.mutate(draftProspect.id)}
                      disabled={enrich.isPending && enrich.variables === draftProspect.id}
                      data-testid="draft-find-linkedin"
                    >
                      {enrich.isPending && enrich.variables === draftProspect.id
                        ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                        : <UserSearch className="w-3.5 h-3.5 mr-1" />}
                      Find LinkedIn
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="default" onClick={() => copyToClipboard(draftBody)} data-testid="draft-copy">
                    <Copy className="w-3.5 h-3.5 mr-1" /> Copy message
                  </Button>
                  {draft?.linkedinFormat === "direct_message" && draftDeepLinks?.messaging && (
                    <Button size="sm" variant="outline" asChild data-testid="draft-open-messaging">
                      <a href={draftDeepLinks.messaging} target="_blank" rel="noreferrer">
                        <Send className="w-3.5 h-3.5 mr-1" /> Open message <ExternalLink className="w-3 h-3 ml-1" />
                      </a>
                    </Button>
                  )}
                  {draftDeepLinks?.profile && (
                    <Button size="sm" variant="outline" asChild data-testid="draft-open-profile">
                      <a href={draftDeepLinks.profile} target="_blank" rel="noreferrer">
                        <Linkedin className="w-3.5 h-3.5 mr-1" /> Open profile <ExternalLink className="w-3 h-3 ml-1" />
                      </a>
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {draftFlags && (
            <div className={`rounded-md border p-2.5 text-sm ${draftFlags.flags.length === 0 ? "border-emerald-500/40" : draftHardBlocked ? "border-destructive/50" : "border-amber-500/40"}`}>
              <div className="flex items-center gap-1.5 font-medium mb-1">
                {draftFlags.flags.length === 0 ? (
                  <><ShieldCheck className="w-4 h-4 text-emerald-500" /> Compliance clean</>
                ) : (
                  <><ShieldAlert className={`w-4 h-4 ${draftHardBlocked ? "text-destructive" : "text-amber-500"}`} /> {draftFlags.flags.length} flag(s)</>
                )}
              </div>
              <ul className="space-y-0.5 text-muted-foreground">
                {draftFlags.flags.map((f, i) => (
                  <li key={i}>
                    <span className="font-mono text-[11px] uppercase mr-1.5">{f.kind.replace("_", " ")}</span>
                    {f.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sharpenResult && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 space-y-3">
              {sharpenResult.subject && sharpenOriginal.subject && sharpenResult.subject !== sharpenOriginal.subject && (
                <SharpenDiffPanel
                  before={sharpenOriginal.subject}
                  after={sharpenResult.subject}
                  beforeLabel="Subject — before"
                  afterLabel="Subject — after"
                  maxHeight="max-h-16"
                />
              )}
              <SharpenDiffPanel
                before={sharpenOriginal.body}
                after={sharpenResult.body}
                beforeLabel="Body — before"
                afterLabel="Body — after"
                maxHeight="max-h-40"
              />
              <div>
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-1">What changed</p>
                <ul className="space-y-0.5">
                  {sharpenResult.changelog.map((item, i) => (
                    <li key={i} className="text-xs text-amber-700 dark:text-amber-400">• {item}</li>
                  ))}
                </ul>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setDraftBody(sharpenResult.body);
                    if (sharpenResult.subject) setDraftSubject(sharpenResult.subject);
                    setSharpenResult(null);
                  }}
                  data-testid="button-sharpen-accept"
                >
                  Accept changes
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSharpenResult(null)} data-testid="button-sharpen-reject">
                  Discard
                </Button>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => { setSharpenOriginal({ body: draftBody, subject: draftSubject }); setSharpenResult(null); sharpenTouch.mutate(); }} disabled={sharpenTouch.isPending} data-testid="button-sharpen-touch">
              {sharpenTouch.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Scissors className="w-4 h-4 mr-1" />}
              Sharpen writing
            </Button>
            <div className="flex-1" />
            <Button variant="outline" onClick={() => saveDraft.mutate()} disabled={saveDraft.isPending} data-testid="button-save-draft">
              {saveDraft.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <PenLine className="w-4 h-4 mr-1" />}
              Save & re-scan
            </Button>
            <Button onClick={() => approve.mutate()} disabled={approve.isPending || draftHardBlocked} data-testid="button-approve-draft">
              {approve.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : draft?.channel === "email" ? <Send className="w-4 h-4 mr-1" /> : <ExternalLink className="w-4 h-4 mr-1" />}
              {draft?.channel === "email" ? "Approve → Outlook" : "Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
