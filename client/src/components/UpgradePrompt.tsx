import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Gem, Lock, ArrowRight } from "lucide-react";

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
