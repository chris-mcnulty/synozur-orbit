import { useState } from "react";
import { useParams, Link } from "wouter";
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
import { useLocation } from "wouter";
import { ArrowLeft, Plus, Loader2, Trash2, GitBranch, ShieldCheck, AlertTriangle, Pencil } from "lucide-react";
import { VersionStatusBadge, AssessmentStatusBadge, SeverityBadge, FindingStatusBadge, VERSION_STATUSES, ASSESSMENT_TYPES, labelFor } from "./shared";
import { formatDate } from "@/lib/utils";

interface Detail {
  id: string;
  name: string;
  productFamily: string | null;
  description: string | null;
  businessOwner: string | null;
  technicalOwner: string | null;
  hostingPlatform: string | null;
  authMethod: string | null;
  dataClassification: string | null;
  aiEnabled: boolean;
  certificationTarget: string | null;
  appUrl: string | null;
  repoUrl: string | null;
  versions: { id: string; versionNumber: string; environment: string | null; assessmentStatus: string; releaseDate: string | null; notes: string | null }[];
  assessments: { id: string; title: string; type: string; status: string; versionId: string | null; startDate: string | null }[];
  findings: { id: string; title: string; severity: string; status: string; domain: string }[];
}

export default function ObservatoryApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canWrite = ["Analyst", "Domain Admin", "Global Admin"].includes(user?.role ?? "");

  const { data: app, isLoading } = useQuery<Detail>({ queryKey: [`/api/observatory/applications/${id}`] });

  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  const [versionForm, setVersionForm] = useState({ versionNumber: "", environment: "production", assessmentStatus: "Draft", branch: "", notes: "", releaseDate: "" });

  const invalidate = () =>
    queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/observatory") });

  const createVersion = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/observatory/versions", {
          applicationId: id,
          versionNumber: versionForm.versionNumber,
          environment: versionForm.environment || null,
          assessmentStatus: versionForm.assessmentStatus,
          branch: versionForm.branch || null,
          notes: versionForm.notes || null,
          releaseDate: versionForm.releaseDate || null,
        })
      ).json(),
    onSuccess: () => {
      invalidate();
      setVersionDialogOpen(false);
      setVersionForm({ versionNumber: "", environment: "production", assessmentStatus: "Draft", branch: "", notes: "", releaseDate: "" });
      toast({ title: "Version created" });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const deleteApp = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/observatory/applications/${id}`)).json(),
    onSuccess: () => {
      invalidate();
      toast({ title: "Application deleted" });
      navigate("/app/observatory/applications");
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading || !app) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </AppLayout>
    );
  }

  const facts: [string, string | null][] = [
    ["Product family", app.productFamily],
    ["Business owner", app.businessOwner],
    ["Technical owner", app.technicalOwner],
    ["Hosting", app.hostingPlatform],
    ["Authentication", app.authMethod],
    ["Data classification", app.dataClassification],
    ["Certification target", app.certificationTarget],
    ["Application URL", app.appUrl],
    ["Repository", app.repoUrl],
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Link href="/app/observatory/applications">
              <Button variant="ghost" size="sm" className="mb-2 -ml-2" data-testid="button-back-applications">
                <ArrowLeft className="h-4 w-4 mr-1" /> Applications
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold" data-testid="text-application-name">{app.name}</h1>
              {app.aiEnabled && <Badge variant="outline" className="bg-purple-500/15 text-purple-400 border-purple-500/30">AI</Badge>}
            </div>
            {app.description && <p className="text-muted-foreground text-sm mt-1 max-w-2xl">{app.description}</p>}
          </div>
          {canWrite && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-delete-application">
                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this application?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes "{app.name}" along with all of its versions, assessments, and findings. Evidence items remain in the vault.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteApp.mutate()} data-testid="button-confirm-delete">Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
              {facts.filter(([, v]) => v).map(([k, v]) => (
                <div key={k}>
                  <p className="text-muted-foreground text-xs">{k}</p>
                  <p data-testid={`text-fact-${k.toLowerCase().replace(/\s+/g, "-")}`}>{v}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2"><GitBranch className="h-4 w-4" /> Versions</CardTitle>
            {canWrite && (
              <Button size="sm" onClick={() => setVersionDialogOpen(true)} data-testid="button-new-version">
                <Plus className="h-4 w-4 mr-1" /> New Version
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {app.versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No versions tracked yet.</p>
            ) : (
              <div className="space-y-2">
                {app.versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2" data-testid={`row-version-${v.id}`}>
                    <div className="min-w-0">
                      <p className="font-medium text-sm">v{v.versionNumber}{v.environment ? ` · ${v.environment}` : ""}</p>
                      {v.notes && <p className="text-xs text-muted-foreground truncate">{v.notes}</p>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {v.releaseDate && <span className="text-xs text-muted-foreground">{formatDate(v.releaseDate)}</span>}
                      <VersionStatusBadge status={v.assessmentStatus} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Assessments</CardTitle>
            <Link href={`/app/observatory/assessments?applicationId=${app.id}`}>
              <Button size="sm" variant="outline" data-testid="link-all-assessments">View all</Button>
            </Link>
          </CardHeader>
          <CardContent>
            {app.assessments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No assessments yet.</p>
            ) : (
              <div className="space-y-2">
                {app.assessments.map((a) => (
                  <Link key={a.id} href={`/app/observatory/assessments/${a.id}`}>
                    <div className="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2 cursor-pointer hover:border-primary/50" data-testid={`row-assessment-${a.id}`}>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{a.title}</p>
                        <p className="text-xs text-muted-foreground">{labelFor(ASSESSMENT_TYPES as any, a.type)}</p>
                      </div>
                      <AssessmentStatusBadge status={a.status} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Findings</CardTitle>
            <Link href={`/app/observatory/findings?applicationId=${app.id}`}>
              <Button size="sm" variant="outline" data-testid="link-all-findings">View all</Button>
            </Link>
          </CardHeader>
          <CardContent>
            {app.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No findings recorded.</p>
            ) : (
              <div className="space-y-2">
                {app.findings.slice(0, 8).map((f) => (
                  <Link key={f.id} href={`/app/observatory/findings/${f.id}`}>
                    <div className="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2 cursor-pointer hover:border-primary/50" data-testid={`row-finding-${f.id}`}>
                      <p className="font-medium text-sm truncate">{f.title}</p>
                      <div className="flex items-center gap-2 shrink-0">
                        <SeverityBadge severity={f.severity} />
                        <FindingStatusBadge status={f.status} />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={versionDialogOpen} onOpenChange={setVersionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Version</DialogTitle>
            <DialogDescription>Track a release of {app.name} through assessment.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Version number *</Label>
              <Input placeholder="e.g. 2.5.0" value={versionForm.versionNumber} onChange={(e) => setVersionForm({ ...versionForm, versionNumber: e.target.value })} data-testid="input-version-number" />
            </div>
            <div className="space-y-2">
              <Label>Environment</Label>
              <Select value={versionForm.environment} onValueChange={(v) => setVersionForm({ ...versionForm, environment: v })}>
                <SelectTrigger data-testid="select-version-environment"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["development", "staging", "production"].map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Assessment status</Label>
              <Select value={versionForm.assessmentStatus} onValueChange={(v) => setVersionForm({ ...versionForm, assessmentStatus: v })}>
                <SelectTrigger data-testid="select-version-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VERSION_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Release date</Label>
              <Input type="date" value={versionForm.releaseDate} onChange={(e) => setVersionForm({ ...versionForm, releaseDate: e.target.value })} data-testid="input-version-release-date" />
            </div>
            <div className="space-y-2">
              <Label>Branch</Label>
              <Input placeholder="e.g. release/2.5" value={versionForm.branch} onChange={(e) => setVersionForm({ ...versionForm, branch: e.target.value })} data-testid="input-version-branch" />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Notes</Label>
              <Textarea rows={2} value={versionForm.notes} onChange={(e) => setVersionForm({ ...versionForm, notes: e.target.value })} data-testid="input-version-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVersionDialogOpen(false)} data-testid="button-cancel-version">Cancel</Button>
            <Button onClick={() => createVersion.mutate()} disabled={!versionForm.versionNumber.trim() || createVersion.isPending} data-testid="button-save-version">
              {createVersion.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
