import { useMemo, useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getTabMarketId, getTabTenantId } from "@/lib/tabContext";
import { format, isToday, isTomorrow, isPast } from "date-fns";
import {
  Zap,
  CheckCircle2,
  AlertCircle,
  FileDown,
  Calendar,
  ListChecks,
  Trash2,
  X,
  RefreshCw,
  Loader2,
  WrenchIcon,
  Pause,
  Play,
  PauseCircle,
  ExternalLink,
  Clock,
  ImageOff,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { CalendarViewSwitcher } from "@/components/marketing/CalendarViewSwitcher";
import { Button } from "@/components/ui/button";
import EmptyPageState from "@/components/EmptyPageState";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import SocialPostEditor from "@/components/marketing/SocialPostEditor";
import { Badge } from "@/components/ui/badge";
import { postingQueueStage as queueStage, type PostingQueueStage as Stage } from "@/lib/posting-queue-stage";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  leadImageUrl: string | null;
  overrideImageUrl?: string | null;
  publishClaimToken: string | null;
}

interface SocialAccount {
  id: string;
  platform: string;
  accountName: string;
  status: string;
  publishingPaused: boolean;
  hasAccessToken: boolean;
}

interface CarouselSlide {
  index: number;
  role: "cover" | "body" | "close";
  kicker?: string | null;
  headline: string;
  supportingLines: string[];
  imageUrl?: string | null;
}

interface FullPost {
  id: string;
  platform: string;
  content: string | null;
  editedContent: string | null;
  publishError: string | null;
  status: string;
  postFormat: string | null;
  scheduledDate: string | null;
  overrideImageUrl: string | null;
  leadImageUrl: string | null;
  carouselSlides: CarouselSlide[] | null;
  campaignId: string | null;
  socialAccountId: string | null;
  exactSchedule: boolean;
  publishNotBefore: string | null;
}

type QueueFilter = "current" | "all" | Stage;

const CURRENT_STAGES: Stage[] = ["failed", "missed", "scheduled"];

const STAGE_META: Record<Stage, { label: string; cls: string; Icon: typeof Zap }> = {
  scheduled: { label: "Orbit-scheduled", cls: "text-emerald-600 dark:text-emerald-400", Icon: Zap },
  failed: { label: "Post failed", cls: "text-destructive", Icon: AlertCircle },
  missed: { label: "Missed — needs review", cls: "text-amber-600 dark:text-amber-400", Icon: Clock },
  posted: { label: "Posted via Orbit", cls: "text-green-600 dark:text-green-400", Icon: CheckCircle2 },
  exported: { label: "Exported to CSV", cls: "text-blue-600 dark:text-blue-400", Icon: FileDown },
  awaiting_export: { label: "Export only — import not confirmed", cls: "text-blue-600 dark:text-blue-400", Icon: FileDown },
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

function postTime(p: CalendarPost): Date | null {
  // A retry keeps its original scheduledDate for audit/history, but once the
  // platform accepts it, publishedAt is the timestamp users need to see.
  const t = p.publishedAt ?? p.scheduledDate;
  return t ? new Date(t) : null;
}

function isCancellable(post: CalendarPost): boolean {
  return ["approved", "draft", "missed", "publish_failed"].includes(post.status) &&
    !post.publishedAt && !post.publishClaimToken;
}

function dayKey(d: Date) {
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  return format(d, "EEEE · MMM d");
}

const FILTERS: { key: QueueFilter; label: string }[] = [
  { key: "current", label: "Current" },
  { key: "scheduled", label: "Scheduled" },
  { key: "missed", label: "Missed" },
  { key: "failed", label: "Failed" },
  { key: "posted", label: "Posted" },
  { key: "exported", label: "Exported" },
  { key: "awaiting_export", label: "Export only" },
  { key: "all", label: "All in window" },
];

// ── Account Pause Panel ─────────────────────────────────────────────────────

function AccountPausePanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: accounts = [], isLoading } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts", getTabMarketId()],
    queryFn: async () => {
      const r = await fetch("/api/social-accounts", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const connected = accounts.filter((a) => a.hasAccessToken && a.status === "active");

  const togglePause = useMutation({
    mutationFn: async ({ id, pause }: { id: string; pause: boolean }) => {
      const r = await fetch(`/api/social-accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ publishingPaused: pause }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Update failed");
      return r.json() as Promise<SocialAccount>;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      toast({
        title: updated.publishingPaused ? "Auto-posting paused" : "Auto-posting resumed",
        description: `${updated.accountName} — ${updated.publishingPaused ? "no posts will be sent until you resume" : "worker will pick up scheduled posts again"}`,
      });
    },
    onError: (err: Error) =>
      toast({ title: "Couldn't update account", description: err.message, variant: "destructive" }),
  });

  if (isLoading || connected.length === 0) return null;

  const anyPaused = connected.some((a) => a.publishingPaused);

  return (
    <div className={cn(
      "rounded-lg border px-4 py-3",
      anyPaused ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-card",
    )}>
      <div className="flex items-center gap-2 mb-2">
        <PauseCircle className={cn("w-4 h-4", anyPaused ? "text-amber-500" : "text-muted-foreground")} />
        <span className="text-sm font-medium">Auto-posting accounts</span>
        {anyPaused && (
          <Badge variant="outline" className="text-amber-600 border-amber-500/40 text-[10px]">
            Paused
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {connected.map((acct) => {
          const pm = platformOf(acct.platform);
          const isPaused = acct.publishingPaused;
          return (
            <button
              key={acct.id}
              type="button"
              onClick={() => togglePause.mutate({ id: acct.id, pause: !isPaused })}
              disabled={togglePause.isPending}
              title={isPaused ? "Resume auto-posting" : "Pause auto-posting"}
              data-testid={`pause-account-${acct.id}`}
              className={cn(
                "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
                isPaused
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20"
                  : "border-border bg-background hover:bg-muted text-foreground",
              )}
            >
              <span
                className="inline-grid place-items-center w-4 h-4 rounded text-[9px] font-bold text-white shrink-0"
                style={{ background: pm.bg }}
                aria-hidden
              >
                {pm.glyph}
              </span>
              <span className="max-w-[160px] truncate">{acct.accountName}</span>
              {isPaused ? (
                <><Pause className="w-3 h-3 fill-current" /><span className="text-[10px] font-semibold uppercase tracking-wide">Paused</span></>
              ) : (
                <Play className="w-3 h-3 text-muted-foreground" />
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">
        Click an account to pause or resume its auto-posting. Paused accounts won't send until you resume them.
      </p>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function QueuePage() {
  const [filter, setFilter] = useState<QueueFilter>("current");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [imageErrors, setImageErrors] = useState<Set<string>>(() => new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editPost, setEditPost] = useState<CalendarPost | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const marketId = getTabMarketId();
  const tenantId = getTabTenantId();

  useEffect(() => {
    setSelectedIds([]);
  }, [campaignFilter, filter, marketId, tenantId]);

  // Deep-link: ?postId=<id> navigates here from the pipeline board and opens
  // that specific post's edit dialog directly — even if it's outside the
  // normal calendar window (e.g. an old May post).
  const deepLinkPostId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("postId");
  }, []);

  const { data: deepLinkPost } = useQuery<CalendarPost | null>({
    queryKey: ["/api/generated-posts", deepLinkPostId],
    queryFn: async () => {
      const r = await fetch(`/api/generated-posts/${deepLinkPostId}`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!deepLinkPostId,
  });

  useEffect(() => {
    if (deepLinkPost && !editPost) {
      setEditPost(deepLinkPost);
      // Clean the ?postId= param from the URL without a page reload.
      window.history.replaceState(null, "", "/app/marketing/queue");
    }
  }, [deepLinkPost]);

  const { data: posts = [], isLoading } = useQuery<CalendarPost[]>({
    queryKey: ["/api/generated-posts/calendar", tenantId, marketId, "orbit-queue"],
    queryFn: async () => {
      const from = new Date();
      from.setDate(from.getDate() - 30);
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
      if (!isCancellable(post)) throw new Error("This post can no longer be cancelled from the queue.");
      const r = await fetch("/api/generated-posts/bulk-cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ postIds: [post.id] }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Couldn't cancel post.");
      return r.json() as Promise<{ cancelled: number; cancelledIds: string[]; skipped: number; skippedIds: string[] }>;
    },
    onSuccess: (result, post) => {
      queryClient.invalidateQueries({ queryKey: ["/api/generated-posts/calendar"] });
      setConfirmDeleteId(null);
      if (post.campaignId) {
        queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${post.campaignId}/generated-posts`] });
      }
      if (result.cancelled > 0) {
        toast({ title: "Post cancelled" });
      } else {
        toast({
          title: "Post wasn't cancelled",
          description: result.skipped > 0
            ? "It may already be sent or currently in flight. Its history is unchanged; refresh the queue to see its current status."
            : "The server did not cancel this post. Refresh the queue to check its current status.",
          variant: "destructive",
        });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't delete post", description: err.message, variant: "destructive" });
      setConfirmDeleteId(null);
    },
  });

  const bulkCancelMutation = useMutation({
    mutationFn: async (postIds: string[]) => {
      const r = await fetch("/api/generated-posts/bulk-cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ postIds }),
      });
      if (!r.ok) {
        const payload = await r.json().catch(() => ({}));
        throw new Error(payload.error || "Couldn't cancel selected posts. Try again.");
      }
      return r.json() as Promise<{ cancelled: number; cancelledIds: string[]; skipped: number; skippedIds: string[] }>;
    },
    onSuccess: (result, postIds) => {
      queryClient.invalidateQueries({ queryKey: ["/api/generated-posts/calendar"] });
      const affectedCampaignIds = new Set(posts
        .filter((post) => postIds.includes(post.id) && post.campaignId)
        .map((post) => post.campaignId as string));
      for (const campaignId of affectedCampaignIds) {
        queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${campaignId}/generated-posts`] });
      }
      setSelectedIds([]);
      setBulkCancelOpen(false);
      if (result.skipped > 0) {
        toast({
          title: `${result.cancelled} cancelled; ${result.skipped} skipped`,
          description: "Some posts became in-flight or were delivered before cancellation. Review the queue for their current status.",
          variant: result.cancelled === 0 ? "destructive" : "default",
        });
      } else if (result.cancelled === 0) {
        toast({
          title: "No posts cancelled",
          description: "The server did not cancel any selected posts. Refresh the queue to check their current status.",
          variant: "destructive",
        });
      } else {
        toast({ title: `${result.cancelled} ${result.cancelled === 1 ? "post" : "posts"} cancelled` });
      }
    },
    onError: (err: Error) => toast({
      title: "Couldn't cancel posts",
      description: err.message,
      variant: "destructive",
    }),
  });

  const campaigns = useMemo(() => {
    const byId = new Map<string, string>();
    for (const post of posts) {
      if (post.campaignId) byId.set(post.campaignId, post.campaignName?.trim() || "View campaign");
    }
    return Array.from(byId.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [posts]);

  const campaignPosts = useMemo(
    () => campaignFilter === "all"
      ? posts
      : posts.filter((post) => campaignFilter === "standalone" ? !post.campaignId : post.campaignId === campaignFilter),
    [campaignFilter, posts],
  );

  const items = useMemo(() => {
    const isCurrent = (stage: Stage) => CURRENT_STAGES.includes(stage);
    // Current work is ordered by urgency. Historical views are newest-first so
    // the latest published/exported activity is immediately visible.
    const currentPriority = (s: Stage) => (s === "failed" ? 0 : s === "missed" ? 1 : 2);
    return campaignPosts
      .map((p) => ({ post: p, stage: queueStage(p), when: postTime(p) }))
      .filter((x): x is { post: CalendarPost; stage: Stage; when: Date | null } => x.stage !== null)
      .sort((a, b) => {
        const at = a.when?.getTime() ?? Infinity;
        const bt = b.when?.getTime() ?? Infinity;
        if (filter === "current") {
          const pa = currentPriority(a.stage);
          const pb = currentPriority(b.stage);
          if (pa !== pb) return pa - pb;
          return at - bt;
        }
        if (filter === "all") {
          const pa = isCurrent(a.stage) ? currentPriority(a.stage) : 3;
          const pb = isCurrent(b.stage) ? currentPriority(b.stage) : 3;
          if (pa !== pb) return pa - pb;
        }
        if (filter === "posted" || filter === "exported" || filter === "all") return bt - at;
        return at - bt;
      });
  }, [filter, campaignPosts]);

  const counts = useMemo(() => {
    const c = { current: 0, all: items.length, scheduled: 0, failed: 0, missed: 0, posted: 0, exported: 0, awaiting_export: 0 } as Record<string, number>;
    for (const it of items) c[it.stage]++;
    c.current = CURRENT_STAGES.reduce((total, stage) => total + c[stage], 0);
    return c;
  }, [items]);

  const nextSend = useMemo(() => {
    const now = Date.now();
    return items
      .filter((it) => it.stage === "scheduled" && it.when && it.when.getTime() >= now)
      .sort((a, b) => (a.when!.getTime() - b.when!.getTime()))[0]?.when ?? null;
  }, [items]);

  const visible = filter === "current"
    ? items.filter((it) => CURRENT_STAGES.includes(it.stage))
    : filter === "all"
      ? items
      : items.filter((it) => it.stage === filter);
  const visibleCancellableIds = visible.filter(({ post }) => isCancellable(post)).map(({ post }) => post.id);
  const selectedVisibleIds = selectedIds.filter((id) => visibleCancellableIds.includes(id));
  const allVisibleSelected = visibleCancellableIds.length > 0 &&
    visibleCancellableIds.every((id) => selectedIds.includes(id));
  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((current) => checked
      ? current.includes(id) || current.length >= 500 ? current : [...current, id]
      : current.filter((selectedId) => selectedId !== id));
  };

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
            Current work is shown first. Click any post to edit, reschedule, or cancel it.
          </p>
          <CalendarViewSwitcher className="mt-3" />
        </div>

        {/* Per-account pause controls */}
        <AccountPausePanel />

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
        <div className="space-y-3">
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={campaignFilter} onValueChange={setCampaignFilter}>
              <SelectTrigger className="w-full min-w-[190px] sm:w-[250px]" aria-label="Filter by campaign" data-testid="queue-campaign-filter">
                <SelectValue placeholder="All campaigns" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All campaigns</SelectItem>
                <SelectItem value="standalone">Standalone</SelectItem>
                {campaigns.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
            {visibleCancellableIds.length > 0 && (
              <label className="inline-flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={allVisibleSelected ? true : selectedVisibleIds.length > 0 ? "indeterminate" : false}
                  onCheckedChange={(checked) => setSelectedIds(checked === true ? visibleCancellableIds.slice(0, 500) : [])}
                  aria-label="Select all visible cancellable posts"
                  data-testid="queue-select-all"
                />
                Select all cancellable
              </label>
            )}
          </div>
          {selectedVisibleIds.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setBulkCancelOpen(true)}
              disabled={bulkCancelMutation.isPending}
              data-testid="queue-bulk-cancel"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Cancel {selectedVisibleIds.length} selected
            </Button>
          )}
        </div>
        {visibleCancellableIds.length > 500 && (
          <p className="text-xs text-muted-foreground">Bulk cancellation is limited to 500 posts per request. Select the first 500 or narrow the queue filters.</p>
        )}
        <p className="text-xs text-muted-foreground">Up to 500 posts can be cancelled per request.</p>
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
              filter === "current"
                ? "There are no scheduled posts or items needing attention in the current window."
                : filter === "all"
                ? "When you approve and schedule posts for Orbit to publish, they'll line up here."
                : "Try a different filter to see other posts."
            }
            primaryAction={
              filter === "current" || filter === "all"
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
                          "relative grid grid-cols-[28px_56px_minmax(0,1fr)_auto] sm:grid-cols-[28px_88px_minmax(0,1fr)_auto] items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 cursor-pointer group hover:bg-muted/40 transition-colors",
                          stage === "failed" && "bg-destructive/5 hover:bg-destructive/10",
                        )}
                        data-testid={`queue-row-${post.id}`}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("button, a, [role='checkbox']")) return;
                          setEditPost(post);
                        }}
                      >
                        {stage === "failed" && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-destructive" />}

                        <div onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.includes(post.id)}
                            disabled={!isCancellable(post) || (selectedIds.length >= 500 && !selectedIds.includes(post.id))}
                            onCheckedChange={(checked) => toggleSelected(post.id, checked === true)}
                            aria-label={`Select post${post.campaignName ? ` from ${post.campaignName}` : ""} for cancellation`}
                            title={isCancellable(post) ? "Select for cancellation" : "This post is published, exported, or currently being processed"}
                            data-testid={`queue-select-${post.id}`}
                          />
                        </div>

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

                        <div className="min-w-0 flex items-center gap-3">
                          {(() => {
                            const thumbnailUrl = post.leadImageUrl || post.overrideImageUrl || null;
                            return thumbnailUrl ? (
                              imageErrors.has(post.id) ? (
                                <div className="w-11 h-11 shrink-0 rounded-md border bg-muted flex flex-col items-center justify-center text-[8px] leading-tight text-muted-foreground" aria-label="Image unavailable">
                                  <ImageOff className="w-3.5 h-3.5 mb-0.5" />
                                  <span>Unavailable</span>
                                </div>
                              ) : (
                                <img
                                  src={thumbnailUrl}
                                  alt=""
                                  className="w-11 h-11 shrink-0 rounded-md border object-cover bg-muted"
                                  onError={() => setImageErrors((current) => new Set(current).add(post.id))}
                                />
                              )
                            ) : (
                              <div className="w-11 h-11 shrink-0 rounded-md border border-dashed bg-muted/50 flex flex-col items-center justify-center text-[8px] leading-tight text-muted-foreground" aria-label="Text-only post">
                                <ImageOff className="w-3.5 h-3.5 mb-0.5" />
                                <span>Text only</span>
                              </div>
                            );
                          })()}
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
                              {post.campaignId ? (
                                <Link
                                  href={`/app/marketing/campaigns/${post.campaignId}`}
                                  className="inline-flex max-w-[180px] items-center gap-1 rounded bg-primary/10 px-1 font-semibold text-primary"
                                  onClick={(e) => e.stopPropagation()}
                                  title={post.campaignName || "View campaign"}
                                  data-testid={`queue-campaign-link-${post.id}`}
                                >
                                  <span className="truncate">{post.campaignName?.trim() || "View campaign"}</span>
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                </Link>
                              ) : (
                                <span className="font-medium text-foreground">Standalone post</span>
                              )}
                            </span>
                          </div>
                          <p className="text-sm truncate">{post.preview || "(no content)"}</p>
                          {stage === "failed" && post.publishError && (
                            <p className="text-xs text-destructive mt-0.5 truncate">{post.publishError}</p>
                          )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                          {isConfirming ? (
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 px-2 text-xs"
                                onClick={() => deletePostMutation.mutate(post)}
                                disabled={deletePostMutation.isPending || !isCancellable(post)}
                                data-testid={`queue-delete-confirm-${post.id}`}
                              >
                                Cancel
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
                              className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => setConfirmDeleteId(post.id)}
                              disabled={!isCancellable(post)}
                              title={isCancellable(post) ? "Cancel this post" : "This post cannot be cancelled"}
                              data-testid={`queue-delete-${post.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <span className={cn("hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold", sm.cls)}>
                            <sm.Icon className="w-3.5 h-3.5" />
                            {sm.label}
                          </span>
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

      <AlertDialog open={bulkCancelOpen} onOpenChange={setBulkCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancel {selectedVisibleIds.length} selected {selectedVisibleIds.length === 1 ? "post" : "posts"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes unsent posts from the queue. It preserves post history and cannot recall CSV exports or posts that have already been sent. Posts currently in flight or delivered may be skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkCancelMutation.isPending}>Keep posts</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (selectedVisibleIds.length > 0 && selectedVisibleIds.length <= 500) {
                  bulkCancelMutation.mutate(selectedVisibleIds);
                }
              }}
              disabled={bulkCancelMutation.isPending || selectedVisibleIds.length === 0 || selectedVisibleIds.length > 500}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="queue-bulk-cancel-confirm"
            >
              {bulkCancelMutation.isPending ? "Cancelling…" : `Cancel ${selectedVisibleIds.length} posts`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Shared post editor (same component as calendar/campaign/pipeline) */}
      {editPost && (
        <SocialPostEditor
          postId={editPost.id}
          campaignName={editPost.campaignName}
          onClose={() => setEditPost(null)}
        />
      )}
    </AppLayout>
  );
}
