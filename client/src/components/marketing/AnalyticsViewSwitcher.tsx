import { Link, useLocation } from "wouter";
import { Gauge, BarChart2, LineChart } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cross-links the three analytics surfaces that were scattered across two
 * areas — Outcomes & Orbit Score and Competitive Visualizations (Research →
 * Insights) and Marketing Performance (Marketing → Measure). Rendering the
 * same switcher on each makes them read as one analytics suite and lets you
 * move between them without hunting through two sidebars. Each entry links to
 * its real route (and its own area), so the pages stay independent.
 */
const VIEWS: { href: string; label: string; icon: typeof Gauge }[] = [
  { href: "/app/insights/outcomes", label: "Outcomes", icon: Gauge },
  { href: "/app/insights/visualizations", label: "Visualizations", icon: BarChart2 },
  { href: "/app/marketing/performance", label: "Content performance", icon: LineChart },
];

export function AnalyticsViewSwitcher({ className }: { className?: string }) {
  const [location] = useLocation();
  const current = location.split("?")[0];

  return (
    <div className={cn("flex items-center gap-2 flex-wrap", className)} data-testid="analytics-view-switcher">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Analytics</span>
      <div className="inline-flex items-center rounded-lg border bg-muted/40 p-0.5" role="tablist" aria-label="Analytics views">
        {VIEWS.map((v) => {
          const active = current === v.href;
          const Icon = v.icon;
          return (
            <Link
              key={v.href}
              href={v.href}
              role="tab"
              aria-selected={active}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              data-testid={`analytics-view-${v.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <Icon className="h-3.5 w-3.5" /> {v.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
