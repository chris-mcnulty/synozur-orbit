import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  ClipboardList,
  FileText,
  Handshake,
  Swords,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StageBar } from "@/components/hub/hub-charts";

const STALE_AFTER_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

/**
 * Sales hub — the area landing page. One card per deliverable type
 * (battle cards, reports, relationship plans, assessments) with live
 * counts and freshness, so a seller can see in one glance what's ready
 * and what's gone stale.
 */
export default function SalesHubPage() {
  const { data: battleCards = [] } = useQuery<any[]>({
    queryKey: ["/api/battlecards"],
    queryFn: async () => {
      const r = await fetch("/api/battlecards", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: reports = [] } = useQuery<any[]>({
    queryKey: ["/api/reports"],
    queryFn: async () => {
      const r = await fetch("/api/reports", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: relationshipReports = [] } = useQuery<any[]>({
    queryKey: ["/api/relationship-reports"],
    queryFn: async () => {
      const r = await fetch("/api/relationship-reports", { credentials: "include" });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : data.reports ?? [];
    },
  });

  const { data: assessments = [] } = useQuery<any[]>({
    queryKey: ["/api/assessments"],
    queryFn: async () => {
      const r = await fetch("/api/assessments", { credentials: "include" });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : data.assessments ?? [];
    },
  });

  const deliverableSegments = [
    { label: "Battle Cards", value: battleCards.length, className: "bg-primary" },
    { label: "Reports", value: reports.length, className: "bg-sky-500" },
    { label: "Relationship Plans", value: relationshipReports.length, className: "bg-amber-500" },
    { label: "Assessments", value: assessments.length, className: "bg-violet-500" },
  ];
  const totalDeliverables = deliverableSegments.reduce((sum, s) => sum + s.value, 0);

  const staleBattleCards = battleCards.filter((bc: any) => {
    const ts = bc.generatedFromDataAsOf || bc.lastGeneratedAt || bc.createdAt;
    return ts && Date.now() - new Date(ts).getTime() > STALE_AFTER_MS;
  }).length;

  const newest = (rows: any[]): string | null => {
    let best: string | null = null;
    for (const row of rows) {
      const ts = row.updatedAt || row.createdAt || row.lastGeneratedAt;
      if (ts && (!best || new Date(ts) > new Date(best))) best = ts;
    }
    return best;
  };

  const sections = [
    {
      id: "battlecards",
      title: "Battle Cards",
      description: "Competitive one-pagers for sellers — generated per product in the Product area.",
      icon: Swords,
      count: battleCards.length,
      latest: newest(battleCards),
      warning:
        staleBattleCards > 0
          ? `${staleBattleCards} built on data over 60 days old — regenerate before the next call`
          : null,
      href: "/app/battlecards",
      cta: battleCards.length > 0 ? "Open battle cards" : "Create your first battle card",
    },
    {
      id: "reports",
      title: "Reports",
      description: "Branded PDF competitive reports for prospects and internal stakeholders.",
      icon: FileText,
      count: reports.length,
      latest: newest(reports),
      warning: null,
      href: "/app/reports",
      cta: reports.length > 0 ? "Open reports" : "Generate a report",
    },
    {
      id: "relationship-plans",
      title: "Relationship Plans",
      description: "12-month engagement plans for competitors and market peers.",
      icon: Handshake,
      count: relationshipReports.length,
      latest: newest(relationshipReports),
      warning: null,
      href: "/app/relationship-reports",
      cta: relationshipReports.length > 0 ? "Open plans" : "Create a plan",
    },
    {
      id: "assessments",
      title: "Assessments",
      description: "Custom assessment deliverables for client engagements.",
      icon: ClipboardList,
      count: assessments.length,
      latest: newest(assessments),
      warning: null,
      href: "/app/assessments",
      cta: assessments.length > 0 ? "Open assessments" : "Create an assessment",
    },
  ];

  return (
    <AppLayout>
      <div className="space-y-6" data-testid="page-sales-hub">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2.5">
            <Handshake className="w-7 h-7 text-primary" />
            Sales
          </h1>
          <p className="text-muted-foreground mt-1">
            Deliverables and enablement, ready for the next conversation.
          </p>
        </div>

        {totalDeliverables > 0 && (
          <Card data-testid="sales-deliverables-mix">
            <CardContent className="py-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Deliverables on hand
              </p>
              <StageBar segments={deliverableSegments} />
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {sections.map((section) => (
            <Card key={section.id} className="flex flex-col" data-testid={`sales-card-${section.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <section.icon className="w-5 h-5 text-primary" />
                  </div>
                  <Badge variant="secondary" className="text-sm font-semibold px-2.5">
                    {section.count}
                  </Badge>
                </div>
                <CardTitle className="text-base mt-3">{section.title}</CardTitle>
                <CardDescription className="text-xs leading-relaxed">{section.description}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto pt-0 space-y-3">
                {section.warning && (
                  <p className="text-xs text-amber-600 dark:text-amber-400" data-testid={`sales-warning-${section.id}`}>
                    ⚠ {section.warning}
                  </p>
                )}
                {section.latest && (
                  <p className="text-[11px] text-muted-foreground">
                    Last updated {formatDistanceToNow(new Date(section.latest), { addSuffix: true })}
                  </p>
                )}
                <Button variant={section.count > 0 ? "default" : "outline"} size="sm" className="w-full" asChild>
                  <Link href={section.href} data-testid={`sales-cta-${section.id}`}>
                    {section.cta}
                    <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Battle cards and one-sheets are generated per product — open a product in the{" "}
          <Link href="/app/products" className="text-primary hover:underline">
            Product area
          </Link>{" "}
          to refresh its collateral.
        </p>
      </div>
    </AppLayout>
  );
}
