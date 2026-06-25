import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Rocket, CheckCircle2, ChevronRight, ArrowRight, Eye
} from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useOnboardingSteps } from "@/lib/useOnboardingSteps";

const CHECKLIST_DISMISSED_KEY = "orbit_onboarding_dismissed";

export default function GettingStartedPage() {
  const [showOnDashboard, setShowOnDashboard] = useState(() => {
    return localStorage.getItem(CHECKLIST_DISMISSED_KEY) !== "true";
  });

  const { steps, completedCount, progress, allComplete, nextStep } = useOnboardingSteps();

  const handleToggleDashboard = (checked: boolean) => {
    setShowOnDashboard(checked);
    if (checked) {
      localStorage.removeItem(CHECKLIST_DISMISSED_KEY);
    } else {
      localStorage.setItem(CHECKLIST_DISMISSED_KEY, "true");
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Rocket className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Getting Started</h1>
              <p className="text-muted-foreground text-sm">
                {allComplete
                  ? "You've completed all the steps — Orbit is fully set up!"
                  : "Complete these steps to unlock Orbit's full potential"}
              </p>
            </div>
          </div>
          <Badge variant={allComplete ? "default" : "secondary"} className="text-sm px-3 py-1">
            {completedCount}/{steps.length} complete
          </Badge>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Setup Progress</CardTitle>
                <CardDescription>
                  {allComplete
                    ? "All steps completed. You're all set to use Orbit!"
                    : `${steps.length - completedCount} step${steps.length - completedCount !== 1 ? "s" : ""} remaining`}
                </CardDescription>
              </div>
              <span className="text-2xl font-bold text-primary">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2 mt-2" />
          </CardHeader>
        </Card>

        <div className="space-y-3">
          {steps.map((step) => {
            const Icon = step.icon;
            const isNext = !step.complete && step.id === nextStep?.id;
            return (
              <Card
                key={step.id}
                className={cn(
                  "transition-all duration-200",
                  step.complete && "border-green-500/30 bg-green-500/5",
                  isNext && "border-primary/50 ring-1 ring-primary/20 shadow-sm",
                  !step.complete && !isNext && "border-border"
                )}
                data-testid={`getting-started-step-${step.id}`}
              >
                <CardContent className="py-5">
                  <div className="flex items-start gap-4">
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold",
                        step.complete
                          ? "bg-emerald-500 text-primary-foreground dark:bg-emerald-600"
                          : isNext
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      )}>
                        {step.complete ? <CheckCircle2 className="w-4 h-4" /> : step.step}
                      </span>
                      <div className={cn(
                        "p-2 rounded-lg",
                        step.complete
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : isNext
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                      )}>
                        <Icon className="w-5 h-5" />
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className={cn(
                          "font-semibold",
                          step.complete ? "text-green-600 dark:text-green-400" : "text-foreground"
                        )}>
                          {step.label}
                        </h3>
                        {step.complete && (
                          <Badge variant="outline" className="text-xs text-green-600 border-green-500/30 bg-green-500/10">
                            Done
                          </Badge>
                        )}
                        {isNext && (
                          <Badge className="text-xs bg-primary/10 text-primary border-0">
                            Up Next
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{step.detail}</p>
                    </div>

                    <div className="shrink-0 self-center">
                      {step.complete ? (
                        <Link href={step.href}>
                          <Button variant="ghost" size="sm">
                            <Eye className="w-4 h-4 mr-1.5" />
                            View
                          </Button>
                        </Link>
                      ) : (
                        <Link href={step.href}>
                          <Button size="sm" variant={isNext ? "default" : "outline"}>
                            {step.cta}
                            {isNext ? (
                              <ArrowRight className="w-4 h-4 ml-1.5" />
                            ) : (
                              <ChevronRight className="w-4 h-4 ml-1.5" />
                            )}
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Label htmlFor="show-on-dashboard" className="text-sm font-medium cursor-pointer">
                  Show getting started checklist on dashboard
                </Label>
                <p className="text-xs text-muted-foreground hidden sm:block">
                  Toggle the checklist card on your Overview page
                </p>
              </div>
              <Switch
                id="show-on-dashboard"
                checked={showOnDashboard}
                onCheckedChange={handleToggleDashboard}
                data-testid="toggle-dashboard-checklist"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
