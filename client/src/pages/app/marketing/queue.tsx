import { useMemo, useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
}

interface CampaignSocialLink {
  socialAccountId: string;
  autoPublish: boolean | null;
}

interface CampaignDetail {
  id: string;
  name: string;
  status: string;
  socialAccounts: CampaignSocialLink[];
}

type MissedReason =
  | { kind: "no_social_account" }
  | { kind: "auto_publish_off"; campaignId: string; campaignName: string }
  | { kind: "account_not_linked"; campaignId: string; campaignName: string }
  | { kind: "campaign_inactive"; campaignName: string }
  | { kind: "stale_post" }
  | { kind: "unknown" };

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  x: "X (Twitter)",
  twitter: "X (Twitter)",
  instagram: "Instagram",
  facebook: "Facebook",
};

type Stage = "scheduled" | "failed" | "posted" | "exported" | "missed";

function queueStage(p: CalendarPost): Stage | null {
  if (p.status === "missed") return "missed";
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
  missed: { label: "Missed — needs review", cls: "text-amber-600 dark:text-amber-400", Icon: Clock },
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

/** Format a Date for a datetime-local input value */
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const FILTERS: { key: "all" | Stage; label: string }[] = [
  { key: "all", label: "All" },
  { key: "scheduled", label: "Scheduled" },
  { key: "missed", label: "Missed" },
  { key: "failed", label: "Failed" },
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

// ── Edit / Fix Post Dialog ──────────────────────────────────────────────────
// Works for any post stage: scheduled (edit + reschedule + cancel),
// failed (edit + resubmit), posted/exported (read-only preview).

function EditPostDialog({
  postId,
  stage,
  campaignId,
  campaignName,
  onClose,
  onChanged,
}: {
  postId: string;
  stage: Stage;
  campaignId: string | null;
  campaignName: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editedText, setEditedText] = useState<string | null>(null);
  const [scheduledValue, setScheduledValue] = useState<string>("");
  const [postNow, setPostNow] = useState(false);
  const [slideUrls, setSlideUrls] = useState<Record<number, string>>({});
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [didInit, setDidInit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const ONE_HOUR_MS = 60 * 60 * 1000;
  const scheduledTooSoon =
    !postNow && !!scheduledValue &&
    new Date(scheduledValue).getTime() - Date.now() < ONE_HOUR_MS;
  const canReschedule = postNow || (!!scheduledValue && !scheduledTooSoon);

  const { data: post, isLoading } = useQuery<FullPost>({
    queryKey: ["/api/generated-posts", postId],
    queryFn: async () => {
      const r = await fetch(`/api/generated-posts/${postId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Could not load post");
      return r.json();
    },
  });

  const { data: allSocialAccounts = [] } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
    queryFn: async () => {
      const r = await fetch("/api/social-accounts", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  // These must be declared before the campaignDetail query so they can be used in `enabled`.
  const isReadOnly = stage === "posted" || stage === "exported";
  const isMissed = stage === "missed";
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const isOverdue = stage === "scheduled" && !!post?.scheduledDate && new Date(post.scheduledDate) < new Date();
  const isStaleOverdue = isOverdue && !!post?.scheduledDate &&
    new Date(post.scheduledDate) < new Date(Date.now() - SEVEN_DAYS_MS);

  // Fetch the campaign when reviewing a missed or overdue post — used to diagnose why it wasn't published.
  const { data: campaignDetail } = useQuery<CampaignDetail | null>({
    queryKey: ["/api/campaigns", campaignId, "diagnostic"],
    queryFn: async () => {
      if (!campaignId) return null;
      const r = await fetch(`/api/campaigns/${campaignId}`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: (stage === "missed" || isOverdue) && !!campaignId,
  });

  // Compute the most actionable reason this post wasn't auto-published.
  const missedReason: MissedReason | null = (() => {
    if (stage !== "missed" && !isOverdue) return null;
    if (!post) return null;
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const isStale = !!post.scheduledDate &&
      new Date(post.scheduledDate) < new Date(Date.now() - SEVEN_DAYS_MS);
    if (!post.socialAccountId) return { kind: "no_social_account" };
    if (!campaignId) {
      // Standalone post — stale is the only automatic-skip reason
      return isStale ? { kind: "stale_post" } : { kind: "unknown" };
    }
    if (!campaignDetail) return null; // still loading
    if (campaignDetail.status !== "active") {
      return { kind: "campaign_inactive", campaignName: campaignDetail.name };
    }
    const link = campaignDetail.socialAccounts.find(a => a.socialAccountId === post.socialAccountId);
    if (!link) {
      return { kind: "account_not_linked", campaignId, campaignName: campaignDetail.name };
    }
    if (!link.autoPublish) {
      return { kind: "auto_publish_off", campaignId, campaignName: campaignDetail.name };
    }
    if (isStale) return { kind: "stale_post" };
    return { kind: "unknown" };
  })();

  if (post && !didInit) {
    setEditedText(post.editedContent ?? post.content ?? "");
    setScheduledValue(post.scheduledDate ? toDatetimeLocal(new Date(post.scheduledDate)) : "");
    setSelectedAccountId(post.socialAccountId ?? null);
    const initUrls: Record<number, string> = {};
    (post.carouselSlides ?? []).forEach((s) => { initUrls[s.index] = s.imageUrl ?? ""; });
    setSlideUrls(initUrls);
    setDidInit(true);
  }

  const isCarousel = post?.postFormat === "carousel";
  const slides = post?.carouselSlides ?? [];

  // Build the PATCH body from current edits
  function buildPatchBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const body: Record<string, unknown> = { editedContent: editedText, ...extra };
    if (postNow) {
      body.scheduledDate = new Date().toISOString();
    } else if (scheduledValue) {
      body.scheduledDate = new Date(scheduledValue).toISOString();
    }
    if (selectedAccountId !== (post?.socialAccountId ?? null)) {
      body.socialAccountId = selectedAccountId;
    }
    if (isCarousel && post?.carouselSlides?.length) {
      body.carouselSlides = post.carouselSlides.map((s) => ({
        ...s,
        imageUrl: slideUrls[s.index] !== undefined ? slideUrls[s.index] : s.imageUrl,
      }));
    }
    return body;
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/generated-posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(buildPatchBody()),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Save failed");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Post updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/generated-posts/calendar"] });
      onChanged();
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const cancelPostMutation = useMutation({
    mutationFn: async () => {
      const url = campaignId
        ? `/api/campaigns/${campaignId}/generated-posts/${postId}`
        : `/api/generated-posts/${postId}`;
      const r = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "deleted" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Cancel failed");
    },
    onSuccess: () => {
      toast({ title: "Post cancelled" });
      queryClient.invalidateQueries({ queryKey: ["/api/generated-posts/calendar"] });
      onChanged();
    },
    onError: (err: Error) => toast({ title: "Couldn't cancel post", description: err.message, variant: "destructive" }),
  });

  const resubmitMutation = useMutation({
    mutationFn: async () => {
      // Save edits first
      const saveR = await fetch(`/api/generated-posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(buildPatchBody()),
      });
      if (!saveR.ok) throw new Error((await saveR.json().catch(() => ({}))).error || "Save failed");
      // Then publish
      const pubR = await fetch(`/api/generated-posts/${postId}/publish`, {
        method: "POST",
        credentials: "include",
      });
      if (!pubR.ok) throw new Error((await pubR.json().catch(() => ({}))).error || "Resubmit failed");
      return pubR.json() as Promise<{ publishedUrl?: string }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Resubmitted!",
        description: data.publishedUrl ? `Live at ${data.publishedUrl}` : "Post sent for publishing.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/generated-posts/calendar"] });
      onChanged();
    },
    onError: (err: Error) => toast({ title: "Resubmit failed", description: err.message, variant: "destructive" }),
  });

  // Direct "post now" for overdue posts — sets scheduledDate to now and closes.
  const postNowMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/generated-posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ editedContent: editedText, scheduledDate: new Date().toISOString() }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Queued for immediate publishing", description: "The worker will pick this up within the next few minutes." });
      queryClient.invalidateQueries({ queryKey: ["/api/generated-posts/calendar"] });
      onChanged();
      onClose();
    },
    onError: (err: Error) => toast({ title: "Could not queue post", description: err.message, variant: "destructive" }),
  });

  const isBusy = saveMutation.isPending || cancelPostMutation.isPending || resubmitMutation.isPending || postNowMutation.isPending;

  const dialogTitle = {
    scheduled: "Edit post",
    failed: "Fix failed post",
    missed: "Missed post — needs review",
    posted: "Posted",
    exported: "Exported post",
  }[stage];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {stage === "failed" && <WrenchIcon className="w-4 h-4 text-destructive" />}
            {stage === "missed" && <Clock className="w-4 h-4 text-amber-500" />}
            {stage === "posted" && <CheckCircle2 className="w-4 h-4 text-green-500" />}
            {dialogTitle}
            {campaignId && (
              <Link
                href={`/app/marketing/campaigns/${campaignId}#posts`}
                className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors font-normal"
                data-testid="edit-dialog-campaign-link"
              >
                {campaignName ?? "View campaign"}
                <ExternalLink className="w-3 h-3" />
              </Link>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : post ? (
          <div className="space-y-4">
            {/* Failure reason */}
            {stage === "failed" && post.publishError && (
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

            {/* Overdue scheduled notice */}
            {isOverdue && (
              isStaleOverdue ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
                  <div className="flex items-start gap-2">
                    <Clock className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-amber-700 dark:text-amber-400">Outside the auto-publish window</p>
                      <p className="text-amber-700/80 dark:text-amber-400/80 mt-0.5 text-[12px]">
                        This post is more than 7 days past its scheduled date and will not be picked up automatically.
                        Update the date and time below to a future date, then save — the worker will queue it at the new time.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2.5 text-sm space-y-2">
                  <div className="flex items-start gap-2">
                    <Zap className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="font-medium text-blue-700 dark:text-blue-300">Passed its scheduled time</p>
                        <button
                          type="button"
                          onClick={() => postNowMutation.mutate()}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shrink-0"
                          data-testid="banner-post-now"
                        >
                          {postNowMutation.isPending
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <Zap className="w-3 h-3" />}
                          Post now
                        </button>
                      </div>
                      <p className="text-blue-700/80 dark:text-blue-300/80 mt-0.5 text-[12px]">
                        The auto-publish worker checks every few minutes. If it hasn't picked this up, use
                        <strong> Post now</strong> to force it, or reschedule below.
                      </p>
                    </div>
                  </div>
                  {/* Diagnostic: why hasn't the worker picked this up? */}
                  {missedReason && (
                    <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0 text-red-700 dark:text-red-400">
                          {missedReason.kind === "no_social_account" && (
                            <><p className="font-medium">No social account linked</p>
                            <p className="text-[12px] mt-0.5 opacity-80">Pick an account using the <strong>Social account</strong> field below, then save to reschedule.</p></>
                          )}
                          {missedReason.kind === "auto_publish_off" && (
                            <><p className="font-medium">Auto-publish is off for this campaign</p>
                            <p className="text-[12px] mt-0.5 opacity-80">
                              The campaign <strong>{missedReason.campaignName}</strong> has auto-publish disabled for this account.{" "}
                              <a href={`/app/marketing/campaigns/${missedReason.campaignId}#accounts`} target="_blank" rel="noreferrer" className="underline underline-offset-2 font-medium hover:opacity-70">Turn it on in Campaign → Social Accounts →</a>
                            </p></>
                          )}
                          {missedReason.kind === "account_not_linked" && (
                            <><p className="font-medium">Social account not linked to this campaign</p>
                            <p className="text-[12px] mt-0.5 opacity-80">
                              This account isn't connected to campaign <strong>{missedReason.campaignName}</strong>.{" "}
                              <a href={`/app/marketing/campaigns/${missedReason.campaignId}#accounts`} target="_blank" rel="noreferrer" className="underline underline-offset-2 font-medium hover:opacity-70">Add it in Campaign → Social Accounts →</a>
                            </p></>
                          )}
                          {missedReason.kind === "campaign_inactive" && (
                            <><p className="font-medium">Campaign is not active</p>
                            <p className="text-[12px] mt-0.5 opacity-80">Campaign <strong>{missedReason.campaignName}</strong> is not active — the worker only publishes posts on active campaigns.</p></>
                          )}
                          {missedReason.kind === "stale_post" && (
                            <><p className="font-medium">Post is too old to auto-publish</p>
                            <p className="text-[12px] mt-0.5 opacity-80">Posts more than 7 days past their scheduled date are skipped. Use Post now or reschedule to a future time.</p></>
                          )}
                          {missedReason.kind === "unknown" && (
                            <><p className="font-medium">Configuration looks correct</p>
                            <p className="text-[12px] mt-0.5 opacity-80">Check that the social account is connected and the campaign is active, then use Post now to force it.</p></>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            )}

            {/* Missed post notice + scheduling choice */}
            {isMissed && (
              <div className="space-y-3">
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
                  <div className="flex items-start gap-2">
                    <Clock className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-amber-700 dark:text-amber-400">This post was not sent</p>
                      <p className="text-amber-700/80 dark:text-amber-400/80 mt-0.5 text-[12px]">
                        It passed its scheduled date without being published. Choose when to send it below,
                        or discard it if the moment has passed.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Diagnostic: why was it missed? */}
                {missedReason && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0 text-red-700 dark:text-red-400">
                        {missedReason.kind === "no_social_account" && (
                          <>
                            <p className="font-medium">No social account linked</p>
                            <p className="text-[12px] mt-0.5 opacity-80">
                              Pick an account using the <strong>Social account</strong> field below, then save to reschedule.
                            </p>
                          </>
                        )}
                        {missedReason.kind === "auto_publish_off" && (
                          <>
                            <p className="font-medium">Auto-publish is off for this campaign</p>
                            <p className="text-[12px] mt-0.5 opacity-80">
                              The campaign <strong>{missedReason.campaignName}</strong> has auto-publish
                              disabled for this account.{" "}
                              <a
                                href={`/app/marketing/campaigns/${missedReason.campaignId}#accounts`}
                                target="_blank"
                                rel="noreferrer"
                                className="underline underline-offset-2 font-medium hover:opacity-70"
                              >
                                Turn it on in Campaign → Social Accounts →
                              </a>
                            </p>
                          </>
                        )}
                        {missedReason.kind === "account_not_linked" && (
                          <>
                            <p className="font-medium">Social account not linked to this campaign</p>
                            <p className="text-[12px] mt-0.5 opacity-80">
                              The account this post targets isn't connected to campaign <strong>{missedReason.campaignName}</strong>.{" "}
                              <a
                                href={`/app/marketing/campaigns/${missedReason.campaignId}#accounts`}
                                target="_blank"
                                rel="noreferrer"
                                className="underline underline-offset-2 font-medium hover:opacity-70"
                              >
                                Add it in Campaign → Social Accounts →
                              </a>
                            </p>
                          </>
                        )}
                        {missedReason.kind === "campaign_inactive" && (
                          <>
                            <p className="font-medium">Campaign is not active</p>
                            <p className="text-[12px] mt-0.5 opacity-80">
                              The campaign <strong>{missedReason.campaignName}</strong> is not active —
                              the worker only publishes posts on active campaigns.
                            </p>
                          </>
                        )}
                        {missedReason.kind === "stale_post" && (
                          <>
                            <p className="font-medium">Post is too old</p>
                            <p className="text-[12px] mt-0.5 opacity-80">
                              The worker skips posts that are more than 7 days past their scheduled date.
                              Reschedule it to a future time and it will be picked up automatically.
                            </p>
                          </>
                        )}
                        {missedReason.kind === "unknown" && (
                          <>
                            <p className="font-medium">Reason unclear</p>
                            <p className="text-[12px] mt-0.5 opacity-80">
                              The post appears correctly configured. Check that the social account is
                              connected and the campaign is active, then reschedule.
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* When to send */}
                <div className="space-y-2">
                  <Label>When should this post go out?</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPostNow(true)}
                      className={`rounded-md border px-3 py-2.5 text-sm font-medium transition-colors text-left ${
                        postNow
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:border-primary/50 text-muted-foreground"
                      }`}
                      data-testid="reschedule-post-now"
                      disabled={isBusy}
                    >
                      <Zap className="w-3.5 h-3.5 inline mr-1.5 mb-0.5" />
                      Post now
                      <p className="text-[11px] font-normal mt-0.5 opacity-70">
                        Picked up at next worker tick
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPostNow(false)}
                      className={`rounded-md border px-3 py-2.5 text-sm font-medium transition-colors text-left ${
                        !postNow
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:border-primary/50 text-muted-foreground"
                      }`}
                      data-testid="reschedule-schedule-later"
                      disabled={isBusy}
                    >
                      <Calendar className="w-3.5 h-3.5 inline mr-1.5 mb-0.5" />
                      Schedule for later
                      <p className="text-[11px] font-normal mt-0.5 opacity-70">
                        Must be ≥ 1 hour from now
                      </p>
                    </button>
                  </div>

                  {!postNow && (
                    <div>
                      <Input
                        type="datetime-local"
                        value={scheduledValue}
                        onChange={(e) => setScheduledValue(e.target.value)}
                        min={toDatetimeLocal(new Date(Date.now() + ONE_HOUR_MS))}
                        className={`w-auto ${scheduledTooSoon ? "border-destructive" : ""}`}
                        data-testid="edit-dialog-scheduled-date"
                        disabled={isBusy}
                      />
                      {scheduledTooSoon && (
                        <p className="text-[11px] text-destructive mt-1">
                          Must be at least 1 hour from now.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Social account selector — visible when editable */}
            {!isReadOnly && (() => {
              const platformAccounts = allSocialAccounts.filter(
                (a) => a.platform === post.platform && a.status === "active" && a.hasAccessToken
              );
              if (platformAccounts.length === 0) return null;
              return (
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    Social account
                    {missedReason?.kind === "no_social_account" && (
                      <span className="text-destructive text-[11px] font-normal">— required to publish</span>
                    )}
                  </Label>
                  <Select
                    value={selectedAccountId ?? ""}
                    onValueChange={(v) => setSelectedAccountId(v || null)}
                    disabled={isBusy}
                  >
                    <SelectTrigger data-testid="edit-dialog-social-account" className="w-full">
                      <SelectValue placeholder="Select an account…" />
                    </SelectTrigger>
                    <SelectContent>
                      {platformAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.accountName || a.platform}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })()}

            {/* Post text */}
            {/* Platform + graphic — shown for all stages */}
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-1">
                  {PLATFORM_LABELS[post.platform] ?? post.platform}
                </p>
                {post.overrideImageUrl || post.leadImageUrl ? (
                  <div className="flex items-center gap-2.5">
                    <img
                      src={post.overrideImageUrl ?? post.leadImageUrl ?? ""}
                      alt="Post graphic"
                      className="w-14 h-14 rounded-md object-cover border border-border shrink-0"
                    />
                    <span className="text-xs text-muted-foreground">Graphic attached</span>
                  </div>
                ) : (
                  <div className={`rounded-md border px-2.5 py-2 text-xs flex items-start gap-1.5 ${
                    isMissed
                      ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
                      : "border-border text-muted-foreground"
                  }`}>
                    <ImageOff className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      No graphic — this post will publish as text only.
                      {isMissed && (
                        <> To attach an image, regenerate the post from its brief.</>
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-post-content">Post text</Label>
              <Textarea
                id="edit-post-content"
                value={editedText ?? ""}
                onChange={(e) => setEditedText(e.target.value)}
                rows={8}
                className="resize-y font-mono text-sm"
                data-testid="edit-dialog-content"
                disabled={isBusy || isReadOnly}
                readOnly={isReadOnly}
              />
            </div>

            {/* Scheduled date — editable for scheduled/failed posts only; missed has its own section above */}
            {!isReadOnly && !isMissed && (
              <div className="space-y-2">
                <Label htmlFor="edit-post-date" className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                  Scheduled date &amp; time
                </Label>

                <Input
                  id="edit-post-date"
                  type="datetime-local"
                  value={scheduledValue}
                  onChange={(e) => setScheduledValue(e.target.value)}
                  className="w-auto"
                  data-testid="edit-dialog-scheduled-date"
                  disabled={isBusy}
                />
                <p className="text-[11px] text-muted-foreground">
                  {isOverdue
                    ? "Set a future date and save to reschedule, or use Post now above."
                    : "Change this to reschedule. The worker picks up posts within a few minutes of their scheduled time."}
                </p>
              </div>
            )}

            {/* Carousel slide image URLs */}
            {!isReadOnly && isCarousel && slides.length > 0 && (
              <div className="space-y-2">
                <Label>Slide image URLs</Label>
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
                        onChange={(e) => setSlideUrls((prev) => ({ ...prev, [slide.index]: e.target.value }))}
                        placeholder="https://..."
                        className="font-mono text-xs h-8"
                        data-testid={`edit-dialog-slide-url-${slide.index}`}
                        disabled={isBusy}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cancel post — two-step confirm (missed stage handled by the Discard button in the footer) */}
            {(stage === "scheduled" || stage === "failed") && (
              <div className="pt-1 border-t">
                {confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Cancel and delete this post?</span>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => cancelPostMutation.mutate()}
                      disabled={isBusy}
                      data-testid="edit-dialog-confirm-cancel"
                    >
                      {cancelPostMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      Yes, delete it
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDelete(false)}
                      disabled={isBusy}
                    >
                      Keep it
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(true)}
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/5 gap-1.5 h-8 px-2"
                    data-testid="edit-dialog-cancel-post"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Cancel and delete this post
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4">Could not load post details.</p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {/* Discard for missed = two-step delete; for others = close without saving */}
          {isMissed ? (
            confirmDelete ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  disabled={isBusy}
                >
                  Keep it
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => cancelPostMutation.mutate()}
                  disabled={isBusy}
                  data-testid="edit-dialog-confirm-cancel"
                >
                  {cancelPostMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                  Yes, remove it
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                onClick={() => setConfirmDelete(true)}
                disabled={isBusy}
                data-testid="edit-dialog-close"
              >
                Discard
              </Button>
            )
          ) : (
            <Button variant="outline" onClick={onClose} disabled={isBusy} data-testid="edit-dialog-close">
              {isReadOnly ? "Close" : "Discard"}
            </Button>
          )}

          {stage === "failed" ? (
            <>
              <Button
                variant="secondary"
                onClick={() => saveMutation.mutate()}
                disabled={isBusy || !post}
                data-testid="edit-dialog-save"
              >
                {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                Save only
              </Button>
              <Button
                onClick={() => resubmitMutation.mutate()}
                disabled={isBusy || !post}
                data-testid="edit-dialog-resubmit"
                className="gap-1.5"
              >
                {resubmitMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Resubmit
              </Button>
            </>
          ) : isMissed ? (
            !confirmDelete && (
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={isBusy || !post || !canReschedule}
                data-testid="edit-dialog-save"
                className="gap-1.5"
              >
                {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calendar className="w-3.5 h-3.5" />}
                Reschedule &amp; reactivate
              </Button>
            )
          ) : !isReadOnly ? (
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={isBusy || !post}
              data-testid="edit-dialog-save"
            >
              {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
              Save changes
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function QueuePage() {
  const [filter, setFilter] = useState<"all" | Stage>("all");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editPost, setEditPost] = useState<CalendarPost | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

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
    queryKey: ["/api/generated-posts/calendar", "orbit-queue"],
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
    // Priority order for sort: failed first, then missed, then by date
    const stagePriority = (s: Stage) => (s === "failed" ? 0 : s === "missed" ? 1 : 2);
    return posts
      .map((p) => ({ post: p, stage: queueStage(p), when: postTime(p) }))
      .filter((x): x is { post: CalendarPost; stage: Stage; when: Date | null } => x.stage !== null)
      .sort((a, b) => {
        const pa = stagePriority(a.stage);
        const pb = stagePriority(b.stage);
        if (pa !== pb) return pa - pb;
        const at = a.when?.getTime() ?? Infinity;
        const bt = b.when?.getTime() ?? Infinity;
        return at - bt;
      });
  }, [posts]);

  const counts = useMemo(() => {
    const c = { all: items.length, scheduled: 0, failed: 0, missed: 0, posted: 0, exported: 0 } as Record<string, number>;
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

  return (
    <AppLayout breadcrumbs={[{ label: "Marketing", href: "/app/marketing" }, { label: "Posting Queue" }]}>
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ListChecks className="w-6 h-6" /> Posting Queue
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Click any post to edit, reschedule, or cancel it. Failures appear at the top.
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

                    return (
                      <div
                        key={post.id}
                        className={cn(
                          "relative grid grid-cols-[88px_1fr_auto] items-center gap-3 px-4 py-3 cursor-pointer group hover:bg-muted/40 transition-colors",
                          stage === "failed" && "bg-destructive/5 hover:bg-destructive/10",
                        )}
                        data-testid={`queue-row-${post.id}`}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("button")) return;
                          setEditPost(post);
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
                            <p className="text-xs text-destructive mt-0.5 truncate">{post.publishError}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
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
                              className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
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

      {/* Edit / Fix dialog */}
      {editPost && (() => {
        const stage = queueStage(editPost);
        return stage ? (
          <EditPostDialog
            postId={editPost.id}
            stage={stage}
            campaignId={editPost.campaignId}
            campaignName={editPost.campaignName}
            onClose={() => setEditPost(null)}
            onChanged={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/generated-posts/calendar"] });
              setEditPost(null);
            }}
          />
        ) : null;
      })()}
    </AppLayout>
  );
}
