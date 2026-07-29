import { useMemo, useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { ArrowLeft, Loader2, Sparkles, AlertTriangle, ClipboardList, Pencil } from "lucide-react";
import { SeverityBadge } from "./shared";

interface RelatedFinding {
  id: string;
  title: string;
  severity: string;
  status: string;
  evidence: { id: string; title: string }[];
}

interface VpatEntry {
  id: string;
  conformance: string;
  remarks: string | null;
  reviewerNotes: string | null;
  aiDrafted: boolean;
  control: {
    id: string;
    controlId: string;
    title: string;
    description: string | null;
    category: string | null;
    level: string | null;
  };
  frameworkCode: string;
  frameworkName: string;
  relatedFindings: RelatedFinding[];
}

interface VpatData {
  version: { id: string; versionNumber: string };
  application: { id: string; name: string };
  disclaimer: string;
  conformanceOptions: string[];
  entries: VpatEntry[];
}

interface AppRow { id: string; name: string }
interface VersionRow { id: string; versionNumber: string; applicationId: string }

const CONFORMANCE_STYLES: Record<string, string> = {
  "Supports": "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
  "Partially Supports": "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  "Supports With Exceptions": "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  "Does Not Support": "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  "Not Applicable": "bg-muted text-muted-foreground",
  "Not Evaluated": "bg-muted text-muted-foreground",
};

export default function ObservatoryVpat() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [applicationId, setApplicationId] = useState<string>("");
  const [versionId, setVersionId] = useState<string>("");
  const [editEntry, setEditEntry] = useState<VpatEntry | null>(null);
  const [editConformance, setEditConformance] = useState<string>("Not Evaluated");
  const [editRemarks, setEditRemarks] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [aiDrafting, setAiDrafting] = useState(false);
  const [aiDrafted, setAiDrafted] = useState(false);

  const { data: apps } = useQuery<AppRow[]>({ queryKey: ["/api/observatory/applications"] });
  const { data: versions } = useQuery<VersionRow[]>({ queryKey: ["/api/observatory/versions"] });
  const appVersions = (versions ?? []).filter((v) => v.applicationId === applicationId);

  const { data, isLoading } = useQuery<VpatData>({
    queryKey: [`/api/observatory/versions/${versionId}/vpat`],
    enabled: !!versionId,
  });

  const initMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/observatory/versions/${versionId}/vpat/init`);
      return res.json();
    },
    onSuccess: (d: { created: number; total: number }) => {
      queryClient.invalidateQueries({ queryKey: [`/api/observatory/versions/${versionId}/vpat`] });
      toast({
        title: "VPAT worksheet ready",
        description: d.created > 0 ? `${d.created} criteria added (${d.total} total).` : "Worksheet was already initialized.",
      });
    },
    onError: (err: Error) => toast({ title: "Could not initialize worksheet", description: err.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editEntry) return;
      const res = await apiRequest("PATCH", `/api/observatory/vpat/${editEntry.id}`, {
        conformance: editConformance,
        remarks: editRemarks || null,
        reviewerNotes: editNotes || null,
        aiDrafted,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/observatory/versions/${versionId}/vpat`] });
      setEditEntry(null);
      toast({ title: "Criterion saved" });
    },
    onError: (err: Error) => toast({ title: "Could not save", description: err.message, variant: "destructive" }),
  });

  const openEdit = (entry: VpatEntry) => {
    setEditEntry(entry);
    setEditConformance(entry.conformance);
    setEditRemarks(entry.remarks ?? "");
    setEditNotes(entry.reviewerNotes ?? "");
    setAiDrafted(entry.aiDrafted);
  };

  const draftWithAi = async () => {
    if (!editEntry) return;
    setAiDrafting(true);
    try {
      const res = await apiRequest("POST", `/api/observatory/vpat/${editEntry.id}/ai-draft`);
      const d = await res.json();
      setEditRemarks(d.draft);
      setAiDrafted(true);
      toast({ title: "Draft ready", description: "Review and edit before saving — this is draft content only." });
    } catch (err) {
      toast({ title: "Could not draft remarks", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setAiDrafting(false);
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, VpatEntry[]>();
    for (const e of data?.entries ?? []) {
      const list = map.get(e.frameworkName) ?? [];
      list.push(e);
      map.set(e.frameworkName, list);
    }
    return [...map.entries()];
  }, [data]);

  const evaluated = (data?.entries ?? []).filter((e) => e.conformance !== "Not Evaluated").length;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <Link href="/app/observatory">
            <Button variant="ghost" size="sm" className="mb-2 -ml-2" data-testid="link-back-observatory">
              <ArrowLeft className="h-4 w-4 mr-1" /> Observatory
            </Button>
          </Link>
          <h1 className="text-2xl font-semibold" data-testid="text-vpat-title">VPAT Assistant</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Criterion-by-criterion conformance worksheet for WCAG 2.2 and Section 508, with linked findings and AI-drafted remarks.
          </p>
        </div>

        <div className="border border-yellow-500/40 bg-yellow-500/5 rounded-md px-4 py-3 flex items-start gap-2 text-sm" data-testid="text-vpat-disclaimer">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-yellow-500" />
          <span className="font-medium">Draft VPAT support content only. Requires human review and validation. Not a legal certification.</span>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="grid md:grid-cols-3 gap-4 items-end">
              <div className="space-y-1.5">
                <Label>Application</Label>
                <Select value={applicationId} onValueChange={(v) => { setApplicationId(v); setVersionId(""); }}>
                  <SelectTrigger data-testid="select-vpat-application"><SelectValue placeholder="Choose an application" /></SelectTrigger>
                  <SelectContent>
                    {(apps ?? []).map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Version</Label>
                <Select value={versionId} onValueChange={setVersionId} disabled={!applicationId}>
                  <SelectTrigger data-testid="select-vpat-version"><SelectValue placeholder="Choose a version" /></SelectTrigger>
                  <SelectContent>
                    {appVersions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>v{v.versionNumber}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => initMutation.mutate()}
                disabled={!versionId || initMutation.isPending}
                variant={data && data.entries.length > 0 ? "outline" : "default"}
                data-testid="button-init-vpat"
              >
                {initMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ClipboardList className="h-4 w-4 mr-2" />}
                {data && data.entries.length > 0 ? "Refresh criteria" : "Initialize worksheet"}
              </Button>
            </div>
            {data && data.entries.length > 0 && (
              <p className="text-sm text-muted-foreground mt-3" data-testid="text-vpat-progress">
                {evaluated} of {data.entries.length} criteria evaluated.
              </p>
            )}
          </CardContent>
        </Card>

        {versionId && isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : data && data.entries.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No worksheet yet for this version — click "Initialize worksheet" to create entries for every WCAG 2.2 and Section 508 criterion.
            </CardContent>
          </Card>
        ) : (
          grouped.map(([framework, entries]) => (
            <Card key={framework}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{framework}</CardTitle>
                <CardDescription>{entries.length} criteria</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {entries.map((e) => (
                  <div key={e.id} className="border rounded-md p-3" data-testid={`row-vpat-${e.control.controlId}`}>
                    <div className="flex items-start gap-3 flex-wrap">
                      <div className="flex-1 min-w-[240px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs text-muted-foreground">{e.control.controlId}</span>
                          <span className="font-medium text-sm">{e.control.title}</span>
                          {e.control.level && <Badge variant="outline" className="text-xs">Level {e.control.level}</Badge>}
                          <Badge variant="outline" className={CONFORMANCE_STYLES[e.conformance] ?? ""} data-testid={`badge-conformance-${e.control.controlId}`}>
                            {e.conformance}
                          </Badge>
                          {e.aiDrafted && <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />}
                        </div>
                        {e.remarks && <p className="text-sm text-muted-foreground mt-1.5">{e.remarks}</p>}
                        {e.relatedFindings.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {e.relatedFindings.map((f) => (
                              <Link key={f.id} href={`/app/observatory/findings/${f.id}`}>
                                <div className="flex items-center gap-2 text-xs cursor-pointer hover:underline" data-testid={`link-vpat-finding-${f.id}`}>
                                  <SeverityBadge severity={f.severity} />
                                  <span>{f.title}</span>
                                  {f.evidence.length > 0 && (
                                    <span className="text-muted-foreground">· {f.evidence.length} evidence item{f.evidence.length === 1 ? "" : "s"}</span>
                                  )}
                                </div>
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                      <Button variant="outline" size="sm" onClick={() => openEdit(e)} data-testid={`button-edit-vpat-${e.control.controlId}`}>
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Evaluate
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))
        )}

        {(data?.entries.length ?? 0) > 0 && (
          <div className="border border-yellow-500/40 bg-yellow-500/5 rounded-md px-4 py-3 flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-yellow-500" />
            <span className="font-medium">Draft VPAT support content only. Requires human review and validation. Not a legal certification.</span>
          </div>
        )}
      </div>

      <Dialog open={!!editEntry} onOpenChange={(open) => !open && setEditEntry(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editEntry?.control.controlId} — {editEntry?.control.title}
            </DialogTitle>
            <DialogDescription>{editEntry?.control.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Conformance</Label>
              <Select value={editConformance} onValueChange={setEditConformance}>
                <SelectTrigger data-testid="select-edit-conformance"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(data?.conformanceOptions ?? []).map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Remarks and explanations</Label>
                <Button variant="outline" size="sm" onClick={draftWithAi} disabled={aiDrafting} data-testid="button-ai-draft-remarks">
                  {aiDrafting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                  Draft with AI
                </Button>
              </div>
              <Textarea
                value={editRemarks}
                onChange={(e) => { setEditRemarks(e.target.value); }}
                rows={4}
                placeholder="How does the product perform against this criterion?"
                data-testid="input-edit-remarks"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Reviewer notes (internal)</Label>
              <Textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={2}
                data-testid="input-edit-reviewer-notes"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Draft VPAT support content only. Requires human review and validation. Not a legal certification.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEntry(null)} data-testid="button-cancel-edit-vpat">Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-vpat">
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
