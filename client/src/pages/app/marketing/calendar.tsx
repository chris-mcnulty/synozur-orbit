/**
 * Calendar Page (Phase 4)
 *
 * Month grid of scheduled and recently-published posts. Click a post to
 * open a side panel with full content, status, and a reschedule control.
 * HTML5 drag-and-drop lets the user move a post to a new day; the time of
 * day is preserved so users only need to confirm dates here.
 *
 * Built on date-fns + a hand-rolled grid (~150 LOC) so we don't pull in
 * react-big-calendar for a single screen.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import {
  CalendarDays, ChevronLeft, ChevronRight, X, AtSign, Lock, ExternalLink,
  Sparkles, Upload, Library, Loader2, Share2, Download, Copy,
} from "lucide-react";
import { useUpload } from "@/hooks/use-upload";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, addMonths,
  format, isSameMonth, isSameDay, isToday, parseISO, setHours, setMinutes, setSeconds,
} from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

// Download an image straight to the user's machine. Images are served
// same-origin via Orbit, so we fetch the blob and save it; if blocked, open in
// a new tab as a fallback.
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

interface CalendarPost {
  id: string;
  platform: string;
  preview: string;
  scheduledDate: string | null;
  publishedAt: string | null;
  status: string;
  socialAccountId: string | null;
  campaignId: string | null;
  accountName?: string | null;
  overrideImageUrl?: string | null;
}

const PLATFORM_COLORS: Record<string, string> = {
  linkedin: "bg-blue-100 text-blue-900 border-blue-300",
  twitter: "bg-sky-100 text-sky-900 border-sky-300",
  instagram: "bg-pink-100 text-pink-900 border-pink-300",
  facebook: "bg-indigo-100 text-indigo-900 border-indigo-300",
  bluesky: "bg-cyan-100 text-cyan-900 border-cyan-300",
};

const STATUS_DOT: Record<string, string> = {
  draft: "bg-gray-400",
  approved: "bg-blue-500",
  published: "bg-green-500",
  publish_failed: "bg-red-500",
  exported: "bg-purple-500",
};

export default function CalendarPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Deep-link support: the master Marketing Calendar can link here with a
  // ?post=<id> (and optional &date=<iso>) to land on a specific post.
  const searchString = useSearch();
  const deepLink = useMemo(() => {
    const p = new URLSearchParams(searchString);
    return { postId: p.get("post"), date: p.get("date"), campaignId: p.get("campaignId") };
  }, [searchString]);

  // Filter by campaign. Seeded from the deep-link campaignId when present.
  const [campaignFilter, setCampaignFilter] = useState<string>(() => {
    const p = new URLSearchParams(searchString);
    return p.get("campaignId") || "all";
  });

  const [cursorMonth, setCursorMonth] = useState<Date>(() => {
    const p = new URLSearchParams(searchString);
    const d = p.get("date");
    if (d) {
      const parsed = new Date(d);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
  });
  const [selectedPost, setSelectedPost] = useState<CalendarPost | null>(null);
  // Once we've honored a given deep-link post id, don't reopen it (so the user
  // can freely close the drawer without it snapping back open).
  const [openedDeepLink, setOpenedDeepLink] = useState<string | null>(null);

  const { data: tenantInfo } = useQuery<{ features?: Record<string, boolean> }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
  });
  // Calendar API (/api/generated-posts/calendar) is gated by socialPosts on
  // the backend — match it client-side so the UI doesn't render only to 403.
  const isAllowed = tenantInfo?.features?.socialPosts === true;

  // Campaign names for the filter dropdown.
  const { data: filterOpts } = useQuery<{ campaigns?: { id: string; name: string }[] }>({
    queryKey: ["/api/marketing-calendar/filters"],
    queryFn: async () => {
      const r = await fetch("/api/marketing-calendar/filters", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
    enabled: isAllowed,
  });
  const campaignOptions = filterOpts?.campaigns ?? [];

  const monthStart = startOfMonth(cursorMonth);
  const monthEnd = endOfMonth(cursorMonth);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = useMemo(() => eachDayOfInterval({ start: gridStart, end: gridEnd }), [gridStart, gridEnd]);

  const { data: posts = [], isLoading } = useQuery<CalendarPost[]>({
    queryKey: ["/api/generated-posts/calendar", gridStart.toISOString(), gridEnd.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams({
        from: gridStart.toISOString(),
        to: gridEnd.toISOString(),
        // Also pull undated drafts so freshly generated posts (which have no
        // date yet) are reachable here instead of silently missing.
        includeUnscheduled: "true",
      });
      const r = await fetch(`/api/generated-posts/calendar?${params.toString()}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const filteredPosts = useMemo(
    () => (campaignFilter === "all" ? posts : posts.filter(p => p.campaignId === campaignFilter)),
    [posts, campaignFilter],
  );

  // Bucket posts by ISO day key for fast cell lookups.
  const postsByDay = useMemo(() => {
    const m = new Map<string, CalendarPost[]>();
    filteredPosts.forEach(p => {
      const ts = p.scheduledDate ?? p.publishedAt;
      if (!ts) return;
      const key = format(parseISO(ts), "yyyy-MM-dd");
      const arr = m.get(key) ?? [];
      arr.push(p);
      m.set(key, arr);
    });
    // Sort each day by time of day.
    m.forEach(arr => arr.sort((a, b) => {
      const ta = a.scheduledDate ?? a.publishedAt ?? "";
      const tb = b.scheduledDate ?? b.publishedAt ?? "";
      return ta.localeCompare(tb);
    }));
    return m;
  }, [filteredPosts]);

  // Undated drafts (e.g. freshly repurposed posts) don't land on the date grid,
  // so surface them in their own list below the calendar where they can be
  // opened and scheduled.
  const unscheduledPosts = useMemo(
    () => filteredPosts.filter(p => !p.scheduledDate && !p.publishedAt),
    [filteredPosts],
  );

  // When arriving via a deep link, open the targeted post's drawer once the
  // month's posts have loaded. If the post isn't in this range (or no longer
  // exists), we just leave the calendar on the linked month — no error.
  useEffect(() => {
    if (!deepLink.postId || openedDeepLink === deepLink.postId) return;
    if (isLoading) return;
    const match = posts.find(p => p.id === deepLink.postId);
    if (match) {
      setSelectedPost(match);
      setOpenedDeepLink(deepLink.postId);
    }
  }, [deepLink.postId, openedDeepLink, isLoading, posts]);

  const rescheduleMutation = useMutation({
    mutationFn: async ({ id, scheduledDate }: { id: string; scheduledDate: string }) => {
      const r = await fetch(`/api/generated-posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ scheduledDate }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Reschedule failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/generated-posts/calendar"] });
      toast({ title: "Rescheduled" });
    },
    onError: (err: Error) => toast({ title: "Reschedule failed", description: err.message, variant: "destructive" }),
  });

  const onDropToDay = (day: Date, postId: string) => {
    const post = posts.find(p => p.id === postId);
    if (!post) return;
    const sourceTs = post.scheduledDate ?? post.publishedAt;
    if (!sourceTs) return;
    const source = parseISO(sourceTs);
    // Preserve time of day; replace just the date.
    let next = new Date(day);
    next = setHours(next, source.getHours());
    next = setMinutes(next, source.getMinutes());
    next = setSeconds(next, 0);
    if (isSameDay(next, source)) return; // no-op
    rescheduleMutation.mutate({ id: postId, scheduledDate: next.toISOString() });
  };

  if (!isAllowed) {
    return (
      <AppLayout>
        <div className="p-6 max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md text-center">
            <CardHeader>
              <div className="mx-auto mb-4 p-4 bg-primary/10 rounded-full w-fit">
                <Lock className="w-10 h-10 text-primary" />
              </div>
              <CardTitle>Social Posts</CardTitle>
              <CardDescription>Available on the Enterprise plan. View and schedule social posts across your connected accounts.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <a href="mailto:contactus@synozur.com?subject=Enterprise Plan Inquiry - Social Posts">Contact Sales</a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Link
              href="/app/marketing/marketing-calendar"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1"
              data-testid="link-back-to-marketing-calendar"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Back to Content Calendar
            </Link>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Share2 className="w-6 h-6" /> Social Posts
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Social-only execution view — schedule, reschedule, retry, and add branded graphics for social posts. Part of the{" "}
              <Link href="/app/marketing/marketing-calendar" className="text-primary underline" data-testid="link-master-calendar">
                Content Calendar
              </Link>{" "}
              overview.
            </p>
          </div>
          <div className="flex items-center gap-1">
            {campaignOptions.length > 0 && (
              <select
                value={campaignFilter}
                onChange={(e) => setCampaignFilter(e.target.value)}
                className="mr-2 h-9 rounded-md border bg-background px-2 text-sm"
                data-testid="select-campaign-filter"
              >
                <option value="all">All campaigns</option>
                {campaignOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            <Button variant="outline" size="icon" onClick={() => setCursorMonth(addMonths(cursorMonth, -1))} data-testid="calendar-prev-month">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="px-3 text-sm font-medium min-w-[140px] text-center" data-testid="calendar-current-month">
              {format(cursorMonth, "MMMM yyyy")}
            </div>
            <Button variant="outline" size="icon" onClick={() => setCursorMonth(addMonths(cursorMonth, 1))} data-testid="calendar-next-month">
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" className="ml-2" onClick={() => setCursorMonth(new Date())} data-testid="calendar-today">
              Today
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="grid grid-cols-7 border-b text-xs font-medium text-muted-foreground">
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
                <div key={d} className="px-2 py-2 text-center">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7" data-testid="calendar-grid">
              {days.map(day => {
                const key = format(day, "yyyy-MM-dd");
                const dayPosts = postsByDay.get(key) ?? [];
                const inMonth = isSameMonth(day, cursorMonth);
                return (
                  <div
                    key={key}
                    onDragOver={e => { e.preventDefault(); }}
                    onDrop={e => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData("text/plain");
                      if (id) onDropToDay(day, id);
                    }}
                    className={`min-h-[100px] border-b border-r last:border-r-0 p-1 ${inMonth ? "" : "bg-muted/30 text-muted-foreground"}`}
                    data-testid={`calendar-day-${key}`}
                  >
                    <div className={`text-xs ${isToday(day) ? "font-bold text-primary" : ""}`}>
                      {format(day, "d")}
                    </div>
                    <div className="space-y-0.5 mt-1">
                      {dayPosts.slice(0, 4).map(post => (
                        <div
                          key={post.id}
                          draggable={post.status !== "published"}
                          onDragStart={e => { e.dataTransfer.setData("text/plain", post.id); }}
                          onClick={() => setSelectedPost(post)}
                          className={`text-[10px] px-1 py-0.5 rounded border cursor-pointer truncate flex items-center gap-1 ${PLATFORM_COLORS[post.platform] ?? "bg-gray-100 text-gray-900 border-gray-300"}`}
                          data-testid={`calendar-post-${post.id}`}
                          title={post.preview}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[post.status] ?? "bg-gray-400"}`} />
                          <span className="truncate">{post.preview || "(empty)"}</span>
                        </div>
                      ))}
                      {dayPosts.length > 4 && (
                        <div className="text-[10px] text-muted-foreground pl-1">+{dayPosts.length - 4} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {!isLoading && unscheduledPosts.length > 0 && (
          <Card data-testid="card-unscheduled-drafts">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">Unscheduled drafts</h2>
                <span
                  className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
                  data-testid="badge-unscheduled-count"
                >
                  {unscheduledPosts.length}
                </span>
              </div>
              <p className="mt-1 mb-3 text-xs text-muted-foreground">
                These posts don't have a date yet, so they aren't on the calendar above. Click one to
                add a date, or schedule them in bulk from the campaign's Content Plan.
              </p>
              <div className="space-y-1.5">
                {unscheduledPosts.map(post => (
                  <button
                    key={post.id}
                    type="button"
                    onClick={() => setSelectedPost(post)}
                    className="flex w-full items-center gap-2 rounded border p-2 text-left text-xs hover:bg-muted"
                    data-testid={`unscheduled-post-${post.id}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[post.status] ?? "bg-gray-400"}`} />
                    <span className={`shrink-0 rounded border px-1 text-[10px] ${PLATFORM_COLORS[post.platform] ?? "bg-gray-100 text-gray-900 border-gray-300"}`}>
                      {post.platform}
                    </span>
                    <span className="flex-1 truncate">{post.preview || "(empty)"}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading && <div className="text-sm text-muted-foreground">Loading...</div>}

        {!isLoading && posts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No scheduled or published posts yet. This calendar only shows posts that already have a
            date — generate and schedule them inside a campaign's{" "}
            <span className="font-medium">Content Plan</span>, or compose one in the{" "}
            <Link href="/app/marketing/composer" className="text-primary underline">Composer</Link>.
          </p>
        )}

        {!isLoading && posts.length > 0 && filteredPosts.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="text-empty-campaign-filter">
            No scheduled or published posts for this campaign.{" "}
            <button
              type="button"
              className="text-primary underline"
              onClick={() => setCampaignFilter("all")}
              data-testid="button-clear-campaign-filter"
            >
              Show all campaigns
            </button>
            .
          </p>
        )}

        {selectedPost && (
          <PostDetailDrawer
            key={selectedPost.id}
            post={selectedPost}
            onClose={() => setSelectedPost(null)}
            onReschedule={(iso) => rescheduleMutation.mutate({ id: selectedPost.id, scheduledDate: iso })}
          />
        )}
      </div>
    </AppLayout>
  );
}

function PostDetailDrawer({
  post, onClose, onReschedule,
}: {
  post: CalendarPost;
  onClose: () => void;
  onReschedule: (iso: string) => void;
}) {
  // Convert ISO to local datetime-input format (yyyy-MM-ddTHH:mm).
  const initial = post.scheduledDate
    ? format(parseISO(post.scheduledDate), "yyyy-MM-dd'T'HH:mm")
    : "";
  const [when, setWhen] = useState(initial);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(post.overrideImageUrl ?? null);
  const [showPicker, setShowPicker] = useState(false);

  // The calendar payload only carries a truncated preview; fetch the full row so
  // the user can read and copy the complete post text here.
  const { data: full } = useQuery<{ content?: string | null; editedContent?: string | null }>({
    queryKey: [`/api/generated-posts/${post.id}`],
    queryFn: async () => {
      const r = await fetch(`/api/generated-posts/${post.id}`, { credentials: "include" });
      return r.ok ? r.json() : {};
    },
  });
  const fullText = full?.editedContent ?? full?.content ?? post.preview ?? "";
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      toast({ title: "Copied", description: "Post text copied to clipboard." });
    } catch {
      toast({ title: "Couldn't copy", description: "Select the text and copy it manually.", variant: "destructive" });
    }
  };

  const invalidateCalendar = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/generated-posts/calendar"] });

  const generateImage = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/generated-posts/${post.id}/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Generation failed");
      return r.json();
    },
    onSuccess: (row: { overrideImageUrl?: string | null }) => {
      setImageUrl(row.overrideImageUrl ?? null);
      invalidateCalendar();
      toast({ title: "Branded image created" });
    },
    onError: (err: Error) => toast({ title: "Couldn't create image", description: err.message, variant: "destructive" }),
  });

  const setImage = useMutation({
    mutationFn: async (payload: { overrideImageUrl: string | null; overrideBrandAssetId?: string | null }) => {
      const r = await fetch(`/api/generated-posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Update failed");
      return r.json();
    },
    onSuccess: (row: { overrideImageUrl?: string | null }) => {
      setImageUrl(row.overrideImageUrl ?? null);
      invalidateCalendar();
    },
    onError: (err: Error) => toast({ title: "Couldn't update image", description: err.message, variant: "destructive" }),
  });

  const { uploadFile, isUploading } = useUpload({
    onSuccess: (resp) => setImage.mutate({ overrideImageUrl: resp.objectPath, overrideBrandAssetId: null }),
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative bg-background w-full max-w-md h-full shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">{post.platform}</Badge>
            <span className="text-sm font-medium">{post.accountName ?? "Account"}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="calendar-detail-close">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Status</div>
            <Badge variant="outline">{post.status}</Badge>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Content</div>
            <p
              className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-sm"
              data-testid="text-post-content"
            >
              {fullText}
            </p>
            {fullText && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 gap-1.5"
                onClick={copyText}
                data-testid="button-copy-post-text"
              >
                <Copy className="w-3.5 h-3.5" /> Copy text
              </Button>
            )}
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Image</div>
            {imageUrl ? (
              <div className="space-y-2">
                <img
                  src={imageUrl}
                  alt="Post graphic"
                  className="w-full rounded-lg border"
                  data-testid="img-post-graphic"
                  onError={e => (e.currentTarget.style.display = "none")}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadImageFromUrl(imageUrl!, `${safeFileStub(post.preview || post.platform)}-graphic`)}
                    data-testid="button-download-post-image"
                  >
                    <Download className="w-3.5 h-3.5 mr-1" /> Download
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setImage.mutate({ overrideImageUrl: null, overrideBrandAssetId: null })}
                    disabled={setImage.isPending}
                    data-testid="button-remove-post-image"
                  >
                    <X className="w-3.5 h-3.5 mr-1" /> Remove image
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No image yet.</p>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => generateImage.mutate()}
                disabled={generateImage.isPending}
                data-testid="button-generate-post-image"
              >
                {generateImage.isPending
                  ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                {generateImage.isPending ? "Creating..." : "Generate branded image"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
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
            {showPicker && (
              <div className="border rounded-lg p-3 mt-2 bg-muted/30 space-y-2">
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
                            setImage.mutate({ overrideImageUrl: u, overrideBrandAssetId: ba.id });
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
          {post.status !== "published" && (
            <div>
              <Label className="text-xs">Reschedule</Label>
              <div className="flex gap-2 items-center mt-1">
                <Input
                  type="datetime-local"
                  value={when}
                  onChange={e => setWhen(e.target.value)}
                  data-testid="calendar-detail-when"
                />
                <Button
                  size="sm"
                  disabled={!when || when === initial}
                  onClick={() => onReschedule(new Date(when).toISOString())}
                  data-testid="calendar-detail-reschedule"
                >
                  Save
                </Button>
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-2 border-t">
            {post.campaignId ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/app/marketing/campaigns/${post.campaignId}`}>
                  <ExternalLink className="w-3.5 h-3.5 mr-1" /> Open campaign
                </Link>
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link href="/app/marketing/composer">
                  <ExternalLink className="w-3.5 h-3.5 mr-1" /> Composer
                </Link>
              </Button>
            )}
            {post.socialAccountId && (
              <Button asChild variant="outline" size="sm">
                <Link href="/app/marketing/social-accounts">
                  <AtSign className="w-3.5 h-3.5 mr-1" /> Account
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
