import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
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
  RefreshCw,
  Loader2,
  WrenchIcon,
  Pause,
  Play,
  PauseCircle,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { CalendarViewSwitcher } from "@/components/marketing/CalendarViewSwitcher";
import { Button } from "@/components/ui/button";
import EmptyPageState from "@/components/EmptyPageState";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

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
  content: string | null;
  editedContent: string | null;
  publishError: string | null;
  status: string;
  postFormat: string | null;
  carouselSlides: CarouselSlide[] | null;
  campaignId: string | null;
}

type Stage = "scheduled" | "failed" | "posted" | "exported";

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

function postTime(p: CalendarPost): Date | null {
  const t = p.scheduledDate ?? p.publishedAt;
  return t ? new Date(t) : null;
}

function dayKey(d: Date) {
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  return format(d, "EEEE · MMM d");
}

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

// ── Account Pause Panel ─────────────────────────────────────────────────────

function AccountPausePanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: accounts = [], isLoading } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
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
          const isLoading = togglePause.isPending;
          return (
            <button
              key={acct.id}
              type="button"
              onClick={() => togglePause.mutate({ id: acct.id, pause: !isPaused })}
              disabled={isLoading}
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

// ── Fix Dialog ─────────────────────────────────────────────────────────────

function FixDialog({
  postId,
  onClose,
  onResubmitted,
}: {
  postId: string;
  onClose: () => void;
  onResubmitted: () => void;
}) {
  const { toast } = useToast();
  const [editedText, setEditedText] = useState<string | null>(null);
  const [slideUrls, setSlideUrls] = useState<Record<number, string>>({});
  const [didInit, setDidInit] = useState(false);

  const { data: post, isLoading } = useQuery<FullPost>({
    queryKey: ["/api/generated-posts", postId],
    queryFn: async () => {
      const r = await fetch(`/api/generated-posts/${postId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Could not load post");
      return r.json();
    },
  });

  if (post && !didInit) {
    setEditedText(post.editedContent ?? post.content ?? "");
    const initUrls: Record<number, string> = {};
    (post.carouselSlides ?? []).forEach((s) => {
      initUrls[s.index] = s.imageUrl ?? "";
    });
    setSlideUrls(initUrls);
    setDidInit(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { editedContent: editedText };
      if (post?.postFormat === "carousel" && post.carouselSlides?.length) {
        const merged = post.carouselSlides.map((s) => ({
          ...s,
          imageUrl: slideUrls[s.index] !== undefined ? slideUrls[s.index] : s.imageUrl,
        }));
        body.carouselSlides = merged;
      }
      const r = await fetch(`/api/generated-posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Save failed");
      return r.json();
    },
    onSuccess: () => toast({ title: "Edits saved" }),
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const resubmitMutation = useMutation({
    mutationFn: async () => {
      const original = post?.editedContent ?? post?.content ?? "";
      const textChanged = editedText !== null && editedText !== original;
      const hasSlideChanges = post?.postFormat === "carousel" &&
        post?.carouselSlides?.some((s) => slideUrls[s.index] !== undefined && slideUrls[s.index] !== (s.imageUrl ?? ""));

      if (textChanged || hasSlideChanges) {
        const saveBody: Record<string, unknown> = { editedContent: editedText };
        if (post?.postFormat === "carousel" && post.carouselSlides?.length) {
          saveBody.carouselSlides = post.carouselSlides.map((s) => ({
            ...s,
            imageUrl: slideUrls[s.index] !== undefined ? slideUrls[s.index] : s.imageUrl,
          }));
        }
        const saveRes = await fetch(`/api/generated-posts/${postId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(saveBody),
        });
        if (!saveRes.ok) throw new Error((await saveRes.json().catch(() => ({}))).error || "Save failed");
      }

      const r = await fetch(`/api/generated-posts/${postId}/publish`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Resubmit failed");
      return r.json() as Promise<{ publishedUrl?: string }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Resubmitted!",
        description: data.publishedUrl ? `Live at ${data.publishedUrl}` : "Post sent for publishing.",
      });
      onResubmitted();
    },
    onError: (err: Error) =>
      toast({ title: "Resubmit failed", description: err.message, variant: "destructive" }),
  });

  const isCarousel = post?.postFormat === "carousel";
  const slides = post?.carouselSlides ?? [];
  const isBusy = saveMutation.isPending || resubmitMutation.isPending;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WrenchIcon className="w-4 h-4 text-destructive" />
            Fix failed post
          </DialogTitle>
          <DialogDescription>
            Edit the post content below, then resubmit to try publishing again.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : post ? (
          <div className="space-y-4">
            {post.publishError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-destructive">Why it failed</p>
                    <p className="text-destructive/80 mt-0.5 font-mono text-xs break-all">{post.publishError}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="fix-post-content">Post text</Label>
              <Textarea
                id="fix-post-content"
                value={editedText ?? ""}
                onChange={(e) => setEditedText(e.target.value)}
                rows={8}
                className="resize-y font-mono text-sm"
                data-testid="fix-dialog-content"
                disabled={isBusy}
              />
            </div>

            {isCarousel && slides.length > 0 && (
              <div className="space-y-2">
                <Label>Slide image URLs</Label>
                <p className="text-xs text-muted-foreground">
                  Update any broken image URLs below. Each URL must be publicly reachable.
                </p>
                <div className="space-y-2">
                  {slides.map((slide) => (
                    <div key={slide.index} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-16 shrink-0">
                        Slide {slide.index}
                        <br />
                        <span className="text-[10px] opacity-70">{slide.role}</span>
                      </span>
                      <Input
                        value={slideUrls[slide.index] ?? slide.imageUrl ?? ""}
                        onChange={(e) =>
                          setSlideUrls((prev) => ({ ...prev, [slide.index]: e.target.value }))
                        }
                        placeholder="https://..."
                        className="font-mono text-xs h-8"
                        data-testid={`fix-dialog-slide-url-${slide.index}`}
                        disabled={isBusy}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4">Could not load post details.</p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={isBusy} data-testid="fix-dialog-cancel">
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => saveMutation.mutate()}
            disabled={isBusy || !post}
            data-testid="fix-dialog-save"
          >
            {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
            Save edits
          </Button>
          <Button
            onClick={() => resubmitMutation.mutate()}
            disabled={isBusy || !post}
            data-testid="fix-dialog-resubmit"
            className="gap-1.5"
          >
            {resubmitMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Resubmit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function QueuePage() {
  const [filter, setFilter] = useState<"all" | Stage>("all");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [fixPostId, setFixPostId] = useState<string | null>(null);
  const [, navigate] = useLocation();
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

  const items = useMemo(() => {
    return posts
      .map((p) => ({ post: p, stage: queueStage(p), when: postTime(p) }))
      .filter((x): x is { post: CalendarPost; stage: Stage; when: Date | null } => x.stage !== null)
      .sort((a, b) => {
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

  const groups = useMemo(() => {
    const map = new Map<string, typeof visible>();
    for (const it of visible) {
      const key = it.when ? dayKey(it.when) : "No date set";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries());
  }, [visible]);

  function handleResubmitted() {
    queryClient.invalidateQueries({ queryKey: ["/api/generated-posts/calendar"] });
    setFixPostId(null);
  }

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
                    const href = actionHref(post);

                    return (
                      <div
                        key={post.id}
                        className={cn(
                          "relative grid grid-cols-[88px_1fr_auto] items-center gap-3 px-4 py-3 group",
                          stage === "failed" && "bg-destructive/5",
                          stage !== "failed" && "cursor-pointer hover:bg-muted/40 transition-colors",
                        )}
                        data-testid={`queue-row-${post.id}`}
                        onClick={(e) => {
                          // Don't navigate if user clicked a button/link inside the row
                          if ((e.target as HTMLElement).closest("button,a")) return;
                          if (stage === "failed") return;
                          navigate(href);
                        }}
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
                            stage === "failed" ? (
                              <Button
                                size="sm"
                                variant="default"
                                className="bg-destructive hover:bg-destructive/90 gap-1"
                                onClick={() => setFixPostId(post.id)}
                                data-testid={`queue-action-${post.id}`}
                              >
                                <WrenchIcon className="w-3.5 h-3.5" />
                                Fix
                              </Button>
                            ) : (
                              <Button asChild size="sm" variant="outline" className="opacity-0 group-hover:opacity-100 transition-opacity">
                                <Link href={href} data-testid={`queue-action-${post.id}`}>
                                  {stage === "posted" ? "View" : "Edit"}
                                  <ArrowRight className="w-3.5 h-3.5 ml-1" />
                                </Link>
                              </Button>
                            )
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

      {/* Fix dialog — rendered outside the list so it doesn't inherit the row layout */}
      {fixPostId && (
        <FixDialog
          postId={fixPostId}
          onClose={() => setFixPostId(null)}
          onResubmitted={handleResubmitted}
        />
      )}
    </AppLayout>
  );
}
