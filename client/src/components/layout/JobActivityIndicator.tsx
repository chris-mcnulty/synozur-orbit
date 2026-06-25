import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, CheckCircle2, XCircle, Clock, Activity, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Job {
  id: string;
  jobType: string;
  status: "pending" | "running" | "completed" | "failed" | string;
  targetName?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

const JOB_LABELS: Record<string, string> = {
  websiteCrawl: "Website crawl",
  socialMonitor: "Social monitor",
  websiteMonitor: "Website monitor",
  productMonitor: "Product monitor",
  fullRegeneration: "Full regeneration",
};

const jobLabel = (t: string) => JOB_LABELS[t] ?? t;
const isActive = (s: string) => s === "running" || s === "pending";

function statusIcon(status: string) {
  if (status === "running") return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
  if (status === "completed") return <CheckCircle2 className="w-4 h-4 text-green-500" />;
  if (status === "failed") return <XCircle className="w-4 h-4 text-destructive" />;
  return <Clock className="w-4 h-4 text-muted-foreground" />;
}

/**
 * Global background-job indicator for the header. Surfaces the work Orbit is
 * doing asynchronously (crawls, monitors, regenerations) so users don't have
 * to keep re-checking, and toasts the moment a job finishes. Reads the same
 * /api/jobs/recent feed the Intelligence Health page uses.
 */
export function JobActivityIndicator() {
  const { toast } = useToast();
  const seen = useRef<Map<string, string> | null>(null);

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs/recent"],
    queryFn: async () => {
      const r = await fetch("/api/jobs/recent?limit=10", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    refetchInterval: 8000,
  });

  // Notify when a job we last saw as active finishes. Seed the map on first
  // load (ref starts null) so we don't toast jobs that were already done.
  useEffect(() => {
    const prev = seen.current;
    const next = new Map<string, string>();
    for (const j of jobs) next.set(j.id, j.status);
    if (prev) {
      for (const j of jobs) {
        if (isActive(prev.get(j.id) ?? "") && !isActive(j.status)) {
          if (j.status === "completed") {
            toast({ title: `${jobLabel(j.jobType)} finished`, description: j.targetName ?? undefined });
          } else if (j.status === "failed") {
            toast({ title: `${jobLabel(j.jobType)} failed`, description: j.targetName ?? "Open Intelligence Health to retry.", variant: "destructive" });
          }
        }
      }
    }
    seen.current = next;
  }, [jobs, toast]);

  const inFlight = jobs.filter((j) => isActive(j.status)).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label={inFlight > 0 ? `${inFlight} background job${inFlight === 1 ? "" : "s"} running` : "Background jobs"}
          data-testid="job-activity-trigger"
        >
          {inFlight > 0 ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Activity size={18} />}
          {inFlight > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center"
              data-testid="job-activity-count"
            >
              {inFlight}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b">
          <span className="text-sm font-semibold">Background jobs</span>
          {inFlight > 0 && <Badge variant="secondary" className="text-[10px]">{inFlight} running</Badge>}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {jobs.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No recent jobs.</p>
          ) : (
            jobs.map((j) => (
              <div
                key={j.id}
                className={cn("flex items-center gap-2.5 px-3 py-2 border-b last:border-b-0", isActive(j.status) && "bg-muted/40")}
                data-testid={`job-row-${j.id}`}
              >
                {statusIcon(j.status)}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{jobLabel(j.jobType)}</div>
                  {j.targetName && <div className="text-xs text-muted-foreground truncate">{j.targetName}</div>}
                </div>
                {j.completedAt && (
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(j.completedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
        <Link
          href="/app/refresh-center"
          className="flex items-center justify-between px-3 py-2.5 border-t text-xs font-medium text-primary hover:bg-muted/40"
          data-testid="job-activity-view-all"
        >
          Intelligence Health <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </PopoverContent>
    </Popover>
  );
}
