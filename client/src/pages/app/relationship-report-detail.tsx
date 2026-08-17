import React from "react";
import { useRoute, Link } from "wouter";
import AppLayout from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { getTabMarketId } from "@/lib/tabContext";
import { ArrowLeft, Download, FileText, Handshake, Loader2, Building2, Clock } from "lucide-react";
import { MarkdownContent } from "@/components/MarkdownViewer";
import { formatShortDate } from "@/lib/staleness";

type RelationshipReport = {
  id: string;
  name: string;
  competitorId: string | null;
  targetCompanyProfileId: string | null;
  targetName: string;
  targetUrl: string | null;
  content: string | null;
  status: string;
  lastGeneratedAt: string | null;
  generatedFromDataAsOf: string | null;
  savedPrompts?: { posture?: string | null; customGuidance?: string; lastError?: string };
  updatedAt?: string | null;
  createdAt?: string | null;
};

export default function RelationshipReportDetailPage() {
  const [, params] = useRoute("/app/relationship-reports/:id");
  const id = params?.id;

  const { data: report, isLoading, isError, error } = useQuery<RelationshipReport>({
    queryKey: ["/api/relationship-reports", getTabMarketId(), id],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/relationship-reports/${id}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load relationship report");
      }
      return res.json();
    },
    // Keep polling while it's still being generated, just like the index page,
    // so a user who navigates straight here from the toast doesn't see a stale
    // "not ready" message indefinitely.
    refetchInterval: (query) => {
      const data = query.state.data as RelationshipReport | undefined;
      return data?.status === "generating" ? 5000 : false;
    },
  });

  const isGenerating = report?.status === "generating";
  const isFailed = report?.status === "failed";
  const isReady = report?.status === "generated" && !!report?.content;
  const lastError = report?.savedPrompts?.lastError;

  return (
    <AppLayout>
      <div className="mb-6">
        <Link href="/app/relationship-reports">
          <Button variant="ghost" size="sm" className="mb-4 -ml-2" data-testid="button-back-relationship-list">
            <ArrowLeft className="w-4 h-4 mr-2" />
            All relationship plans
          </Button>
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-2">
              {report?.targetCompanyProfileId && !report?.competitorId ? (
                <Building2 className="h-7 w-7 text-primary" />
              ) : (
                <Handshake className="h-7 w-7 text-primary" />
              )}
              {report?.name || (isLoading ? "Loading…" : "Relationship Plan")}
            </h1>
            {report?.targetName && (
              <p className="text-muted-foreground flex items-center gap-3 flex-wrap">
                <span>12-month plan for {report.targetName}</span>
                {report.lastGeneratedAt && (
                  <span className="flex items-center gap-1 text-sm">
                    <Clock className="w-3.5 h-3.5" />
                    {formatShortDate(report.lastGeneratedAt)}
                  </span>
                )}
                {report.savedPrompts?.posture && (
                  <Badge variant="outline" className="capitalize">
                    {report.savedPrompts.posture.replace(/_/g, " ")}
                  </Badge>
                )}
              </p>
            )}
          </div>

          {isReady && report && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`/api/relationship-reports/${report.id}/download/pdf`, "_blank")}
                data-testid="button-detail-download-pdf"
              >
                <Download className="w-4 h-4 mr-2" />
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`/api/relationship-reports/${report.id}/download/markdown`, "_blank")}
                data-testid="button-detail-download-md"
              >
                <FileText className="w-4 h-4 mr-2" />
                Markdown
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`/api/relationship-reports/${report.id}/download/docx`, "_blank")}
                data-testid="button-detail-download-docx"
              >
                <FileText className="w-4 h-4 mr-2" />
                Word
              </Button>
            </div>
          )}
        </div>
      </div>

      {isLoading && (
        <Card>
          <CardContent className="py-12 flex items-center justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Loading plan…
          </CardContent>
        </Card>
      )}

      {isError && (
        <Card>
          <CardContent className="py-12 text-center" data-testid="text-detail-load-error">
            <p className="text-destructive font-medium mb-1">Couldn't load this plan</p>
            <p className="text-sm text-muted-foreground">{(error as Error)?.message || "Unknown error"}</p>
          </CardContent>
        </Card>
      )}

      {report && isGenerating && (
        <Card data-testid="text-detail-generating">
          <CardContent className="py-12 flex flex-col items-center text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 mb-3 animate-spin text-primary" />
            <p className="font-medium text-foreground mb-1">Generating your 12-month plan…</p>
            <p className="text-sm">This usually takes 2–4 minutes. The page will update automatically when it's ready.</p>
          </CardContent>
        </Card>
      )}

      {report && isFailed && (
        <Card data-testid="text-detail-failed">
          <CardContent className="py-12 text-center">
            <p className="text-destructive font-medium mb-1">Generation failed</p>
            {lastError && <p className="text-sm text-muted-foreground mb-4">{lastError}</p>}
            <Link href="/app/relationship-reports">
              <Button variant="outline" size="sm">Back to plans</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {report && isReady && (
        <Card>
          <CardContent className="py-8" data-testid="content-relationship-report">
            <MarkdownContent content={report.content!} className="max-w-3xl mx-auto" />
          </CardContent>
        </Card>
      )}
    </AppLayout>
  );
}
