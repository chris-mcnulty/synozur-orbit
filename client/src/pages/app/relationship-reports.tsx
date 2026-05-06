import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Handshake, Sparkles, Loader2, Download, FileText, RefreshCw, Trash2, Clock } from "lucide-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { formatShortDate } from "@/lib/staleness";
import EmptyPageState from "@/components/EmptyPageState";
import { UpgradePrompt } from "@/components/UpgradePrompt";

type RelationshipReport = {
  id: string;
  name: string;
  competitorId: string | null;
  targetName: string;
  targetUrl: string | null;
  content: string | null;
  status: string;
  lastGeneratedAt: string | null;
  generatedFromDataAsOf: string | null;
  savedPrompts?: { posture?: string | null; customGuidance?: string };
  updatedAt?: string | null;
  createdAt?: string | null;
};

export default function RelationshipReportsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [competitorId, setCompetitorId] = useState<string>("");
  const [posture, setPosture] = useState<string>("");
  const [guidance, setGuidance] = useState<string>("");

  const { data: user } = useQuery({
    queryKey: ["/api/me"],
    queryFn: async () => {
      const response = await fetch("/api/me", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
  });
  const isAdmin = user?.role === "Domain Admin" || user?.role === "Global Admin";

  const { data: tenantInfo, isLoading: tenantLoading } = useQuery<{ features?: any }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const response = await fetch("/api/tenant/info", { credentials: "include" });
      if (!response.ok) return { features: {} };
      return response.json();
    },
  });
  const allowed = tenantInfo?.features?.relationshipReports !== false;

  const { data: companyProfile } = useQuery({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const response = await fetch("/api/company-profile", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
  });

  const { data: competitors = [] as any[] } = useQuery({
    queryKey: ["/api/competitors"],
    queryFn: async () => {
      const response = await fetch("/api/competitors", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const { data: reports = [] as RelationshipReport[] } = useQuery<RelationshipReport[]>({
    queryKey: ["/api/relationship-reports"],
    queryFn: async () => {
      const response = await fetch("/api/relationship-reports", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: allowed,
  });

  const generateMutation = useMutation({
    mutationFn: async (params: { competitorId: string; posture: string; customGuidance: string }) => {
      const body: any = { customGuidance: params.customGuidance };
      if (params.posture && params.posture !== "auto") body.posture = params.posture;
      const response = await fetch(`/api/competitors/${params.competitorId}/relationship-report/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Failed to generate relationship report");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/relationship-reports"] });
      toast({
        title: "Relationship plan generated",
        description: "Your 12-month relationship plan is ready below.",
      });
      setGuidance("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/relationship-reports/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete report");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/relationship-reports"] });
      toast({ title: "Relationship report deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-2">
          <Handshake className="h-7 w-7 text-primary" />
          Relationship Reports
        </h1>
        <p className="text-muted-foreground">
          12-month plans for engaging with, cooperating with, selling to, competing
          with, speaking to, or steering clear of any company in your market.
        </p>
      </div>

      {!tenantLoading && !allowed ? (
        <UpgradePrompt
          feature="Relationship Reports"
          requiredPlan="Trial"
          description="On-demand 12-month engagement plans for any competitor or market peer. Upgrade to unlock this feature."
          className="mb-8"
        />
      ) : (
        <Card className="mb-8 border-primary/20" data-testid="card-relationship-report">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Generate a Relationship Plan
            </CardTitle>
            <CardDescription>
              The plan is written from the perspective of {companyProfile?.companyName || "your baseline company"}.
              Default targets are tracked competitors; future versions will support any external company.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Target Company</Label>
                <Select value={competitorId} onValueChange={setCompetitorId}>
                  <SelectTrigger data-testid="select-relationship-target">
                    <SelectValue placeholder="Choose a tracked competitor" />
                  </SelectTrigger>
                  <SelectContent>
                    {competitors.length === 0 ? (
                      <SelectItem value="none" disabled>No competitors tracked yet</SelectItem>
                    ) : (
                      competitors.map((c: any) => (
                        <SelectItem key={c.id} value={c.id} data-testid={`option-relationship-target-${c.id}`}>
                          {c.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Recommended Posture</Label>
                <Select value={posture || "auto"} onValueChange={setPosture}>
                  <SelectTrigger data-testid="select-relationship-posture">
                    <SelectValue placeholder="Let AI recommend" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Let AI recommend</SelectItem>
                    <SelectItem value="cooperate">Cooperate / Partner</SelectItem>
                    <SelectItem value="compete">Compete / Differentiate</SelectItem>
                    <SelectItem value="sell_to">Sell To / Pursue as Customer</SelectItem>
                    <SelectItem value="steer_clear">Steer Clear / Avoid</SelectItem>
                    <SelectItem value="observe">Observe / Hold Steady</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The plan still covers all postures; this just biases the framing.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="relationship-guidance">Custom Guidance (optional)</Label>
              <Textarea
                id="relationship-guidance"
                placeholder="e.g., We want to evaluate a co-marketing arrangement and have one shared customer; avoid burning bridges with their CRO."
                rows={3}
                value={guidance}
                onChange={(e) => setGuidance(e.target.value)}
                data-testid="input-relationship-guidance"
              />
            </div>
          </CardContent>
          <CardFooter className="border-t pt-4">
            <Button
              onClick={() => generateMutation.mutate({
                competitorId,
                posture,
                customGuidance: guidance,
              })}
              disabled={!competitorId || generateMutation.isPending}
              size="lg"
              className="w-full sm:w-auto"
              data-testid="button-generate-relationship"
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating 12-month plan…
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Relationship Plan
                </>
              )}
            </Button>
          </CardFooter>
        </Card>
      )}

      <div className="mb-4">
        <h2 className="text-xl font-semibold">Saved Relationship Plans</h2>
        <p className="text-sm text-muted-foreground">12-month engagement plans you have generated</p>
      </div>

      {reports.length === 0 ? (
        <EmptyPageState
          icon={<Handshake className="h-5 w-5" />}
          title="No relationship plans yet"
          description="Generate a plan above to capture how to engage with a specific competitor over the next 12 months."
          learnMoreHref="/app/guide"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {reports.map((rr) => (
            <Card key={rr.id} className="group hover:border-primary/50 transition-all" data-testid={`card-relationship-${rr.id}`}>
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start mb-2">
                  <div className="w-9 h-9 rounded bg-primary/10 text-primary flex items-center justify-center">
                    <Handshake size={18} />
                  </div>
                  {rr.savedPrompts?.posture && (
                    <Badge variant="outline" className="text-xs capitalize">
                      {rr.savedPrompts.posture.replace(/_/g, " ")}
                    </Badge>
                  )}
                </div>
                <CardTitle className="text-base line-clamp-1">{rr.name}</CardTitle>
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1">
                    <Clock size={12} />
                    {rr.lastGeneratedAt
                      ? formatShortDate(rr.lastGeneratedAt)
                      : rr.createdAt
                        ? formatShortDate(rr.createdAt)
                        : "—"}
                  </span>
                  {rr.targetName && (
                    <>
                      <span>•</span>
                      <span className="truncate max-w-[12rem]">{rr.targetName}</span>
                    </>
                  )}
                </div>
              </CardHeader>
              <CardFooter className="pt-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => window.open(`/api/relationship-reports/${rr.id}/download/markdown`, "_blank")}
                  data-testid={`button-download-relationship-${rr.id}`}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Markdown
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`/api/relationship-reports/${rr.id}/download/docx`, "_blank")}
                  data-testid={`button-download-relationship-docx-${rr.id}`}
                  title="Download as Word document"
                >
                  <FileText className="w-4 h-4" />
                </Button>
                {rr.competitorId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-primary"
                    onClick={() => generateMutation.mutate({
                      competitorId: rr.competitorId!,
                      posture: rr.savedPrompts?.posture || "",
                      customGuidance: rr.savedPrompts?.customGuidance || "",
                    })}
                    disabled={generateMutation.isPending}
                    data-testid={`button-regenerate-relationship-${rr.id}`}
                    title="Regenerate with latest data"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => deleteMutation.mutate(rr.id)}
                    disabled={deleteMutation.isPending}
                    data-testid={`button-delete-relationship-${rr.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
