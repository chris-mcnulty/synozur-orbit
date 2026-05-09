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

import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  CalendarDays, ChevronLeft, ChevronRight, X, AtSign, Lock, ExternalLink,
} from "lucide-react";
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
  const [cursorMonth, setCursorMonth] = useState<Date>(new Date());
  const [selectedPost, setSelectedPost] = useState<CalendarPost | null>(null);

  const { data: tenantInfo } = useQuery<{ features?: Record<string, boolean> }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
  });
  const isAllowed = tenantInfo?.features?.socialAccounts === true;

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
      });
      const r = await fetch(`/api/generated-posts/calendar?${params.toString()}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  // Bucket posts by ISO day key for fast cell lookups.
  const postsByDay = useMemo(() => {
    const m = new Map<string, CalendarPost[]>();
    posts.forEach(p => {
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
  }, [posts]);

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
              <CardTitle>Social Calendar</CardTitle>
              <CardDescription>Available on the Enterprise plan. View and schedule social posts across your connected accounts.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <a href="mailto:contactus@synozur.com?subject=Enterprise Plan Inquiry - Social Calendar">Contact Sales</a>
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
              <CalendarDays className="w-6 h-6" /> Social Calendar
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Scheduled and recently-published posts. Drag to reschedule. Click for details.
            </p>
          </div>
          <div className="flex items-center gap-1">
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

        {isLoading && <div className="text-sm text-muted-foreground">Loading...</div>}

        {!isLoading && posts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No scheduled or published posts in this range. Compose one in the{" "}
            <Link href="/app/marketing/composer" className="text-primary underline">Composer</Link>.
          </p>
        )}

        {selectedPost && (
          <PostDetailDrawer
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
            <div className="text-xs text-muted-foreground mb-1">Preview</div>
            <p className="text-sm whitespace-pre-wrap">{post.preview}</p>
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
