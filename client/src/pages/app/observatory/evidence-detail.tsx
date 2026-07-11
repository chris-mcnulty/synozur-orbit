import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/lib/userContext";
import { ArrowLeft, Loader2, Trash2, AlertTriangle, ClipboardCheck, Pencil, ExternalLink, BookMarked, X } from "lucide-react";
import {
  EVIDENCE_TYPES,
  ASSESSMENT_TYPES,
  FINDING_DOMAINS,
  SeverityBadge,
  FindingStatusBadge,
  AssessmentStatusBadge,
  labelFor,
  type LabeledOption,
} from "./shared";
import { formatDate } from "@/lib/utils";

interface EvidenceDetail {
  id: string;
  title: string;
  description: string | null;
  evidenceType: string;
  source: string | null;
  externalUrl: string | null;
  collectedAt: string | null;
  createdAt: string;
  findings: {
    id: string;
    title: string;
    severity: string;
    status: string;
    domain: string;
  }[];
  assessments: {
    id: string;
    title: string;
    type: string;
    status: string;
  }[];
  versions: {
    id: string;
    versionNumber: string;
    applicationId: string;
  }[];
  controls: {
    id: string;
    controlId: string;
    title: string;
    framework: { id: string; name: string; version: string | null };
  }[];
}

export default function ObservatoryEvidenceDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canWrite = ["Analyst", "Domain Admin", "Global Admin"].includes(user?.role ?? "");
  const canDelete = ["Domain Admin", "Global Admin"].includes(user?.role ?? "");

  const { data: evidence, isLoading } = useQuery<EvidenceDetail>({
    queryKey: [`/api/observatory/evidence/${id}`],
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    evidenceType: "screenshot",
    source: "",
    externalUrl: "",
    collectedAt: "",
  });

  const openEdit = () => {
    if (!evidence) return;
    setEditForm({
      title: evidence.title,
      description: evidence.description ?? "",
      evidenceType: evidence.evidenceType,
      source: evidence.source ?? "",
      externalUrl: evidence.externalUrl ?? "",
      collectedAt: evidence.collectedAt ? evidence.collectedAt.substring(0, 10) : "",
    });
    setEditOpen(true);
  };

  const invalidate = () =>
    queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/observatory") });

  const editMutation = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("PATCH", `/api/observatory/evidence/${id}`, {
          title: editForm.title,
          description: editForm.description || null,
          evidenceType: editForm.evidenceType,
          source: editForm.source || null,
          externalUrl: editForm.externalUrl || null,
          collectedAt: editForm.collectedAt || null,
        })
      ).json(),
    onSuccess: () => {
      invalidate();
      setEditOpen(false);
      toast({ title: "Evidence updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const unlinkFinding = useMutation({
    mutationFn: async (findingId: string) =>
      (await apiRequest("DELETE", `/api/observatory/findings/${findingId}/evidence/${id}`)).json(),
    onSuccess: () => {
      invalidate();
      toast({ title: "Finding unlinked" });
    },
    onError: (err: Error) => toast({ title: "Unlink failed", description: err.message, variant: "destructive" }),
  });

  const unlinkAssessment = useMutation({
    mutationFn: async (assessmentId: string) =>
      (await apiRequest("DELETE", `/api/observatory/assessments/${assessmentId}/evidence/${id}`)).json(),
    onSuccess: () => {
      invalidate();
      toast({ title: "Assessment unlinked" });
    },
    onError: (err: Error) => toast({ title: "Unlink failed", description: err.message, variant: "destructive" }),
  });

  const deleteEvidence = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/observatory/evidence/${id}`)).json(),
    onSuccess: () => {
      invalidate();
      toast({ title: "Evidence deleted" });
      navigate("/app/observatory/evidence");
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading || !evidence) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Link href="/app/observatory/evidence">
              <Button variant="ghost" size="sm" className="mb-2 -ml-2" data-testid="button-back-evidence">
                <ArrowLeft className="h-4 w-4 mr-1" /> Evidence Vault
              </Button>
            </Link>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-semibold" data-testid="text-evidence-detail-title">{evidence.title}</h1>
              <Badge variant="secondary" data-testid="badge-evidence-type">{labelFor(EVIDENCE_TYPES, evidence.evidenceType)}</Badge>
            </div>
            {evidence.source && (
              <p className="text-muted-foreground text-sm mt-1" data-testid="text-evidence-source-tool">
                Collected with {evidence.source}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canWrite && (
              <Button variant="outline" size="sm" onClick={openEdit} data-testid="button-edit-evidence">
                <Pencil className="h-4 w-4 mr-1" /> Edit
              </Button>
            )}
            {canDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="icon" data-testid="button-delete-evidence">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this evidence?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes the evidence record and all of its links to findings, assessments, and versions. The linked items themselves are not deleted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteEvidence.mutate()} data-testid="button-confirm-delete-evidence">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <Card className="md:col-span-2">
            <CardHeader><CardTitle className="text-base">Description</CardTitle></CardHeader>
            <CardContent className="text-sm">
              {evidence.description
                ? <p data-testid="text-evidence-description">{evidence.description}</p>
                : <p className="text-muted-foreground">No description provided.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Type:</span>{" "}
                {labelFor(EVIDENCE_TYPES, evidence.evidenceType)}
              </p>
              {evidence.collectedAt && (
                <p data-testid="text-evidence-collected-at">
                  <span className="text-muted-foreground">Collected:</span>{" "}
                  {formatDate(evidence.collectedAt)}
                </p>
              )}
              <p>
                <span className="text-muted-foreground">Added:</span>{" "}
                {formatDate(evidence.createdAt)}
              </p>
              {evidence.externalUrl && (
                <p>
                  <span className="text-muted-foreground">URL:</span>{" "}
                  <a
                    href={evidence.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                    data-testid="link-evidence-external-url"
                  >
                    Open link <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Linked findings ({evidence.findings.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {evidence.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No findings linked to this evidence.</p>
            ) : (
              <div className="space-y-2">
                {evidence.findings.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2"
                    data-testid={`row-linked-finding-${f.id}`}
                  >
                    <Link href={`/app/observatory/findings/${f.id}`} className="min-w-0 flex-1 hover:underline">
                      <p className="font-medium text-sm truncate">{f.title}</p>
                      <p className="text-xs text-muted-foreground">{labelFor(FINDING_DOMAINS as readonly LabeledOption[], f.domain)}</p>
                    </Link>
                    <div className="flex items-center gap-2 shrink-0">
                      <SeverityBadge severity={f.severity} />
                      <FindingStatusBadge status={f.status} />
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => unlinkFinding.mutate(f.id)}
                          disabled={unlinkFinding.isPending}
                          data-testid={`button-unlink-finding-${f.id}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4" /> Linked assessments ({evidence.assessments.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {evidence.assessments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No assessments linked to this evidence.</p>
            ) : (
              <div className="space-y-2">
                {evidence.assessments.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2"
                    data-testid={`row-linked-assessment-${a.id}`}
                  >
                    <Link href={`/app/observatory/assessments/${a.id}`} className="min-w-0 flex-1 hover:underline">
                      <p className="font-medium text-sm truncate">{a.title}</p>
                      <p className="text-xs text-muted-foreground">{labelFor(ASSESSMENT_TYPES as readonly LabeledOption[], a.type)}</p>
                    </Link>
                    <div className="flex items-center gap-2 shrink-0">
                      <AssessmentStatusBadge status={a.status} />
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => unlinkAssessment.mutate(a.id)}
                          disabled={unlinkAssessment.isPending}
                          data-testid={`button-unlink-assessment-${a.id}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {evidence.versions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                Linked versions ({evidence.versions.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {evidence.versions.map((v) => (
                  <Link key={v.id} href={`/app/observatory/versions`}>
                    <div
                      className="flex items-center gap-3 border border-border rounded-md px-3 py-2 cursor-pointer hover:border-primary/50"
                      data-testid={`row-linked-version-${v.id}`}
                    >
                      <p className="font-medium text-sm">v{v.versionNumber}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {evidence.controls.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BookMarked className="h-4 w-4" /> Linked controls ({evidence.controls.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {evidence.controls.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 border border-border rounded-md px-3 py-2"
                    data-testid={`row-linked-control-${c.id}`}
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{c.controlId} — {c.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.framework.name}{c.framework.version ? ` ${c.framework.version}` : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit evidence</DialogTitle>
            <DialogDescription>Update the metadata for this evidence record.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                data-testid="input-edit-evidence-title"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type *</Label>
                <Select value={editForm.evidenceType} onValueChange={(v) => setEditForm({ ...editForm, evidenceType: v })}>
                  <SelectTrigger data-testid="select-edit-evidence-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EVIDENCE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Collected on</Label>
                <Input
                  type="date"
                  value={editForm.collectedAt}
                  onChange={(e) => setEditForm({ ...editForm, collectedAt: e.target.value })}
                  data-testid="input-edit-evidence-collected"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Source tool</Label>
                <Input
                  placeholder="e.g. axe DevTools, Burp Suite"
                  value={editForm.source}
                  onChange={(e) => setEditForm({ ...editForm, source: e.target.value })}
                  data-testid="input-edit-evidence-source"
                />
              </div>
              <div className="space-y-2">
                <Label>External URL</Label>
                <Input
                  placeholder="https://…"
                  value={editForm.externalUrl}
                  onChange={(e) => setEditForm({ ...editForm, externalUrl: e.target.value })}
                  data-testid="input-edit-evidence-url"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                rows={3}
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                data-testid="input-edit-evidence-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} data-testid="button-cancel-edit-evidence">
              Cancel
            </Button>
            <Button
              onClick={() => editMutation.mutate()}
              disabled={!editForm.title.trim() || editMutation.isPending}
              data-testid="button-save-edit-evidence"
            >
              {editMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
