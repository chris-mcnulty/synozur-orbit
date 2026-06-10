import type { Dispatch, DragEvent as ReactDragEvent, SetStateAction } from "react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
  CheckCircle2,
  FileDown,
  Mail,
  Share2,
  PenLine,
  ExternalLink,
  Inbox,
  CalendarRange,
  Tag,
  X,
  GripVertical,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getTabContextHeaders } from "@/lib/tabContext";

type ItemType = "social" | "email" | "content";
type Lifecycle = "draft" | "approved" | "delivered";

interface CalendarItem {
  id: string;
  type: ItemType;
  title: string;
  preview: string;
  date: string | null;
  status: string;
  lifecycle: Lifecycle;
  platform?: string;
  format?: string;
  contentAssetId?: string | null;
  campaignId?: string | null;
  solutionAreaId?: string | null;
  conferenceId?: string | null;
  // Server-resolved labels (scoped tenant-wide, so out-of-market assignments
  // still render a name instead of going blank).
  campaignName?: string | null;
  solutionAreaName?: string | null;
  conferenceName?: string | null;
  imageUrl?: string | null;
  // WS4: when a dense social batch is collapsed into one item.
  isBatch?: boolean;
  batchKey?: string;
  day?: string;
  count?: number;
  platforms?: Record<string, number>;
}

const PLATFORM_ABBR: Record<string, string> = {
  linkedin: "LI", twitter: "X", x: "X", facebook: "FB", instagram: "IG",
};

// Summarize a batch's platform breakdown, e.g. "LI 24 · X 30".
function batchBreakdown(platforms?: Record<string, number>): string {
  if (!platforms) return "";
  return Object.entries(platforms)
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${PLATFORM_ABBR[p] ?? p} ${n}`)
    .join(" · ");
}

// Normalize a server "social_batch" item into a calendar item that renders via
// the existing social styling, flagged so pills/handlers treat it as a batch.
function normalizeBatchItems(rows: CalendarItem[]): CalendarItem[] {
  return rows.map((r) => {
    if ((r as any).type !== "social_batch") return r;
    const breakdown = batchBreakdown((r as any).platforms);
    return {
      ...r,
      type: "social",
      isBatch: true,
      title: `${(r as any).count ?? 0} social posts${breakdown ? ` · ${breakdown}` : ""}`,
      lifecycle: r.lifecycle ?? "draft",
    } as CalendarItem;
  });
}

interface FilterOption {
  id: string;
  name: string;
}
interface FilterOptions {
  campaigns: FilterOption[];
  solutionAreas: FilterOption[];
  conferences: FilterOption[];
  socialChannels?: FilterOption[];
  contentFormats?: FilterOption[];
}

// ── Type filter (bucket → channel/format) ──
// A single string drives the filter: "all", a bucket ("social"/"email"/
// "content"), a social channel ("social:linkedin"), or a content format
// ("content:blog_post"). Email is its own bucket with no sub-dimension.
function matchesTypeFilter(item: CalendarItem, tf: string): boolean {
  if (tf === "all") return true;
  if (tf.includes(":")) {
    const [bucket, sub] = tf.split(":");
    if (item.type !== bucket) return false;
    if (bucket === "social") return (item.platform ?? "").toLowerCase() === sub;
    if (bucket === "content") return (item.format ?? "") === sub;
    return true;
  }
  return item.type === tf;
}

function typeFilterLabel(tf: string, filterOpts?: FilterOptions): string {
  if (tf === "all") return "All types";
  if (tf.includes(":")) {
    const [bucket, sub] = tf.split(":");
    if (bucket === "social") return filterOpts?.socialChannels?.find((c) => c.id === sub)?.name ?? sub;
    if (bucket === "content") return filterOpts?.contentFormats?.find((f) => f.id === sub)?.name ?? sub;
    return sub;
  }
  return TYPE_META[tf as ItemType]?.label ?? tf;
}

// Grouped type/channel/format dropdown shared by the calendar and the backlog.
// Top-level buckets, then per-channel social options and per-format content
// options pulled from the filters endpoint.
function TypeFilterSelect({
  value, onChange, filterOpts, testid,
}: {
  value: string;
  onChange: (v: string) => void;
  filterOpts?: FilterOptions;
  testid?: string;
}) {
  const channels = filterOpts?.socialChannels ?? [];
  const formats = filterOpts?.contentFormats ?? [];
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[170px]" data-testid={testid ?? "select-type-filter"}>
        <SelectValue placeholder="Type">{typeFilterLabel(value, filterOpts)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All types</SelectItem>
        <SelectItem value="social">Social — all</SelectItem>
        {channels.map((c) => (
          <SelectItem key={`social:${c.id}`} value={`social:${c.id}`} data-testid={`option-social-${c.id}`}>
            &nbsp;&nbsp;{c.name}
          </SelectItem>
        ))}
        <SelectItem value="email">Email</SelectItem>
        <SelectItem value="content">Content — all</SelectItem>
        {formats.map((f) => (
          <SelectItem key={`content:${f.id}`} value={`content:${f.id}`} data-testid={`option-content-${f.id}`}>
            &nbsp;&nbsp;{f.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface DateAdvice {
  date: string;
  count: number;
  busy: boolean;
  threshold: number;
  suggestion: string | null;
}

// Inline warning that appears when the chosen day already has several activities,
// offering the nearest open weekday. Quiet when the day is clear.
function DateCrowdingHint({ date, onPick, testid }: { date: string; onPick?: (d: string) => void; testid?: string }) {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date || "");
  const tz = new Date().getTimezoneOffset();
  const { data } = useQuery<DateAdvice>({
    queryKey: [`/api/marketing-calendar/date-advice?date=${date}&tzOffset=${tz}`],
    enabled: valid,
  });
  if (!valid || !data || !data.busy) return null;
  const pretty = prettyDay;
  return (
    <p className="text-xs text-amber-600 dark:text-amber-400" data-testid={testid ?? "text-crowding-hint"}>
      This day already has {data.count} activities.
      {data.suggestion && (
        <>
          {" "}Try{" "}
          {onPick ? (
            <button type="button" className="font-medium underline" onClick={() => onPick(data.suggestion!)} data-testid="button-crowding-suggestion">
              {pretty(data.suggestion)}
            </button>
          ) : (
            <span className="font-medium">{pretty(data.suggestion)}</span>
          )}
          {" "}instead.
        </>
      )}
    </p>
  );
}

const TYPE_META: Record<ItemType, { label: string; dot: string; chip: string }> = {
  social: { label: "Social", dot: "bg-blue-500", chip: "border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900" },
  email: { label: "Email", dot: "bg-amber-500", chip: "border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900" },
  content: { label: "Content", dot: "bg-violet-500", chip: "border-violet-200 bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-900" },
};

// Short, scannable markers for a social post's channel or a content draft's
// format, mirroring the friendly names from the server's /filters endpoint
// (PLATFORM_LABELS / FORMAT_LABELS). Surfaced on every calendar pill/row so a
// filtered or unfiltered calendar is easy to read at a glance.
const CHANNEL_MARKERS: Record<string, { abbr: string; label: string }> = {
  linkedin: { abbr: "LI", label: "LinkedIn" },
  twitter: { abbr: "X", label: "X / Twitter" },
  x: { abbr: "X", label: "X / Twitter" },
  facebook: { abbr: "FB", label: "Facebook" },
  instagram: { abbr: "IG", label: "Instagram" },
  blog: { abbr: "Blog", label: "Blog" },
};
const FORMAT_MARKERS: Record<string, { abbr: string; label: string }> = {
  blog_post: { abbr: "Blog", label: "Blog post" },
  whitepaper: { abbr: "WP", label: "Whitepaper" },
  case_study: { abbr: "Case", label: "Case study" },
  landing_page: { abbr: "LP", label: "Landing page" },
  video_script: { abbr: "Video", label: "Video script" },
  newsletter: { abbr: "News", label: "Newsletter" },
  linkedin_post: { abbr: "LI", label: "LinkedIn post" },
  x_post: { abbr: "X", label: "X post" },
};

function titleizeClient(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Resolve the channel (social) or format (content) marker for an item, or null
// when the item has no sub-dimension (e.g. email, or a social post with no
// platform recorded).
function channelFormatMarker(item: CalendarItem): { abbr: string; label: string } | null {
  if (item.type === "social" && item.platform) {
    const p = item.platform.toLowerCase();
    return CHANNEL_MARKERS[p] ?? { abbr: titleizeClient(p).slice(0, 4), label: titleizeClient(p) };
  }
  if (item.type === "content" && item.format) {
    const f = item.format;
    return FORMAT_MARKERS[f] ?? { abbr: titleizeClient(f).slice(0, 4), label: titleizeClient(f) };
  }
  return null;
}

// Tiny pill carrying a social channel / content format abbreviation, shown on
// calendar items across all views. Tooltip spells out the full name.
function ChannelFormatTag({ item }: { item: CalendarItem }) {
  const marker = channelFormatMarker(item);
  if (!marker) return null;
  return (
    <span
      className="shrink-0 rounded bg-black/[0.06] px-1 text-[9px] font-semibold uppercase leading-[1.4] tracking-wide text-foreground/70 dark:bg-white/10"
      title={marker.label}
      data-testid={`tag-channel-format-${item.id}`}
    >
      {marker.abbr}
    </span>
  );
}

const LIFECYCLE_META: Record<Lifecycle, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-muted text-muted-foreground" },
  approved: { label: "Approved", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  delivered: { label: "Delivered", cls: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" },
};

type AssignmentKind = "campaign" | "theme" | "event";

const ASSIGN_META: Record<AssignmentKind, { label: string; dot: string; chip: string }> = {
  campaign: { label: "Campaign", dot: "bg-rose-500", chip: "border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900" },
  theme: { label: "Theme", dot: "bg-teal-500", chip: "border-teal-200 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-900" },
  event: { label: "Event", dot: "bg-indigo-500", chip: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-900" },
};

interface ResolvedAssignment {
  kind: AssignmentKind;
  name: string;
}

function resolveAssignments(item: CalendarItem, filterOpts?: FilterOptions): ResolvedAssignment[] {
  const find = (list: FilterOption[] | undefined, id: string) => list?.find((o) => o.id === id)?.name;
  const out: ResolvedAssignment[] = [];
  // Prefer the server-resolved name (works even for out-of-scope assignments);
  // fall back to the in-scope filter option list when it isn't provided.
  if (item.campaignId) {
    const name = item.campaignName ?? find(filterOpts?.campaigns, item.campaignId);
    if (name) out.push({ kind: "campaign", name });
  }
  if (item.solutionAreaId) {
    const name = item.solutionAreaName ?? find(filterOpts?.solutionAreas, item.solutionAreaId);
    if (name) out.push({ kind: "theme", name });
  }
  if (item.conferenceId) {
    const name = item.conferenceName ?? find(filterOpts?.conferences, item.conferenceId);
    if (name) out.push({ kind: "event", name });
  }
  return out;
}

// Drag payload type for already-scheduled pills, distinct from the backlog
// rail's "application/json" descriptor array so day cells can tell a reschedule
// drag apart from a backlog schedule drag.
const SCHEDULED_DRAG_TYPE = "application/x-orbit-scheduled";

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function localKey(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return ymd(d);
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function quarterRange(d: Date) {
  const q = Math.floor(d.getMonth() / 3);
  const start = new Date(d.getFullYear(), q * 3, 1);
  const end = new Date(d.getFullYear(), q * 3 + 3, 0, 23, 59, 59);
  return { start, end };
}
function prettyDay(d: string) {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function MarketingCalendarPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [view, setView] = useState<"calendar" | "backlog">("calendar");
  const [anchor, setAnchor] = useState(() => startOfMonth(new Date()));
  const [grouping, setGrouping] = useState<"month" | "quarter">("month");
  const [groupBy, setGroupBy] = useState<"none" | "campaign" | "theme" | "event">("none");
  const [filters, setFilters] = useState({ campaignId: "all", solutionAreaId: "all", conferenceId: "all" });
  // Shared type/channel/format filter used by both the calendar and the backlog.
  const [typeFilter, setTypeFilter] = useState("all");

  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<CalendarItem | null>(null);
  // WS4: when drilling into a collapsed social batch (shows its members).
  const [batchDrill, setBatchDrill] = useState<{ key: string; day: string; label: string } | null>(null);
  // When a draft is dropped onto a crowded day, we hold the drop here and ask
  // the user to confirm (or pick the suggested open day) before scheduling.
  const [pendingDrop, setPendingDrop] = useState<{ descriptors: { type: string; id: string }[]; dateKey: string } | null>(null);

  // ── Backlog state ──
  const [backlogFilters, setBacklogFilters] = useState({ campaignId: "all", solutionAreaId: "all", conferenceId: "all", status: "all" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDate, setBulkDate] = useState("");
  const [assignKind, setAssignKind] = useState<AssignmentKind>("campaign");
  const [assignValue, setAssignValue] = useState("none");

  const range = useMemo(() => {
    if (grouping === "quarter") return quarterRange(anchor);
    const start = startOfMonth(anchor);
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59);
    return { start, end };
  }, [anchor, grouping]);

  // The calendar grid shows ONLY scheduled items in the active window.
  const queryUrl = useMemo(() => {
    const p = new URLSearchParams();
    p.set("from", range.start.toISOString());
    p.set("to", range.end.toISOString());
    if (filters.campaignId !== "all") p.set("campaignId", filters.campaignId);
    if (filters.solutionAreaId !== "all") p.set("solutionAreaId", filters.solutionAreaId);
    if (filters.conferenceId !== "all") p.set("conferenceId", filters.conferenceId);
    // Drilling into a batch returns its individual posts (scoped to the exact
    // source + day it was collapsed from); otherwise collapse dense social
    // batches so the calendar isn't a wall of identical posts.
    if (batchDrill) { p.set("batchId", batchDrill.key); p.set("batchDay", batchDrill.day); }
    else p.set("rollupSocial", "true");
    return `/api/marketing-calendar?${p.toString()}`;
  }, [range, filters, batchDrill]);

  // The backlog query returns ONLY unscheduled drafts, tenant-wide, with no
  // calendar filters applied — the backlog has its own independent filters.
  const backlogUrl = "/api/marketing-calendar?unscheduledOnly=true";

  const { data: items = [], isLoading } = useQuery<CalendarItem[]>({ queryKey: [queryUrl], select: normalizeBatchItems });
  const { data: backlogItems = [], isLoading: backlogLoading } = useQuery<CalendarItem[]>({ queryKey: [backlogUrl] });
  const { data: filterOpts } = useQuery<FilterOptions>({ queryKey: ["/api/marketing-calendar/filters"] });

  // Open per-item detail for normal items; drill into the batch's posts for a
  // collapsed social batch.
  const handleSelect = (i: CalendarItem) => {
    if (i.isBatch && i.batchKey) setBatchDrill({ key: i.batchKey, day: i.day ?? "unscheduled", label: i.title });
    else setDetail(i);
  };

  const scheduled = useMemo(() => items.filter((i) => i.date), [items]);
  const visibleScheduled = useMemo(
    () => scheduled.filter((i) => matchesTypeFilter(i, typeFilter)),
    [scheduled, typeFilter],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const it of visibleScheduled) {
      const k = localKey(it.date);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return map;
  }, [visibleScheduled]);

  // Invalidate every marketing-calendar query (grid + backlog + filters) so a
  // change in one view reflects in the other.
  const invalidate = () => {
    qc.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/marketing-calendar"),
    });
  };

  // Apply the backlog's own client-side filters (independent of the calendar).
  const filteredBacklog = useMemo(() => {
    return backlogItems.filter((it) => {
      if (!matchesTypeFilter(it, typeFilter)) return false;
      if (backlogFilters.campaignId !== "all" && (it.campaignId ?? "") !== backlogFilters.campaignId) return false;
      if (backlogFilters.solutionAreaId !== "all" && (it.solutionAreaId ?? "") !== backlogFilters.solutionAreaId) return false;
      if (backlogFilters.conferenceId !== "all" && (it.conferenceId ?? "") !== backlogFilters.conferenceId) return false;
      if (backlogFilters.status !== "all" && it.lifecycle !== backlogFilters.status) return false;
      return true;
    });
  }, [backlogItems, backlogFilters, typeFilter]);

  const itemKey = (it: { type: string; id: string }) => `${it.type}-${it.id}`;
  const toggleSelected = (it: CalendarItem) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = itemKey(it);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());
  const selectedDescriptors = useMemo(
    () => filteredBacklog.filter((it) => selected.has(itemKey(it))).map((it) => ({ type: it.type, id: it.id })),
    [filteredBacklog, selected],
  );

  const approveMut = useMutation({
    mutationFn: async (it: CalendarItem) => {
      await apiRequest("POST", `/api/marketing-calendar/items/${it.type}/${it.id}/approve`);
    },
    onSuccess: () => { invalidate(); setDetail(null); toast({ title: "Approved" }); },
    onError: (e: any) => toast({ title: "Could not approve", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (it: CalendarItem) => {
      await apiRequest("DELETE", `/api/marketing-calendar/items/${it.type}/${it.id}`);
    },
    onSuccess: () => { invalidate(); setDetail(null); toast({ title: "Removed from calendar" }); },
    onError: (e: any) => toast({ title: "Could not remove", description: e.message, variant: "destructive" }),
  });

  const rescheduleMut = useMutation({
    mutationFn: async ({ it, date }: { it: CalendarItem; date: string | null }) => {
      await apiRequest("PATCH", `/api/marketing-calendar/items/${it.type}/${it.id}`, { date });
    },
    onSuccess: () => { invalidate(); toast({ title: "Date updated" }); },
    onError: (e: any) => toast({ title: "Could not update date", description: e.message, variant: "destructive" }),
  });

  const assignMut = useMutation({
    mutationFn: async ({ it, patch }: { it: CalendarItem; patch: Record<string, string | null> }) => {
      await apiRequest("PATCH", `/api/marketing-calendar/items/${it.type}/${it.id}`, patch);
    },
    onSuccess: (_d, vars) => {
      invalidate();
      setDetail((prev) => (prev ? { ...prev, ...vars.patch } : prev));
      toast({ title: "Assignment updated" });
    },
    onError: (e: any) => toast({ title: "Could not update assignment", description: e.message, variant: "destructive" }),
  });

  const handoffMut = useMutation({
    mutationFn: async (it: CalendarItem) => {
      await apiRequest("POST", `/api/marketing-calendar/items/email/${it.id}/handoff`);
    },
    onSuccess: () => { invalidate(); setDetail(null); toast({ title: "Handed off to email engine", description: "Marked as delivered. Finish the send in the email engine." }); },
    onError: (e: any) => toast({ title: "Could not hand off", description: e.message, variant: "destructive" }),
  });

  async function downloadBlob(url: string, method: string, fallbackName: string) {
    const res = await fetch(url, { method, credentials: "include", headers: getTabContextHeaders() });
    if (!res.ok) {
      let msg = "Export failed";
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const name = match ? match[1] : fallbackName;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  const exportDocxMut = useMutation({
    mutationFn: async (it: CalendarItem) => {
      await downloadBlob(`/api/marketing-calendar/items/content/${it.id}/export-docx`, "GET", "content.docx");
    },
    onSuccess: () => { invalidate(); setDetail(null); toast({ title: "Word doc exported", description: "Marked as delivered." }); },
    onError: (e: any) => toast({ title: "Could not export", description: e.message, variant: "destructive" }),
  });

  const exportCsvMut = useMutation({
    mutationFn: async () => {
      const p = new URLSearchParams();
      p.set("from", range.start.toISOString());
      p.set("to", range.end.toISOString());
      p.set("tzOffset", String(new Date().getTimezoneOffset()));
      if (filters.campaignId !== "all") p.set("campaignId", filters.campaignId);
      if (filters.solutionAreaId !== "all") p.set("solutionAreaId", filters.solutionAreaId);
      if (filters.conferenceId !== "all") p.set("conferenceId", filters.conferenceId);
      await downloadBlob(`/api/marketing-calendar/export-csv?${p.toString()}`, "POST", "social-posts.csv");
    },
    onSuccess: () => { invalidate(); toast({ title: "Social CSV exported", description: "Exported posts marked as delivered." }); },
    onError: (e: any) => toast({ title: "Could not export CSV", description: e.message, variant: "destructive" }),
  });

  const bulkMut = useMutation({
    mutationFn: async ({ action, params }: { action: string; params?: Record<string, any> }) => {
      const res = await apiRequest("POST", "/api/marketing-calendar/bulk", {
        action,
        items: selectedDescriptors,
        ...(params || {}),
      });
      return res.json() as Promise<{ affected: number; skipped: string[] }>;
    },
    onSuccess: (data, vars) => {
      invalidate();
      clearSelection();
      setBulkDate("");
      setAssignValue("none");
      const labels: Record<string, string> = { schedule: "Scheduled", approve: "Approved", assign: "Assignment updated", discard: "Discarded", archive: "Archived" };
      toast({
        title: `${labels[vars.action] ?? "Done"} ${data.affected} item${data.affected === 1 ? "" : "s"}`,
        description: data.skipped?.length ? data.skipped.join(" ") : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Bulk action failed", description: e.message, variant: "destructive" }),
  });

  const runBulk = (action: string, params?: Record<string, any>) => {
    if (selectedDescriptors.length === 0) return;
    bulkMut.mutate({ action, params });
  };

  // Drag-and-drop scheduling: dropping backlog drafts onto a day cell schedules
  // them. Reuses the same bulk "schedule" path as the bulk bar so single and
  // multi-draft drops behave identically.
  const dragScheduleMut = useMutation({
    mutationFn: async ({ descriptors, date }: { descriptors: { type: string; id: string }[]; date: string }) => {
      const res = await apiRequest("POST", "/api/marketing-calendar/bulk", {
        action: "schedule",
        items: descriptors,
        date,
      });
      return res.json() as Promise<{ affected: number; skipped: string[] }>;
    },
    onSuccess: (data) => {
      invalidate();
      clearSelection();
      toast({
        title: `Scheduled ${data.affected} item${data.affected === 1 ? "" : "s"}`,
        description: data.skipped?.length ? data.skipped.join(" ") : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Could not schedule", description: e.message, variant: "destructive" }),
  });

  // Given the dragged draft, return the descriptors to schedule: the whole
  // multi-selection if the dragged item is part of it, otherwise just itself.
  const dragDescriptors = (it: CalendarItem): { type: string; id: string }[] => {
    const k = itemKey(it);
    if (selected.has(k) && selected.size > 1) {
      return filteredBacklog.filter((b) => selected.has(itemKey(b))).map((b) => ({ type: b.type, id: b.id }));
    }
    return [{ type: it.type, id: it.id }];
  };

  const scheduleDrop = (descriptors: { type: string; id: string }[], dateKey: string) => {
    dragScheduleMut.mutate({ descriptors, date: new Date(`${dateKey}T09:00:00`).toISOString() });
  };

  // Before scheduling a drop, ask the date-advice endpoint whether the target
  // day is crowded. If so, surface the same warning + suggestion the dialogs use
  // and let the user confirm; otherwise schedule straight away.
  const handleDropSchedule = async (descriptors: { type: string; id: string }[], dateKey: string) => {
    if (!descriptors.length || dragScheduleMut.isPending) return;
    const tz = new Date().getTimezoneOffset();
    try {
      const advice = await qc.fetchQuery<DateAdvice>({
        queryKey: [`/api/marketing-calendar/date-advice?date=${dateKey}&tzOffset=${tz}`],
      });
      if (advice?.busy) {
        setPendingDrop({ descriptors, dateKey });
        return;
      }
    } catch {
      // If the advice lookup fails, fall back to scheduling without a warning.
    }
    scheduleDrop(descriptors, dateKey);
  };

  // Dragging an already-scheduled pill onto another day reschedules it; dropping
  // it on the backlog rail (dateKey null) unschedules it. Both reuse the single
  // PATCH reschedule path.
  const handleRescheduleDrag = (descriptor: { type: string; id: string }, dateKey: string | null) => {
    if (rescheduleMut.isPending) return;
    const date = dateKey ? new Date(`${dateKey}T09:00:00`).toISOString() : null;
    rescheduleMut.mutate({ it: descriptor as CalendarItem, date });
  };

  const periodLabel = grouping === "quarter"
    ? `Q${Math.floor(anchor.getMonth() / 3) + 1} ${anchor.getFullYear()}`
    : anchor.toLocaleString(undefined, { month: "long", year: "numeric" });

  const step = (dir: number) => {
    setAnchor((prev) => grouping === "quarter"
      ? new Date(prev.getFullYear(), prev.getMonth() + dir * 3, 1)
      : new Date(prev.getFullYear(), prev.getMonth() + dir, 1));
  };

  return (
    <AppLayout>
      <div className="space-y-4 p-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold" data-testid="text-page-title">
              <CalendarDays className="h-6 w-6" /> Marketing Calendar
            </h1>
            <p className="text-sm text-muted-foreground">All your social posts, emails, and content in one place. Nothing here generates with AI — add and plan by hand.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => exportCsvMut.mutate()} disabled={exportCsvMut.isPending} data-testid="button-export-csv">
              {exportCsvMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Share2 className="mr-2 h-4 w-4" />} Export social CSV
            </Button>
            <Button onClick={() => setAddOpen(true)} data-testid="button-add-item">
              <Plus className="mr-2 h-4 w-4" /> Add item
            </Button>
          </div>
        </div>

        {/* Calendar / Backlog toggle */}
        <div className="flex items-center gap-1 rounded-md border p-0.5 w-fit">
          <Button variant={view === "calendar" ? "secondary" : "ghost"} size="sm" className="h-8" onClick={() => setView("calendar")} data-testid="button-view-calendar">
            <CalendarRange className="mr-2 h-4 w-4" /> Calendar
          </Button>
          <Button variant={view === "backlog" ? "secondary" : "ghost"} size="sm" className="h-8" onClick={() => setView("backlog")} data-testid="button-view-backlog">
            <Inbox className="mr-2 h-4 w-4" /> Backlog
            {backlogItems.length > 0 && <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px]" data-testid="badge-backlog-count">{backlogItems.length}</Badge>}
          </Button>
        </div>

        {view === "calendar" ? (
          <>
            {/* Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-md border p-0.5">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => step(-1)} data-testid="button-prev-period"><ChevronLeft className="h-4 w-4" /></Button>
                <span className="min-w-[150px] text-center text-sm font-medium" data-testid="text-period-label">{periodLabel}</span>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => step(1)} data-testid="button-next-period"><ChevronRight className="h-4 w-4" /></Button>
              </div>
              <Button variant="outline" size="sm" onClick={() => setAnchor(startOfMonth(new Date()))} data-testid="button-today">Today</Button>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Select value={grouping} onValueChange={(v) => setGrouping(v as any)} disabled={groupBy !== "none"}>
                  <SelectTrigger className="h-8 w-[130px]" data-testid="select-grouping"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Month view</SelectItem>
                    <SelectItem value="quarter">Quarter view</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={groupBy} onValueChange={(v) => setGroupBy(v as any)}>
                  <SelectTrigger className="h-8 w-[140px]" data-testid="select-groupby"><SelectValue placeholder="Group by" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No grouping</SelectItem>
                    <SelectItem value="campaign">Group by campaign</SelectItem>
                    <SelectItem value="theme">Group by theme</SelectItem>
                    <SelectItem value="event">Group by event</SelectItem>
                  </SelectContent>
                </Select>
                <TypeFilterSelect value={typeFilter} onChange={setTypeFilter} filterOpts={filterOpts} testid="select-calendar-type" />
                <Select value={filters.campaignId} onValueChange={(v) => setFilters((f) => ({ ...f, campaignId: v }))}>
                  <SelectTrigger className="h-8 w-[150px]" data-testid="select-filter-campaign"><SelectValue placeholder="Campaign" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All campaigns</SelectItem>
                    {filterOpts?.campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filters.solutionAreaId} onValueChange={(v) => setFilters((f) => ({ ...f, solutionAreaId: v }))}>
                  <SelectTrigger className="h-8 w-[150px]" data-testid="select-filter-theme"><SelectValue placeholder="Theme" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All themes</SelectItem>
                    {filterOpts?.solutionAreas.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filters.conferenceId} onValueChange={(v) => setFilters((f) => ({ ...f, conferenceId: v }))}>
                  <SelectTrigger className="h-8 w-[150px]" data-testid="select-filter-event"><SelectValue placeholder="Event" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All events</SelectItem>
                    {filterOpts?.conferences.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Legend + active type filter indicator */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              {(Object.keys(TYPE_META) as ItemType[]).map((t) => (
                <span key={t} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${TYPE_META[t].dot}`} /> {TYPE_META[t].label}</span>
              ))}
              {((filterOpts?.socialChannels?.length ?? 0) > 0 || (filterOpts?.contentFormats?.length ?? 0) > 0) && (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-l pl-4">
                  {filterOpts?.socialChannels?.map((c) => (
                    <span key={`legend-social-${c.id}`} className="flex items-center gap-1" data-testid={`legend-channel-${c.id}`}>
                      <span className="rounded bg-black/[0.06] px-1 text-[9px] font-semibold uppercase tracking-wide text-foreground/70 dark:bg-white/10">
                        {CHANNEL_MARKERS[c.id]?.abbr ?? titleizeClient(c.id).slice(0, 4)}
                      </span>
                      {c.name}
                    </span>
                  ))}
                  {filterOpts?.contentFormats?.map((f) => (
                    <span key={`legend-content-${f.id}`} className="flex items-center gap-1" data-testid={`legend-format-${f.id}`}>
                      <span className="rounded bg-black/[0.06] px-1 text-[9px] font-semibold uppercase tracking-wide text-foreground/70 dark:bg-white/10">
                        {FORMAT_MARKERS[f.id]?.abbr ?? titleizeClient(f.id).slice(0, 4)}
                      </span>
                      {f.name}
                    </span>
                  ))}
                </span>
              )}
              {typeFilter !== "all" && (
                <span className="ml-auto flex items-center gap-2" data-testid="text-calendar-filter-indicator">
                  Showing {visibleScheduled.length} of {scheduled.length} · {typeFilterLabel(typeFilter, filterOpts)}
                  <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setTypeFilter("all")} data-testid="button-calendar-clear-type">
                    <X className="mr-1 h-3 w-3" /> Clear
                  </Button>
                </span>
              )}
            </div>

            {/* Batch drill-in banner */}
            {batchDrill && (
              <div className="mb-2 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-900 dark:bg-blue-950" data-testid="banner-batch-drill">
                <Inbox className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                <span className="text-blue-800 dark:text-blue-200">Viewing one social batch — {batchDrill.label}</span>
                <Button variant="ghost" size="sm" className="ml-auto h-6 px-2" onClick={() => setBatchDrill(null)} data-testid="button-exit-batch-drill">
                  <X className="mr-1 h-3 w-3" /> Back to all
                </Button>
              </div>
            )}

            {/* Calendar (scheduled items only) */}
            {isLoading ? (
              <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : groupBy !== "none" ? (
              <GroupedList items={visibleScheduled} groupBy={groupBy} filterOpts={filterOpts} onSelect={handleSelect} />
            ) : grouping === "month" ? (
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                <div className="min-w-0 flex-1">
                  <MonthGrid
                    anchor={anchor}
                    byDay={byDay}
                    filterOpts={filterOpts}
                    onSelect={handleSelect}
                    onDropSchedule={handleDropSchedule}
                    onReschedule={(d, key) => handleRescheduleDrag(d, key)}
                  />
                </div>
                <BacklogRail
                  items={filteredBacklog}
                  totalCount={backlogItems.length}
                  isLoading={backlogLoading}
                  selected={selected}
                  toggleSelected={toggleSelected}
                  itemKey={itemKey}
                  onSelect={setDetail}
                  dragDescriptors={dragDescriptors}
                  scheduling={dragScheduleMut.isPending}
                  onUnschedule={(d) => handleRescheduleDrag(d, null)}
                />
              </div>
            ) : (
              <QuarterList anchor={anchor} items={visibleScheduled} filterOpts={filterOpts} onSelect={handleSelect} />
            )}
          </>
        ) : (
          <BacklogPanel
            items={filteredBacklog}
            totalCount={backlogItems.length}
            isLoading={backlogLoading}
            filterOpts={filterOpts}
            backlogFilters={backlogFilters}
            setBacklogFilters={setBacklogFilters}
            typeFilter={typeFilter}
            setTypeFilter={setTypeFilter}
            selected={selected}
            toggleSelected={toggleSelected}
            clearSelection={clearSelection}
            setSelected={setSelected}
            itemKey={itemKey}
            onSelect={setDetail}
            bulkDate={bulkDate}
            setBulkDate={setBulkDate}
            assignKind={assignKind}
            setAssignKind={setAssignKind}
            assignValue={assignValue}
            setAssignValue={setAssignValue}
            runBulk={runBulk}
            bulkBusy={bulkMut.isPending}
          />
        )}
      </div>

      <Dialog open={!!pendingDrop} onOpenChange={(o) => !o && setPendingDrop(null)}>
        <DialogContent data-testid="dialog-drop-crowding">
          <DialogHeader>
            <DialogTitle>That day looks busy</DialogTitle>
            <DialogDescription>
              {pendingDrop
                ? `Scheduling ${pendingDrop.descriptors.length} item${pendingDrop.descriptors.length === 1 ? "" : "s"} onto ${prettyDay(pendingDrop.dateKey)}.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {pendingDrop && (
            <DateCrowdingHint
              date={pendingDrop.dateKey}
              onPick={(d) => { scheduleDrop(pendingDrop.descriptors, d); setPendingDrop(null); }}
              testid="text-drop-crowding"
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDrop(null)} data-testid="button-drop-cancel">Cancel</Button>
            <Button
              onClick={() => { if (pendingDrop) { scheduleDrop(pendingDrop.descriptors, pendingDrop.dateKey); setPendingDrop(null); } }}
              data-testid="button-drop-schedule-anyway"
            >
              Schedule anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddItemDialog open={addOpen} onOpenChange={setAddOpen} filterOpts={filterOpts} onCreated={invalidate} />

      <DetailDialog
        key={detail ? itemKey(detail) : "none"}
        item={detail}
        filterOpts={filterOpts}
        onOpenChange={(o) => !o && setDetail(null)}
        onApprove={(it) => approveMut.mutate(it)}
        onDelete={(it) => deleteMut.mutate(it)}
        onExportDocx={(it) => exportDocxMut.mutate(it)}
        onHandoffEmail={(it) => handoffMut.mutate(it)}
        onReschedule={(it, date) => rescheduleMut.mutate({ it, date })}
        onAssign={(it, patch) => assignMut.mutate({ it, patch })}
        busy={approveMut.isPending || deleteMut.isPending || exportDocxMut.isPending || handoffMut.isPending || assignMut.isPending}
      />
    </AppLayout>
  );
}

// Small colored dots summarizing an item's campaign / theme / event assignments,
// shown consistently across the month, quarter, grouped, and backlog views.
function AssignmentDots({ item, filterOpts }: { item: CalendarItem; filterOpts?: FilterOptions }) {
  const assignments = resolveAssignments(item, filterOpts);
  if (assignments.length === 0) return null;
  const tip = assignments.map((a) => `${ASSIGN_META[a.kind].label}: ${a.name}`).join(", ");
  return (
    <span className="flex shrink-0 items-center gap-0.5" title={tip} data-testid={`assign-dots-${item.id}`}>
      {assignments.map((a) => (
        <span key={a.kind} className={`h-1.5 w-1.5 rounded-full ${ASSIGN_META[a.kind].dot}`} />
      ))}
    </span>
  );
}

function ItemPill({ item, filterOpts, onSelect, draggable }: { item: CalendarItem; filterOpts?: FilterOptions; onSelect: (i: CalendarItem) => void; draggable?: boolean }) {
  const assignments = resolveAssignments(item, filterOpts);
  // A collapsed batch is never individually draggable (it has no single date/id).
  const canDrag = !!draggable && !item.isBatch;
  const titleAttr = item.isBatch
    ? `${item.title} — click to drill in`
    : assignments.length
    ? `${item.title} — ${assignments.map((a) => `${ASSIGN_META[a.kind].label}: ${a.name}`).join(", ")}`
    : item.title;
  return (
    <button
      onClick={() => onSelect(item)}
      draggable={canDrag}
      onDragStart={canDrag ? (e) => {
        e.dataTransfer.setData(SCHEDULED_DRAG_TYPE, JSON.stringify({ type: item.type, id: item.id }));
        e.dataTransfer.effectAllowed = "move";
      } : undefined}
      className={`flex w-full items-center gap-1 truncate rounded border px-1 py-0.5 text-left text-[11px] ${canDrag ? "cursor-grab active:cursor-grabbing" : ""} ${item.isBatch ? "font-medium ring-1 ring-inset ring-blue-300 dark:ring-blue-800" : ""} ${TYPE_META[item.type].chip}`}
      data-testid={`item-calendar-${item.id}`}
      title={titleAttr}
    >
      {item.isBatch
        ? <Inbox className="h-3 w-3 shrink-0" />
        : <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.lifecycle === "delivered" ? "bg-green-500" : item.lifecycle === "approved" ? "bg-blue-500" : "bg-gray-400"}`} />}
      {!item.isBatch && <ChannelFormatTag item={item} />}
      <span className="truncate">{item.title}</span>
      {assignments.length > 0 && (
        <span className="ml-auto flex shrink-0 items-center gap-0.5" data-testid={`assign-dots-${item.id}`}>
          {assignments.map((a) => (
            <span key={a.kind} className={`h-1.5 w-1.5 rounded-full ${ASSIGN_META[a.kind].dot}`} />
          ))}
        </span>
      )}
    </button>
  );
}

function MonthGrid({ anchor, byDay, filterOpts, onSelect, onDropSchedule, onReschedule }: {
  anchor: Date;
  byDay: Map<string, CalendarItem[]>;
  filterOpts?: FilterOptions;
  onSelect: (i: CalendarItem) => void;
  onDropSchedule?: (descriptors: { type: string; id: string }[], dateKey: string) => void;
  onReschedule?: (descriptor: { type: string; id: string }, dateKey: string) => void;
}) {
  const first = startOfMonth(anchor);
  const startDow = first.getDay();
  const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  const todayKey = ymd(new Date());
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(anchor.getFullYear(), anchor.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  const handleDrop = (e: ReactDragEvent, key: string) => {
    e.preventDefault();
    setDragOverKey(null);
    // Reschedule drag: an already-scheduled pill moved to another day.
    const sched = e.dataTransfer.getData(SCHEDULED_DRAG_TYPE);
    if (sched && onReschedule) {
      try {
        const d = JSON.parse(sched) as { type: string; id: string };
        if (d?.type && d?.id) onReschedule(d, key);
      } catch {
        // Ignore malformed reschedule payloads.
      }
      return;
    }
    // Schedule drag: one or more backlog drafts dropped onto a day.
    if (!onDropSchedule) return;
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    try {
      const descriptors = JSON.parse(raw) as { type: string; id: string }[];
      if (Array.isArray(descriptors) && descriptors.length) onDropSchedule(descriptors, key);
    } catch {
      // Ignore drops that don't carry our draft payload.
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs font-medium text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date, i) => {
          const key = date ? ymd(date) : null;
          const dayItems = key ? byDay.get(key) || [] : [];
          const isDropTarget = !!date && (!!onDropSchedule || !!onReschedule);
          const isDragOver = key !== null && key === dragOverKey;
          return (
            <div
              key={i}
              className={`min-h-[96px] border-b border-r p-1 ${date ? "" : "bg-muted/20"} ${key === todayKey ? "bg-primary/5" : ""} ${isDragOver ? "bg-primary/10 ring-2 ring-inset ring-primary" : ""}`}
              data-testid={key ? `day-cell-${key}` : undefined}
              onDragOver={isDropTarget ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (key !== dragOverKey) setDragOverKey(key); } : undefined}
              onDragLeave={isDropTarget ? (e) => { if (e.currentTarget === e.target && key === dragOverKey) setDragOverKey(null); } : undefined}
              onDrop={isDropTarget ? (e) => handleDrop(e, key!) : undefined}
            >
              {date && (
                <>
                  <div className={`mb-1 text-right text-xs ${key === todayKey ? "font-bold text-primary" : "text-muted-foreground"}`}>{date.getDate()}</div>
                  <div className="space-y-0.5">
                    {dayItems.slice(0, 4).map((it) => <ItemPill key={`${it.type}-${it.id}`} item={it} filterOpts={filterOpts} onSelect={onSelect} draggable={!!onReschedule} />)}
                    {dayItems.length > 4 && <div className="px-1 text-[10px] text-muted-foreground">+{dayItems.length - 4} more</div>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Compact, draggable backlog rail shown beside the month grid. Lets users drag
// drafts (single or multi-selected) onto a day cell to schedule them.
function BacklogRail({ items, totalCount, isLoading, selected, toggleSelected, itemKey, onSelect, dragDescriptors, scheduling, onUnschedule }: {
  items: CalendarItem[];
  totalCount: number;
  isLoading: boolean;
  selected: Set<string>;
  toggleSelected: (it: CalendarItem) => void;
  itemKey: (it: { type: string; id: string }) => string;
  onSelect: (i: CalendarItem) => void;
  dragDescriptors: (it: CalendarItem) => { type: string; id: string }[];
  scheduling: boolean;
  onUnschedule?: (descriptor: { type: string; id: string }) => void;
}) {
  const selectedCount = items.filter((it) => selected.has(itemKey(it))).length;
  const [isUnscheduleOver, setIsUnscheduleOver] = useState(false);

  const onDragStart = (e: ReactDragEvent, it: CalendarItem) => {
    const descriptors = dragDescriptors(it);
    e.dataTransfer.setData("application/json", JSON.stringify(descriptors));
    e.dataTransfer.effectAllowed = "move";
  };

  // The rail accepts already-scheduled pills (dragged from the month grid) and
  // unschedules them — backlog drafts dragged within the rail carry a different
  // payload and are ignored here.
  const canUnschedule = !!onUnschedule;
  const onUnscheduleDragOver = (e: ReactDragEvent) => {
    if (!canUnschedule || !e.dataTransfer.types.includes(SCHEDULED_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!isUnscheduleOver) setIsUnscheduleOver(true);
  };
  const onUnscheduleDrop = (e: ReactDragEvent) => {
    setIsUnscheduleOver(false);
    if (!canUnschedule) return;
    const sched = e.dataTransfer.getData(SCHEDULED_DRAG_TYPE);
    if (!sched) return;
    e.preventDefault();
    try {
      const d = JSON.parse(sched) as { type: string; id: string };
      if (d?.type && d?.id) onUnschedule!(d);
    } catch {
      // Ignore malformed payloads.
    }
  };

  return (
    <div
      className={`rounded-lg border lg:w-72 lg:shrink-0 ${isUnscheduleOver ? "bg-primary/10 ring-2 ring-inset ring-primary" : ""}`}
      data-testid="backlog-rail"
      onDragOver={canUnschedule ? onUnscheduleDragOver : undefined}
      onDragLeave={canUnschedule ? () => setIsUnscheduleOver(false) : undefined}
      onDrop={canUnschedule ? onUnscheduleDrop : undefined}
    >
      <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
        <Inbox className="h-3.5 w-3.5" />
        <span>Backlog ({items.length})</span>
        {scheduling && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" />}
      </div>
      {isLoading ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <p className="p-4 text-center text-xs text-muted-foreground" data-testid="backlog-rail-empty">
          {totalCount === 0 ? "Nothing in the backlog." : "No drafts match the backlog filters."}
        </p>
      ) : (
        <>
          <p className="px-3 pt-2 text-[11px] text-muted-foreground">
            {selectedCount > 1
              ? `Drag any selected draft onto a day to schedule all ${selectedCount}.`
              : "Drag a draft onto a day to schedule it. Drop a scheduled item here to unschedule it. Tick boxes to move several at once."}
          </p>
          <div className="max-h-[560px] space-y-1 overflow-y-auto p-2" data-testid="backlog-rail-list">
            {items.map((it) => {
              const k = itemKey(it);
              const checked = selected.has(k);
              return (
                <div
                  key={k}
                  draggable
                  onDragStart={(e) => onDragStart(e, it)}
                  className={`flex cursor-grab items-center gap-2 rounded border px-2 py-1.5 text-xs active:cursor-grabbing ${checked ? "border-primary/40 bg-primary/5" : "bg-card hover:bg-muted/50"}`}
                  data-testid={`backlog-rail-row-${it.id}`}
                >
                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <Checkbox checked={checked} onCheckedChange={() => toggleSelected(it)} data-testid={`checkbox-rail-${it.id}`} aria-label={`Select ${it.title}`} />
                  <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_META[it.type].dot}`} title={TYPE_META[it.type].label} />
                  <ChannelFormatTag item={it} />
                  <button onClick={() => onSelect(it)} className="flex-1 truncate text-left hover:underline" data-testid={`button-rail-item-${it.id}`}>
                    {it.title}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function QuarterList({ anchor, items, filterOpts, onSelect }: { anchor: Date; items: CalendarItem[]; filterOpts?: FilterOptions; onSelect: (i: CalendarItem) => void }) {
  const q = Math.floor(anchor.getMonth() / 3);
  const months = [0, 1, 2].map((m) => new Date(anchor.getFullYear(), q * 3 + m, 1));
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {months.map((mDate) => {
        const monthItems = items
          .filter((it) => {
            const d = it.date ? new Date(it.date) : null;
            return d && d.getFullYear() === mDate.getFullYear() && d.getMonth() === mDate.getMonth();
          })
          .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime());
        return (
          <Card key={mDate.getMonth()}>
            <CardContent className="p-3">
              <h3 className="mb-2 text-sm font-semibold">{mDate.toLocaleString(undefined, { month: "long" })} <span className="text-muted-foreground">({monthItems.length})</span></h3>
              <div className="space-y-1">
                {monthItems.length === 0 && <p className="text-xs text-muted-foreground">Nothing planned.</p>}
                {monthItems.map((it) => (
                  <button key={`${it.type}-${it.id}`} onClick={() => onSelect(it)} className="flex w-full items-center gap-1.5 rounded border p-1.5 text-left text-xs hover:bg-muted" data-testid={`item-quarter-${it.id}`}>
                    <span className="w-9 shrink-0 text-[10px] text-muted-foreground">{new Date(it.date!).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_META[it.type].dot}`} />
                    <ChannelFormatTag item={it} />
                    <span className="flex-1 truncate">{it.title}</span>
                    <AssignmentDots item={it} filterOpts={filterOpts} />
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function AddItemDialog({ open, onOpenChange, filterOpts, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  filterOpts?: FilterOptions;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [type, setType] = useState<ItemType>("social");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [platform, setPlatform] = useState("linkedin");
  const [format, setFormat] = useState("blog_post");
  const [campaignId, setCampaignId] = useState("none");
  const [solutionAreaId, setSolutionAreaId] = useState("none");
  const [conferenceId, setConferenceId] = useState("none");

  const reset = () => {
    setType("social"); setTitle(""); setDate(""); setPlatform("linkedin"); setFormat("blog_post");
    setCampaignId("none"); setSolutionAreaId("none"); setConferenceId("none");
  };

  const createMut = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/marketing-calendar/items", {
        type,
        title: title.trim(),
        date: date ? new Date(`${date}T09:00:00`).toISOString() : null,
        platform: type === "social" ? platform : undefined,
        format: type === "content" ? format : undefined,
        campaignId: campaignId === "none" ? null : campaignId,
        solutionAreaId: solutionAreaId === "none" ? null : solutionAreaId,
        conferenceId: conferenceId === "none" ? null : conferenceId,
      });
    },
    onSuccess: () => { onCreated(); onOpenChange(false); reset(); toast({ title: "Added to calendar" }); },
    onError: (e: any) => toast({ title: "Could not add item", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent data-testid="dialog-add-item">
        <DialogHeader>
          <DialogTitle>Add a calendar item</DialogTitle>
          <DialogDescription>Plan a piece of content by hand. This does not use AI.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as ItemType)}>
              <SelectTrigger data-testid="select-add-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="social">Social post</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="content">Content / blog</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{type === "email" ? "Subject" : "Title"}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === "email" ? "Email subject" : "What is this?"} data-testid="input-add-title" />
          </div>
          {type === "social" && (
            <div>
              <Label className="text-xs">Platform</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger data-testid="select-add-platform"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="linkedin">LinkedIn</SelectItem>
                  <SelectItem value="twitter">X / Twitter</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {type === "content" && (
            <div>
              <Label className="text-xs">Format</Label>
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger data-testid="select-add-format"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="blog_post">Blog post</SelectItem>
                  <SelectItem value="whitepaper">Whitepaper</SelectItem>
                  <SelectItem value="case_study">Case study</SelectItem>
                  <SelectItem value="landing_page">Landing page</SelectItem>
                  <SelectItem value="video_script">Video script</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-xs">Date (optional — leave blank for unscheduled)</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-add-date" />
            <DateCrowdingHint date={date} onPick={setDate} testid="text-add-crowding" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Campaign</Label>
              <Select value={campaignId} onValueChange={setCampaignId}>
                <SelectTrigger data-testid="select-add-campaign"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {filterOpts?.campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Theme</Label>
              <Select value={solutionAreaId} onValueChange={setSolutionAreaId}>
                <SelectTrigger data-testid="select-add-theme"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {filterOpts?.solutionAreas.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Event</Label>
              <Select value={conferenceId} onValueChange={setConferenceId}>
                <SelectTrigger data-testid="select-add-event"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {filterOpts?.conferences.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => createMut.mutate()} disabled={!title.trim() || createMut.isPending} data-testid="button-save-item">
            {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function editorHref(it: CalendarItem): string {
  if (it.type === "social") return "/app/marketing/calendar";
  if (it.type === "email") return "/app/marketing/email-newsletters";
  return "/app/marketing/editorial-calendar";
}

function DetailDialog({ item, filterOpts, onOpenChange, onApprove, onDelete, onExportDocx, onHandoffEmail, onReschedule, onAssign, busy }: {
  item: CalendarItem | null;
  filterOpts?: FilterOptions;
  onOpenChange: (o: boolean) => void;
  onApprove: (it: CalendarItem) => void;
  onDelete: (it: CalendarItem) => void;
  onExportDocx: (it: CalendarItem) => void;
  onHandoffEmail: (it: CalendarItem) => void;
  onReschedule: (it: CalendarItem, date: string | null) => void;
  onAssign: (it: CalendarItem, patch: Record<string, string | null>) => void;
  busy: boolean;
}) {
  const [dateVal, setDateVal] = useState(item?.date ? localKey(item.date) || "" : "");
  if (!item) return null;
  const assignments = resolveAssignments(item, filterOpts);
  // Only blog/content and email require an explicit Approve; social posts are
  // high-volume and rely on the bulk CSV export (= delivered) flow instead.
  const canApprove = (item.type === "content" || item.type === "email") && item.lifecycle === "draft";
  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-item-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${TYPE_META[item.type].dot}`} /> {item.title}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <Badge variant="outline">{TYPE_META[item.type].label}</Badge>
            {channelFormatMarker(item) && (
              <Badge variant="outline" data-testid="badge-detail-channel-format">{channelFormatMarker(item)!.label}</Badge>
            )}
            <Badge variant="outline" className={LIFECYCLE_META[item.lifecycle].cls}>{LIFECYCLE_META[item.lifecycle].label}</Badge>
          </DialogDescription>
        </DialogHeader>

        {assignments.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="detail-assignment-chips">
            {assignments.map((a) => (
              <Badge
                key={a.kind}
                variant="outline"
                className={`gap-1 px-1.5 py-0 text-[11px] ${ASSIGN_META[a.kind].chip}`}
                data-testid={`chip-assignment-${a.kind}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${ASSIGN_META[a.kind].dot}`} />
                {ASSIGN_META[a.kind].label}: {a.name}
              </Badge>
            ))}
          </div>
        )}

        {item.preview && <p className="rounded-md bg-muted p-2 text-sm text-muted-foreground">{item.preview}</p>}

        <div>
          <Label className="text-xs">Date</Label>
          <Input
            type="date"
            value={dateVal}
            onChange={(e) => {
              setDateVal(e.target.value);
              onReschedule(item, e.target.value ? new Date(`${e.target.value}T09:00:00`).toISOString() : null);
            }}
            data-testid="input-detail-date"
          />
          <DateCrowdingHint
            date={dateVal}
            onPick={(d) => { setDateVal(d); onReschedule(item, new Date(`${d}T09:00:00`).toISOString()); }}
            testid="text-detail-crowding"
          />
        </div>

        {/* Campaign / theme / event assignment for the existing item */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-xs">Campaign</Label>
            <Select value={item.campaignId ?? "none"} onValueChange={(v) => onAssign(item, { campaignId: v === "none" ? null : v })}>
              <SelectTrigger data-testid="select-detail-campaign"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {filterOpts?.campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Theme</Label>
            <Select value={item.solutionAreaId ?? "none"} onValueChange={(v) => onAssign(item, { solutionAreaId: v === "none" ? null : v })}>
              <SelectTrigger data-testid="select-detail-theme"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {filterOpts?.solutionAreas.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Event</Label>
            <Select value={item.conferenceId ?? "none"} onValueChange={(v) => onAssign(item, { conferenceId: v === "none" ? null : v })}>
              <SelectTrigger data-testid="select-detail-event"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {filterOpts?.conferences.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Link href={editorHref(item)}>
              <Button variant="outline" size="sm" data-testid="button-open-editor"><PenLine className="mr-2 h-4 w-4" /> Open editor</Button>
            </Link>
            {canApprove && (
              <Button variant="outline" size="sm" onClick={() => onApprove(item)} disabled={busy} data-testid="button-approve">
                <CheckCircle2 className="mr-2 h-4 w-4" /> Approve
              </Button>
            )}
            {item.type === "content" && (
              <Button variant="outline" size="sm" onClick={() => onExportDocx(item)} disabled={busy || item.lifecycle === "draft"} title={item.lifecycle === "draft" ? "Approve the content first" : undefined} data-testid="button-export-docx">
                <FileDown className="mr-2 h-4 w-4" /> Export Word
              </Button>
            )}
            {item.type === "email" && (
              <Button variant="outline" size="sm" onClick={() => onHandoffEmail(item)} disabled={busy || item.lifecycle === "draft"} title={item.lifecycle === "draft" ? "Approve the email first" : undefined} data-testid="button-email-engine">
                <Mail className="mr-2 h-4 w-4" /> Hand off to email engine
              </Button>
            )}
            {item.type === "social" && (
              <Link href="/app/marketing/calendar">
                <Button variant="outline" size="sm" data-testid="button-social-export"><ExternalLink className="mr-2 h-4 w-4" /> Social tools</Button>
              </Link>
            )}
          </div>
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => onDelete(item)} disabled={busy} data-testid="button-delete-item">
            <Trash2 className="mr-2 h-4 w-4" /> Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GroupedList({ items, groupBy, filterOpts, onSelect }: {
  items: CalendarItem[];
  groupBy: "campaign" | "theme" | "event";
  filterOpts?: FilterOptions;
  onSelect: (i: CalendarItem) => void;
}) {
  const field = groupBy === "campaign" ? "campaignId" : groupBy === "theme" ? "solutionAreaId" : "conferenceId";
  const optList = groupBy === "campaign" ? filterOpts?.campaigns : groupBy === "theme" ? filterOpts?.solutionAreas : filterOpts?.conferences;
  const nameOf = (id: string) => optList?.find((o) => o.id === id)?.name || "Unknown";

  const groups = new Map<string, CalendarItem[]>();
  for (const it of items) {
    const key = (it as any)[field] || "__none__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(it);
  }
  const sortItems = (arr: CalendarItem[]) =>
    [...arr].sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

  const orderedKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a === "__none__") return 1;
    if (b === "__none__") return -1;
    return nameOf(a).localeCompare(nameOf(b));
  });

  const groupLabel = groupBy === "campaign" ? "campaign" : groupBy === "theme" ? "theme" : "event";

  if (items.length === 0) {
    return <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">Nothing to show for this period.</div>;
  }

  return (
    <div className="space-y-3" data-testid="grouped-list">
      {orderedKeys.map((key) => {
        const groupItems = sortItems(groups.get(key)!);
        return (
          <Card key={key}>
            <CardContent className="p-3">
              <h3 className="mb-2 text-sm font-semibold">
                {key === "__none__" ? `No ${groupLabel}` : nameOf(key)} <span className="text-muted-foreground">({groupItems.length})</span>
              </h3>
              <div className="space-y-1">
                {groupItems.map((it) => (
                  <button key={`${it.type}-${it.id}`} onClick={() => onSelect(it)} className="flex w-full items-center gap-2 rounded border p-1.5 text-left text-xs hover:bg-muted" data-testid={`item-grouped-${it.id}`}>
                    <span className="w-14 shrink-0 text-[10px] text-muted-foreground">{it.date ? new Date(it.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}</span>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_META[it.type].dot}`} />
                    <ChannelFormatTag item={it} />
                    <span className="flex-1 truncate">{it.title}</span>
                    <AssignmentDots item={it} filterOpts={filterOpts} />
                    <Badge variant="outline" className={`shrink-0 px-1 py-0 text-[10px] ${LIFECYCLE_META[it.lifecycle].cls}`}>{LIFECYCLE_META[it.lifecycle].label}</Badge>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

interface BacklogFilterState {
  campaignId: string;
  solutionAreaId: string;
  conferenceId: string;
  status: string;
}

function BacklogPanel({
  items, totalCount, isLoading, filterOpts, backlogFilters, setBacklogFilters, typeFilter, setTypeFilter,
  selected, toggleSelected, clearSelection, setSelected, itemKey, onSelect,
  bulkDate, setBulkDate, assignKind, setAssignKind, assignValue, setAssignValue, runBulk, bulkBusy,
}: {
  items: CalendarItem[];
  totalCount: number;
  isLoading: boolean;
  filterOpts?: FilterOptions;
  backlogFilters: BacklogFilterState;
  setBacklogFilters: Dispatch<SetStateAction<BacklogFilterState>>;
  typeFilter: string;
  setTypeFilter: (v: string) => void;
  selected: Set<string>;
  toggleSelected: (it: CalendarItem) => void;
  clearSelection: () => void;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  itemKey: (it: { type: string; id: string }) => string;
  onSelect: (i: CalendarItem) => void;
  bulkDate: string;
  setBulkDate: (v: string) => void;
  assignKind: AssignmentKind;
  setAssignKind: (v: AssignmentKind) => void;
  assignValue: string;
  setAssignValue: (v: string) => void;
  runBulk: (action: string, params?: Record<string, any>) => void;
  bulkBusy: boolean;
}) {
  const allKeys = items.map(itemKey);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const someSelected = allKeys.some((k) => selected.has(k));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(allKeys));
  const selectedCount = allKeys.filter((k) => selected.has(k)).length;

  const assignOptions = assignKind === "campaign" ? filterOpts?.campaigns : assignKind === "theme" ? filterOpts?.solutionAreas : filterOpts?.conferences;
  const doAssign = () => {
    const key = assignKind === "campaign" ? "campaignId" : assignKind === "theme" ? "solutionAreaId" : "conferenceId";
    runBulk("assign", { [key]: assignValue === "none" ? null : assignValue });
  };
  const doSchedule = () => {
    if (!bulkDate) return;
    runBulk("schedule", { date: new Date(`${bulkDate}T09:00:00`).toISOString() });
  };

  return (
    <div className="space-y-3" data-testid="backlog-panel">
      <p className="text-sm text-muted-foreground">
        Unscheduled drafts across social, email, and content. Select items to schedule, approve, assign, or discard them in bulk.
      </p>

      {/* Backlog filters */}
      <div className="flex flex-wrap items-center gap-2">
        <TypeFilterSelect value={typeFilter} onChange={setTypeFilter} filterOpts={filterOpts} testid="select-backlog-type" />
        <Select value={backlogFilters.campaignId} onValueChange={(v) => setBacklogFilters((f) => ({ ...f, campaignId: v }))}>
          <SelectTrigger className="h-8 w-[150px]" data-testid="select-backlog-campaign"><SelectValue placeholder="Campaign" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All campaigns</SelectItem>
            {filterOpts?.campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={backlogFilters.solutionAreaId} onValueChange={(v) => setBacklogFilters((f) => ({ ...f, solutionAreaId: v }))}>
          <SelectTrigger className="h-8 w-[150px]" data-testid="select-backlog-theme"><SelectValue placeholder="Theme" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All themes</SelectItem>
            {filterOpts?.solutionAreas.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={backlogFilters.conferenceId} onValueChange={(v) => setBacklogFilters((f) => ({ ...f, conferenceId: v }))}>
          <SelectTrigger className="h-8 w-[150px]" data-testid="select-backlog-event"><SelectValue placeholder="Event" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            {filterOpts?.conferences.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={backlogFilters.status} onValueChange={(v) => setBacklogFilters((f) => ({ ...f, status: v }))}>
          <SelectTrigger className="h-8 w-[130px]" data-testid="select-backlog-status"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
          </SelectContent>
        </Select>
        {(typeFilter !== "all" || backlogFilters.campaignId !== "all" || backlogFilters.solutionAreaId !== "all" || backlogFilters.conferenceId !== "all" || backlogFilters.status !== "all") && (
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground" data-testid="text-backlog-filter-indicator">
            Showing {items.length} of {totalCount}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => { setTypeFilter("all"); setBacklogFilters({ campaignId: "all", solutionAreaId: "all", conferenceId: "all", status: "all" }); }}
              data-testid="button-backlog-clear-filters"
            >
              <X className="mr-1 h-3 w-3" /> Clear all
            </Button>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2" data-testid="bulk-action-bar">
          <span className="text-sm font-medium" data-testid="text-selected-count">{selectedCount} selected</span>
          <Button variant="ghost" size="sm" className="h-8" onClick={clearSelection} data-testid="button-clear-selection"><X className="mr-1 h-3.5 w-3.5" /> Clear</Button>
          <Separator orientation="vertical" className="h-6" />
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Input type="date" className="h-8 w-[140px]" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} data-testid="input-bulk-date" />
              <Button size="sm" className="h-8" onClick={doSchedule} disabled={!bulkDate || bulkBusy} data-testid="button-bulk-schedule"><CalendarDays className="mr-1 h-3.5 w-3.5" /> Schedule</Button>
            </div>
            <DateCrowdingHint date={bulkDate} onPick={setBulkDate} testid="text-bulk-crowding" />
          </div>
          <Button variant="outline" size="sm" className="h-8" onClick={() => runBulk("approve")} disabled={bulkBusy} data-testid="button-bulk-approve"><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve</Button>
          <Separator orientation="vertical" className="h-6" />
          <div className="flex items-center gap-1">
            <Select value={assignKind} onValueChange={(v) => { setAssignKind(v as AssignmentKind); setAssignValue("none"); }}>
              <SelectTrigger className="h-8 w-[110px]" data-testid="select-assign-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="campaign">Campaign</SelectItem>
                <SelectItem value="theme">Theme</SelectItem>
                <SelectItem value="event">Event</SelectItem>
              </SelectContent>
            </Select>
            <Select value={assignValue} onValueChange={setAssignValue}>
              <SelectTrigger className="h-8 w-[150px]" data-testid="select-assign-value"><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (clear)</SelectItem>
                {assignOptions?.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8" onClick={doAssign} disabled={bulkBusy} data-testid="button-bulk-assign"><Tag className="mr-1 h-3.5 w-3.5" /> Assign</Button>
          </div>
          <Separator orientation="vertical" className="h-6" />
          <Button variant="outline" size="sm" className="h-8" onClick={() => runBulk("archive")} disabled={bulkBusy} data-testid="button-bulk-archive"><Inbox className="mr-1 h-3.5 w-3.5" /> Archive</Button>
          <Button variant="ghost" size="sm" className="h-8 text-destructive" onClick={() => runBulk("discard")} disabled={bulkBusy} data-testid="button-bulk-discard"><Trash2 className="mr-1 h-3.5 w-3.5" /> Discard</Button>
          {bulkBusy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      )}

      {/* Item list */}
      {isLoading ? (
        <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground" data-testid="backlog-empty">
          {totalCount === 0 ? "Nothing in the backlog. Every draft has a date." : "No backlog items match these filters."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="flex items-center gap-3 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
            <Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={toggleAll} data-testid="checkbox-select-all" aria-label="Select all" />
            <span>Select all ({items.length})</span>
          </div>
          <div className="divide-y" data-testid="backlog-list">
            {items.map((it) => {
              const k = itemKey(it);
              const checked = selected.has(k);
              return (
                <div key={k} className={`flex items-center gap-3 px-3 py-2 text-sm ${checked ? "bg-primary/5" : "hover:bg-muted/50"}`} data-testid={`backlog-row-${it.id}`}>
                  <Checkbox checked={checked} onCheckedChange={() => toggleSelected(it)} data-testid={`checkbox-item-${it.id}`} aria-label={`Select ${it.title}`} />
                  <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_META[it.type].dot}`} title={TYPE_META[it.type].label} />
                  <ChannelFormatTag item={it} />
                  <button onClick={() => onSelect(it)} className="flex-1 truncate text-left hover:underline" data-testid={`button-backlog-item-${it.id}`}>
                    {it.title}
                  </button>
                  <AssignmentDots item={it} filterOpts={filterOpts} />
                  <Badge variant="outline" className={`shrink-0 px-1.5 py-0 text-[10px] ${LIFECYCLE_META[it.lifecycle].cls}`}>{LIFECYCLE_META[it.lifecycle].label}</Badge>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
