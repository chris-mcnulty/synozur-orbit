import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { ArrowLeft, Loader2, FileText, Download, Eye, Trash2, RefreshCw, Sparkles } from "lucide-react";
import { formatDateTime } from "@/lib/utils";

const REPORT_TYPES = [
  { value: "executive_readiness", label: "Executive Readiness Report" },
  { value: "technical_assessment", label: "Technical Assessment Report" },
  { value: "accessibility_vpat", label: "Accessibility Report (WCAG/508 + VPAT)" },
  { value: "pen_test", label: "Penetration Test Report" },
  { value: "certification_readiness", label: "Certification Readiness Report" },
] as const;

interface ReportRow {
  id: string;
  applicationId: string;
  versionId: string | null;
  reportType: string;
  title: string;
  status: "generating" | "generated" | "failed";
  includeAiSummary: boolean;
  error: string | null;
  generatedAt: string | null;
  createdAt: string;
  applicationName: string | null;
  versionNumber: string | null;
}

interface AppRow {
  id: string;
  name: string;
}

interface VersionRow {
  id: string;
  versionNumber: string;
  applicationId: string;
}

const STATUS_STYLES: Record<string, string> = {
  generating: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  generated: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
};

export default function ObservatoryReports() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reportType, setReportType] = useState<string>("executive_readiness");
  const [applicationId, setApplicationId] = useState<string>("");
  const [versionId, setVersionId] = useState<string>("latest");
  const [includeAiSummary, setIncludeAiSummary] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: apps } = useQuery<AppRow[]>({ queryKey: ["/api/observatory/applications"] });
  const { data: versions } = useQuery<VersionRow[]>({ queryKey: ["/api/observatory/versions"] });
  const { data: reports, isLoading } = useQuery<ReportRow[]>({
    queryKey: ["/api/observatory/reports"],
    refetchInterval: (query) =>
      (query.state.data ?? []).some((r) => r.status === "generating") ? 2500 : false,
  });

  const appVersions = (versions ?? []).filter((v) => v.applicationId === applicationId);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/observatory/reports", {
        reportType,
        applicationId,
        versionId: versionId === "latest" ? null : versionId,
        includeAiSummary,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/observatory/reports"] });
      toast({ title: "Report queued", description: "Generation runs in the background — the list updates automatically." });
    },
    onError: (err: Error) => toast({ title: "Could not queue report", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/observatory/reports/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/observatory/reports"] });
      toast({ title: "Report deleted" });
    },
    onError: (err: Error) => toast({ title: "Could not delete report", description: err.message, variant: "destructive" }),
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <Link href="/app/observatory">
            <Button variant="ghost" size="sm" className="mb-2 -ml-2" data-testid="link-back-observatory">
              <ArrowLeft className="h-4 w-4 mr-1" /> Observatory
            </Button>
          </Link>
          <h1 className="text-2xl font-semibold" data-testid="text-reports-title">Reports</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Generate printable readiness, assessment, accessibility, pen-test, and certification reports. Every referenced finding links back to its evidence.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Generate a report</CardTitle>
            <CardDescription>Reports are generated in the background; PDF export is available once generation completes.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-4 gap-4 items-end">
              <div className="space-y-1.5">
                <Label>Report type</Label>
                <Select value={reportType} onValueChange={setReportType}>
                  <SelectTrigger data-testid="select-report-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REPORT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Application</Label>
                <Select value={applicationId} onValueChange={(v) => { setApplicationId(v); setVersionId("latest"); }}>
                  <SelectTrigger data-testid="select-report-application"><SelectValue placeholder="Choose an application" /></SelectTrigger>
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
                  <SelectTrigger data-testid="select-report-version"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="latest">Latest version</SelectItem>
                    {appVersions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>v{v.versionNumber}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!applicationId || createMutation.isPending}
                data-testid="button-generate-report"
              >
                {createMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                Generate
              </Button>
            </div>
            <div className="flex items-center gap-2 mt-4">
              <Checkbox
                id="ai-summary"
                checked={includeAiSummary}
                onCheckedChange={(c) => setIncludeAiSummary(c === true)}
                data-testid="checkbox-ai-summary"
              />
              <Label htmlFor="ai-summary" className="text-sm font-normal flex items-center gap-1.5 cursor-pointer">
                <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                Include an AI-drafted executive summary (review before external distribution)
              </Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Generated reports</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (reports ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4" data-testid="text-no-reports">No reports generated yet.</p>
            ) : (
              <div className="space-y-2">
                {(reports ?? []).map((r) => (
                  <div key={r.id} className="border rounded-md p-3 flex items-center gap-3 flex-wrap" data-testid={`row-report-${r.id}`}>
                    <div className="flex-1 min-w-[240px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{r.title}</span>
                        <Badge variant="outline" className={STATUS_STYLES[r.status]} data-testid={`badge-report-status-${r.id}`}>
                          {r.status === "generating" && <RefreshCw className="h-3 w-3 mr-1 animate-spin" />}
                          {r.status}
                        </Badge>
                        {r.includeAiSummary && <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {r.versionNumber ? `v${r.versionNumber} · ` : ""}Requested {formatDateTime(r.createdAt)}
                        {r.status === "failed" && r.error ? ` · ${r.error}` : ""}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={r.status !== "generated"}
                        onClick={() => window.open(`/api/observatory/reports/${r.id}/html`, "_blank")}
                        data-testid={`button-view-report-${r.id}`}
                      >
                        <Eye className="h-4 w-4 mr-1" /> View
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={r.status !== "generated"}
                        onClick={() => window.open(`/api/observatory/reports/${r.id}/pdf`, "_blank")}
                        data-testid={`button-download-report-${r.id}`}
                      >
                        <Download className="h-4 w-4 mr-1" /> PDF
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteId(r.id)}
                        data-testid={`button-delete-report-${r.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this report?</AlertDialogTitle>
            <AlertDialogDescription>The generated report record and its content will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-report">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteId) deleteMutation.mutate(deleteId); setDeleteId(null); }}
              data-testid="button-confirm-delete-report"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
