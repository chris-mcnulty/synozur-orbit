/**
 * ActionCostTooltip
 *
 * Wraps any trigger element (usually a Button) and shows a tooltip that
 * communicates the estimated duration and nature of the action before the user
 * commits to it.  For batch operations the tooltip also surfaces how many
 * items are affected via the `itemCount` prop.
 *
 * Usage:
 *   <ActionCostTooltip jobType="crawl" itemCount={competitors.length}>
 *     <Button onClick={handleRefreshAll}>Refresh All</Button>
 *   </ActionCostTooltip>
 */

import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Clock, Zap, AlertCircle, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Job type metadata — typical duration estimates (in seconds) per job type.
// These are conservative upper bounds to set expectations correctly.
// ---------------------------------------------------------------------------

type JobType = "crawl" | "monitor" | "pdf" | "analysis" | "refresh" | "social";

interface JobMeta {
  label: string;
  estimatedSec: number; // per-item estimate
  usesAI: boolean;
  icon: React.ReactNode;
  color: string;
}

const JOB_META: Record<JobType, JobMeta> = {
  crawl: {
    label: "Website crawl",
    estimatedSec: 45,
    usesAI: false,
    icon: <Clock className="h-3 w-3" />,
    color: "text-blue-400",
  },
  monitor: {
    label: "Change monitoring",
    estimatedSec: 30,
    usesAI: true,
    icon: <Cpu className="h-3 w-3" />,
    color: "text-purple-400",
  },
  social: {
    label: "Social media scan",
    estimatedSec: 20,
    usesAI: true,
    icon: <Zap className="h-3 w-3" />,
    color: "text-cyan-400",
  },
  analysis: {
    label: "AI analysis",
    estimatedSec: 60,
    usesAI: true,
    icon: <Cpu className="h-3 w-3" />,
    color: "text-amber-400",
  },
  pdf: {
    label: "PDF generation",
    estimatedSec: 20,
    usesAI: false,
    icon: <Clock className="h-3 w-3" />,
    color: "text-green-400",
  },
  refresh: {
    label: "Data refresh",
    estimatedSec: 45,
    usesAI: false,
    icon: <Clock className="h-3 w-3" />,
    color: "text-blue-400",
  },
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  const minutes = Math.ceil(seconds / 60);
  return `~${minutes} min`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ActionCostTooltipProps {
  /** The type of background operation that will be triggered. */
  jobType: JobType;
  /** Number of items that will be processed; defaults to 1. */
  itemCount?: number;
  /** Custom override for the tooltip title. */
  title?: string;
  /** Additional human-readable note shown below the estimate. */
  note?: string;
  /** Tooltip placement (default: "top"). */
  side?: "top" | "right" | "bottom" | "left";
  children: React.ReactNode;
  /** When true the tooltip is suppressed (e.g. when the button is already loading). */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActionCostTooltip({
  jobType,
  itemCount = 1,
  title,
  note,
  side = "top",
  children,
  disabled = false,
}: ActionCostTooltipProps) {
  const meta = JOB_META[jobType];
  const totalSec = meta.estimatedSec * itemCount;

  if (disabled) return <>{children}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        className="max-w-[240px] p-0 overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b border-border">
          <span className={cn("flex-shrink-0", meta.color)}>{meta.icon}</span>
          <span className="text-xs font-semibold text-foreground">
            {title || meta.label}
          </span>
        </div>

        {/* Details */}
        <div className="px-3 py-2 space-y-1.5">
          {/* Duration estimate */}
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-muted-foreground">Estimated time</span>
            <span className="text-xs font-medium text-foreground">
              {formatDuration(totalSec)}
            </span>
          </div>

          {/* Items affected */}
          {itemCount > 1 && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-muted-foreground">Items affected</span>
              <span className="text-xs font-medium text-foreground">{itemCount}</span>
            </div>
          )}

          {/* AI credit usage */}
          {meta.usesAI && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <Zap className="h-3 w-3 text-amber-400 flex-shrink-0" />
              <span className="text-xs text-amber-400">Uses AI credits</span>
            </div>
          )}

          {/* Optional note */}
          {note && (
            <div className="flex items-start gap-1.5 mt-0.5">
              <AlertCircle className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-0.5" />
              <span className="text-xs text-muted-foreground">{note}</span>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
