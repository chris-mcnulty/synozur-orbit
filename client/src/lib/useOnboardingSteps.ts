import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Users, Sparkles, Swords, FileText, RefreshCw } from "lucide-react";
import { calculateStaleness } from "@/lib/staleness";

/**
 * Single source of truth for the onboarding checklist.
 *
 * Both the standalone Getting Started page and the Research Overview's
 * inline checklist render from this hook, so the step list and completion
 * logic can't drift between them (they used to be copy-pasted). React Query
 * dedupes the underlying fetches by key, so calling this alongside a page's
 * own queries costs no extra requests.
 *
 * `description` is the compact one-liner (used by the dashboard card);
 * `detail` is the full paragraph (used by the Getting Started page).
 * `maintenance` marks the ongoing step (data freshness) that isn't part of
 * one-time setup — the dashboard nudge keys its show/hide off setup only.
 */
export interface OnboardingStep {
  id: string;
  step: number;
  label: string;
  description: string;
  detail: string;
  complete: boolean;
  href: string;
  icon: ComponentType<{ className?: string }>;
  cta: string;
  maintenance?: boolean;
}

export interface OnboardingState {
  steps: OnboardingStep[];
  setupSteps: OnboardingStep[];
  completedCount: number;
  progress: number;
  nextStep: OnboardingStep | undefined;
  allComplete: boolean;
  setupComplete: boolean;
}

export function useOnboardingSteps(): OnboardingState {
  const { data: companyProfile } = useQuery<any>({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const r = await fetch("/api/company-profile", { credentials: "include" });
      return r.ok ? r.json() : null;
    },
  });
  const { data: competitors = [] } = useQuery<any[]>({
    queryKey: ["/api/competitors"],
    queryFn: async () => {
      const r = await fetch("/api/competitors", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });
  const { data: analysis } = useQuery<any>({
    queryKey: ["/api/analysis"],
    queryFn: async () => {
      const r = await fetch("/api/analysis", { credentials: "include" });
      return r.ok ? r.json() : null;
    },
  });
  const { data: battleCards = [] } = useQuery<any[]>({
    queryKey: ["/api/battlecards"],
    queryFn: async () => {
      const r = await fetch("/api/battlecards", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });
  const { data: reports = [] } = useQuery<any[]>({
    queryKey: ["/api/reports"],
    queryFn: async () => {
      const r = await fetch("/api/reports", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const baselineComplete = !!(companyProfile && companyProfile.websiteUrl);
  const hasAnalysis = !!(analysis && analysis.themes);

  // Fresh = at least one tracked source, and none of them stale.
  const allDataFresh = (() => {
    const timestamps = [
      companyProfile?.lastFullCrawl,
      ...competitors.map((c: any) => c.lastFullCrawl),
      ...competitors.map((c: any) => c.lastSocialCrawl),
    ].filter(Boolean) as string[];
    if (timestamps.length === 0) return false;
    return timestamps.every((ts) => calculateStaleness(ts) !== "stale");
  })();

  const steps: OnboardingStep[] = [
    {
      id: "company",
      step: 1,
      label: "Set up your company profile",
      description: "Add your website and company details",
      detail: "Add your website URL and company details so Orbit can establish your competitive baseline. This is the foundation for all analysis.",
      complete: baselineComplete,
      href: "/app/company-profile",
      icon: Building2,
      cta: "Set Up Profile",
    },
    {
      id: "competitors",
      step: 2,
      label: "Add your first competitor",
      description: "Track at least one competitor",
      detail: "Enter a competitor's website URL and Orbit will automatically crawl their site, social profiles, and blog to build a competitive profile.",
      complete: competitors.length > 0,
      href: "/app/competitors",
      icon: Users,
      cta: "Add Competitor",
    },
    {
      id: "analysis",
      step: 3,
      label: "Run a competitive analysis",
      description: "Generate competitive insights",
      detail: "Once you have a baseline and at least one competitor, run an AI-powered analysis to uncover themes, gaps, and strategic opportunities.",
      complete: hasAnalysis,
      href: "/app/analysis",
      icon: Sparkles,
      cta: "Run Analysis",
    },
    {
      id: "battlecards",
      step: 4,
      label: "Create a battle card",
      description: "Arm your sales team",
      detail: "Generate sales battle cards that compare your strengths against specific competitors. Perfect for arming your sales team with talking points.",
      complete: battleCards.length > 0,
      href: "/app/battlecards",
      icon: Swords,
      cta: "Create Battle Card",
    },
    {
      id: "reports",
      step: 5,
      label: "Generate a report",
      description: "Create your first competitive report",
      detail: "Create a branded PDF competitive report you can share with your team or stakeholders. Reports include analysis, positioning, and recommendations.",
      complete: reports.length > 0,
      href: "/app/reports",
      icon: FileText,
      cta: "Generate Report",
    },
    {
      id: "freshness",
      step: 6,
      label: "Keep your data fresh",
      description: "Refresh stale sources anytime",
      detail: "Orbit works best when data is refreshed regularly. Check Data Sources to see freshness and refresh stale data anytime. Pro and Enterprise plans include automatic scheduled refreshes.",
      complete: allDataFresh,
      href: "/app/data-sources",
      icon: RefreshCw,
      cta: "Check Freshness",
      maintenance: true,
    },
  ];

  const setupSteps = steps.filter((s) => !s.maintenance);
  const completedCount = steps.filter((s) => s.complete).length;
  const progress = Math.round((completedCount / steps.length) * 100);
  const nextStep = steps.find((s) => !s.complete);
  const allComplete = completedCount === steps.length;
  const setupComplete = setupSteps.every((s) => s.complete);

  return { steps, setupSteps, completedCount, progress, nextStep, allComplete, setupComplete };
}
