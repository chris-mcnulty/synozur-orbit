import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getTabMarketId } from "@/lib/tabContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useFeatureAccess, UpgradePrompt } from "@/components/UpgradePrompt";
import { Loader2, RefreshCw, DollarSign, Check, Clock, AlertCircle, Save } from "lucide-react";

interface PricingTier {
  name: string;
  price?: string | null;
  priceAmount?: number | null;
  billingPeriod?: string | null;
  currency?: string | null;
  features?: string[];
  cta?: string | null;
  isHighlighted?: boolean;
  audience?: string | null;
}

interface PricingChange {
  kind: string;
  description: string;
  significance: "high" | "medium" | "low";
}

interface PricingChangeAnalysis {
  changes: PricingChange[];
  categories: string[];
  narrative: string;
}

interface PricingSnapshot {
  id: string;
  pricingUrl: string;
  tiers: PricingTier[];
  pricingModel?: string | null;
  currency?: string | null;
  hasFreeTier?: boolean | null;
  changeScore: number;
  changeSummary?: string | null;
  changeAnalysis?: PricingChangeAnalysis | null;
  capturedAt: string;
  crawlMethod?: string | null;
}

interface PricingResponse {
  pricingPageUrl: string | null;
  latestSnapshotAt: string | null;
  latest: PricingSnapshot | null;
  snapshots: PricingSnapshot[];
}

function significanceBadge(s: PricingChange["significance"]) {
  const variants: Record<PricingChange["significance"], "destructive" | "default" | "secondary"> = {
    high: "destructive",
    medium: "default",
    low: "secondary",
  };
  return <Badge variant={variants[s]} className="text-[10px] uppercase">{s}</Badge>;
}

export default function CompetitorPricing({
  competitorId,
  competitorName,
  initialPricingUrl,
}: {
  competitorId: string;
  competitorName: string;
  initialPricingUrl?: string | null;
}) {
  const { isAllowed, isLoading: featureLoading } = useFeatureAccess("pricingIntelligence");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editingUrl, setEditingUrl] = useState(false);
  const [pricingUrlInput, setPricingUrlInput] = useState(initialPricingUrl || "");

  const { data, isLoading, error } = useQuery<PricingResponse>({
    queryKey: ["/api/competitors", getTabMarketId(), competitorId, "pricing"],
    queryFn: async () => {
      const res = await fetch(`/api/competitors/${competitorId}/pricing`, { credentials: "include" });
      if (res.status === 403) throw new Error("forbidden");
      if (!res.ok) throw new Error("Failed to load pricing data");
      return res.json();
    },
    enabled: !!competitorId && isAllowed,
  });

  React.useEffect(() => {
    if (data?.pricingPageUrl !== undefined && !editingUrl) {
      setPricingUrlInput(data.pricingPageUrl || "");
    }
  }, [data?.pricingPageUrl, editingUrl]);

  const saveUrlMutation = useMutation({
    mutationFn: async (url: string | null) => {
      const res = await fetch(`/api/competitors/${competitorId}/pricing-url`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pricingPageUrl: url }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save pricing URL");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors", getTabMarketId(), competitorId, "pricing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/competitors", getTabMarketId(), competitorId] });
      setEditingUrl(false);
      toast({ title: "Pricing URL saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not save", description: err.message, variant: "destructive" });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/competitors/${competitorId}/pricing/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to refresh pricing");
      }
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors", getTabMarketId(), competitorId, "pricing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      toast({
        title: result.hasChanges ? "Pricing change detected" : "Pricing snapshot updated",
        description: result.summary || `Captured tiers from ${competitorName}'s pricing page.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Refresh failed", description: err.message, variant: "destructive" });
    },
  });

  if (featureLoading) return null;

  if (!isAllowed) {
    return (
      <UpgradePrompt
        feature="Pricing Intelligence"
        requiredPlan="Pro"
        description="Track competitor pricing pages with structured tier extraction, change history, and AI-summarised diffs."
      />
    );
  }

  if (error && (error as Error).message === "forbidden") {
    return (
      <UpgradePrompt
        feature="Pricing Intelligence"
        requiredPlan="Pro"
        description="Track competitor pricing pages with structured tier extraction, change history, and AI-summarised diffs."
      />
    );
  }

  const pricingUrl = data?.pricingPageUrl || null;
  const latest = data?.latest;
  const history = (data?.snapshots || []).slice(1); // Exclude latest

  return (
    <div className="space-y-6" data-testid="pricing-tab">
      {/* URL configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="h-5 w-5 text-primary" />
            Pricing Page
          </CardTitle>
        </CardHeader>
        <CardContent>
          {editingUrl || !pricingUrl ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                placeholder="https://example.com/pricing"
                value={pricingUrlInput}
                onChange={e => setPricingUrlInput(e.target.value)}
                data-testid="input-pricing-url"
                className="flex-1"
              />
              <div className="flex gap-2">
                <Button
                  onClick={() => saveUrlMutation.mutate(pricingUrlInput.trim() || null)}
                  disabled={saveUrlMutation.isPending}
                  data-testid="button-save-pricing-url"
                >
                  {saveUrlMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Save
                </Button>
                {pricingUrl && (
                  <Button variant="ghost" onClick={() => { setEditingUrl(false); setPricingUrlInput(pricingUrl); }}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <a
                href={pricingUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sm font-mono text-primary hover:underline truncate"
                data-testid="link-pricing-url"
              >
                {pricingUrl}
              </a>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => setEditingUrl(true)} data-testid="button-edit-pricing-url">
                  Edit
                </Button>
                <Button
                  size="sm"
                  onClick={() => refreshMutation.mutate()}
                  disabled={refreshMutation.isPending}
                  data-testid="button-refresh-pricing"
                >
                  {refreshMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                  Refresh
                </Button>
              </div>
            </div>
          )}
          {!pricingUrl && !editingUrl && (
            <p className="text-sm text-muted-foreground mt-2">
              Add a pricing page URL to start tracking pricing tiers and detect changes.
            </p>
          )}
        </CardContent>
      </Card>

      {isLoading && (
        <Card><CardContent className="p-12 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 mx-auto animate-spin" />
        </CardContent></Card>
      )}

      {/* Empty state when URL is set but no snapshot yet */}
      {!isLoading && pricingUrl && !latest && (
        <Card>
          <CardContent className="p-12 text-center">
            <DollarSign className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-xl font-semibold mb-2">No pricing snapshots yet</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Click <strong>Refresh</strong> above to capture {competitorName}'s pricing tiers and start tracking changes.
            </p>
            <Button onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending} data-testid="button-first-pricing-refresh">
              {refreshMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Capturing...</>
              ) : (
                <><RefreshCw className="h-4 w-4 mr-2" /> Capture Snapshot</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Current tiers */}
      {latest && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">Current Tiers</CardTitle>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                  <Clock className="h-3 w-3" />
                  Captured {new Date(latest.capturedAt).toLocaleString()}
                  {latest.crawlMethod && <span>• {latest.crawlMethod}</span>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {latest.pricingModel && <Badge variant="outline">{latest.pricingModel}</Badge>}
                {latest.currency && <Badge variant="outline">{latest.currency}</Badge>}
                {latest.hasFreeTier && <Badge variant="secondary">Free tier</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {latest.tiers.length === 0 ? (
              <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/40 p-3 rounded-md">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  No tiers could be extracted from this page. It may use a "Contact sales" model, render content client-side that
                  the crawler couldn't reach, or block automated access. You can still see the change history below.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {latest.tiers.map((tier, idx) => (
                  <div
                    key={idx}
                    className={`border rounded-lg p-4 ${tier.isHighlighted ? "border-primary bg-primary/5" : "border-border"}`}
                    data-testid={`pricing-tier-${idx}`}
                  >
                    <div className="font-semibold text-base">{tier.name}</div>
                    {tier.audience && <div className="text-xs text-muted-foreground mt-0.5">{tier.audience}</div>}
                    <div className="text-2xl font-bold text-primary mt-2">
                      {tier.price || (tier.priceAmount != null ? `$${tier.priceAmount}` : "—")}
                      {tier.billingPeriod && (
                        <span className="text-xs font-normal text-muted-foreground ml-1">/{tier.billingPeriod}</span>
                      )}
                    </div>
                    {tier.cta && (
                      <div className="text-xs text-muted-foreground mt-1 italic">CTA: {tier.cta}</div>
                    )}
                    {tier.features && tier.features.length > 0 && (
                      <ul className="mt-3 space-y-1.5 text-sm">
                        {tier.features.slice(0, 6).map((f, fi) => (
                          <li key={fi} className="flex items-start gap-1.5">
                            <Check className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                            <span className="text-muted-foreground">{f}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Change history */}
      {latest && data && data.snapshots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Change History</CardTitle>
          </CardHeader>
          <CardContent>
            {data.snapshots.filter(s => s.changeSummary).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {data.snapshots.length === 1
                  ? "First snapshot captured — change tracking starts on the next refresh."
                  : "No significant pricing changes detected across the captured snapshots."}
              </p>
            ) : (
              <div className="space-y-3">
                {data.snapshots
                  .filter(s => s.changeSummary)
                  .map(snap => (
                    <div
                      key={snap.id}
                      className="border-l-2 border-primary/40 pl-3 py-1"
                      data-testid={`pricing-change-${snap.id}`}
                    >
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                        <Clock className="h-3 w-3" />
                        {new Date(snap.capturedAt).toLocaleString()}
                        <Badge variant="outline" className="text-[10px]">{snap.changeScore}% diff</Badge>
                      </div>
                      <p className="text-sm">{snap.changeSummary}</p>
                      {snap.changeAnalysis?.changes && snap.changeAnalysis.changes.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {snap.changeAnalysis.changes.map((c, i) => (
                            <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                              {significanceBadge(c.significance)}
                              <span>{c.description}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!latest && !pricingUrl && !isLoading && (
        <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/40 p-3 rounded-md">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong>Tip:</strong> The pricing page URL is usually something like
            <code className="mx-1 px-1 py-0.5 bg-muted rounded text-xs">{`{site}/pricing`}</code>
            or
            <code className="mx-1 px-1 py-0.5 bg-muted rounded text-xs">{`{site}/plans`}</code>.
          </div>
        </div>
      )}
    </div>
  );
}
