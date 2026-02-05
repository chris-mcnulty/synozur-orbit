import React from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { getFullStalenessInfo, type StalenessLevel } from "@/lib/staleness";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface StalenessDotProps {
  lastUpdated: string | Date | null | undefined;
  label?: string;
  showLabel?: boolean;
  showTime?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export default function StalenessDot({
  lastUpdated,
  label,
  showLabel = false,
  showTime = false,
  size = "md",
  className,
}: StalenessDotProps) {
  const staleness = getFullStalenessInfo(lastUpdated);
  
  const sizeClasses = {
    sm: "w-2 h-2",
    md: "w-2.5 h-2.5",
    lg: "w-3 h-3",
  };
  
  const iconSizeClasses = {
    sm: "w-3 h-3",
    md: "w-3.5 h-3.5",
    lg: "w-4 h-4",
  };
  
  const content = (
    <div className={cn("flex items-center gap-1.5", className)}>
      <div className={cn(
        "rounded-full flex-shrink-0",
        sizeClasses[size],
        staleness.dotColor,
        staleness.level !== "never" && "animate-pulse"
      )} />
      {showLabel && (
        <span className={cn("text-xs", staleness.color)}>
          {staleness.label}
        </span>
      )}
      {showTime && lastUpdated && (
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className={iconSizeClasses[size]} />
          {staleness.timeAgo}
        </span>
      )}
    </div>
  );
  
  if (label) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="cursor-help">
              {content}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs space-y-1">
              <p className="font-medium">{label}</p>
              <p className={staleness.color}>{staleness.label}</p>
              {lastUpdated && (
                <p className="text-muted-foreground">Last updated: {staleness.timeAgo}</p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  
  return content;
}
