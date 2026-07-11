import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/lib/userContext";
import { useSearch } from "wouter";
import { Archive, Plus, Loader2, Search, ExternalLink } from "lucide-react";
import { EVIDENCE_TYPES, labelFor } from "./shared";
import { formatDate } from "@/lib/utils";

interface EvidenceRow {
  id: string;
  title: string;
  description: string | null;
  evidenceType: string;
  sourceTool: string | null;
  externalUrl: string | null;
  collectedAt: string | null;
  createdAt: string;
}

export default function ObservatoryEvidence() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const linkFindingId = params.get("findingId") ?? "";
  const linkAssessmentId = params.get("assessmentId") ?? "";
  const canWrite = ["Analyst", "Domain Admin", "Global Admin"].includes(user?.role ?? "");

  const [typeFilter, setTypeFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(!!linkFindingId || !!linkAssessmentId);
  const [form, setForm] = useState({ title: "", description: "", evidenceType: "screenshot", sourceTool: "", externalUrl: "", collectedAt: "" });

  const qp = new URLSearchParams();
  if (typeFilter !== "all") qp.set("type", typeFilter);
  if (searchTerm.trim()) qp.set("search", searchTerm.trim());
  const qs = qp.toString();

  const { data: evidence, isLoading } = useQuery<EvidenceRow[]>({
    queryKey: [`/api/observatory/evidence${qs ? `?${qs}` : ""}`],
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/observatory/evidence", {
          title: form.title,
          description: form.description || null,
          evidenceType: form.evidenceType,
          sourceTool: form.sourceTool || null,
          externalUrl: form.externalUrl || null,
          collectedAt: form.collectedAt || null,
          ...(linkFindingId ? { linkFindingId } : {}),
          ...(linkAssessmentId ? { linkAssessmentId } : {}),
        })
      ).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/observatory") });
      setDialogOpen(false);
      setForm({ title: "", description: "", evidenceType: "screenshot", sourceTool: "", externalUrl: "", collectedAt: "" });
      toast({
        title: "Evidence added",
        description: linkFindingId ? "Linked to the finding." : linkAssessmentId ? "Linked to the assessment." : undefined,
      });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-evidence-title">Evidence Vault</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Screenshots, scan reports, attestations, and documents that back your assessments and findings.
            </p>
          </div>
          {canWrite && (
            <Button onClick={() => setDialogOpen(true)} data-testid="button-new-evidence">
              <Plus className="h-4 w-4 mr-2" /> Add Evidence
            </Button>
          )}
        </div>

        <div className="flex gap-3 flex-wrap items-center">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9 w-[240px]" placeholder="Search evidence…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} data-testid="input-search-evidence" />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[170px]" data-testid="select-filter-evidence-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {EVIDENCE_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (evidence ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-12 flex flex-col items-center text-center gap-3">
              <Archive className="h-10 w-10 text-muted-foreground" />
              <p className="font-medium">The vault is empty</p>
              <p className="text-sm text-muted-foreground">Add evidence here, or from a finding or assessment to link it automatically.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {(evidence ?? []).map((e) => (
              <Card key={e.id} data-testid={`card-evidence-${e.id}`}>
                <CardContent className="py-3 px-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate" data-testid={`text-evidence-title-${e.id}`}>{e.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {e.sourceTool ? `${e.sourceTool} · ` : ""}
                      {e.description ?? ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {e.externalUrl && (
                      <a href={e.externalUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" data-testid={`link-evidence-url-${e.id}`}>
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                    <span className="text-xs text-muted-foreground">{formatDate(e.collectedAt ?? e.createdAt)}</span>
                    <Badge variant="secondary" className="text-xs">{labelFor(EVIDENCE_TYPES, e.evidenceType)}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Evidence</DialogTitle>
            <DialogDescription>
              {linkFindingId
                ? "This evidence will be linked to the finding you came from."
                : linkAssessmentId
                  ? "This evidence will be linked to the assessment you came from."
                  : "Add an item to the evidence vault."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-evidence-title" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type *</Label>
                <Select value={form.evidenceType} onValueChange={(v) => setForm({ ...form, evidenceType: v })}>
                  <SelectTrigger data-testid="select-evidence-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EVIDENCE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Collected on</Label>
                <Input type="date" value={form.collectedAt} onChange={(e) => setForm({ ...form, collectedAt: e.target.value })} data-testid="input-evidence-collected" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Source tool</Label>
                <Input placeholder="e.g. axe DevTools, Burp Suite" value={form.sourceTool} onChange={(e) => setForm({ ...form, sourceTool: e.target.value })} data-testid="input-evidence-source" />
              </div>
              <div className="space-y-2">
                <Label>External URL</Label>
                <Input placeholder="https://…" value={form.externalUrl} onChange={(e) => setForm({ ...form, externalUrl: e.target.value })} data-testid="input-evidence-url" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-evidence-description" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-evidence">Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!form.title.trim() || createMutation.isPending} data-testid="button-save-evidence">
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Add evidence
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
