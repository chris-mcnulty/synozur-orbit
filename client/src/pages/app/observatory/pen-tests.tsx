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
import { Link } from "wouter";
import { Crosshair, Plus, Loader2 } from "lucide-react";
import { PenTestResultBadge } from "./shared";
import { formatDate } from "@/lib/utils";

interface PenTestRow {
  id: string;
  testName: string;
  firm: string | null;
  leadTester: string | null;
  methodology: string | null;
  startDate: string | null;
  endDate: string | null;
  result: string | null;
  assessmentId: string;
  assessmentTitle: string;
  applicationName: string;
  findingCount: number;
}

interface AssessmentRow {
  id: string;
  title: string;
  applicationName: string;
}

export default function ObservatoryPenTests() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canWrite = ["Analyst", "Domain Admin", "Global Admin"].includes(user?.role ?? "");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ assessmentId: "", testName: "", firm: "", leadTester: "", methodology: "", startDate: "", endDate: "" });

  const { data: penTests, isLoading } = useQuery<PenTestRow[]>({ queryKey: ["/api/observatory/pen-tests"] });
  const { data: penTestAssessments } = useQuery<AssessmentRow[]>({
    queryKey: ["/api/observatory/assessments?type=penetration_test"],
  });

  const usedAssessmentIds = new Set((penTests ?? []).map((p) => p.assessmentId));
  const availableAssessments = (penTestAssessments ?? []).filter((a) => !usedAssessmentIds.has(a.id));

  const createMutation = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/observatory/pen-tests", {
          assessmentId: form.assessmentId,
          testName: form.testName,
          firm: form.firm || null,
          leadTester: form.leadTester || null,
          methodology: form.methodology || null,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
        })
      ).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/observatory") });
      setDialogOpen(false);
      setForm({ assessmentId: "", testName: "", firm: "", leadTester: "", methodology: "", startDate: "", endDate: "" });
      toast({ title: "Pen test created" });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-pen-tests-title">Penetration Tests</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Track engagements, CVSS-scored findings, and remediation validation. Findings land in the shared register.
            </p>
          </div>
          {canWrite && (
            <Button onClick={() => setDialogOpen(true)} data-testid="button-new-pen-test">
              <Plus className="h-4 w-4 mr-2" /> New Pen Test
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (penTests ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-12 flex flex-col items-center text-center gap-3">
              <Crosshair className="h-10 w-10 text-muted-foreground" />
              <p className="font-medium">No penetration tests yet</p>
              <p className="text-sm text-muted-foreground max-w-md">
                Create a penetration-test assessment first, then attach the engagement record here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {(penTests ?? []).map((p) => (
              <Link key={p.id} href={`/app/observatory/pen-tests/${p.id}`}>
                <Card className="cursor-pointer hover:border-primary/50 transition-colors" data-testid={`card-pen-test-${p.id}`}>
                  <CardContent className="py-3 px-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate" data-testid={`text-pen-test-name-${p.id}`}>{p.testName}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.applicationName}
                        {p.firm ? ` · ${p.firm}` : ""}
                        {p.methodology ? ` · ${p.methodology}` : ""}
                        {p.startDate ? ` · ${formatDate(p.startDate)}${p.endDate ? ` – ${formatDate(p.endDate)}` : ""}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant="secondary" className="text-xs">{p.findingCount} finding{p.findingCount === 1 ? "" : "s"}</Badge>
                      <PenTestResultBadge result={p.result} />
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
            <DialogTitle>New Penetration Test</DialogTitle>
            <DialogDescription>Attach an engagement record to a penetration-test assessment (one per assessment).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Assessment *</Label>
              <Select value={form.assessmentId} onValueChange={(v) => setForm({ ...form, assessmentId: v })}>
                <SelectTrigger data-testid="select-pen-test-assessment"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {availableAssessments.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.title} — {a.applicationName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availableAssessments.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No unattached penetration-test assessments. Create one on the Assessments page first.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Test name *</Label>
              <Input value={form.testName} onChange={(e) => setForm({ ...form, testName: e.target.value })} data-testid="input-pen-test-name" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Firm</Label>
                <Input value={form.firm} onChange={(e) => setForm({ ...form, firm: e.target.value })} data-testid="input-pen-test-firm" />
              </div>
              <div className="space-y-2">
                <Label>Lead tester</Label>
                <Input value={form.leadTester} onChange={(e) => setForm({ ...form, leadTester: e.target.value })} data-testid="input-pen-test-lead" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Methodology</Label>
              <Input value={form.methodology} onChange={(e) => setForm({ ...form, methodology: e.target.value })} placeholder="OWASP WSTG, PTES…" data-testid="input-pen-test-methodology" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start date</Label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} data-testid="input-pen-test-start" />
              </div>
              <div className="space-y-2">
                <Label>End date</Label>
                <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} data-testid="input-pen-test-end" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-pen-test">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!form.assessmentId || !form.testName.trim() || createMutation.isPending}
              data-testid="button-save-pen-test"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
