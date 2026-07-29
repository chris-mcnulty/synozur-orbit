import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  AppWindow,
  ShieldCheck,
  AlertTriangle,
  AlertOctagon,
  Accessibility,
  Crosshair,
  CircleX,
  CircleCheck,
  Loader2,
  Sparkles,
  FileText,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  Bell,
} from "lucide-react";
import { SeverityBadge, labelFor, FINDING_STATUSES, FINDING_DOMAINS, ASSESSMENT_STATUSES } from "./shared";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface DomainScore {
  domain: string;
  score: number | null;
  weight: number;
  applicable: boolean;
  assessed: boolean;
  openFindings: number;
  note?: string;
}

interface Blocker {
  type: string;
  reason: string;
  count: number;
  refs?: { id: string; title: string }[];
}

interface ReadinessEntry {
  applicationId: string;
  applicationName: string;
  versionId: string;
  versionNumber: string;
  score: number;
  band: string;
  blocked: boolean;
  domainScores: DomainScore[];
  blockers: Blocker[];
}

interface DashboardData {
  kpis: {
    applications: number;
    activeAssessments: number;
    openFindings: number;
    openCriticalFindings: number;
    accessibilityReviews: number;
    penTests: number;
    redApplications: number;
    greenApplications: number;
  };
  readinessByApplication: ReadinessEntry[];
  findingsBySeverity: { key: string; count: number }[];
  findingsByDomain: { key: string; count: number }[];
  assessmentStatus: { key: string; count: number }[];
  remediationStatus: { key: string; count: number }[];
  alerts: { type: string; severity: "critical" | "warning" | "info"; message: string; href?: string }[];
}

const DOMAIN_LABELS: Record<string, string> = {
  accessibility: "Accessibility",
  security: "Security",
  source_code: "Source Code",
  architecture: "Architecture",
  privacy: "Privacy",
  documentation: "Documentation",
  ai_governance: "AI Governance",
};

const SEVERITY_COLORS: Record<string, string> = {
  Critical: "#dc2626",
  High: "#ea580c",
  Medium: "#ca8a04",
  Low: "#3b82f6",
  Informational: "#6b7280",
};

const BAND_STYLES: Record<string, string> = {
  "Ready": "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
  "Ready With Minor Remediation": "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  "Remediation Required": "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  "Not Ready": "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
};

function bandColor(score: number | null): string {
  if (score === null) return "#9ca3af";
  if (score >= 90) return "#16a34a";
  if (score >= 75) return "#ca8a04";
  if (score >= 60) return "#ea580c";
  return "#dc2626";
}

function BandBadge({ band }: { band: string }) {
  return (
    <Badge variant="outline" className={BAND_STYLES[band] ?? ""} data-testid={`badge-band-${band.toLowerCase().replace(/\s+/g, "-")}`}>
      {band}
    </Badge>
  );
}

function ReadinessRow({ entry }: { entry: ReadinessEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-md" data-testid={`row-readiness-${entry.applicationId}`}>
      <button
        className="w-full flex items-center gap-3 p-3 text-left"
        onClick={() => setOpen(!open)}
        data-testid={`button-expand-readiness-${entry.applicationId}`}
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{entry.applicationName}</span>
            <span className="text-xs text-muted-foreground">v{entry.versionNumber}</span>
            <BandBadge band={entry.band} />
            {entry.blocked && (
              <Badge variant="outline" className="bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30">
                <AlertOctagon className="h-3 w-3 mr-1" /> Blocked
              </Badge>
            )}
          </div>
          <div className="mt-2 h-2 rounded bg-muted overflow-hidden">
            <div className="h-2 rounded" style={{ width: `${entry.score}%`, backgroundColor: bandColor(entry.score) }} />
          </div>
        </div>
        <span className="text-2xl font-semibold w-12 text-right" data-testid={`text-readiness-score-${entry.applicationId}`}>{entry.score}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t pt-3">
          {entry.blockers.length > 0 && (
            <div className="space-y-1">
              {entry.blockers.map((b, i) => (
                <div key={i} className="text-sm text-red-600 dark:text-red-400 flex items-start gap-2" data-testid={`text-blocker-${entry.applicationId}-${i}`}>
                  <AlertOctagon className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{b.reason}</span>
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-1.5">
            {entry.domainScores.map((d) => (
              <div key={d.domain} className="flex items-center gap-2 text-sm" data-testid={`row-domain-${entry.applicationId}-${d.domain}`}>
                <span className="w-28 shrink-0 text-muted-foreground">{DOMAIN_LABELS[d.domain] ?? d.domain}</span>
                <span className="w-12 text-xs text-muted-foreground">{d.weight}%</span>
                <div className="flex-1 h-1.5 rounded bg-muted overflow-hidden">
                  {d.applicable && d.score !== null && (
                    <div className="h-1.5 rounded" style={{ width: `${d.score}%`, backgroundColor: bandColor(d.score) }} />
                  )}
                </div>
                <span className="w-10 text-right font-medium">{d.applicable && d.score !== null ? d.score : "—"}</span>
                {d.note && <span className="text-xs text-muted-foreground truncate max-w-[180px]">{d.note}</span>}
              </div>
            ))}
          </div>
          <Link href={`/app/observatory/applications/${entry.applicationId}`}>
            <Button variant="outline" size="sm" data-testid={`link-application-${entry.applicationId}`}>Open application</Button>
          </Link>
        </div>
      )}
    </div>
  );
}

export default function ObservatoryDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<DashboardData>({ queryKey: ["/api/observatory/exec-dashboard"] });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/observatory/seed-demo");
      return res.json();
    },
    onSuccess: (d: { seeded: boolean }) => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/observatory") });
      toast({
        title: d.seeded ? "Sample data loaded" : "Sample data already present",
        description: d.seeded
          ? "Five applications with versions, assessments, findings, and evidence were created."
          : "This workspace already has applications, so nothing was changed.",
      });
    },
    onError: (err: Error) => toast({ title: "Could not load sample data", description: err.message, variant: "destructive" }),
  });

  const isEmpty = !isLoading && data && data.kpis.applications === 0;

  const kpiCards = data
    ? [
        { label: "Applications", value: data.kpis.applications, icon: AppWindow, href: "/app/observatory/applications" },
        { label: "Active Assessments", value: data.kpis.activeAssessments, icon: ShieldCheck, href: "/app/observatory/assessments" },
        { label: "Open Findings", value: data.kpis.openFindings, icon: AlertTriangle, href: "/app/observatory/findings" },
        { label: "Open Critical", value: data.kpis.openCriticalFindings, icon: AlertOctagon, href: "/app/observatory/findings" },
        { label: "Accessibility Reviews", value: data.kpis.accessibilityReviews, icon: Accessibility, href: "/app/observatory/review/accessibility" },
        { label: "Pen Tests", value: data.kpis.penTests, icon: Crosshair, href: "/app/observatory/pen-tests" },
        { label: "Red Applications", value: data.kpis.redApplications, icon: CircleX, href: "/app/observatory/applications" },
        { label: "Green Applications", value: data.kpis.greenApplications, icon: CircleCheck, href: "/app/observatory/applications" },
      ]
    : [];

  const severityData = (data?.findingsBySeverity ?? [])
    .slice()
    .sort((a, b) => ["Critical", "High", "Medium", "Low", "Informational"].indexOf(a.key) - ["Critical", "High", "Medium", "Low", "Informational"].indexOf(b.key));
  const domainData = (data?.findingsByDomain ?? []).map((d) => ({ ...d, label: labelFor(FINDING_DOMAINS, d.key) }));
  const assessmentData = (data?.assessmentStatus ?? []).map((d) => ({ ...d, label: labelFor(ASSESSMENT_STATUSES, d.key) }));
  const remediationData = (data?.remediationStatus ?? []).map((d) => ({ ...d, label: labelFor(FINDING_STATUSES, d.key) }));

  const alertStyles: Record<string, string> = {
    critical: "border-red-500/40 bg-red-500/5",
    warning: "border-yellow-500/40 bg-yellow-500/5",
    info: "border-blue-500/40 bg-blue-500/5",
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-observatory-title">Observatory</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Executive dashboard — portfolio readiness, risk, and certification blockers at a glance.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/app/observatory/reports">
              <Button variant="outline" data-testid="link-reports">
                <FileText className="h-4 w-4 mr-2" /> Reports
              </Button>
            </Link>
            <Link href="/app/observatory/vpat">
              <Button variant="outline" data-testid="link-vpat">
                <ClipboardList className="h-4 w-4 mr-2" /> VPAT Assistant
              </Button>
            </Link>
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
                <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} data-testid="button-load-sample-data">
                  {seedMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Load sample data
                </Button>
                <Link href="/app/observatory/applications">
                  <Button variant="outline" data-testid="link-add-application">Add an application</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
              {kpiCards.map((s) => (
                <Link key={s.label} href={s.href}>
                  <Card className="cursor-pointer hover:border-primary/50 transition-colors h-full" data-testid={`card-kpi-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    <CardContent className="pt-4 pb-4 px-4">
                      <s.icon className="h-4 w-4 text-muted-foreground/60 mb-2" />
                      <p className="text-2xl font-semibold leading-none" data-testid={`text-kpi-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>{s.value}</p>
                      <p className="text-xs text-muted-foreground mt-1.5">{s.label}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>

            {data.alerts.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Bell className="h-4 w-4" /> Alerts
                  </CardTitle>
                  <CardDescription>Certification blockers, critical risk, and coverage gaps.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {data.alerts.map((a, i) => (
                    <Link key={i} href={a.href ?? "/app/observatory"}>
                      <div className={`border rounded-md px-3 py-2 text-sm flex items-start gap-2 cursor-pointer ${alertStyles[a.severity]}`} data-testid={`alert-${i}`}>
                        {a.severity === "critical" ? (
                          <AlertOctagon className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />
                        ) : a.severity === "warning" ? (
                          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-yellow-500" />
                        ) : (
                          <Bell className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
                        )}
                        <span>{a.message}</span>
                      </div>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Readiness by application</CardTitle>
                <CardDescription>
                  Weighted score across Accessibility (25%), Security (25%), Source Code (15%), Architecture (10%), Privacy (10%), Documentation (10%), AI Governance (5%). Expand a row for the domain breakdown and blockers.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.readinessByApplication.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active applications with versions yet.</p>
                ) : (
                  data.readinessByApplication.map((entry) => <ReadinessRow key={entry.versionId} entry={entry} />)
                )}
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Open findings by severity</CardTitle>
                </CardHeader>
                <CardContent>
                  {severityData.length === 0 ? (
                    <p className="text-sm text-muted-foreground" data-testid="text-no-open-findings">No open findings.</p>
                  ) : (
                    <div className="flex items-center gap-4">
                      <ResponsiveContainer width="55%" height={200}>
                        <PieChart>
                          <Pie data={severityData} dataKey="count" nameKey="key" innerRadius={45} outerRadius={80} strokeWidth={1}>
                            {severityData.map((s) => (
                              <Cell key={s.key} fill={SEVERITY_COLORS[s.key] ?? "#6b7280"} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="space-y-2">
                        {severityData.map((s) => (
                          <div key={s.key} className="flex items-center gap-2" data-testid={`row-severity-${s.key.toLowerCase()}`}>
                            <SeverityBadge severity={s.key} />
                            <span className="font-medium text-sm">{s.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Open findings by domain</CardTitle>
                </CardHeader>
                <CardContent>
                  {domainData.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No open findings.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={domainData} margin={{ left: -20 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip cursor={{ fill: "rgba(120,120,120,0.08)" }} />
                        <Bar dataKey="count" fill="#7c6bd6" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Assessment status</CardTitle>
                </CardHeader>
                <CardContent>
                  {assessmentData.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No assessments yet.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={assessmentData} margin={{ left: -20 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip cursor={{ fill: "rgba(120,120,120,0.08)" }} />
                        <Bar dataKey="count" fill="#4f9cf9" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Remediation status</CardTitle>
                  <CardDescription className="text-xs">Lifecycle of every finding in the workspace.</CardDescription>
                </CardHeader>
                <CardContent>
                  {remediationData.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No findings recorded yet.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={remediationData} margin={{ left: -20 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip cursor={{ fill: "rgba(120,120,120,0.08)" }} />
                        <Bar dataKey="count" fill="#34b3a0" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        ) : null}
      </div>
    </AppLayout>
  );
}
