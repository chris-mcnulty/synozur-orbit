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
import { useDeepLinkFocus } from "@/lib/use-deep-link-focus";
import { Link, useSearch } from "wouter";
import {
  AlertTriangle, ChevronLeft, ChevronRight, AtSign, Lock,
  Loader2, Share2,
} from "lucide-react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, addMonths,
  format, isSameMonth, isSameDay, isToday, parseISO, setHours, setMinutes, setSeconds,
} from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import { CalendarViewSwitcher } from "@/components/marketing/CalendarViewSwitcher";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import SocialPostEditor from "@/components/marketing/SocialPostEditor";

interface CalendarPost {
  id: string;
  platform: string;
  preview: string;
  scheduledDate: string | null;
  publishedAt: string | null;
  status: string;
  socialAccountId: string | null;
  campaignId: string | null;
  campaignName?: string | null;
  accountName?: string | null;
  accountStatus?: string | null;
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

  // Filter by campaign. Seeded from the deep-link campaignId when present.
  const [campaignFilter, setCampaignFilter] = useState<string>(() => {
    const p = new URLSearchParams(searchString);
    return p.get("campaignId") || "all";
  });
  // Filter by platform (client-side, same as campaign filter).
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [reassignOpen, setReassignOpen] = useState(false);

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
  // Ref tracks which deep-link post id has already been opened so the user can
  // freely close the drawer without it snapping back open.
  const openedDeepLinkRef = useRef<string | null>(null);
  // Fallback highlight: when the deep-linked post sits beyond a day's visible
  // slice (the "+N more" overflow) its pill isn't in the DOM, so we highlight
  // the whole day cell instead. Holds the "yyyy-MM-dd" key. Cleared after cue.
  const [focusDayKey, setFocusDayKey] = useState<string | null>(null);
  // Day whose posts are fully expanded (past the 4-post "+N more" cap). Set
  // automatically when a deep-linked post is hidden in that day's overflow so
  // its pill can render and be scrolled to; also toggled by "+N more".
  const [expandedDayKey, setExpandedDayKey] = useState<string | null>(null);

  const { data: tenantInfo } = useQuery<{ features?: Record<string, boolean> }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
  });
  // Calendar API (/api/generated-posts/calendar) is gated by socialPosts on
  // the backend — match it client-side so the UI doesn't render only to 403.
  // Default true while loading — show the page skeleton rather than the paywall.
  // The paywall only renders once tenantInfo has resolved and socialPosts is
  // confirmed false. Using === true while undefined flashes "Contact Sales".
  const isAllowedResolved = tenantInfo !== undefined;
  const isAllowed = !isAllowedResolved || tenantInfo?.features?.socialPosts === true;

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
    () => posts.filter(p =>
      (campaignFilter === "all" || p.campaignId === campaignFilter) &&
      (platformFilter === "all" || p.platform === platformFilter),
    ),
    [posts, campaignFilter, platformFilter],
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

  // Deep-link: useDeepLinkFocus reads ?post=, scrolls the matched pill into
  // view (dated posts only), fires onFound once the element is in the DOM.
  // Overflow ("+N more") and undated posts need the extra effect below since
  // their DOM elements appear later or use a different testid prefix.
  const [focusId] = useDeepLinkFocus<CalendarPost>({
    paramName: "post",
    items: posts,
    testIdPrefix: "calendar-post",
    onFound: (match) => {
      if (openedDeepLinkRef.current !== match.id) {
        setSelectedPost(match);
        openedDeepLinkRef.current = match.id;
      }
    },
  });

  // Supplemental scroll handler for:
  //  - Undated posts (testid "unscheduled-post-*", different prefix than hook)
  //  - Dated posts hidden in "+N more" overflow (not in DOM until day expands)
  // Also opens the drawer for the above cases where onFound won't fire.
  useEffect(() => {
    if (!focusId || isLoading) return;
    // Undated rail — hook can't find this element (wrong prefix).
    const unscheduledEl = document.querySelector(`[data-testid="unscheduled-post-${focusId}"]`);
    if (unscheduledEl) {
      unscheduledEl.scrollIntoView({ behavior: "smooth", block: "center" });
      if (openedDeepLinkRef.current !== focusId) {
        const match = posts.find(p => p.id === focusId);
        if (match) { setSelectedPost(match); openedDeepLinkRef.current = focusId; }
      }
      return;
    }
    // Dated post hidden in overflow — open the drawer immediately (same as the
    // old effect), then expand the day so its pill becomes visible and the hook
    // can scroll to it on the next render. Opening the drawer does not require
    // the pill to be in the DOM.
    const match = filteredPosts.find(p => p.id === focusId);
    if (match) {
      if (openedDeepLinkRef.current !== focusId) {
        setSelectedPost(match);
        openedDeepLinkRef.current = focusId;
      }
      const ts = match.scheduledDate ?? match.publishedAt;
      if (ts) {
        const dayKey = format(parseISO(ts), "yyyy-MM-dd");
        if (expandedDayKey !== dayKey) {
          setExpandedDayKey(dayKey);
          setFocusDayKey(dayKey);
          const cell = document.querySelector(`[data-testid="calendar-day-${dayKey}"]`);
          cell?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    }
  }, [focusId, isLoading, filteredPosts, expandedDayKey, posts]);

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
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Share2 className="w-6 h-6" /> Social Posts
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Social-only execution view — schedule, reschedule, retry, and add branded graphics for social posts.
            </p>
            <CalendarViewSwitcher className="mt-3" />
            <div className="flex items-center gap-3 flex-wrap mt-2 text-[11px] text-muted-foreground">
              <span className="font-medium">Key:</span>
              {(["linkedin","twitter","instagram","facebook","bluesky"] as const).map(p => (
                <span key={p} className={`px-1.5 py-0.5 rounded border capitalize ${PLATFORM_COLORS[p]}`}>{p}</span>
              ))}
              <span className="ml-2 font-medium">Status dot:</span>
              {([["Draft","bg-gray-400"],["Approved","bg-blue-500"],["Published","bg-green-500"],["Failed","bg-red-500"],["Exported","bg-purple-500"]] as const).map(([label,cls]) => (
                <span key={label} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full shrink-0 ${cls}`}/>{label}</span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="mr-2" onClick={() => setReassignOpen(true)} data-testid="button-open-reassign">
              <AtSign className="w-3.5 h-3.5 mr-1" /> Reassign account
            </Button>
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="mr-2 h-9 rounded-md border bg-background px-2 text-sm capitalize"
              data-testid="select-platform-filter"
            >
              <option value="all">All platforms</option>
              {(["linkedin","twitter","instagram","facebook","bluesky"] as const).map(p => (
                <option key={p} value={p}>{p === "twitter" ? "X (Twitter)" : p}</option>
              ))}
            </select>
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
                    className={`min-h-[100px] border-b border-r last:border-r-0 p-1 ${inMonth ? "" : "bg-muted/30 text-muted-foreground"} ${focusDayKey === key ? "ring-2 ring-inset ring-primary" : ""}`}
                    data-testid={`calendar-day-${key}`}
                  >
                    <div className={`text-xs ${isToday(day) ? "font-bold text-primary" : ""}`}>
                      {format(day, "d")}
                    </div>
                    <div className="space-y-0.5 mt-1">
                      {(expandedDayKey === key ? dayPosts : dayPosts.slice(0, 4)).map(post => (
                        <div
                          key={post.id}
                          draggable={post.status !== "published"}
                          onDragStart={e => { e.dataTransfer.setData("text/plain", post.id); }}
                          onClick={() => setSelectedPost(post)}
                          className={`text-[10px] px-1 py-0.5 rounded border cursor-pointer truncate flex items-center gap-1 ${PLATFORM_COLORS[post.platform] ?? "bg-gray-100 text-gray-900 border-gray-300"} ${focusId === post.id ? "ring-2 ring-primary ring-offset-1" : ""}`}
                          data-testid={`calendar-post-${post.id}`}
                          title={post.accountStatus === "needs_reconnect"
                            ? `⚠ Disconnected account — ${post.accountName ?? "unknown"} · ${post.preview}`
                            : post.accountName ? `${post.accountName} · ${post.preview}` : post.preview}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[post.status] ?? "bg-gray-400"}`} />
                          {post.accountStatus === "needs_reconnect" && (
                            <AlertTriangle className="w-2.5 h-2.5 shrink-0 text-amber-500" aria-label="Disconnected account" />
                          )}
                          {post.accountName && <span className="shrink-0 font-medium">{post.accountName}</span>}
                          {post.accountName && <span className="shrink-0 opacity-50">·</span>}
                          <span className="truncate">{post.preview || "(empty)"}</span>
                        </div>
                      ))}
                      {dayPosts.length > 4 && (
                        <button
                          type="button"
                          onClick={() => setExpandedDayKey(prev => (prev === key ? null : key))}
                          className="text-[10px] text-muted-foreground pl-1 hover:text-foreground hover:underline"
                          data-testid={`calendar-day-toggle-${key}`}
                        >
                          {expandedDayKey === key ? "Show less" : `+${dayPosts.length - 4} more`}
                        </button>
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
                    className={`flex w-full items-center gap-2 rounded border p-2 text-left text-xs hover:bg-muted ${focusId === post.id ? "ring-2 ring-primary ring-offset-1" : ""}`}
                    data-testid={`unscheduled-post-${post.id}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[post.status] ?? "bg-gray-400"}`} />
                    <span className={`shrink-0 rounded border px-1 text-[10px] ${PLATFORM_COLORS[post.platform] ?? "bg-gray-100 text-gray-900 border-gray-300"}`}>
                      {post.platform}
                    </span>
                    {post.accountName && (
                      <span className="shrink-0 text-[10px] text-muted-foreground font-medium" data-testid={`badge-account-${post.id}`}>
                        {post.accountName}
                      </span>
                    )}
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

        <ReassignAccountDialog open={reassignOpen} onClose={() => setReassignOpen(false)} />

        {selectedPost && (
          <SocialPostEditor
            key={selectedPost.id}
            postId={selectedPost.id}
            campaignName={selectedPost.campaignName}
            onClose={() => setSelectedPost(null)}
          />
        )}
      </div>
    </AppLayout>
  );
}

function ReassignAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [targetAccountId, setTargetAccountId] = useState<string>("");
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // Fresh start each time the dialog opens — stale target/selection from a
  // previous session could otherwise be applied by accident.
  useEffect(() => {
    if (open) {
      setTargetAccountId("");
      setChecked(new Set());
    }
  }, [open]);

  const { data: accounts = [] } = useQuery<Array<{ id: string; platform: string; accountName: string | null; status: string }>>({
    queryKey: ["/api/social-accounts"],
    queryFn: async () => {
      const r = await fetch("/api/social-accounts", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: open,
  });
  const targetAccount = accounts.find(a => a.id === targetAccountId) ?? null;

  // All pending posts for the target platform, tenant-wide: wide date window
  // plus undated drafts, filtered client-side to unpublished statuses.
  const { data: candidatePosts = [], isLoading: postsLoading } = useQuery<CalendarPost[]>({
    queryKey: ["/api/generated-posts/calendar", "reassign", targetAccount?.platform ?? "none"],
    queryFn: async () => {
      const now = new Date();
      // Only posts that can still publish: from the start of today forward,
      // plus undated drafts. Past-dated posts are dead weight here.
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const params = new URLSearchParams({
        from: startOfToday.toISOString(),
        to: new Date(now.getTime() + 365 * 86400000).toISOString(),
        includeUnscheduled: "true",
        platform: targetAccount!.platform,
      });
      const r = await fetch(`/api/generated-posts/calendar?${params.toString()}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: open && !!targetAccount,
  });
  const pending = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return candidatePosts.filter(p =>
      // Exported posts were already handed off to an external tool; published
      // posts are history. Neither should be reassigned.
      ["draft", "approved", "publish_failed"].includes(p.status) &&
      // Unscheduled, or scheduled today onward — past-dated posts won't publish.
      (!p.scheduledDate || parseISO(p.scheduledDate) >= todayStart),
    );
  }, [candidatePosts]);

  // Pre-select every pending post not already on the target account whenever
  // the target (and thus the candidate list) changes.
  useEffect(() => {
    setChecked(new Set(pending.filter(p => p.socialAccountId !== targetAccountId).map(p => p.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.length, targetAccountId]);

  const reassignMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/generated-posts/bulk-reassign-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ socialAccountId: targetAccountId, postIds: Array.from(checked) }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Reassign failed");
      return r.json() as Promise<{ updated: number }>;
    },
    onSuccess: (data) => {
      toast({ title: "Posts reassigned", description: `${data.updated} post(s) now publish via ${targetAccount?.accountName ?? "the selected account"}.` });
      queryClient.invalidateQueries({ queryKey: ["/api/generated-posts/calendar"] });
      onClose();
    },
    onError: (err: any) => toast({ title: "Reassign failed", description: err.message, variant: "destructive" }),
  });

  const allChecked = pending.length > 0 && pending.every(p => checked.has(p.id));

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reassign posting account</DialogTitle>
          <DialogDescription>
            Move pending (unpublished) posts to a different connected account — e.g. after reconnecting or recreating an account. Published posts are not changed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Publish via</Label>
            <select
              value={targetAccountId}
              onChange={e => setTargetAccountId(e.target.value)}
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              data-testid="select-reassign-target-account"
            >
              <option value="">Choose an account…</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {(a.platform === "twitter" ? "X" : a.platform)} — {a.accountName ?? a.id}{a.status !== "active" ? ` (${a.status.replace(/_/g, " ")})` : ""}
                </option>
              ))}
            </select>
            {targetAccount && targetAccount.status !== "active" && (
              <p className="text-xs text-amber-600 dark:text-amber-500">This account is not active — posts assigned to it won't publish until it's reconnected.</p>
            )}
          </div>
          {targetAccount && (
            postsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="w-4 h-4 animate-spin" /> Loading pending posts…</div>
            ) : pending.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No pending {targetAccount.platform === "twitter" ? "X" : targetAccount.platform} posts found.</p>
            ) : (
              <div className="border rounded">
                <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40">
                  <Checkbox
                    checked={allChecked}
                    onCheckedChange={v => setChecked(v ? new Set(pending.map(p => p.id)) : new Set())}
                    data-testid="checkbox-reassign-all"
                  />
                  <span className="text-xs font-medium">{checked.size} of {pending.length} pending post(s) selected</span>
                </div>
                <div className="max-h-64 overflow-y-auto divide-y">
                  {pending.map(p => (
                    <label key={p.id} className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-muted/30">
                      <Checkbox
                        checked={checked.has(p.id)}
                        onCheckedChange={v => setChecked(prev => {
                          const next = new Set(prev);
                          if (v) next.add(p.id); else next.delete(p.id);
                          return next;
                        })}
                        className="mt-0.5"
                        data-testid={`checkbox-reassign-${p.id}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs truncate">{p.preview}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {p.status.replace(/_/g, " ")} · {p.scheduledDate ? format(parseISO(p.scheduledDate), "MMM d, h:mm a") : "unscheduled"} · currently: {p.accountName ?? "no account"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              disabled={!targetAccountId || checked.size === 0 || reassignMutation.isPending}
              onClick={() => reassignMutation.mutate()}
              data-testid="button-reassign-apply"
            >
              {reassignMutation.isPending ? "Reassigning…" : `Reassign ${checked.size} post(s)`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
