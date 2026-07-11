import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { AppWindow, GitBranch, ShieldCheck, Archive, AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { SeverityBadge, FindingStatusBadge, labelFor, FINDING_STATUSES } from "./shared";
import { formatDateTime } from "@/lib/utils";

interface Stats {
  applications: number;
  versions: number;
  assessments: number;
  evidence: number;
  openFindingsBySeverity: { severity: string; count: number }[];
  findingsByStatus: { status: string; count: number }[];
  recentActivity: { id: string; entityType: string; action: string; summary: string | null; createdAt: string }[];
}

export default function ObservatoryDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: stats, isLoading } = useQuery<Stats>({ queryKey: ["/api/observatory/stats"] });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/observatory/seed-demo");
      return res.json();
    },
    onSuccess: (data: { seeded: boolean }) => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/observatory") });
      toast({
        title: data.seeded ? "Sample data loaded" : "Sample data already present",
        description: data.seeded
          ? "Five applications with versions, assessments, findings, and evidence were created."
          : "This workspace already has applications, so nothing was changed.",
      });
    },
    onError: (err: Error) => toast({ title: "Could not load sample data", description: err.message, variant: "destructive" }),
  });

  const severityOrder = ["Critical", "High", "Medium", "Low", "Informational"];
  const openBySeverity = severityOrder
    .map((s) => ({ severity: s, count: stats?.openFindingsBySeverity.find((f) => f.severity === s)?.count ?? 0 }))
    .filter((f) => f.count > 0);
  const totalOpen = (stats?.openFindingsBySeverity ?? []).reduce((a, f) => a + f.count, 0);
  const isEmpty = !isLoading && stats && stats.applications === 0;

  const statCards = [
    { label: "Applications", value: stats?.applications ?? 0, icon: AppWindow, href: "/app/observatory/applications" },
    { label: "Versions", value: stats?.versions ?? 0, icon: GitBranch, href: "/app/observatory/versions" },
    { label: "Assessments", value: stats?.assessments ?? 0, icon: ShieldCheck, href: "/app/observatory/assessments" },
    { label: "Open Findings", value: totalOpen, icon: AlertTriangle, href: "/app/observatory/findings" },
    { label: "Evidence Items", value: stats?.evidence ?? 0, icon: Archive, href: "/app/observatory/evidence" },
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-observatory-title">Observatory</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Application assurance and certification intelligence — your portfolio's readiness at a glance.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : isEmpty ? (
          <Card>
            <CardContent className="py-12 flex flex-col items-center text-center gap-4">
              <Sparkles className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="font-medium">No applications yet</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  Add your first application, or load sample data to explore the full traceability chain:
                  applications, versions, assessments, findings, and evidence.
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={() => seedMutation.mutate()}
                  disabled={seedMutation.isPending}
                  data-testid="button-load-sample-data"
                >
                  {seedMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Load sample data
                </Button>
                <Link href="/app/observatory/applications">
                  <Button variant="outline" data-testid="link-add-application">Add an application</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {statCards.map((s) => (
                <Link key={s.label} href={s.href}>
                  <Card className="cursor-pointer hover:border-primary/50 transition-colors" data-testid={`card-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-3xl font-semibold" data-testid={`text-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>{s.value}</p>
                          <p className="text-sm text-muted-foreground mt-1">{s.label}</p>
                        </div>
                        <s.icon className="h-8 w-8 text-muted-foreground/50" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Open findings by severity</CardTitle>
                  <CardDescription>Open and in-progress findings across all assessments.</CardDescription>
                </CardHeader>
                <CardContent>
                  {openBySeverity.length === 0 ? (
                    <p className="text-sm text-muted-foreground" data-testid="text-no-open-findings">No open findings. 🎉</p>
                  ) : (
                    <div className="space-y-2">
                      {openBySeverity.map((f) => (
                        <div key={f.severity} className="flex items-center justify-between" data-testid={`row-severity-${f.severity.toLowerCase()}`}>
                          <SeverityBadge severity={f.severity} />
                          <span className="font-medium">{f.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Findings by status</CardTitle>
                  <CardDescription>Lifecycle of every finding in the workspace.</CardDescription>
                </CardHeader>
                <CardContent>
                  {(stats?.findingsByStatus ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No findings recorded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {(stats?.findingsByStatus ?? []).map((f) => (
                        <div key={f.status} className="flex items-center justify-between" data-testid={`row-status-${f.status}`}>
                          <FindingStatusBadge status={f.status} />
                          <span className="font-medium">{f.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent activity</CardTitle>
                <CardDescription>Latest changes across the Observatory workspace.</CardDescription>
              </CardHeader>
              <CardContent>
                {(stats?.recentActivity ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No activity yet.</p>
                ) : (
                  <div className="space-y-3">
                    {(stats?.recentActivity ?? []).map((a) => (
                      <div key={a.id} className="flex items-start justify-between gap-4 text-sm" data-testid={`row-activity-${a.id}`}>
                        <p>{a.summary ?? `${a.action} ${a.entityType}`}</p>
                        <span className="text-muted-foreground whitespace-nowrap">{formatDateTime(a.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
