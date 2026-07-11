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
import { Link, useSearch } from "wouter";
import { ShieldCheck, Plus, Loader2 } from "lucide-react";
import { AssessmentStatusBadge, ASSESSMENT_TYPES, ASSESSMENT_STATUSES, labelFor } from "./shared";
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
  endDate: string | null;
  findingCount: number;
}

export default function ObservatoryAssessments() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const applicationIdFilter = params.get("applicationId") ?? "";
  const canWrite = ["Analyst", "Domain Admin", "Global Admin"].includes(user?.role ?? "");

  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ title: "", type: "accessibility", applicationId: "", versionId: "", assessorName: "", team: "", scope: "", startDate: "" });

  const queryString = new URLSearchParams();
  if (applicationIdFilter) queryString.set("applicationId", applicationIdFilter);
  if (typeFilter !== "all") queryString.set("type", typeFilter);
  if (statusFilter !== "all") queryString.set("status", statusFilter);
  const qs = queryString.toString();

  const { data: assessments, isLoading } = useQuery<AssessmentRow[]>({
    queryKey: [`/api/observatory/assessments${qs ? `?${qs}` : ""}`],
  });
  const { data: apps } = useQuery<{ id: string; name: string }[]>({ queryKey: ["/api/observatory/applications"] });
  const { data: versions } = useQuery<{ id: string; versionNumber: string; applicationId: string }[]>({
    queryKey: ["/api/observatory/versions"],
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/observatory/assessments", {
          title: form.title,
          type: form.type,
          applicationId: form.applicationId,
          versionId: form.versionId || null,
          assessorName: form.assessorName || null,
          team: form.team || null,
          scope: form.scope || null,
          startDate: form.startDate || null,
          status: "planned",
        })
      ).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/observatory") });
      setDialogOpen(false);
      setForm({ title: "", type: "accessibility", applicationId: "", versionId: "", assessorName: "", team: "", scope: "", startDate: "" });
      toast({ title: "Assessment created" });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const appVersions = (versions ?? []).filter((v) => v.applicationId === form.applicationId);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-assessments-title">Assessments</h1>
            <p className="text-muted-foreground text-sm mt-1">Accessibility, security, privacy, AI, and compliance assessments across the portfolio.</p>
          </div>
          {canWrite && (
            <Button onClick={() => setDialogOpen(true)} data-testid="button-new-assessment">
              <Plus className="h-4 w-4 mr-2" /> New Assessment
            </Button>
          )}
        </div>

        <div className="flex gap-3 flex-wrap">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[200px]" data-testid="select-filter-type"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {ASSESSMENT_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-filter-status"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {ASSESSMENT_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (assessments ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-12 flex flex-col items-center text-center gap-3">
              <ShieldCheck className="h-10 w-10 text-muted-foreground" />
              <p className="font-medium">No assessments found</p>
              <p className="text-sm text-muted-foreground">Create an assessment against an application version to begin recording findings.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {(assessments ?? []).map((a) => (
              <Link key={a.id} href={`/app/observatory/assessments/${a.id}`}>
                <Card className="cursor-pointer hover:border-primary/50 transition-colors" data-testid={`card-assessment-${a.id}`}>
                  <CardContent className="py-3 px-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate" data-testid={`text-assessment-title-${a.id}`}>{a.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.applicationName}
                        {a.versionNumber ? ` · v${a.versionNumber}` : ""} · {labelFor(ASSESSMENT_TYPES as any, a.type)}
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
            <DialogTitle>New Assessment</DialogTitle>
            <DialogDescription>Scope an assessment against an application (and optionally a specific version).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-assessment-title" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type *</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger data-testid="select-assessment-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASSESSMENT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Start date</Label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} data-testid="input-assessment-start" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Application *</Label>
                <Select value={form.applicationId} onValueChange={(v) => setForm({ ...form, applicationId: v, versionId: "" })}>
                  <SelectTrigger data-testid="select-assessment-application"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {(apps ?? []).map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Version</Label>
                <Select value={form.versionId} onValueChange={(v) => setForm({ ...form, versionId: v })} disabled={!form.applicationId}>
                  <SelectTrigger data-testid="select-assessment-version"><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    {appVersions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>v{v.versionNumber}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Assessor</Label>
                <Input value={form.assessorName} onChange={(e) => setForm({ ...form, assessorName: e.target.value })} data-testid="input-assessment-assessor" />
              </div>
              <div className="space-y-2">
                <Label>Team</Label>
                <Input value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} data-testid="input-assessment-team" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Scope</Label>
              <Textarea rows={2} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} data-testid="input-assessment-scope" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-assessment">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!form.title.trim() || !form.applicationId || createMutation.isPending}
              data-testid="button-save-assessment"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create assessment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
