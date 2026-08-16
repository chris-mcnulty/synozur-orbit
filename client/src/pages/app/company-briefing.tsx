/**
 * Unified Executive Summary ("Briefing Room") — one cross-area, tenant-level
 * AI-synthesized report spanning Research, Strategy, Marketing, and Sales.
 * On-demand generation; optional weekly auto-runs (plan-gated).
 */
import React from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  Sparkles, Loader2, RefreshCw, Globe, Crosshair, Megaphone, Handshake, ListChecks, CalendarClock,
} from "lucide-react";

interface SummarySection {
  key: string;
  title: string;
  body: string;
  highlights?: string[];
}

interface SummaryRun {
  id: string;
  status: "generating" | "completed" | "failed";
  trigger: string;
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
  summaryData?: { headline: string; sections: SummarySection[] } | null;
}

const SECTION_ICONS: Record<string, React.ElementType> = {
  market_position: Globe,
  where_to_play: Crosshair,
  marketing_execution: Megaphone,
  sales_development: Handshake,
  executive_actions: ListChecks,
};

export default function CompanyBriefingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canAutoRun = useFeatureFlag("executiveSummaryAuto");

  const { data: latest, isLoading } = useQuery<SummaryRun | null>({
    queryKey: ["/api/executive-summary/latest"],
    queryFn: async () => {
      const res = await fetch("/api/executive-summary/latest", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    // Poll while a run is in flight so the report appears without a refresh.
    refetchInterval: (query) => (query.state.data?.status === "generating" ? 4000 : false),
  });

  const { data: settings } = useQuery<{ autoEnabled: boolean }>({
    queryKey: ["/api/executive-summary/settings"],
    queryFn: async () => {
      const res = await fetch("/api/executive-summary/settings", { credentials: "include" });
      if (!res.ok) return { autoEnabled: false };
      return res.json();
    },
    enabled: canAutoRun,
  });

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/executive-summary/generate", { method: "POST", credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to start generation");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/executive-summary/latest"] });
      toast({ title: "Generating", description: "Your executive summary is being prepared — it will appear here shortly." });
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const toggleAuto = useMutation({
    mutationFn: async (autoEnabled: boolean) => {
      const res = await fetch("/api/executive-summary/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ autoEnabled }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to update setting");
      }
      return res.json();
    },
    onSuccess: (row: { autoEnabled: boolean }) => {
      queryClient.setQueryData(["/api/executive-summary/settings"], row);
      toast({
        title: row.autoEnabled ? "Weekly auto-run enabled" : "Weekly auto-run disabled",
        description: row.autoEnabled ? "A fresh summary will be generated every week." : undefined,
      });
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const isGenerating = latest?.status === "generating" || generate.isPending;
  const report = latest?.status === "completed" ? latest.summaryData : null;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" /> Executive Briefing
            </h1>
            <p className="text-muted-foreground mt-1">
              One unified summary across your market position, strategy, marketing, and sales.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {canAutoRun && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarClock className="h-4 w-4" />
                Weekly auto-run
                <Switch
                  checked={settings?.autoEnabled ?? false}
                  disabled={toggleAuto.isPending}
                  onCheckedChange={(v) => toggleAuto.mutate(v)}
                  data-testid="switch-auto-run"
                />
              </label>
            )}
            <Button onClick={() => generate.mutate()} disabled={isGenerating} data-testid="button-generate-summary">
              {isGenerating ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
              ) : (
                <><RefreshCw className="h-4 w-4 mr-2" /> {report ? "Regenerate" : "Generate summary"}</>
              )}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : latest?.status === "failed" ? (
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive text-base">Last run failed</CardTitle>
              <CardDescription>{latest.error || "Generation failed. Try again."}</CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {report ? (
          <>
            <Card>
              <CardContent className="pt-6">
                <p className="text-lg font-medium" data-testid="text-headline">{report.headline}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  Generated {latest?.completedAt ? new Date(latest.completedAt).toLocaleString() : ""}
                  {latest?.trigger === "scheduled" && <Badge variant="secondary" className="ml-2">Scheduled</Badge>}
                </p>
              </CardContent>
            </Card>
            {report.sections?.map((section) => {
              const Icon = SECTION_ICONS[section.key] ?? Sparkles;
              const html = DOMPurify.sanitize(marked.parse(section.body || "") as string);
              return (
                <Card key={section.key} data-testid={`card-section-${section.key}`}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Icon className="h-4 w-4 text-primary" /> {section.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {section.highlights && section.highlights.length > 0 && (
                      <ul className="space-y-1">
                        {section.highlights.map((h, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className="text-primary mt-0.5">•</span>
                            <span>{h}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: html }} />
                  </CardContent>
                </Card>
              );
            })}
          </>
        ) : !isLoading && latest?.status !== "generating" ? (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <Sparkles className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="font-medium">No briefing yet</p>
              <p className="text-sm text-muted-foreground">
                Generate your first unified executive summary. It pulls together competitive intelligence,
                market segments and opportunities, marketing activity, and sales development into one report.
              </p>
            </CardContent>
          </Card>
        ) : latest?.status === "generating" ? (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Collecting signals across all areas and writing your briefing…</p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppLayout>
  );
}
