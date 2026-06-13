import { useState } from "react";
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
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface OutreachCampaign {
  id: string;
  name: string;
  goalType: string;
  salesGoal: string | null;
  status: string;
  channels: string[] | null;
  eventDate: string | null;
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
  disqualifiedReason: string | null;
  researchDossier: string | null;
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

export default function OutreachCampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [dossier, setDossier] = useState<Prospect | null>(null);
  const [form, setForm] = useState({ name: "", title: "", companyName: "", email: "", linkedinUrl: "" });

  // Draft review dialog state.
  const [draft, setDraft] = useState<Touch | null>(null);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const prospectsKey = ["/api/sales-outreach/campaigns", id, "prospects"];

  const { data: campaign, isLoading } = useQuery<OutreachCampaign>({
    queryKey: ["/api/sales-outreach/campaigns", id],
    queryFn: async () => {
      const r = await fetch(`/api/sales-outreach/campaigns/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Campaign not found");
      return r.json();
    },
  });

  const { data: prospects = [] } = useQuery<Prospect[]>({
    queryKey: prospectsKey,
    queryFn: async () => {
      const r = await fetch(`/api/sales-outreach/campaigns/${id}/prospects`, { credentials: "include" });
      if (!r.ok) return [];
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

  const importHubspot = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sales-outreach/campaigns/${id}/import-hubspot`, { limit: 50 });
      return res.json();
    },
    onSuccess: (data: { imported: number; skipped: number }) => {
      queryClient.invalidateQueries({ queryKey: prospectsKey });
      toast({ title: `Imported ${data.imported} contact(s)`, description: data.skipped ? `${data.skipped} already on this campaign.` : undefined });
    },
    onError: (err: any) =>
      toast({
        title: "HubSpot import failed",
        description: err?.message?.includes("connected") ? "Connect HubSpot in Integrations first." : err?.message,
        variant: "destructive",
      }),
  });

  const approve = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sales-outreach/touches/${draft!.id}/approve`, {});
      return res.json();
    },
    onSuccess: (data: { webLink?: string }) => {
      queryClient.invalidateQueries({ queryKey: prospectsKey });
      setDraft(null);
      toast({
        title: "Approved",
        description: data.webLink ? "Draft created in your Outlook — review and send." : "Draft approved.",
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
            <Button variant="outline" onClick={() => importHubspot.mutate()} disabled={importHubspot.isPending} data-testid="button-import-hubspot">
              {importHubspot.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />}
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
                        {p.status !== "dormant" && (
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

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
