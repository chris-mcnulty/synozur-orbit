import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/lib/userContext";
import { Link, useParams } from "wouter";
import { ClipboardList, Plus, Loader2, Sparkles } from "lucide-react";
import { AssessmentStatusBadge, workbenchBySlug } from "./shared";
import { formatDate } from "@/lib/utils";

interface AssessmentRow {
  id: string;
  title: string;
  type: string;
  status: string;
  applicationId: string;
  applicationName: string;
  versionNumber: string | null;
  assessorName: string | null;
  startDate: string | null;
  findingCount: number;
}

interface AppRow {
  id: string;
  name: string;
  aiEnabled?: boolean;
}

export default function ObservatoryReviewHub() {
  const { module: slug } = useParams<{ module: string }>();
  const wb = workbenchBySlug(slug);
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canWrite = ["Analyst", "Domain Admin", "Global Admin"].includes(user?.role ?? "");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ title: "", applicationId: "", versionId: "", assessorName: "" });

  const { data: assessments, isLoading } = useQuery<AssessmentRow[]>({
    queryKey: [`/api/observatory/assessments?type=${wb?.assessmentType ?? ""}`],
    enabled: !!wb,
  });
  const { data: apps } = useQuery<AppRow[]>({ queryKey: ["/api/observatory/applications"] });
  const { data: versions } = useQuery<{ id: string; versionNumber: string; applicationId: string }[]>({
    queryKey: ["/api/observatory/versions"],
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/observatory/assessments", {
          title: form.title,
          type: wb!.assessmentType,
          applicationId: form.applicationId,
          versionId: form.versionId || null,
          assessorName: form.assessorName || null,
          status: "planned",
        })
      ).json(),
    onSuccess: (created: { id: string }) => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/observatory") });
      setDialogOpen(false);
      setForm({ title: "", applicationId: "", versionId: "", assessorName: "" });
      toast({ title: "Assessment created" });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  if (!wb) {
    return (
      <AppLayout>
        <div className="py-16 text-center text-muted-foreground" data-testid="text-unknown-module">Unknown review module.</div>
      </AppLayout>
    );
  }

  const eligibleApps = wb.aiOnly ? (apps ?? []).filter((a) => a.aiEnabled) : (apps ?? []);
  const appVersions = (versions ?? []).filter((v) => v.applicationId === form.applicationId);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-review-hub-title">
              {wb.aiOnly && <Sparkles className="h-5 w-5 text-primary" />}
              {wb.label}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">{wb.description}</p>
          </div>
          {canWrite && (
            <Button onClick={() => setDialogOpen(true)} data-testid="button-new-review-assessment">
              <Plus className="h-4 w-4 mr-2" /> New {wb.label}
            </Button>
          )}
        </div>

        {wb.aiOnly && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="py-3 px-4 text-sm text-muted-foreground" data-testid="text-ai-only-notice">
              AI Governance reviews are only available for applications flagged as AI-enabled in the application registry.
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (assessments ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-12 flex flex-col items-center text-center gap-3">
              <ClipboardList className="h-10 w-10 text-muted-foreground" />
              <p className="font-medium">No {wb.label.toLowerCase()} assessments yet</p>
              <p className="text-sm text-muted-foreground">Create one to open the review workbench and start working through the checklist.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {(assessments ?? []).map((a) => (
              <Link key={a.id} href={`/app/observatory/review/${wb.slug}/${a.id}`}>
                <Card className="cursor-pointer hover:border-primary/50 transition-colors" data-testid={`card-review-assessment-${a.id}`}>
                  <CardContent className="py-3 px-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate" data-testid={`text-review-assessment-title-${a.id}`}>{a.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.applicationName}
                        {a.versionNumber ? ` · v${a.versionNumber}` : ""}
                        {a.assessorName ? ` · ${a.assessorName}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant="secondary" className="text-xs">{a.findingCount} finding{a.findingCount === 1 ? "" : "s"}</Badge>
                      {a.startDate && <span className="text-xs text-muted-foreground">{formatDate(a.startDate)}</span>}
                      <AssessmentStatusBadge status={a.status} />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New {wb.label}</DialogTitle>
            <DialogDescription>
              {wb.aiOnly
                ? "Only AI-enabled applications can receive an AI governance review."
                : "Scope the review against an application (and optionally a specific version)."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-review-title" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Application *</Label>
                <Select value={form.applicationId} onValueChange={(v) => setForm({ ...form, applicationId: v, versionId: "" })}>
                  <SelectTrigger data-testid="select-review-application"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {eligibleApps.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {wb.aiOnly && eligibleApps.length === 0 && (
                  <p className="text-xs text-muted-foreground">No AI-enabled applications in the registry.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Version</Label>
                <Select value={form.versionId} onValueChange={(v) => setForm({ ...form, versionId: v })} disabled={!form.applicationId}>
                  <SelectTrigger data-testid="select-review-version"><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    {appVersions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>v{v.versionNumber}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Assessor</Label>
              <Input value={form.assessorName} onChange={(e) => setForm({ ...form, assessorName: e.target.value })} data-testid="input-review-assessor" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-review">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!form.title.trim() || !form.applicationId || createMutation.isPending}
              data-testid="button-save-review"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
