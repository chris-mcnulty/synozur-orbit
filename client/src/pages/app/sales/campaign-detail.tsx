import { useState, useRef, KeyboardEvent } from "react";
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
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useUser } from "@/lib/userContext";

interface OutreachCampaign {
  id: string;
  name: string;
  goalType: string;
  salesGoal: string | null;
  status: string;
  channels: string[] | null;
  eventDate: string | null;
  productId: string | null;
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
  source: "web" | "salesnav" | "apollo";
}
interface ScoredDiscoveryCandidate {
  candidate: DiscoveryCandidate;
  scored: { score: number; qualified: boolean; disqualified: boolean };
}
interface DiscoverResult {
  backend: "web" | "salesnav" | "apollo";
  candidates: ScoredDiscoveryCandidate[];
  foundCount: number;
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

function initEditForm(c: OutreachCampaign) {
  return {
    name: c.name,
    goalType: c.goalType,
    salesGoal: c.salesGoal ?? "",
    productId: c.productId ?? "",
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

export default function OutreachCampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const [adding, setAdding] = useState(false);
  const [dossier, setDossier] = useState<Prospect | null>(null);
  const [form, setForm] = useState({ name: "", title: "", companyName: "", email: "", linkedinUrl: "" });

  // Edit campaign dialog state.
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);

  // Draft review dialog state.
  const [draft, setDraft] = useState<Touch | null>(null);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");

  // Discovery dialog state.
  const [discovering, setDiscovering] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<DiscoverResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // HubSpot import dialog state.
  const [hubspotOpen, setHubspotOpen] = useState(false);
  const [hubspotQuery, setHubspotQuery] = useState("");
  const [hubspotContacts, setHubspotContacts] = useState<HubspotContact[] | null>(null);
  const [hubspotSearching, setHubspotSearching] = useState(false);
  const [hubspotSelected, setHubspotSelected] = useState<Set<string>>(new Set());

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

  function openDraft(t: Touch) {
    setDraft(t);
    setDraftSubject(t.subject ?? "");
    setDraftBody(t.body ?? "");
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
    mutationFn: async (prospectId: string) => {
      const res = await apiRequest("POST", `/api/sales-outreach/prospects/${prospectId}/compose`, {});
      return res.json();
    },
    onSuccess: (data: { touch: Touch }) => {
      queryClient.invalidateQueries({ queryKey: prospectsKey });
      openDraft(data.touch);
      toast({ title: "Draft composed", description: "Review and approve to send to Outlook." });
    },
    onError: (err: any) => toast({ title: "Compose failed", description: err?.message, variant: "destructive" }),
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
    try {
      const res = await apiRequest("POST", `/api/sales-outreach/campaigns/${id}/preview-hubspot`, { query: q || undefined, limit: 50 });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setHubspotContacts(data.contacts ?? []);
      // Pre-select contacts not already on the campaign.
      setHubspotSelected(new Set((data.contacts ?? []).filter((c: HubspotContact) => !c.alreadyOnCampaign).map((c: HubspotContact) => c.hubspotContactId)));
    } catch (err: any) {
      toast({ title: "HubSpot search failed", description: err?.message?.includes("connected") ? "Connect HubSpot in Integrations first." : err?.message, variant: "destructive" });
    } finally {
      setHubspotSearching(false);
    }
  }

  function openHubspotDialog() {
    setHubspotContacts(null);
    setHubspotQuery("");
    setHubspotSelected(new Set());
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

  const draftFlags = draft?.complianceFlags;
  const draftHardBlocked = (draftFlags?.flags ?? []).some((f) => FLAG_HARD.has(f.kind));

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
          <CardHeader className="pb-2"><CardTitle className="text-base">Prospects ({prospects.length})</CardTitle></CardHeader>
          <CardContent>
            {prospects.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No prospects yet — add one to research and score it.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead className="text-center">Score</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prospects.map((p) => (
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
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {p.source === "hubspot" ? "HubSpot" : p.source}
                          </Badge>
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
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => compose.mutate(p.id)}
                            disabled={compose.isPending && compose.variables === p.id}
                            data-testid={`compose-${p.id}`}
                          >
                            {compose.isPending && compose.variables === p.id ? (
                              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                            ) : (
                              <PenLine className="w-3.5 h-3.5 mr-1" />
                            )}
                            Compose
                          </Button>
                        )}
                        {!p.hubspotContactId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => syncHubspot.mutate(p.id)}
                            disabled={syncHubspot.isPending && syncHubspot.variables === p.id}
                            data-testid={`push-hubspot-${p.id}`}
                            title="Push to HubSpot"
                          >
                            {syncHubspot.isPending && syncHubspot.variables === p.id
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Upload className="w-3.5 h-3.5" />}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
                <p className="text-sm font-medium">Targeting</p>

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
        </DialogContent>
      </Dialog>

      {/* HubSpot import dialog — search, preview, select, import */}
      <Dialog open={hubspotOpen} onOpenChange={(o) => { if (!o) setHubspotOpen(false); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="w-4 h-4" /> Import from HubSpot
            </DialogTitle>
            <DialogDescription>
              Search your HubSpot contacts, pick who to add, then click Import.
            </DialogDescription>
          </DialogHeader>

          {/* Search bar */}
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
                      <TableHead>Name</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Email</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hubspotContacts.map((c) => (
                      <TableRow
                        key={c.hubspotContactId}
                        className={c.alreadyOnCampaign ? "opacity-40" : ""}
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
                          <div className="font-medium">{c.name}</div>
                          {c.jobTitle && <div className="text-xs text-muted-foreground">{c.jobTitle}</div>}
                          {c.alreadyOnCampaign && <div className="text-[10px] text-muted-foreground">already on campaign</div>}
                        </TableCell>
                        <TableCell className="text-sm">{c.company ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.email ?? "—"}</TableCell>
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
        </DialogContent>
      </Dialog>

      {/* Discovery dialog — review web-discovered candidates, then import selected */}
      <Dialog open={discovering} onOpenChange={(o) => { if (!o) { setDiscovering(false); setDiscoverResult(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Radar className="w-4 h-4" /> Discover prospects
            </DialogTitle>
            <DialogDescription>
              Net-new people matching this campaign's ICP, found from public web sources and scored. Pick who to add.
            </DialogDescription>
          </DialogHeader>

          {discover.isPending ? (
            <div className="py-10 flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              Searching public sources…
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
                          {c.candidate.sourceUrl ? (
                            <a href={c.candidate.sourceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline text-xs inline-flex items-center gap-1">
                              source <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
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
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No new prospects found. Try widening the campaign's roles, industries, or geographies.
            </div>
          )}
          {salesNavBackend && !salesNavBackend.available && discoverResult && (
            <p className="text-[11px] text-muted-foreground border-t pt-2">{salesNavBackend.reason}</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Draft review dialog */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {draft?.channel === "linkedin" ? <Linkedin className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
              Review draft — step {draft?.stepNumber}
            </DialogTitle>
            <DialogDescription>
              You approve every send. Approving creates a draft in your Outlook; you click Send there.
            </DialogDescription>
          </DialogHeader>

          {draft?.channel === "email" && (
            <div className="space-y-1.5">
              <Label htmlFor="d-subject">Subject</Label>
              <Input id="d-subject" value={draftSubject} onChange={(e) => setDraftSubject(e.target.value)} data-testid="input-draft-subject" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="d-body">Body</Label>
            <Textarea id="d-body" value={draftBody} onChange={(e) => setDraftBody(e.target.value)} rows={9} data-testid="input-draft-body" />
          </div>

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

          <DialogFooter className="gap-2">
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
