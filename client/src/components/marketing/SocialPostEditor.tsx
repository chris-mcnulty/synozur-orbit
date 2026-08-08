/**
 * Shared Social Post Editor (Task: one editor everywhere)
 *
 * The single edit surface for a generated social post. Opened from the
 * campaign detail Social Posts tab, the Social Calendar, the Pipeline Board,
 * and the Posting Queue so every surface offers the same full action set:
 *
 *  - edit content + hashtags, AI rewrite (voice-profile driven)
 *  - change / generate / upload / remove the post image
 *  - change the posting account
 *  - schedule / reschedule (+ exact-time toggle, post-now for missed/overdue)
 *  - approve / reject, publish now / retry, delete
 *
 * All actions use the platform-agnostic endpoints:
 *   PATCH  /api/generated-posts/:id            (save, approve, reject, image)
 *   POST   /api/generated-posts/:id/publish    (publish now / retry)
 *   POST   /api/generated-posts/:id/generate-image
 *   PUT    /api/campaigns/:cid/generated-posts/:id or /api/generated-posts/:id
 *          with { status: "deleted" }          (delete)
 *
 * Surface-specific extras (drag-to-reschedule on the calendar grid, bulk
 * actions on campaign detail) intentionally stay on their own surfaces.
 */

import { useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, AtSign, Calendar, CheckCircle2, Clock, Download, ExternalLink,
  ImageOff, Library, Loader2, RefreshCw, Share2, Sparkles, Trash2, Upload,
  WrenchIcon, X, XCircle, Zap,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import AIRewritePanel from "@/components/marketing/AIRewritePanel";
import { PostStageBadge } from "@/components/marketing/post-stage";

// ── types ────────────────────────────────────────────────────────────────────

interface CarouselSlide {
  index: number;
  role: string;
  kicker?: string | null;
  headline: string;
  supportingLines?: string[];
  imageUrl?: string | null;
}

interface FullPost {
  id: string;
  platform: string;
  content: string | null;
  editedContent: string | null;
  hashtags: string[] | null;
  publishError: string | null;
  publishedUrl: string | null;
  publishedAt: string | null;
  status: string;
  postFormat: string | null;
  scheduledDate: string | null;
  overrideImageUrl: string | null;
  leadImageUrl: string | null;
  carouselSlides: CarouselSlide[] | null;
  campaignId: string | null;
  socialAccountId: string | null;
  deliveryMode: string | null;
  exactSchedule: boolean;
}

interface SocialAccount {
  id: string;
  platform: string;
  accountName: string;
  status: string;
  hasAccessToken?: boolean;
}

interface CampaignSocialLink { socialAccountId: string; autoPublish: boolean | null }
interface CampaignDetail { id: string; name: string; status: string; socialAccounts: CampaignSocialLink[] }

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
  bluesky: "Bluesky",
};

/** Format a Date for a datetime-local input value */
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Download an image straight to the user's machine (same-origin fetch; falls
// back to opening in a new tab when blocked).
async function downloadImageFromUrl(url: string, fallbackName: string) {
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error("fetch failed");
    const blob = await res.blob();
    const ext = ((blob.type.split("/")[1] || "png").split("+")[0]) || "png";
    const name = /\.[a-z0-9]+$/i.test(fallbackName) ? fallbackName : `${fallbackName}.${ext}`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  } catch {
    window.open(url, "_blank");
  }
}

function safeFileStub(s: string): string {
  return (s || "post").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60).toLowerCase() || "post";
}

export interface SocialPostEditorProps {
  postId: string;
  onClose: () => void;
  /** Extra react-query keys to invalidate after any change (e.g. a campaign's post list). */
  extraInvalidateKeys?: unknown[][];
  /** Called after any successful change (in addition to invalidation). */
  onChanged?: () => void;
  /** Optional campaign name for the header link (avoids an extra fetch). */
  campaignName?: string | null;
}

// ── component ────────────────────────────────────────────────────────────────

export default function SocialPostEditor({
  postId, onClose, extraInvalidateKeys, onChanged, campaignName,
}: SocialPostEditorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editedText, setEditedText] = useState<string | null>(null);
  const [hashtagsValue, setHashtagsValue] = useState<string>("");
  const [scheduledValue, setScheduledValue] = useState<string>("");
  const [postNow, setPostNow] = useState(false);
  const [slideUrls, setSlideUrls] = useState<Record<number, string>>({});
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [exactSchedule, setExactSchedule] = useState(false);
  const [didInit, setDidInit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ONE_HOUR_MS = 60 * 60 * 1000;
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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

  const campaignId = post?.campaignId ?? null;

  // ── stage derivation (drives which actions are shown) ──
  const status = post?.status ?? "draft";
  const isPosted = !!post?.publishedAt || status === "published";
  const isExported = status === "exported" || status === "scheduled_external";
  const isReadOnly = isPosted || isExported;
  const isFailed = !isPosted && (status === "publish_failed" || (!!post?.publishError && status !== "missed"));
  const isMissed = status === "missed";
  const isDraft = status === "draft";
  const isRejected = status === "rejected";
  const isApproved = status === "approved";
  const isOverdue = isApproved && !!post?.scheduledDate && new Date(post.scheduledDate) < new Date();
  const isStaleOverdue = isOverdue && !!post?.scheduledDate &&
    new Date(post.scheduledDate) < new Date(Date.now() - SEVEN_DAYS_MS);

  const scheduledTooSoon =
    isMissed && !postNow && !!scheduledValue &&
    new Date(scheduledValue).getTime() - Date.now() < ONE_HOUR_MS;
  const canReschedule = !isMissed || postNow || (!!scheduledValue && !scheduledTooSoon);

  // Fetch the campaign when reviewing a missed or overdue post — used to
  // diagnose why it wasn't published.
  const { data: campaignDetail } = useQuery<CampaignDetail | null>({
    queryKey: ["/api/campaigns", campaignId, "diagnostic"],
    queryFn: async () => {
      if (!campaignId) return null;
      const r = await fetch(`/api/campaigns/${campaignId}`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: (isMissed || isOverdue) && !!campaignId,
  });

  const missedReason: MissedReason | null = (() => {
    if (!isMissed && !isOverdue) return null;
    if (!post) return null;
    const isStale = !!post.scheduledDate &&
      new Date(post.scheduledDate) < new Date(Date.now() - SEVEN_DAYS_MS);
    if (!post.socialAccountId) return { kind: "no_social_account" };
    if (!campaignId) return isStale ? { kind: "stale_post" } : { kind: "unknown" };
    if (!campaignDetail) return null; // still loading
    if (campaignDetail.status !== "active") {
      return { kind: "campaign_inactive", campaignName: campaignDetail.name };
    }
    const link = campaignDetail.socialAccounts.find(a => a.socialAccountId === post.socialAccountId);
    if (!link) return { kind: "account_not_linked", campaignId, campaignName: campaignDetail.name };
    if (!link.autoPublish) return { kind: "auto_publish_off", campaignId, campaignName: campaignDetail.name };
    if (isStale) return { kind: "stale_post" };
    return { kind: "unknown" };
  })();

  if (post && !didInit) {
    setEditedText(post.editedContent ?? post.content ?? "");
    setHashtagsValue((post.hashtags ?? []).join(", "));
    setScheduledValue(post.scheduledDate ? toDatetimeLocal(new Date(post.scheduledDate)) : "");
    setSelectedAccountId(post.socialAccountId ?? null);
    setExactSchedule(post.exactSchedule ?? false);
    const initUrls: Record<number, string> = {};
    (post.carouselSlides ?? []).forEach((s) => { initUrls[s.index] = s.imageUrl ?? ""; });
    setSlideUrls(initUrls);
    setDidInit(true);
  }

  const isCarousel = post?.postFormat === "carousel";
  const slides = post?.carouselSlides ?? [];
  const slidesWithImages = slides.filter(s => s.imageUrl);
  const imageUrl = post?.overrideImageUrl ?? post?.leadImageUrl ?? null;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/generated-posts/calendar"] });
    queryClient.invalidateQueries({ queryKey: ["/api/generated-posts", postId] });
    queryClient.invalidateQueries({ queryKey: [`/api/generated-posts/${postId}`] });
    if (campaignId) {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${campaignId}/generated-posts`] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns", campaignId, "next-actions"] });
    }
    for (const key of extraInvalidateKeys ?? []) {
      queryClient.invalidateQueries({ queryKey: key });
    }
    onChanged?.();
  };

  function parseHashtags(): string[] {
    return hashtagsValue
      .split(/[,\s]+/)
      .map(h => h.replace(/^#/, "").trim())
      .filter(h => h.length > 0);
  }

  // Build the PATCH body from current edits
  function buildPatchBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const body: Record<string, unknown> = {
      editedContent: editedText,
      hashtags: parseHashtags(),
      ...extra,
    };
    if (isMissed && postNow) {
      body.scheduledDate = new Date().toISOString();
    } else if (scheduledValue) {
      body.scheduledDate = new Date(scheduledValue).toISOString();
    }
    if (selectedAccountId !== (post?.socialAccountId ?? null)) {
      body.socialAccountId = selectedAccountId;
    }
    if (exactSchedule !== (post?.exactSchedule ?? false)) {
      body.exactSchedule = exactSchedule;
    }
    if (isCarousel && post?.carouselSlides?.length) {
      body.carouselSlides = post.carouselSlides.map((s) => ({
        ...s,
        imageUrl: slideUrls[s.index] !== undefined ? slideUrls[s.index] : s.imageUrl,
      }));
    }
    return body;
  }

  async function patchPost(body: Record<string, unknown>) {
    const r = await fetch(`/api/generated-posts/${postId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Save failed");
    return r.json();
  }

  const saveMutation = useMutation({
    mutationFn: async () => patchPost(buildPatchBody()),
    onSuccess: () => {
      toast({ title: "Post updated" });
      invalidateAll();
      onClose();
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: async () => patchPost(buildPatchBody({ status: "approved" })),
    onSuccess: () => {
      toast({ title: "Post approved", description: "Ready to publish or export." });
      invalidateAll();
      onClose();
    },
    onError: (err: Error) => toast({ title: "Couldn't approve", description: err.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => patchPost({ status: "rejected" }),
    onSuccess: () => {
      toast({ title: "Post rejected" });
      invalidateAll();
      onClose();
    },
    onError: (err: Error) => toast({ title: "Couldn't reject", description: err.message, variant: "destructive" }),
  });

  // Publish now (approved) / retry (failed): save edits first, then publish.
  const publishMutation = useMutation({
    mutationFn: async () => {
      await patchPost(buildPatchBody());
      const pubR = await fetch(`/api/generated-posts/${postId}/publish`, {
        method: "POST",
        credentials: "include",
      });
      if (!pubR.ok) throw new Error((await pubR.json().catch(() => ({}))).error || "Publish failed");
      return pubR.json() as Promise<{ publishedUrl?: string }>;
    },
    onSuccess: (data) => {
      toast({
        title: isFailed ? "Resubmitted!" : "Published!",
        description: data.publishedUrl ? `Live at ${data.publishedUrl}` : "Post sent for publishing.",
      });
      invalidateAll();
      onClose();
    },
    onError: (err: Error) => toast({
      title: isFailed ? "Resubmit failed" : "Publish failed",
      description: err.message,
      variant: "destructive",
    }),
  });

  // Direct "post now" for overdue posts — sets scheduledDate to now and closes.
  const postNowMutation = useMutation({
    mutationFn: async () => patchPost({ editedContent: editedText, scheduledDate: new Date().toISOString() }),
    onSuccess: () => {
      toast({ title: "Queued for immediate publishing", description: "The worker will pick this up within the next few minutes." });
      invalidateAll();
      onClose();
    },
    onError: (err: Error) => toast({ title: "Could not queue post", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
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
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Delete failed");
    },
    onSuccess: () => {
      toast({ title: "Post deleted" });
      invalidateAll();
      onClose();
    },
    onError: (err: Error) => toast({ title: "Couldn't delete post", description: err.message, variant: "destructive" }),
  });

  const generateImageMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/generated-posts/${postId}/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Generation failed");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Branded image created" });
      invalidateAll();
    },
    onError: (err: Error) => toast({ title: "Couldn't create image", description: err.message, variant: "destructive" }),
  });

  const setImageMutation = useMutation({
    mutationFn: async (payload: { overrideImageUrl: string | null; overrideBrandAssetId?: string | null }) =>
      patchPost(payload),
    onSuccess: () => invalidateAll(),
    onError: (err: Error) => toast({ title: "Couldn't update image", description: err.message, variant: "destructive" }),
  });

  const { uploadFile, isUploading } = useUpload({
    onSuccess: (resp) => setImageMutation.mutate({ overrideImageUrl: resp.objectPath, overrideBrandAssetId: null }),
    onError: (err) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  const { data: brandAssets = [] } = useQuery<any[]>({
    queryKey: ["/api/brand-assets"],
    queryFn: async () => {
      const r = await fetch("/api/brand-assets", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: showPicker,
  });
  const brandImages = brandAssets.filter((ba: any) => {
    const url = ba.fileUrl || ba.url || "";
    const mime = ba.mimeType || ba.fileType || "";
    return /\.(png|jpe?g|webp|gif|svg)$/i.test(url) || /^image\//i.test(mime);
  });

  const isBusy =
    saveMutation.isPending || approveMutation.isPending || rejectMutation.isPending ||
    publishMutation.isPending || postNowMutation.isPending || deleteMutation.isPending ||
    generateImageMutation.isPending || setImageMutation.isPending;

  const dialogTitle = isPosted
    ? "Posted"
    : isExported
      ? "Exported post"
      : isFailed
        ? "Fix failed post"
        : isMissed
          ? "Missed post — needs review"
          : "Edit post";

  const resolvedCampaignName = campaignName ?? campaignDetail?.name ?? null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="social-post-editor">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isFailed && <WrenchIcon className="w-4 h-4 text-destructive" />}
            {isMissed && <Clock className="w-4 h-4 text-amber-500" />}
            {isPosted && <CheckCircle2 className="w-4 h-4 text-green-500" />}
            {dialogTitle}
            {post && <PostStageBadge post={post} className="ml-1" />}
            {campaignId && (
              <Link
                href={`/app/marketing/campaigns/${campaignId}#posts`}
                className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors font-normal"
                data-testid="edit-dialog-campaign-link"
              >
                {resolvedCampaignName ?? "View campaign"}
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
            {/* Published confirmation */}
            {isPosted && (
              <div className="flex items-center gap-2 flex-wrap text-sm text-green-600">
                <CheckCircle2 className="w-4 h-4" />
                Posted{post.publishedAt ? ` ${new Date(post.publishedAt).toLocaleString()}` : ""}
                {post.publishedUrl && (
                  <a
                    href={post.publishedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-600/10 hover:bg-green-600/20 text-green-700 font-medium transition-colors"
                    data-testid="edit-dialog-published-link"
                  >
                    <ExternalLink className="w-3 h-3" /> View post
                  </a>
                )}
              </div>
            )}

            {/* Failure reason */}
            {isFailed && post.publishError && (
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
                  <MissedReasonPanel reason={missedReason} />
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

                <MissedReasonPanel reason={missedReason} />

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
                (a) => a.platform === post.platform && a.status === "active" && a.hasAccessToken !== false
              );
              if (platformAccounts.length === 0) return null;
              return (
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <AtSign className="w-3.5 h-3.5 text-muted-foreground" />
                    Social account
                    {missedReason?.kind === "no_social_account" && (
                      <span className="text-destructive text-[11px] font-normal">— required to publish</span>
                    )}
                  </Label>
                  <Select
                    value={selectedAccountId ?? "__none__"}
                    onValueChange={(v) => setSelectedAccountId(v === "__none__" ? null : v)}
                    disabled={isBusy}
                  >
                    <SelectTrigger data-testid="edit-dialog-social-account" className="w-full">
                      <SelectValue placeholder="Select an account…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No account assigned</SelectItem>
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

            {/* Platform + image */}
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">
                {PLATFORM_LABELS[post.platform] ?? post.platform}
              </p>
              {imageUrl ? (
                <div className="space-y-2">
                  <img
                    src={imageUrl}
                    alt="Post graphic"
                    className="max-h-56 rounded-lg border object-contain"
                    data-testid="img-post-graphic"
                    onError={e => (e.currentTarget.style.display = "none")}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadImageFromUrl(imageUrl, `${safeFileStub((editedText ?? "") || post.platform)}-graphic`)}
                      data-testid="button-download-post-image"
                    >
                      <Download className="w-3.5 h-3.5 mr-1" /> Download
                    </Button>
                    {!isReadOnly && post.overrideImageUrl && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setImageMutation.mutate({ overrideImageUrl: null, overrideBrandAssetId: null })}
                        disabled={isBusy}
                        data-testid="button-remove-post-image"
                      >
                        <X className="w-3.5 h-3.5 mr-1" /> Remove image
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border px-2.5 py-2 text-xs flex items-start gap-1.5 border-border text-muted-foreground">
                  <ImageOff className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>No graphic — this post will publish as text only.</span>
                </div>
              )}
              {!isReadOnly && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => generateImageMutation.mutate()}
                    disabled={isBusy}
                    data-testid="button-generate-post-image"
                  >
                    {generateImageMutation.isPending
                      ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                      : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                    {generateImageMutation.isPending ? "Creating..." : "Generate branded image"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading || isBusy}
                    data-testid="button-upload-post-image"
                  >
                    {isUploading
                      ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                      : <Upload className="w-3.5 h-3.5 mr-1" />}
                    {isUploading ? "Uploading..." : "Upload"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowPicker(v => !v)}
                    data-testid="button-pick-post-image"
                  >
                    <Library className="w-3.5 h-3.5 mr-1" /> {showPicker ? "Hide" : "Visual/Brand Assets"}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) uploadFile(f);
                      e.currentTarget.value = "";
                    }}
                    data-testid="input-upload-post-image"
                  />
                </div>
              )}
              {!isReadOnly && showPicker && (
                <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
                  <Label className="text-xs text-muted-foreground">Select an image from Visual/Brand Assets</Label>
                  {brandImages.length > 0 ? (
                    <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                      {brandImages.map((ba: any) => {
                        const u = ba.fileUrl || ba.url || "";
                        return (
                          <button
                            key={ba.id}
                            type="button"
                            className="relative rounded border overflow-hidden aspect-square hover:ring-2 ring-primary transition-all bg-card"
                            onClick={() => {
                              setImageMutation.mutate({ overrideImageUrl: u, overrideBrandAssetId: ba.id });
                              setShowPicker(false);
                            }}
                            data-testid={`button-brand-image-${ba.id}`}
                          >
                            <img
                              src={u}
                              alt={ba.name}
                              className="w-full h-full object-cover"
                              onError={e => (e.currentTarget.style.display = "none")}
                            />
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No images in Visual/Brand Assets yet.</p>
                  )}
                </div>
              )}
            </div>

            {/* Post text */}
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
              {!isReadOnly && selectedAccountId && (
                <AIRewritePanel
                  socialAccountId={selectedAccountId}
                  draft={editedText ?? ""}
                  postId={postId}
                  onApply={(variant) => setEditedText(variant)}
                />
              )}
            </div>

            {/* Hashtags */}
            {!isReadOnly && (
              <div className="space-y-1.5">
                <Label htmlFor="edit-post-hashtags">Hashtags</Label>
                <Input
                  id="edit-post-hashtags"
                  value={hashtagsValue}
                  onChange={(e) => setHashtagsValue(e.target.value)}
                  placeholder="tag1, tag2, tag3 (comma or space separated)"
                  className="text-sm"
                  data-testid="edit-dialog-hashtags"
                  disabled={isBusy}
                />
              </div>
            )}
            {isReadOnly && (post.hashtags?.length ?? 0) > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {post.hashtags!.map((h, i) => (
                  <Badge key={i} variant="outline" className="text-[10px]">#{h}</Badge>
                ))}
              </div>
            )}

            {/* Scheduled date — editable for non-missed editable posts; missed has its own section above */}
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
                <label className="flex items-center gap-2 cursor-pointer select-none mt-1" data-testid="edit-dialog-exact-schedule">
                  <input
                    type="checkbox"
                    className="rounded border-border accent-primary w-3.5 h-3.5"
                    checked={exactSchedule}
                    onChange={(e) => setExactSchedule(e.target.checked)}
                    disabled={isBusy}
                  />
                  <span className="text-[12px] text-muted-foreground">
                    Post at exact time <span className="opacity-60">(skip naturalistic delay)</span>
                  </span>
                </label>
              </div>
            )}

            {/* Carousel slides */}
            {isCarousel && slides.length > 0 && (
              <div className="space-y-2" data-testid="edit-dialog-carousel">
                <div className="flex items-center justify-between">
                  <Label>Carousel · {slides.length} slides</Label>
                  {slidesWithImages.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px] gap-1"
                      onClick={async () => {
                        toast({ title: `Downloading ${slidesWithImages.length} slides…` });
                        for (let i = 0; i < slidesWithImages.length; i++) {
                          await downloadImageFromUrl(slidesWithImages[i].imageUrl as string, `slide-${i + 1}`);
                        }
                      }}
                      data-testid="button-download-all-slides"
                    >
                      <Download className="w-3 h-3" /> Download all
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  {slides.map((slide) => (
                    <div key={slide.index} className="flex items-center gap-2">
                      {slide.imageUrl ? (
                        <img src={slide.imageUrl} alt={slide.headline} className="w-12 h-8 rounded object-cover border shrink-0" />
                      ) : (
                        <div className="w-12 h-8 rounded border bg-muted shrink-0" />
                      )}
                      <span className="text-xs text-muted-foreground w-16 shrink-0">
                        Slide {slide.index}
                        <br />
                        <span className="text-[10px] opacity-70">{slide.role}</span>
                      </span>
                      {!isReadOnly ? (
                        <Input
                          value={slideUrls[slide.index] ?? slide.imageUrl ?? ""}
                          onChange={(e) => setSlideUrls((prev) => ({ ...prev, [slide.index]: e.target.value }))}
                          placeholder="https://..."
                          className="font-mono text-xs h-8"
                          data-testid={`edit-dialog-slide-url-${slide.index}`}
                          disabled={isBusy}
                        />
                      ) : (
                        <span className="text-[11px] text-muted-foreground truncate">{slide.headline}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Delete — two-step confirm (missed stage handled by the Discard button in the footer) */}
            {!isReadOnly && !isMissed && (
              <div className="pt-1 border-t">
                {confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Delete this post permanently?</span>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteMutation.mutate()}
                      disabled={isBusy}
                      data-testid="edit-dialog-confirm-cancel"
                    >
                      {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
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
                    Delete this post
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4">Could not load post details.</p>
        )}

        <DialogFooter className="gap-2 sm:gap-0 flex-wrap">
          {/* Discard for missed = two-step delete; for others = close without saving */}
          {isMissed ? (
            confirmDelete ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={isBusy}>
                  Keep it
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => deleteMutation.mutate()}
                  disabled={isBusy}
                  data-testid="edit-dialog-confirm-cancel"
                >
                  {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                  Yes, remove it
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setConfirmDelete(true)} disabled={isBusy} data-testid="edit-dialog-close">
                Discard
              </Button>
            )
          ) : (
            <Button variant="outline" onClick={onClose} disabled={isBusy} data-testid="edit-dialog-close">
              {isReadOnly ? "Close" : "Discard"}
            </Button>
          )}

          {/* Status-driven primary actions */}
          {!isReadOnly && post && !isMissed && (
            <>
              {(isDraft || isRejected) && (
                <Button
                  variant="secondary"
                  onClick={() => approveMutation.mutate()}
                  disabled={isBusy}
                  className="gap-1.5"
                  data-testid="edit-dialog-approve"
                >
                  {approveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Save &amp; approve
                </Button>
              )}
              {isDraft && (
                <Button
                  variant="ghost"
                  onClick={() => rejectMutation.mutate()}
                  disabled={isBusy}
                  className="gap-1.5 text-orange-600"
                  data-testid="edit-dialog-reject"
                >
                  {rejectMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                  Reject
                </Button>
              )}
              {(isApproved || isFailed) && post.socialAccountId && post.deliveryMode !== "csv" && (
                <Button
                  variant="secondary"
                  onClick={() => publishMutation.mutate()}
                  disabled={isBusy}
                  className="gap-1.5"
                  data-testid={isFailed ? "edit-dialog-resubmit" : "edit-dialog-publish-now"}
                >
                  {publishMutation.isPending
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : isFailed ? <RefreshCw className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
                  {isFailed ? "Resubmit" : "Publish now"}
                </Button>
              )}
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={isBusy}
                data-testid="edit-dialog-save"
              >
                {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                Save changes
              </Button>
            </>
          )}
          {isMissed && post && !confirmDelete && (
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={isBusy || !canReschedule}
              data-testid="edit-dialog-save"
              className="gap-1.5"
            >
              {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calendar className="w-3.5 h-3.5" />}
              Reschedule &amp; reactivate
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── missed/overdue diagnostic panel ──────────────────────────────────────────

function MissedReasonPanel({ reason }: { reason: MissedReason | null }) {
  if (!reason) return null;
  return (
    <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 text-red-700 dark:text-red-400">
          {reason.kind === "no_social_account" && (
            <><p className="font-medium">No social account linked</p>
            <p className="text-[12px] mt-0.5 opacity-80">Pick an account using the <strong>Social account</strong> field below, then save to reschedule.</p></>
          )}
          {reason.kind === "auto_publish_off" && (
            <><p className="font-medium">Auto-publish is off for this campaign</p>
            <p className="text-[12px] mt-0.5 opacity-80">
              The campaign <strong>{reason.campaignName}</strong> has auto-publish disabled for this account.{" "}
              <a href={`/app/marketing/campaigns/${reason.campaignId}#accounts`} target="_blank" rel="noreferrer" className="underline underline-offset-2 font-medium hover:opacity-70">Turn it on in Campaign → Social Accounts →</a>
            </p></>
          )}
          {reason.kind === "account_not_linked" && (
            <><p className="font-medium">Social account not linked to this campaign</p>
            <p className="text-[12px] mt-0.5 opacity-80">
              This account isn't connected to campaign <strong>{reason.campaignName}</strong>.{" "}
              <a href={`/app/marketing/campaigns/${reason.campaignId}#accounts`} target="_blank" rel="noreferrer" className="underline underline-offset-2 font-medium hover:opacity-70">Add it in Campaign → Social Accounts →</a>
            </p></>
          )}
          {reason.kind === "campaign_inactive" && (
            <><p className="font-medium">Campaign is not active</p>
            <p className="text-[12px] mt-0.5 opacity-80">Campaign <strong>{reason.campaignName}</strong> is not active — the worker only publishes posts on active campaigns.</p></>
          )}
          {reason.kind === "stale_post" && (
            <><p className="font-medium">Post is too old to auto-publish</p>
            <p className="text-[12px] mt-0.5 opacity-80">Posts more than 7 days past their scheduled date are skipped. Use Post now or reschedule to a future time.</p></>
          )}
          {reason.kind === "unknown" && (
            <><p className="font-medium">Configuration looks correct</p>
            <p className="text-[12px] mt-0.5 opacity-80">Check that the social account is connected and the campaign is active, then use Post now to force it.</p></>
          )}
        </div>
      </div>
    </div>
  );
}
