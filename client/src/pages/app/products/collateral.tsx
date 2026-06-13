import { Link } from "wouter";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package, FolderOpen } from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Portfolio collateral — a tenant-wide view of the generated artifacts for
 * every product, grouped Strategy vs Go-to-market. This gives the Product
 * area a second, genuinely useful surface (the plan's "Planning / Collateral"
 * sections) so artifacts are reachable without drilling into each product's
 * tabs. Backed by the same /api/projects/artifact-summary the portfolio
 * freshness strip uses.
 */

const ARTIFACT_STALE_AFTER_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

const GROUPS = [
  {
    label: "Strategy",
    artifacts: [
      { type: "gap_analysis", label: "Gap Analysis", tab: "gaps" },
      { type: "strategic_recommendations", label: "Strategic Recs", tab: "recommendations" },
      { type: "competitive_summary", label: "Competitive Summary", tab: "summary" },
    ],
  },
  {
    label: "Go-to-market",
    artifacts: [
      { type: "gtm_plan", label: "GTM Plan", tab: "gtm_plan" },
      { type: "messaging_framework", label: "Messaging", tab: "messaging" },
      { type: "product_one_sheet", label: "One-sheet", tab: "one_sheet" },
    ],
  },
] as const;

interface ArtifactSummaryRow {
  projectId: string | null;
  type: string;
  status: string;
  lastGeneratedAt: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
  analysisType?: "company" | "product";
}

export default function ProductCollateralPage() {
  const { data: projects = [] } = useQuery<ProjectRow[]>({
    queryKey: ["/api/projects"],
    queryFn: async () => {
      const r = await fetch("/api/projects", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: artifactRows = [] } = useQuery<ArtifactSummaryRow[]>({
    queryKey: ["/api/projects/artifact-summary"],
    queryFn: async () => {
      const r = await fetch("/api/projects/artifact-summary", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const artifactsByProject = useMemo(() => {
    const map = new Map<string, Map<string, ArtifactSummaryRow>>();
    for (const row of artifactRows) {
      if (!row.projectId) continue;
      let inner = map.get(row.projectId);
      if (!inner) {
        inner = new Map();
        map.set(row.projectId, inner);
      }
      inner.set(row.type, row);
    }
    return map;
  }, [artifactRows]);

  const chipFor = (projectId: string, type: string, tab: string, label: string) => {
    const row = artifactsByProject.get(projectId)?.get(type);
    const generated = row?.status === "generated";
    const generating = row?.status === "generating";
    const stale =
      generated && row?.lastGeneratedAt && Date.now() - new Date(row.lastGeneratedAt).getTime() > ARTIFACT_STALE_AFTER_MS;
    const title = generating
      ? `${label}: generating…`
      : generated
        ? `${label}: generated ${row?.lastGeneratedAt ? new Date(row.lastGeneratedAt).toLocaleDateString() : ""}${stale ? " — over 60 days old" : ""}`
        : `${label}: not generated yet — click to create`;
    return (
      <Link key={type} href={`/app/products/${projectId}?tab=${tab}`} title={title}>
        <Badge
          variant="outline"
          className={cn(
            "text-[11px]",
            generating
              ? "border-primary/40 text-primary"
              : generated
                ? stale
                  ? "border-amber-400/60 text-amber-600 dark:text-amber-400"
                  : "border-emerald-400/60 text-emerald-600 dark:text-emerald-400"
                : "border-dashed text-muted-foreground/60",
          )}
        >
          {generating ? "… " : generated ? "✓ " : ""}
          {label}
        </Badge>
      </Link>
    );
  };

  return (
    <AppLayout>
      <div className="space-y-6" data-testid="page-product-collateral">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2.5">
            <FolderOpen className="w-7 h-7 text-primary" />
            Collateral
          </h1>
          <p className="text-muted-foreground mt-1">
            Every product's generated strategy and go-to-market artifacts in one place. Click any
            item to view or generate it.
          </p>
        </div>

        {projects.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Package className="w-10 h-10 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-1">No products yet.</p>
              <Link href="/app/products" className="text-sm text-primary hover:underline">
                Add a product to start generating collateral →
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => (
              <Card key={project.id} data-testid={`collateral-product-${project.id}`}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <Link
                      href={`/app/products/${project.id}`}
                      className="font-semibold hover:text-primary transition-colors flex items-center gap-2"
                    >
                      <Package className="w-4 h-4 text-muted-foreground" />
                      {project.name}
                    </Link>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {GROUPS.map((group) => (
                      <div key={group.label}>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                          {group.label}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {group.artifacts.map((a) => chipFor(project.id, a.type, a.tab, a.label))}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
