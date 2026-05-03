import { useEffect, useRef, useState } from "react";

export interface JobProgress {
  percent?: number;
  phase?: string;
  currentItem?: number;
  totalItems?: number;
  currentItemName?: string;
}

export interface JobStatus {
  status: "active" | "pending" | "not_found";
  progress?: JobProgress;
  runningSec?: number;
  queuePosition?: number;
  pendingAhead?: number;
  type?: string;
}

/**
 * Polls /api/queue/job-status?label=<labelPrefix> while `enabled` is true.
 * Returns the latest status snapshot. Used by long-running export buttons
 * (PDF generation, etc.) to flip between "Queued" / "Generating" labels.
 */
export function useJobStatus(labelPrefix: string | null, enabled: boolean, intervalMs: number = 1500): JobStatus | null {
  const [status, setStatus] = useState<JobStatus | null>(null);
  const lastEnabled = useRef(enabled);

  useEffect(() => {
    // Reset state when polling toggles off so the next run starts fresh.
    if (lastEnabled.current && !enabled) {
      setStatus(null);
    }
    lastEnabled.current = enabled;

    if (!enabled || !labelPrefix) return;

    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const res = await fetch(
          `/api/queue/job-status?label=${encodeURIComponent(labelPrefix)}`,
          { credentials: "include" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as JobStatus;
        if (!cancelled) setStatus(data);
      } catch {
        // Silently retry — polling will continue.
      }
    };

    void fetchStatus();
    const id = setInterval(fetchStatus, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [labelPrefix, enabled, intervalMs]);

  return status;
}

/** Convert a JobStatus into a human-readable export button label. */
export function jobStatusLabel(status: JobStatus | null, fallback: string = "Working…"): string {
  if (!status) return fallback;
  if (status.status === "pending") {
    if (typeof status.pendingAhead === "number" && status.pendingAhead > 0) {
      return `Queued (${status.pendingAhead} ahead)`;
    }
    return "Queued";
  }
  if (status.status === "active") {
    const percent = status.progress?.percent;
    const phase = status.progress?.phase;
    const pct = typeof percent === "number" ? `Generating ${Math.round(percent)}%` : "Generating";
    if (phase) return `${pct} — ${phase}`;
    return pct;
  }
  return fallback;
}
