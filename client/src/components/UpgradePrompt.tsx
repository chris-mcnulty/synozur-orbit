import React, { useState, useCallback, useEffect, createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Gem, Lock, ArrowRight, ShieldAlert } from "lucide-react";
import { ApiError, queryClient } from "@/lib/queryClient";

interface UpgradePromptProps {
  feature: string;
  requiredPlan: string;
  description?: string;
  inline?: boolean;
  className?: string;
}

export function UpgradePrompt({ feature, requiredPlan, description, inline, className }: UpgradePromptProps) {
  if (inline) {
    return (
      <div className={`flex items-center gap-2 text-sm text-muted-foreground ${className || ""}`} data-testid="upgrade-prompt-inline">
        <Lock className="h-3.5 w-3.5" />
        <span>{feature} requires {requiredPlan}+</span>
        <a href="mailto:contactus@synozur.com" className="text-primary hover:underline text-xs">
          Upgrade
        </a>
      </div>
    );
  }

  return (
    <Card className={`border-dashed ${className || ""}`} data-testid="upgrade-prompt">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <div className="rounded-full bg-primary/10 p-4 mb-4">
          <Gem className="h-8 w-8 text-primary" />
        </div>
        <h3 className="text-lg font-semibold mb-2">{feature}</h3>
        <p className="text-muted-foreground mb-4 max-w-md">
          {description || `This feature is available on the ${requiredPlan} plan and above. Upgrade to unlock ${feature.toLowerCase()}.`}
        </p>
        <Badge variant="outline" className="mb-4">
          Requires {requiredPlan} Plan
        </Badge>
        <a href="mailto:contactus@synozur.com">
          <Button data-testid="button-upgrade">
            Contact Us to Upgrade
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </a>
      </CardContent>
    </Card>
  );
}

interface PlanLimitBadgeProps {
  current: number;
  limit: number;
  label: string;
  visibleCount?: number;
}

export function PlanLimitBadge({ current, limit, label, visibleCount }: PlanLimitBadgeProps) {
  if (limit === -1) return null;
  const isAtLimit = current >= limit;
  const isNearLimit = current >= limit * 0.8;
  const showCrossMarketHint = visibleCount !== undefined && visibleCount < current;

  return (
    <Badge
      variant={isAtLimit ? "destructive" : isNearLimit ? "secondary" : "outline"}
      className="text-xs"
      title={showCrossMarketHint ? `${current} total across all markets (${visibleCount} in this market)` : undefined}
      data-testid={`limit-badge-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {current}/{limit} {label}{showCrossMarketHint ? " (all markets)" : ""}
    </Badge>
  );
}

interface FeatureGateProps {
  feature: string;
  requiredPlan: string;
  isAllowed: boolean;
  children: React.ReactNode;
  description?: string;
}

export function FeatureGate({ feature, requiredPlan, isAllowed, children, description }: FeatureGateProps) {
  if (isAllowed) {
    return <>{children}</>;
  }
  return <UpgradePrompt feature={feature} requiredPlan={requiredPlan} description={description} />;
}

interface TenantInfo {
  plan: string;
  isPremium: boolean;
  features: Record<string, boolean>;
}

export function useFeatureAccess(featureKey: string) {
  const { data: tenantInfo, isLoading } = useQuery<TenantInfo>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch tenant info");
      return r.json();
    },
    staleTime: 60_000,
  });

  const isAllowed = tenantInfo?.features?.[featureKey] ?? true;
  const plan = tenantInfo?.plan ?? "trial";

  return { isAllowed, isLoading, plan };
}

const FEATURE_REQUIRED_PLAN: Record<string, string> = {
  battlecards: "Pro",
  recommendations: "Pro",
  pdfReports: "Pro",
  gtmPlan: "Pro",
  messagingFramework: "Pro",
  socialMonitoring: "Pro",
  websiteMonitoring: "Pro",
  clientProjects: "Pro",
  marketingPlanner: "Enterprise",
  productManagement: "Enterprise",
  multiMarket: "Enterprise",
  ssoIntegration: "Enterprise",
  customBranding: "Enterprise",
  socialPosts: "Pro",
  emailNewsletters: "Pro",
  contentLibrary: "Enterprise",
  brandLibrary: "Enterprise",
  campaigns: "Enterprise",
  socialAccounts: "Enterprise",
  saturnCapture: "Enterprise",
  intelligenceBriefings: "Pro",
  podcastBriefings: "Pro",
  scheduledBriefingUpdates: "Pro",
  competitorAlerts: "Pro",
  personaBuilder: "Pro",
  autoBuild: "Enterprise",
};

export function PageFeatureGate({ featureKey, label, description, children }: {
  featureKey: string;
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  const { isAllowed, isLoading } = useFeatureAccess(featureKey);
  const requiredPlan = FEATURE_REQUIRED_PLAN[featureKey] || "Pro";

  if (isLoading) return null;

  if (!isAllowed) {
    return (
      <div className="container mx-auto p-8" data-testid={`feature-gate-${featureKey}`}>
        <UpgradePrompt
          feature={label}
          requiredPlan={requiredPlan}
          description={description}
        />
      </div>
    );
  }

  return <>{children}</>;
}

export function isUpgradeError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.upgradeRequired === true;
}

interface UpgradeModalState {
  open: boolean;
  feature: string;
  requiredPlan: string;
  message: string;
}

interface UpgradeModalContextType {
  showUpgradeModal: (feature: string, requiredPlan: string, message?: string) => void;
  handleUpgradeResponse: (response: Response) => Promise<boolean>;
  handleMutationError: (error: unknown) => boolean;
}

const UpgradeModalContext = createContext<UpgradeModalContextType>({
  showUpgradeModal: () => {},
  handleUpgradeResponse: async () => false,
  handleMutationError: () => false,
});

export function useUpgradeModal() {
  return useContext(UpgradeModalContext);
}

export function UpgradeModalProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<UpgradeModalState>({
    open: false,
    feature: "",
    requiredPlan: "",
    message: "",
  });

  const showUpgradeModal = useCallback((feature: string, requiredPlan: string, message?: string) => {
    setState({
      open: true,
      feature,
      requiredPlan,
      message: message || `This feature requires a ${requiredPlan} plan or higher.`,
    });
  }, []);

  const handleUpgradeResponse = useCallback(async (response: Response): Promise<boolean> => {
    if (response.status === 403) {
      try {
        const data = await response.clone().json();
        if (data.upgradeRequired) {
          setState({
            open: true,
            feature: data.error || "Premium Feature",
            requiredPlan: data.requiredPlan || "Pro",
            message: data.error || "This feature requires a plan upgrade.",
          });
          return true;
        }
      } catch {}
    }
    return false;
  }, []);

  const handleMutationError = useCallback((error: unknown): boolean => {
    if (isUpgradeError(error)) {
      setState({
        open: true,
        feature: error.message.replace(/^\d+:\s*/, "") || "Premium Feature",
        requiredPlan: error.requiredPlan || "Pro",
        message: error.message.replace(/^\d+:\s*/, "") || "This feature requires a plan upgrade.",
      });
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    const defaults = queryClient.getDefaultOptions();
    queryClient.setDefaultOptions({
      ...defaults,
      queries: {
        ...defaults.queries,
        retry: (failureCount: number, error: Error) => {
          if (isUpgradeError(error)) return false;
          return failureCount < 0;
        },
      },
    });

    const cache = queryClient.getQueryCache();
    const unsubscribe = cache.subscribe((event) => {
      if (event.type === "updated" && event.action?.type === "error") {
        const actionError = "error" in event.action ? event.action.error : null;
        if (actionError) {
          handleMutationError(actionError);
        }
      }
    });

    const mutationCache = queryClient.getMutationCache();
    const mutationUnsubscribe = mutationCache.subscribe((event) => {
      if (event.type === "updated" && event.action?.type === "error") {
        const actionError = "error" in event.action ? event.action.error : null;
        if (actionError) {
          handleMutationError(actionError);
        }
      }
    });

    return () => {
      unsubscribe();
      mutationUnsubscribe();
    };
  }, [handleMutationError]);

  return (
    <UpgradeModalContext.Provider value={{ showUpgradeModal, handleUpgradeResponse, handleMutationError }}>
      {children}
      <Dialog open={state.open} onOpenChange={(open) => setState(s => ({ ...s, open }))}>
        <DialogContent className="sm:max-w-md" data-testid="upgrade-modal">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="rounded-full bg-primary/10 p-2">
                <ShieldAlert className="h-5 w-5 text-primary" />
              </div>
              <DialogTitle>Upgrade Required</DialogTitle>
            </div>
            <DialogDescription>{state.message}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center py-4">
            <Badge variant="outline" className="text-sm px-3 py-1">
              Requires {state.requiredPlan} Plan
            </Badge>
          </div>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setState(s => ({ ...s, open: false }))} data-testid="button-dismiss-upgrade">
              Maybe Later
            </Button>
            <a href="mailto:contactus@synozur.com">
              <Button data-testid="button-upgrade-modal">
                Contact Us to Upgrade
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </UpgradeModalContext.Provider>
  );
}
