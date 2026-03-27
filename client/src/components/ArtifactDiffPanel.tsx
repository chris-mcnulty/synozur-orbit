import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";

interface ArtifactDiffPanelProps {
  /** Whether there is a previous version to compare */
  hasPreviousVersion: boolean;
  /** Called when user wants to view the diff */
  onViewDiff?: () => void;
  /** Called when user wants to roll back */
  onRollback?: () => void;
  /** Whether rollback is in progress */
  isRollingBack?: boolean;
  /** Human-readable summary of what changed, or null if not computed */
  changeSummary?: string | null;
}

export default function ArtifactDiffPanel({
  hasPreviousVersion,
  onViewDiff,
  onRollback,
  isRollingBack,
  changeSummary,
}: ArtifactDiffPanelProps) {
  const [open, setOpen] = useState(false);

  if (!hasPreviousVersion) return null;

  return (
    <div className="border border-blue-500/20 rounded-lg bg-blue-500/5 p-3 mt-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-blue-400 border-blue-400/30 text-xs">
            Updated
          </Badge>
          <span className="text-sm text-muted-foreground">
            {changeSummary ?? "A previous version is available for comparison."}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-blue-400 hover:text-blue-300"
            onClick={() => { setOpen(v => !v); onViewDiff?.(); }}
          >
            {open ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
            {open ? "Hide diff" : "What changed?"}
          </Button>
          {onRollback && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-amber-400 hover:text-amber-300"
              onClick={onRollback}
              disabled={isRollingBack}
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              {isRollingBack ? "Reverting…" : "Keep previous"}
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-blue-500/20 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground mb-2">Regeneration comparison</p>
          <p>The content above reflects the latest AI generation. The previous version has been stored and can be restored using "Keep previous".</p>
          <p className="text-blue-400/70 mt-2 italic">Tip: Use "Keep previous" if the new output is not an improvement, or run analysis again with updated data sources.</p>
        </div>
      )}
    </div>
  );
}
