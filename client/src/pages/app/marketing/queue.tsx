import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, isToday, isTomorrow, isPast } from "date-fns";
import {
  Zap,
  CheckCircle2,
  AlertCircle,
  FileDown,
  Calendar,
  ArrowRight,
  ListChecks,
  Trash2,
  X,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { CalendarViewSwitcher } from "@/components/marketing/CalendarViewSwitcher";
import { Button } from "@/components/ui/button";
import EmptyPageState from "@/components/EmptyPageState";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// One row per Orbit-managed post, from /api/generated-posts/calendar.
interface CalendarPost {
  id: string;
  platform: string;
  preview: string;
  scheduledDate: string | null;
  publishedAt: string | null;
  status: string;
  socialAccountId: string | null;
  accountName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  deliveryMode: string | null;
  publishError: string | null;
}

type Stage = "scheduled" | "failed" | "posted" | "exported";

// Map a post onto a queue stage, following the same precedence the campaign
// view uses. Posts Orbit doesn't manage (drafts, needs-a-date, rejected) and
// rows we can't place return null and drop out of the queue.
function queueStage(p: CalendarPost): Stage | null {
  if (p.status === "publish_failed" || p.publishError) return "failed";
  if (p.publishedAt || p.status === "published") return "posted";
  if (p.status === "exported" || p.status === "scheduled_external") return "exported";
  if (p.status === "approved" && p.scheduledDate) {
    return p.deliveryMode === "csv" ? "exported" : "scheduled";
  }
  return null;
}

const STAGE_META: Record<Stage, { label: string; cls: string; Icon: typeof Zap }> = {
  scheduled: { label: "Orbit-scheduled", cls: "text-emerald-600 dark:text-emerald-400", Icon: Zap },
  failed: { label: "Post failed", cls: "text-destructive", Icon: AlertCircle },
  posted: { label: "Posted via Orbit", cls: "text-green-600 dark:text-green-400", Icon: CheckCircle2 },
  exported: { label: "Exported to CSV", cls: "text-blue-600 dark:text-blue-400", Icon: FileDown },
};

const PLATFORM_META: Record<string, { label: string; glyph: string; bg: string }> = {
  linkedin: { label: "LinkedIn", glyph: "in", bg: "#0a66c2" },
  x: { label: "X", glyph: "𝕏", bg: "#111111" },
  twitter: { label: "X", glyph: "𝕏", bg: "#111111" },
  instagram: { label: "Instagram", glyph: "◎", bg: "#c13584" },
  facebook: { label: "Facebook", glyph: "f", bg: "#1877f2" },
};

function platformOf(platform: string) {
  return PLATFORM_META[platform?.toLowerCase()] ?? { label: platform || "Social", glyph: "•", bg: "#475569" };
}

// The time a row sorts and groups by: when it's going out, or when it went out.
function postTime(p: CalendarPost): Date | null {
  const t = p.scheduledDate ?? p.publishedAt;
  return t ? new Date(t) : null;
}

function dayKey(d: Date) {
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  return format(d, "EEEE · MMM d");
}

// Where to go to act on a row. Failed/scheduled posts open in their campaign's
// Social Posts tab (the existing place to retry, reschedule, or reconnect);
// standalone posts open the Social Calendar.
function actionHref(p: CalendarPost) {
  if (p.campaignId) return `/app/marketing/campaigns/${p.campaignId}#posts`;
  return "/app/marketing/calendar";
}

const FILTERS: { key: "all" | Stage; label: string }[] = [
  { key: "all", label: "All" },
  { key: "scheduled", label: "Scheduled" },
  { key: "failed", label: "Needs attention" },
  { key: "posted", label: "Posted" },
  { key: "exported", label: "Exported" },
];

export default function QueuePage() {
  const [filter, setFilter] = useState<"all" | Stage>("all");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: posts = [], isLoading } = useQuery<CalendarPost[]>({
    queryKey: ["/api/generated-posts/calendar", "orbit-queue"],
    queryFn: async () => {
      const from = new Date();
      from.setDate(from.getDate() - 14);
      const to = new Date();
      to.setDate(to.getDate() + 90);
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
        includeUnscheduled: "true",
      });
      const r = await fetch(`/api/generated-posts/calendar?${params}`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const deletePostMutation = useMutation({
    mutationFn: async (post: CalendarPost) => {
      const url = post.campaignId
        ? `/api/campaigns/${post.campaignId}/generated-posts/${post.id}`
        : `/api/generated-posts/${post.id}`;
      const r = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "deleted" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/generated-posts/calendar"] });
      setConfirmDeleteId(null);
      toast({ title: "Post deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't delete post", description: err.message, variant: "destructive" });
      setConfirmDeleteId(null);
    },
  });

  // Stage every post, drop the ones Orbit isn't managing, sort by time.
  const items = useMemo(() => {
    return posts
      .map((p) => ({ post: p, stage: queueStage(p), when: postTime(p) }))
      .filter((x): x is { post: CalendarPost; stage: Stage; when: Date | null } => x.stage !== null)
      .sort((a, b) => {
        // Failures first, then by send time (soonest first; undated last).
        if (a.stage === "failed" && b.stage !== "failed") return -1;
        if (b.stage === "failed" && a.stage !== "failed") return 1;
        const at = a.when?.getTime() ?? Infinity;
        const bt = b.when?.getTime() ?? Infinity;
        return at - bt;
      });
  }, [posts]);

  const counts = useMemo(() => {
    const c = { all: items.length, scheduled: 0, failed: 0, posted: 0, exported: 0 } as Record<string, number>;
    for (const it of items) c[it.stage]++;
    return c;
  }, [items]);

  const nextSend = useMemo(() => {
    const now = Date.now();
    return items
      .filter((it) => it.stage === "scheduled" && it.when && it.when.getTime() >= now)
      .sort((a, b) => (a.when!.getTime() - b.when!.getTime()))[0]?.when ?? null;
  }, [items]);

  const visible = filter === "all" ? items : items.filter((it) => it.stage === filter);

  // Group visible rows by day for scannable headers.
  const groups = useMemo(() => {
    const map = new Map<string, typeof visible>();
    for (const it of visible) {
      const key = it.when ? dayKey(it.when) : "No date set";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries());
  }, [visible]);

  return (
    <AppLayout breadcrumbs={[{ label: "Marketing", href: "/app/marketing" }, { label: "Posting Queue" }]}>
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ListChecks className="w-6 h-6" /> Posting Queue
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Everything Orbit is publishing for you, across all campaigns — sorted by send time, with failures first.
          </p>
          <CalendarViewSwitcher className="mt-3" />
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-3 divide-x divide-border rounded-lg border bg-card">
          <div className="px-5 py-4">
            <div className="text-2xl font-bold tabular-nums">{counts.scheduled}</div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">In queue</div>
          </div>
          <div className="px-5 py-4">
            <div className="text-2xl font-bold tabular-nums">{nextSend ? format(nextSend, "MMM d, HH:mm") : "—"}</div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">Next send</div>
          </div>
          <div className={cn("px-5 py-4", counts.failed > 0 && "bg-destructive/5")}>
            <div className={cn("text-2xl font-bold tabular-nums", counts.failed > 0 && "text-destructive")}>{counts.failed}</div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">Needs attention</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => {
            const n = counts[f.key] ?? 0;
            const active = filter === f.key;
            const isFail = f.key === "failed";
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? isFail
                      ? "border-destructive/50 bg-destructive/10 text-destructive"
                      : "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
                data-testid={`queue-filter-${f.key}`}
              >
                {f.label}
                <span className="text-xs tabular-nums opacity-70">{n}</span>
              </button>
            );
          })}
        </div>

        {/* Rows */}
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 rounded-lg border bg-card animate-pulse" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyPageState
            icon={<Calendar className="w-8 h-8" />}
            title={filter === "all" ? "Nothing in the queue yet" : "No posts in this view"}
            description={
              filter === "all"
                ? "When you approve and schedule posts for Orbit to publish, they'll line up here."
                : "Try a different filter to see other posts."
            }
            primaryAction={
              filter === "all"
                ? { label: "Go to Campaigns", href: "/app/marketing/campaigns" }
                : undefined
            }
          />
        ) : (
          <div className="space-y-5">
            {groups.map(([day, rows]) => (
              <div key={day}>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{day}</div>
                <div className="rounded-lg border bg-card overflow-hidden divide-y divide-border">
                  {rows.map(({ post, stage, when }) => {
                    const sm = STAGE_META[stage];
                    const pm = platformOf(post.platform);
                    const overdue = stage === "scheduled" && when && isPast(when);
                    const isConfirming = confirmDeleteId === post.id;
                    return (
                      <div
                        key={post.id}
                        className={cn(
                          "relative grid grid-cols-[88px_1fr_auto] items-center gap-3 px-4 py-3",
                          stage === "failed" && "bg-destructive/5",
                        )}
                        data-testid={`queue-row-${post.id}`}
                      >
                        {stage === "failed" && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-destructive" />}
                        <div className="text-sm font-medium tabular-nums">
                          {when ? (
                            <>
                              {format(when, "HH:mm")}
                              {overdue && <span className="block text-[10px] font-normal text-amber-600 dark:text-amber-400">overdue</span>}
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span
                              className="inline-grid place-items-center w-4 h-4 rounded text-[9px] font-bold text-white shrink-0"
                              style={{ background: pm.bg }}
                              aria-hidden
                            >
                              {pm.glyph}
                            </span>
                            <span className="text-xs text-muted-foreground truncate">
                              {pm.label}
                              {post.accountName ? ` · ${post.accountName}` : ""}
                              {" · "}
                              {post.campaignName ?? "Standalone post"}
                            </span>
                          </div>
                          <p className="text-sm truncate">{post.preview || "(no content)"}</p>
                          {stage === "failed" && post.publishError && (
                            <p className="text-xs text-destructive mt-0.5">{post.publishError}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Delete: one click to arm, second click confirms */}
                          {isConfirming ? (
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 px-2 text-xs"
                                onClick={() => deletePostMutation.mutate(post)}
                                disabled={deletePostMutation.isPending}
                                data-testid={`queue-delete-confirm-${post.id}`}
                              >
                                Delete
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => setConfirmDeleteId(null)}
                                data-testid={`queue-delete-cancel-${post.id}`}
                              >
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => setConfirmDeleteId(post.id)}
                              title="Delete this post"
                              data-testid={`queue-delete-${post.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <span className={cn("hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold", sm.cls)}>
                            <sm.Icon className="w-3.5 h-3.5" />
                            {sm.label}
                          </span>
                          {!isConfirming && (
                            <Button
                              asChild
                              size="sm"
                              variant={stage === "failed" ? "default" : "outline"}
                              className={cn(stage === "failed" && "bg-destructive hover:bg-destructive/90")}
                            >
                              <Link href={actionHref(post)} data-testid={`queue-action-${post.id}`}>
                                {stage === "failed" ? "Fix" : stage === "posted" ? "View" : "Edit"}
                                <ArrowRight className="w-3.5 h-3.5 ml-1" />
                              </Link>
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
