import { Link, useLocation } from "wouter";
import { CalendarRange, ListChecks, Share2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Segmented switcher shared by the marketing scheduling surfaces — the
 * cross-channel Content Calendar, the drag-and-drop Pipeline Board, the
 * social-only Social Calendar, and the Orbit Posting Queue. They were
 * disconnected pages; this makes them read as one "Calendar" with several
 * views. Each entry links to a real route, so the pages stay independent
 * under the hood.
 */
const VIEWS: { href: string; label: string; icon: typeof CalendarRange }[] = [
  { href: "/app/marketing/marketing-calendar", label: "Calendar", icon: CalendarRange },
  { href: "/app/marketing/pipeline", label: "Board", icon: ListChecks },
  { href: "/app/marketing/calendar", label: "Social", icon: Share2 },
  { href: "/app/marketing/queue", label: "Queue", icon: Zap },
];

export function CalendarViewSwitcher({ className }: { className?: string }) {
  const [location] = useLocation();
  const current = location.split("?")[0];

  return (
    <div
      className={cn("inline-flex items-center rounded-lg border bg-muted/40 p-0.5", className)}
      role="tablist"
      aria-label="Calendar views"
      data-testid="calendar-view-switcher"
    >
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
            data-testid={`calendar-view-${v.label.toLowerCase()}`}
          >
            <Icon className="h-3.5 w-3.5" /> {v.label}
          </Link>
        );
      })}
    </div>
  );
}
