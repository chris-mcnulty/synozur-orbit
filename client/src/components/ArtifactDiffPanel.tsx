import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, RotateCcw, GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";

interface ArtifactDiffPanelProps {
  /** The type of artifact (for display) */
  artifactType: "analysis" | "battlecard";
  /** The artifact ID for rollback API calls */
  artifactId: string;
  /** Whether previous content exists */
  hasPreviousContent: boolean;
  /** Timestamp of the latest regeneration (ISO string or Date) */
  updatedAt?: string | Date | null;
  /** Callback after successful rollback */
  onRollback?: () => void;
  /** Optional className */
  className?: string;
}

/**
 * UX3 — AI Artefact Diff View
 *
 * Displays an "Updated / What changed?" banner when an analysis or battlecard
 * has been regenerated. Shows a toggleable detail panel and a "Keep previous"
 * rollback button.
 */
export default function ArtifactDiffPanel({
  artifactType,
  artifactId,
  hasPreviousContent,
  updatedAt,
  onRollback,
  className,
}: ArtifactDiffPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [rolling, setRolling] = useState(false);

  if (!hasPreviousContent) return null;

  const formattedDate = updatedAt
    ? new Date(updatedAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "recently";

  const handleRollback = async () => {
    if (rolling) return;
    setRolling(true);
    try {
      const endpoint =
        artifactType === "analysis"
          ? "/api/analysis/rollback"
          : `/api/battlecards/${artifactId}/rollback`;
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(artifactType === "analysis" ? { analysisId: artifactId } : {}),
      });
      if (!res.ok) {
        console.error("Rollback failed:", await res.text());
      } else {
        onRollback?.();
      }
    } catch (err) {
      console.error("Rollback error:", err);
    } finally {
      setRolling(false);
    }
  };

  return (
    <div
      className={cn(
        "border border-amber-500/30 bg-amber-500/5 rounded-lg overflow-hidden",
        className
      )}
    >
      {/* Banner */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-amber-500/10 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <GitCompare className="w-4 h-4 text-amber-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
            Updated {formattedDate}
          </span>
          <span className="text-xs text-muted-foreground ml-2">
            — What changed?
          </span>
        </div>
        <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">
          New version
        </Badge>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-amber-500/20">
          <p className="text-sm text-muted-foreground pt-3">
            This {artifactType === "analysis" ? "analysis" : "battlecard"} was
            regenerated with updated competitor data. The previous version has
            been preserved.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
              onClick={handleRollback}
              disabled={rolling}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              {rolling ? "Rolling back..." : "Keep previous version"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
