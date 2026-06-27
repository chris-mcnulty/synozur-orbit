import type { Dispatch, DragEvent as ReactDragEvent, SetStateAction } from "react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import AppLayout from "@/components/layout/AppLayout";
import { CalendarViewSwitcher } from "@/components/marketing/CalendarViewSwitcher";
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
  ChevronDown,
  Loader2,
  Plus,
  Trash2,
  CheckCircle2,
  FileDown,
  Mail,
  Share2,
  PenLine,
  Send,
  ExternalLink,
  Inbox,
  CalendarRange,
  Tag,
  X,
  GripVertical,
  Download,
  Copy,
  RotateCcw,
  AlertTriangle,
  Sparkles,
  Clock,
  Zap,
  Globe,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getTabContextHeaders } from "@/lib/tabContext";

// Download an image (graphic or carousel slide) straight to the user's machine.
// Images are served same-origin via Orbit, so we fetch the blob and save it with
// a sensible filename. If the fetch is blocked, fall back to opening in a new tab.
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

// Turn a post title into a safe filename stub.
function safeFileStub(s: string): string {
  return (s || "post").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60).toLowerCase() || "post";
}

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
  deliveryMode?: string | null;
  platform?: string;
  format?: string;
  calendarId?: string | null;
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
  websitePostSlug?: string | null;
  websitePostStatus?: string | null;
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
  ebook: { abbr: "Ebook", label: "Ebook" },
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
// Local HH:mm for an ISO timestamp, used to seed/edit the time-of-day picker.
function localTime(iso: string | null): string {
  if (!iso) return "09:00";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "09:00";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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

// ───────────────────────── Content Advisor ─────────────────────────
// A lightweight, client-side scheduling review. It runs over whatever scheduled
// items are currently visible (so it respects the active campaign/type filter —
// switch the filter to review one campaign or all of them) plus the backlog
// count. No backend call: it just looks for the common ways a packed calendar
// goes wrong and explains, in plain language, how to fix each one.
type AdvisoryKind = "backlog" | "past" | "duplicate" | "overload" | "gap" | "weekend";
type AdvisorySeverity = "high" | "medium" | "low";

interface Advisory {
  id: string;
  kind: AdvisoryKind;
  severity: AdvisorySeverity;
  title: string;
  detail: string;
  items?: CalendarItem[];
}

const DAY_OVERLOAD = 4; // more than this many items in a single day = crowded
const SEVERITY_RANK: Record<AdvisorySeverity, number> = { high: 0, medium: 1, low: 2 };

// Parse a "YYYY-MM-DD" key into a local Date. Avoids `new Date(string)`, which
// treats date-only strings as UTC and can shift the day/week in other zones.
function parseLocalDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
// Monday-anchored week key for an item's local date, used for gap detection.
function mondayKey(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - dow);
  return ymd(x);
}

function normalizeContent(s: string): string {
  return s.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// A social post that's already been exported/published ("delivered") is
// committed to the external scheduler — changing its date in Orbit does nothing.
// The advisor must not suggest rescheduling these.
function isLocked(it: CalendarItem): boolean {
  return it.type === "social" && it.lifecycle === "delivered";
}

function computeAdvisories(scheduled: CalendarItem[], backlogCount: number): Advisory[] {
  const out: Advisory[] = [];
  const todayKey = ymd(new Date());

  // 1) Undated pile-up — items that never make it onto the calendar.
  if (backlogCount > 0) {
    out.push({
      id: "backlog",
      kind: "backlog",
      severity: backlogCount >= 10 ? "high" : "medium",
      title: `${backlogCount} item${backlogCount === 1 ? "" : "s"} have no date`,
      detail: "These sit in the Backlog and never appear on the calendar until scheduled. Open the Backlog, tick the ones you want, and set a date — or drag a draft onto a day.",
    });
  }

  // 2) Scheduled in the past but not yet delivered.
  const stale = scheduled.filter((it) => {
    const k = localKey(it.date);
    return k && k < todayKey && it.lifecycle !== "delivered";
  });
  if (stale.length > 0) {
    out.push({
      id: "past",
      kind: "past",
      severity: "high",
      title: `${stale.length} item${stale.length === 1 ? "" : "s"} scheduled in the past`,
      detail: "These are dated before today but haven't been marked delivered. Either send/deliver them, move them to a future date, or remove them.",
      items: stale,
    });
  }

  // 3) Duplicate / near-duplicate content scheduled more than once.
  const byContent = new Map<string, CalendarItem[]>();
  for (const it of scheduled) {
    const key = normalizeContent(it.preview?.trim() || it.title);
    if (!key) continue;
    if (!byContent.has(key)) byContent.set(key, []);
    byContent.get(key)!.push(it);
  }
  for (const group of Array.from(byContent.values())) {
    if (group.length >= 2) {
      const someLocked = group.some(isLocked);
      out.push({
        id: `dup-${group[0].type}-${group[0].id}`,
        kind: "duplicate",
        severity: "high",
        title: `Looks scheduled ${group.length} times: "${(group[0].preview?.trim() || group[0].title).slice(0, 50)}"`,
        detail: `The same (or nearly the same) content is on the calendar more than once. Keep the one you want and remove or reword the rest.${someLocked ? " Note: copies already committed can't be removed — adjust the ones that aren't." : ""}`,
        items: group,
      });
    }
  }

  // 4) Overloaded days.
  const byDayMap = new Map<string, CalendarItem[]>();
  for (const it of scheduled) {
    const k = localKey(it.date);
    if (!k) continue;
    if (!byDayMap.has(k)) byDayMap.set(k, []);
    byDayMap.get(k)!.push(it);
  }
  for (const [day, group] of Array.from(byDayMap.entries())) {
    if (group.length > DAY_OVERLOAD) {
      const movable = group.filter((it) => !isLocked(it));
      // Nothing actionable if every item that day is already committed.
      if (movable.length === 0) continue;
      const someLocked = movable.length < group.length;
      out.push({
        id: `overload-${day}`,
        kind: "overload",
        severity: "medium",
        title: `${prettyDay(day)} is crowded — ${group.length} items`,
        detail: `That's a lot for one day and the audience may tune out. Spread a few onto nearby quieter days.${someLocked ? " Some posts here are already committed and can't be moved — shift the others." : ""}`,
        items: movable,
      });
    }
  }

  // 5) Empty weeks (underload) between the first and last scheduled item.
  const dated = scheduled.map((it) => localKey(it.date)).filter((k): k is string => !!k).sort();
  if (dated.length >= 2) {
    const first = parseLocalDay(dated[0]);
    const last = parseLocalDay(dated[dated.length - 1]);
    const weeksWithItems = new Set(scheduled.map((it) => (it.date ? mondayKey(new Date(it.date)) : "")).filter(Boolean));
    const emptyWeeks: string[] = [];
    const cursor = new Date(first);
    cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
    let guard = 0;
    while (cursor <= last && guard < 200) {
      const wk = ymd(cursor);
      if (!weeksWithItems.has(wk)) emptyWeeks.push(wk);
      cursor.setDate(cursor.getDate() + 7);
      guard++;
    }
    if (emptyWeeks.length > 0) {
      out.push({
        id: "gaps",
        kind: "gap",
        severity: "low",
        title: `${emptyWeeks.length} week${emptyWeeks.length === 1 ? "" : "s"} with nothing scheduled`,
        detail: `Week${emptyWeeks.length === 1 ? "" : "s"} of ${emptyWeeks.map((w) => prettyDay(w)).slice(0, 5).join(", ")}${emptyWeeks.length > 5 ? "…" : ""} ${emptyWeeks.length === 1 ? "has" : "have"} no posts. Consider moving some content there to keep a steady cadence.`,
      });
    }
  }

  // 6) Weekend posts (usually lower engagement for B2B). Skip committed posts —
  // they can't be moved anymore, so flagging them is just noise.
  const weekend = scheduled.filter((it) => {
    if (!it.date || isLocked(it)) return false;
    const dow = new Date(it.date).getDay();
    return dow === 0 || dow === 6;
  });
  if (weekend.length > 0) {
    out.push({
      id: "weekend",
      kind: "weekend",
      severity: "low",
      title: `${weekend.length} item${weekend.length === 1 ? "" : "s"} on a weekend`,
      detail: "Weekend posts usually get less attention for B2B. Move them to a weekday unless that's intentional.",
      items: weekend,
    });
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

const ADVISORY_META: Record<AdvisorySeverity, { dot: string; label: string }> = {
  high: { dot: "bg-red-500", label: "Needs attention" },
  medium: { dot: "bg-amber-500", label: "Worth a look" },
  low: { dot: "bg-blue-500", label: "Suggestion" },
};

function ContentAdvisorDialog({ open, onOpenChange, advisories, scopeLabel, onSelectItem, onMarkDelivered, markingDelivered }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  advisories: Advisory[];
  scopeLabel: string;
  onSelectItem: (it: CalendarItem) => void;
  onMarkDelivered: (items: CalendarItem[]) => void;
  markingDelivered: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto" data-testid="dialog-content-advisor">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Content Advisor
          </DialogTitle>
          <DialogDescription>
            Reviewing {scopeLabel}. Change the calendar's campaign filter to review a single campaign or all of them.
          </DialogDescription>
        </DialogHeader>
        {advisories.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center" data-testid="advisor-empty">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
            <p className="text-sm font-medium">Nothing to flag</p>
            <p className="text-xs text-muted-foreground">No duplicates, crowded days, gaps, or stale dates in this view.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {advisories.map((a) => (
              <div key={a.id} className="rounded-lg border p-3" data-testid={`advisory-${a.kind}`}>
                <div className="flex items-start gap-2">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ADVISORY_META[a.severity].dot}`} title={ADVISORY_META[a.severity].label} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{a.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{a.detail}</p>
                    {a.items && a.items.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {a.items.slice(0, 8).map((it) => (
                          <button
                            key={`${it.type}-${it.id}`}
                            type="button"
                            onClick={() => onSelectItem(it)}
                            className="flex items-center gap-1 rounded border bg-card px-2 py-0.5 text-[11px] hover:bg-muted"
                            data-testid={`advisory-item-${it.id}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${TYPE_META[it.type].dot}`} />
                            <span className="max-w-[180px] truncate">{it.preview?.trim() || it.title}</span>
                            {it.date && <span className="text-muted-foreground">· {prettyDay(localKey(it.date)!)}</span>}
                          </button>
                        ))}
                        {a.items.length > 8 && <span className="px-1 text-[11px] text-muted-foreground">+{a.items.length - 8} more</span>}
                      </div>
                    )}
                    {a.kind === "past" && a.items && a.items.some((it) => it.type === "social") && (
                      <div className="mt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={markingDelivered}
                          onClick={() => onMarkDelivered(a.items!.filter((it) => it.type === "social"))}
                          data-testid="button-advisor-mark-delivered"
                        >
                          {markingDelivered ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                          Mark {a.items.filter((it) => it.type === "social").length} posted item
                          {a.items.filter((it) => it.type === "social").length === 1 ? "" : "s"} as delivered
                        </Button>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Already shared these (e.g. via SocialPilot)? Clear them here instead of opening each one.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-advisor-close">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [detail, setDetail] = useState<CalendarItem | null>(null);
  // WS4: when drilling into a collapsed social batch (shows its members).
  const [batchDrill, setBatchDrill] = useState<{ key: string; day: string; label: string } | null>(null);
  // The "see everything on this day" panel — opened from a day cell when the
  // grid caps the visible pills at 4 (or to expand a busy day in full).
  const [dayDetail, setDayDetail] = useState<string | null>(null);
  // When a draft is dropped onto a crowded day, we hold the drop here and ask
  // the user to confirm (or pick the suggested open day) before scheduling.
  const [pendingDrop, setPendingDrop] = useState<{ descriptors: { type: string; id: string }[]; dateKey: string } | null>(null);

  // ── Backlog state ──
  const [backlogFilters, setBacklogFilters] = useState({ campaignId: "all", solutionAreaId: "all", conferenceId: "all", status: "all" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDate, setBulkDate] = useState("");
  const [assignKind, setAssignKind] = useState<AssignmentKind>("campaign");
  const [assignValue, setAssignValue] = useState("none");
  // Export pre-check + delivery-confirm flow (mirrors the campaign export).
  const [exportPreview, setExportPreview] = useState<{
    totalPosts: number; datedPosts: number; undatedPosts: number; collisions: number;
    pendingSocialDrafts: number; accountsConfigured: number;
  } | null>(null);
  const [showExportWarning, setShowExportWarning] = useState(false);
  const [pendingFormat, setPendingFormat] = useState("socialpilot");
  const [includeUndated, setIncludeUndated] = useState(false);
  const [showDeliverConfirm, setShowDeliverConfirm] = useState(false);
  const [lastExportedIds, setLastExportedIds] = useState<string[]>([]);

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

  // Selecting from the day-detail panel: close the panel first, then open the
  // item (or drill into its batch) so the user sees the result underneath.
  const handleSelectFromDay = (i: CalendarItem) => {
    setDayDetail(null);
    handleSelect(i);
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

  // Content Advisor: review the currently-visible scheduled items (respects the
  // active campaign/type filter) plus the undated backlog. Scope the backlog
  // count to the same campaign/type filter as the scheduled view, so a
  // per-campaign review doesn't count unrelated campaigns' undated drafts.
  const advisorBacklogCount = useMemo(
    () => backlogItems.filter((it) =>
      (filters.campaignId === "all" || (it.campaignId ?? "") === filters.campaignId)
      && matchesTypeFilter(it, typeFilter),
    ).length,
    [backlogItems, filters.campaignId, typeFilter],
  );
  // Re-runs whenever the filtered view changes, so advice re-scopes per campaign.
  const advisories = useMemo(
    () => computeAdvisories(visibleScheduled, advisorBacklogCount),
    [visibleScheduled, advisorBacklogCount],
  );
  const advisorScopeLabel = useMemo(() => {
    if (filters.campaignId !== "all") {
      const name = filterOpts?.campaigns.find((c) => c.id === filters.campaignId)?.name;
      return name ? `the "${name}" campaign` : "this campaign";
    }
    return "all campaigns in view";
  }, [filters.campaignId, filterOpts]);

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

  // The backlog RAIL beside the calendar grid follows the SAME active campaign /
  // theme / event filter as the grid, so a per-campaign view shows only that
  // campaign's undated drafts — not every campaign's. (The standalone Backlog
  // tab keeps its own independent filters above for cross-campaign triage.)
  const railBacklog = useMemo(
    () => backlogItems.filter((it) =>
      matchesTypeFilter(it, typeFilter)
      && (filters.campaignId === "all" || (it.campaignId ?? "") === filters.campaignId)
      && (filters.solutionAreaId === "all" || (it.solutionAreaId ?? "") === filters.solutionAreaId)
      && (filters.conferenceId === "all" || (it.conferenceId ?? "") === filters.conferenceId)
    ),
    [backlogItems, filters, typeFilter],
  );

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

  // Open the pre-check dialog: fetch counts so the user sees exactly what will
  // (and won't) leave before any file downloads.
  const handleExportClick = async (format: string) => {
    setPendingFormat(format);
    setIncludeUndated(false);
    try {
      const p = new URLSearchParams();
      p.set("from", range.start.toISOString());
      p.set("to", range.end.toISOString());
      if (filters.campaignId !== "all") p.set("campaignId", filters.campaignId);
      if (filters.solutionAreaId !== "all") p.set("solutionAreaId", filters.solutionAreaId);
      if (filters.conferenceId !== "all") p.set("conferenceId", filters.conferenceId);
      const r = await fetch(`/api/marketing-calendar/export-preview?${p.toString()}`, { credentials: "include", headers: getTabContextHeaders() });
      setExportPreview(r.ok ? await r.json() : null);
    } catch {
      setExportPreview(null);
    }
    setShowExportWarning(true);
  };

  const exportCsvMut = useMutation({
    mutationFn: async ({ format, includeUndated: inclUndated }: { format: string; includeUndated: boolean }) => {
      const p = new URLSearchParams();
      p.set("from", range.start.toISOString());
      p.set("to", range.end.toISOString());
      p.set("tzOffset", String(new Date().getTimezoneOffset()));
      p.set("format", format);
      p.set("excludeUndated", inclUndated ? "false" : "true");
      if (filters.campaignId !== "all") p.set("campaignId", filters.campaignId);
      if (filters.solutionAreaId !== "all") p.set("solutionAreaId", filters.solutionAreaId);
      if (filters.conferenceId !== "all") p.set("conferenceId", filters.conferenceId);
      const res = await fetch(`/api/marketing-calendar/export-csv?${p.toString()}`, { method: "POST", credentials: "include", headers: getTabContextHeaders() });
      if (!res.ok) {
        let msg = "Export failed";
        try { msg = (await res.json()).error || msg; } catch {}
        throw new Error(msg);
      }
      const idsHeader = res.headers.get("X-Exported-Post-Ids") || "";
      const exportedIds = idsHeader ? idsHeader.split(",").filter(Boolean) : [];
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const name = match ? match[1] : `social-posts-${format}.csv`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      return { exportedIds };
    },
    onSuccess: ({ exportedIds }) => {
      setShowExportWarning(false);
      invalidate();
      if (exportedIds.length > 0) {
        setLastExportedIds(exportedIds);
        setShowDeliverConfirm(true);
      } else {
        toast({ title: "Social CSV downloaded", description: "No new posts were included in the file." });
      }
    },
    onError: (e: any) => toast({ title: "Could not export CSV", description: e.message, variant: "destructive" }),
  });

  const markDeliveredMut = useMutation({
    mutationFn: async (postIds: string[]) => {
      const res = await apiRequest("POST", "/api/marketing-calendar/mark-delivered", { postIds });
      return res.json() as Promise<{ updated: number }>;
    },
    onSuccess: (d) => {
      setShowDeliverConfirm(false);
      invalidate();
      toast({ title: `Marked ${d.updated} post${d.updated === 1 ? "" : "s"} as delivered`, description: "They won't appear in future exports unless you reset them." });
    },
    onError: (e: any) => toast({ title: "Couldn't mark delivered", description: e.message, variant: "destructive" }),
  });

  // Turn a LinkedIn / X content draft into a real, schedulable social post so it
  // shows up blue and gets included in the social CSV.
  const contentToPostMut = useMutation({
    mutationFn: async ({ it, platforms }: { it: CalendarItem; platforms: string[] }) => {
      const res = await apiRequest("POST", "/api/marketing-calendar/content-to-post", { briefId: it.id, platforms });
      return res.json() as Promise<{ posts: { postId: string; platform: string }[]; scheduled: boolean }>;
    },
    onSuccess: (d) => {
      invalidate();
      setDetail(null);
      const names = (d.posts ?? []).map((p) => (p.platform === "twitter" ? "X" : p.platform.charAt(0).toUpperCase() + p.platform.slice(1)));
      const list = names.join(", ");
      const n = names.length;
      toast({
        title: n === 1 ? "Scheduled as a social post" : `Created ${n} social posts`,
        description: d.scheduled
          ? `${list} — included in the social CSV.`
          : `${list}. Give them a date in Social Posts so they show up in the CSV.`,
      });
    },
    onError: (e: any) => toast({ title: "Couldn't schedule", description: e.message, variant: "destructive" }),
  });

  const resetExportsMut = useMutation({
    mutationFn: async () => {
      const p = new URLSearchParams();
      p.set("from", range.start.toISOString());
      p.set("to", range.end.toISOString());
      const res = await apiRequest("POST", `/api/marketing-calendar/reset-exports?${p.toString()}`);
      return res.json() as Promise<{ ok: boolean; affected: number }>;
    },
    onSuccess: (data) => {
      invalidate();
      toast({ title: `Reset ${data.affected} post${data.affected === 1 ? "" : "s"} to ready`, description: "Posts are back in the queue. Re-export when your scheduling tool is ready." });
    },
    onError: (e: any) => toast({ title: "Reset failed", description: e.message, variant: "destructive" }),
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
      return railBacklog.filter((b) => selected.has(itemKey(b))).map((b) => ({ type: b.type, id: b.id }));
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
    // Briefs are specs, not dated deliverables — they can't be dropped onto a
    // day. Drop them from the batch and tell the user how to schedule instead.
    const schedulable = descriptors.filter((d) => d.type !== "content");
    if (schedulable.length < descriptors.length) {
      toast({ title: "Briefs can't be scheduled", description: "A brief is a spec to hand off for creating content — turn it into a post or draft, then schedule that." });
    }
    if (!schedulable.length) return;
    const tz = new Date().getTimezoneOffset();
    try {
      const advice = await qc.fetchQuery<DateAdvice>({
        queryKey: [`/api/marketing-calendar/date-advice?date=${dateKey}&tzOffset=${tz}`],
      });
      if (advice?.busy) {
        setPendingDrop({ descriptors: schedulable, dateKey });
        return;
      }
    } catch {
      // If the advice lookup fails, fall back to scheduling without a warning.
    }
    scheduleDrop(schedulable, dateKey);
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
              <CalendarRange className="h-6 w-6" /> Content Calendar
            </h1>
            <p className="text-sm text-muted-foreground">The cross-channel overview of every scheduled social post, email, and content piece. Nothing here generates with AI — add and plan by hand.</p>
            <CalendarViewSwitcher className="mt-3" />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={exportCsvMut.isPending || resetExportsMut.isPending}
              onClick={() => handleExportClick(pendingFormat)}
              data-testid="button-export-csv"
            >
              {exportCsvMut.isPending || resetExportsMut.isPending
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Share2 className="mr-2 h-4 w-4" />}
              Export social CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => resetExportsMut.mutate()}
              disabled={resetExportsMut.isPending}
              className="text-amber-600 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950"
              data-testid="button-reset-exports"
            >
              <RotateCcw className="mr-2 h-4 w-4" /> Reset export status
            </Button>
            <Button variant="outline" onClick={() => setAdvisorOpen(true)} data-testid="button-content-advisor">
              <Sparkles className="mr-2 h-4 w-4" /> Advisor
              {advisories.length > 0 && (
                <Badge
                  variant="secondary"
                  className={`ml-2 px-1.5 py-0 text-[10px] ${advisories.some((a) => a.severity === "high") ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : ""}`}
                  data-testid="badge-advisor-count"
                >
                  {advisories.length}
                </Badge>
              )}
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
              <span className="border-l pl-4 flex items-center gap-x-3 gap-y-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-wide font-medium opacity-50 mr-1">Dots on pills:</span>
                {(Object.keys(ASSIGN_META) as AssignmentKind[]).map((k) => (
                  <span key={k} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${ASSIGN_META[k].dot}`} />{ASSIGN_META[k].label}</span>
                ))}
              </span>
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
                    onOpenDay={(key) => setDayDetail(key)}
                    onDropSchedule={handleDropSchedule}
                    onReschedule={(d, key) => handleRescheduleDrag(d, key)}
                  />
                </div>
                <BacklogRail
                  items={railBacklog}
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

      <ContentAdvisorDialog
        open={advisorOpen}
        onOpenChange={setAdvisorOpen}
        advisories={advisories}
        scopeLabel={advisorScopeLabel}
        onSelectItem={(it) => { setAdvisorOpen(false); handleSelect(it); }}
        onMarkDelivered={(items) => markDeliveredMut.mutate(items.map((it) => it.id))}
        markingDelivered={markDeliveredMut.isPending}
      />

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
        onScheduleAsSocial={(it, platforms) => contentToPostMut.mutate({ it, platforms })}
        busy={approveMut.isPending || deleteMut.isPending || exportDocxMut.isPending || handoffMut.isPending || assignMut.isPending || contentToPostMut.isPending}
      />

      {/* Export pre-check: show exactly what will and won't leave before downloading. */}
      <Dialog open={showExportWarning} onOpenChange={(o) => { if (!o) setShowExportWarning(false); }}>
        <DialogContent data-testid="dialog-export-precheck">
          <DialogHeader>
            <DialogTitle>Before you export</DialogTitle>
            <DialogDescription>Here's what will go into the {pendingFormat} file for the current view.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2 border-b pb-3">
              <label htmlFor="export-format" className="font-medium">CSV format</label>
              <Select value={pendingFormat} onValueChange={setPendingFormat}>
                <SelectTrigger className="w-44" id="export-format" data-testid="select-export-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="socialpilot">SocialPilot</SelectItem>
                  <SelectItem value="hootsuite">Hootsuite</SelectItem>
                  <SelectItem value="sproutsocial">Sprout Social</SelectItem>
                  <SelectItem value="generic">Generic CSV</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-between"><span>Scheduled posts (will export)</span><strong data-testid="text-precheck-dated">{exportPreview?.datedPosts ?? "—"}</strong></div>
            {(exportPreview?.undatedPosts ?? 0) > 0 && (
              <div className="flex justify-between text-amber-600"><span>Past / undated (skipped)</span><strong data-testid="text-precheck-undated">{exportPreview!.undatedPosts}</strong></div>
            )}
            {(exportPreview?.collisions ?? 0) > 0 && (
              <div className="flex justify-between text-amber-600"><span>Same time slot (auto-staggered)</span><strong>{exportPreview!.collisions}</strong></div>
            )}
            {(exportPreview?.accountsConfigured ?? 0) === 0 && (
              <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="warn-no-accounts">
                No active social accounts are set up, so account numbers will be blank. Add accounts in Social settings so SocialPilot can match them.
              </div>
            )}
            {(exportPreview?.pendingSocialDrafts ?? 0) > 0 && (
              <div className="rounded border border-violet-200 bg-violet-50 p-2 text-xs text-violet-900 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200" data-testid="warn-pending-drafts">
                {exportPreview!.pendingSocialDrafts} LinkedIn/X content draft{exportPreview!.pendingSocialDrafts === 1 ? "" : "s"} in this view {exportPreview!.pendingSocialDrafts === 1 ? "is" : "are"} not a scheduled social post yet, so {exportPreview!.pendingSocialDrafts === 1 ? "it" : "they"} won't be in this file. Open one and choose "Schedule as social post" to include it.
              </div>
            )}
            {(exportPreview?.undatedPosts ?? 0) > 0 && (
              <label className="flex items-center gap-2 pt-1 text-xs" data-testid="label-include-undated">
                <input type="checkbox" checked={includeUndated} onChange={(e) => setIncludeUndated(e.target.checked)} />
                Include past/undated posts anyway (their date column will be blank)
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExportWarning(false)} data-testid="button-precheck-cancel">Cancel</Button>
            <Button onClick={() => exportCsvMut.mutate({ format: pendingFormat, includeUndated })} disabled={exportCsvMut.isPending} data-testid="button-precheck-download">
              {exportCsvMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Download CSV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delivery confirm: mirrors the campaign export so exported posts get marked delivered.
          Intentionally non-dismissible (no onOpenChange, no outside-click close) — the user
          must explicitly choose "Not yet" or "Yes", so the dialog can't be lost by accident. */}
      <Dialog open={showDeliverConfirm}>
        <DialogContent
          data-testid="dialog-deliver-confirm"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Did the import work?</DialogTitle>
            <DialogDescription>
              Once your scheduling tool accepted the file, mark these {lastExportedIds.length} post{lastExportedIds.length === 1 ? "" : "s"} as delivered so they won't appear in future exports. Choose "Not yet" if the import failed or you haven't tried yet.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeliverConfirm(false)} data-testid="button-deliver-not-yet">Not yet</Button>
            <Button onClick={() => markDeliveredMut.mutate(lastExportedIds)} disabled={markDeliveredMut.isPending} data-testid="button-deliver-confirm">
              {markDeliveredMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Yes, mark delivered
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!dayDetail} onOpenChange={(o) => !o && setDayDetail(null)}>
        <DialogContent className="max-w-lg" data-testid="dialog-day-detail">
          <DialogHeader>
            <DialogTitle>{dayDetail ? prettyDay(dayDetail) : ""}</DialogTitle>
            <DialogDescription>
              {dayDetail
                ? `${(byDay.get(dayDetail) || []).length} activit${(byDay.get(dayDetail) || []).length === 1 ? "y" : "ies"} scheduled. Click any item to open it.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-1 overflow-y-auto">
            {dayDetail && (byDay.get(dayDetail) || []).length === 0 && (
              <p className="text-sm text-muted-foreground" data-testid="text-day-detail-empty">Nothing scheduled this day.</p>
            )}
            {dayDetail && (byDay.get(dayDetail) || []).map((it) => {
              // Lead with the actual content so near-identical rows (e.g. many
              // "instagram · Synozur" posts) are distinguishable at a glance.
              // Social posts carry their text in `preview`; email/content already
              // use a meaningful subject/title, so fall back to that.
              const primary = it.preview?.trim() ? it.preview.trim() : it.title;
              const secondary = primary !== it.title ? it.title : null;
              return (
                <button
                  key={`${it.type}-${it.id}`}
                  onClick={() => handleSelectFromDay(it)}
                  className="flex w-full items-center gap-1.5 rounded border p-2 text-left text-xs hover:bg-muted"
                  data-testid={`item-day-detail-${it.type}-${it.id}`}
                  title={it.isBatch ? `${it.title} — click to drill in` : primary}
                >
                  {it.isBatch
                    ? <Inbox className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-300" />
                    : <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_META[it.type].dot}`} />}
                  <ChannelFormatTag item={it} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{primary}</span>
                    {secondary && (
                      <span className="truncate text-[10px] text-muted-foreground">{secondary}</span>
                    )}
                  </span>
                  <AssignmentDots item={it} filterOpts={filterOpts} />
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
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
  // A collapsed batch is never individually draggable (it has no single date/id);
  // a committed (delivered) social post can't be rescheduled, so it's locked too.
  const locked = isLocked(item);
  const canDrag = !!draggable && !item.isBatch && !locked;
  const titleAttr = item.isBatch
    ? `${item.title} — click to drill in`
    : locked
    ? `${item.title} — already committed to your scheduler; can't be moved`
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
      {(assignments.length > 0 || item.websitePostSlug) && (
        <span className="ml-auto flex shrink-0 items-center gap-0.5" data-testid={`assign-dots-${item.id}`}>
          {item.websitePostSlug && (
            <Globe
              className="h-2.5 w-2.5 text-violet-400"
              title={`On website: ${item.websitePostStatus ?? "draft"}`}
            />
          )}
          {assignments.map((a) => (
            <span key={a.kind} className={`h-1.5 w-1.5 rounded-full ${ASSIGN_META[a.kind].dot}`} />
          ))}
        </span>
      )}
    </button>
  );
}

function MonthGrid({ anchor, byDay, filterOpts, onSelect, onOpenDay, onDropSchedule, onReschedule }: {
  anchor: Date;
  byDay: Map<string, CalendarItem[]>;
  filterOpts?: FilterOptions;
  onSelect: (i: CalendarItem) => void;
  onOpenDay?: (key: string) => void;
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
                  <div className="mb-1 flex items-center justify-end">
                    {dayItems.length > 0 && onOpenDay ? (
                      <button
                        type="button"
                        onClick={() => onOpenDay(key!)}
                        className={`rounded px-1 text-xs hover:bg-muted ${key === todayKey ? "font-bold text-primary" : "text-muted-foreground"}`}
                        data-testid={`button-open-day-${key}`}
                        title="See everything on this day"
                      >
                        {date.getDate()}
                      </button>
                    ) : (
                      <span className={`px-1 text-xs ${key === todayKey ? "font-bold text-primary" : "text-muted-foreground"}`}>{date.getDate()}</span>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {dayItems.slice(0, 4).map((it) => <ItemPill key={`${it.type}-${it.id}`} item={it} filterOpts={filterOpts} onSelect={onSelect} draggable={!!onReschedule} />)}
                    {dayItems.length > 4 && (
                      onOpenDay ? (
                        <button
                          type="button"
                          onClick={() => onOpenDay(key!)}
                          className="w-full rounded px-1 text-left text-[10px] text-muted-foreground hover:bg-muted hover:underline"
                          data-testid={`button-day-more-${key}`}
                        >
                          +{dayItems.length - 4} more
                        </button>
                      ) : (
                        <div className="px-1 text-[10px] text-muted-foreground">+{dayItems.length - 4} more</div>
                      )
                    )}
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
          {selectedCount > 0 && (
            <p className="px-3 pt-1 text-[11px] text-muted-foreground" data-testid="backlog-rail-discard-hint">
              To discard or archive in bulk, open the Backlog tab.
            </p>
          )}
          <div className="max-h-[560px] space-y-1 overflow-y-auto p-2" data-testid="backlog-rail-list">
            {items.map((it) => {
              const k = itemKey(it);
              const checked = selected.has(k);
              // Briefs are specs, not dated deliverables — they can't be dragged
              // onto a day. They still show here as ideas and can be opened.
              const canSchedule = it.type !== "content";
              return (
                <div
                  key={k}
                  draggable={canSchedule}
                  onDragStart={canSchedule ? (e) => onDragStart(e, it) : undefined}
                  className={`flex items-center gap-2 rounded border px-2 py-1.5 text-xs ${canSchedule ? "cursor-grab active:cursor-grabbing" : ""} ${checked ? "border-primary/40 bg-primary/5" : "bg-card hover:bg-muted/50"}`}
                  data-testid={`backlog-rail-row-${it.id}`}
                  title={canSchedule ? undefined : "Briefs are specs — turn into a post or draft to schedule"}
                >
                  {canSchedule && <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  <Checkbox checked={checked} onCheckedChange={() => toggleSelected(it)} data-testid={`checkbox-rail-${it.id}`} aria-label={`Select ${it.title}`} />
                  <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_META[it.type].dot}`} title={TYPE_META[it.type].label} />
                  <ChannelFormatTag item={it} />
                  {it.type === "content" ? (
                    <Link href={editorHref(it)} className="flex-1 truncate text-xs hover:underline" data-testid={`button-rail-item-${it.id}`}>
                      {it.title}
                    </Link>
                  ) : (
                    <button onClick={() => onSelect(it)} className="flex-1 truncate text-left hover:underline" data-testid={`button-rail-item-${it.id}`}>
                      {it.title}
                    </button>
                  )}
                  {it.type === "content" && (
                    <Badge variant="outline" className={`shrink-0 px-1 py-0 text-[10px] ${LIFECYCLE_META[it.lifecycle].cls}`} data-testid={`badge-brief-status-${it.id}`}>
                      {it.websitePostSlug ? "Pushed to web" : LIFECYCLE_META[it.lifecycle].label}
                    </Badge>
                  )}
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
                  <SelectItem value="ebook">Ebook</SelectItem>
                  <SelectItem value="case_study">Case study</SelectItem>
                  <SelectItem value="landing_page">Landing page</SelectItem>
                  <SelectItem value="video_script">Video script</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {type !== "content" ? (
            <div>
              <Label className="text-xs">Date (optional — leave blank for unscheduled)</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-add-date" />
              <DateCrowdingHint date={date} onPick={setDate} testid="text-add-crowding" />
            </div>
          ) : (
            <p className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground" data-testid="text-add-content-note">
              Briefs aren't scheduled — a brief is a spec for creating content. It'll go to the backlog; create the collateral, then schedule that.
            </p>
          )}
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
  // Deep-link straight to this brief so "Open editor" lands on the right draft
  // instead of dumping the user into the bare briefs list. Pass the calendar id
  // too so the page selects the right calendar before scrolling to the brief.
  const params = new URLSearchParams();
  if (it.calendarId) params.set("calendar", it.calendarId);
  // Pass the campaign too so the editor opens scoped to this piece's campaign
  // (a campaign-scoped review view) instead of the calendar's full brief list.
  if (it.campaignId) params.set("campaignId", it.campaignId);
  params.set("brief", it.id);
  return `/app/marketing/editorial-calendar?${params.toString()}`;
}

// A content draft authored for LinkedIn / X is NOT a schedulable social post yet
// — it has no account or send time, so it never shows up in the social CSV. The
// dialog uses this to explain that and offer the one-click convert path.
function isSocialFormatContent(it: CalendarItem): boolean {
  return it.type === "content" && (it.format === "linkedin_post" || it.format === "x_post");
}

// Deep-link a single social post into the Social Calendar so it lands on the
// right month and opens that post's drawer. Batches (no single post id) and
// unscheduled items fall back to the general view.
function socialCalendarHref(it: CalendarItem): string {
  const params = new URLSearchParams();
  // A batch is many posts — we can't focus one, but we can still land the user
  // on the right month (and campaign, if known) instead of a bare calendar.
  if (!it.isBatch) params.set("post", it.id);
  if (it.date) params.set("date", it.date);
  if (it.campaignId) params.set("campaignId", it.campaignId);
  const qs = params.toString();
  return qs ? `/app/marketing/calendar?${qs}` : "/app/marketing/calendar";
}

function DetailDialog({ item, filterOpts, onOpenChange, onApprove, onDelete, onExportDocx, onHandoffEmail, onReschedule, onAssign, onScheduleAsSocial, busy }: {
  item: CalendarItem | null;
  filterOpts?: FilterOptions;
  onOpenChange: (o: boolean) => void;
  onApprove: (it: CalendarItem) => void;
  onDelete: (it: CalendarItem) => void;
  onExportDocx: (it: CalendarItem) => void;
  onHandoffEmail: (it: CalendarItem) => void;
  onReschedule: (it: CalendarItem, date: string | null) => void;
  onAssign: (it: CalendarItem, patch: Record<string, string | null>) => void;
  onScheduleAsSocial: (it: CalendarItem, platforms: string[]) => void;
  busy: boolean;
}) {
  const [dateVal, setDateVal] = useState(item?.date ? localKey(item.date) || "" : "");
  const [timeVal, setTimeVal] = useState(localTime(item?.date ?? null));
  // Which channels to fan this draft out to. The draft's native channel is
  // pre-checked; the others get the post tailored to their native style.
  const [channels, setChannels] = useState<string[]>([item?.format === "x_post" ? "twitter" : "linkedin"]);
  const toggleChannel = (c: string) =>
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  const { toast } = useToast();
  // Combine the date + time fields into an ISO string the reschedule PATCH
  // understands. Clearing the date unschedules the item (null); time defaults to
  // 9:00 AM when left blank.
  const pushSchedule = (day: string, time: string) => {
    if (!day) { onReschedule(item!, null); return; }
    onReschedule(item!, new Date(`${day}T${(time || "09:00")}:00`).toISOString());
  };
  // A committed (exported/published) social post can't be rescheduled — it's
  // already locked into the external scheduler. Disable the date/time editor.
  const locked = !!item && isLocked(item);
  // Social posts only ship a 160-char preview in the aggregation payload. Fetch
  // the full row (complete copy, branded graphic, carousel slides) on click so
  // the dialog isn't just a snippet. Batches drill down separately, so skip them.
  const isSocialPost = item?.type === "social" && !item?.isBatch;
  const { data: postDetail } = useQuery<{
    content?: string | null;
    editedContent?: string | null;
    overrideImageUrl?: string | null;
    postFormat?: string | null;
    carouselSlides?: { index: number; role: string; headline: string; imageUrl?: string | null }[] | null;
  }>({
    queryKey: [`/api/generated-posts/${item?.id}`],
    enabled: !!item?.id && isSocialPost,
  });
  if (!item) return null;
  const assignments = resolveAssignments(item, filterOpts);
  // Blog/content and email get "Finalize/Approve"; social posts can also be
  // approved one-at-a-time from here (in addition to the bulk CSV export path).
  const canApprove = (item.type === "content" || item.type === "email" || item.type === "social") && item.lifecycle === "draft";
  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-item-detail" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${TYPE_META[item.type].dot}`} /> {item.title}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{TYPE_META[item.type].label}</Badge>
            {channelFormatMarker(item) && (
              <Badge variant="outline" data-testid="badge-detail-channel-format">{channelFormatMarker(item)!.label}</Badge>
            )}
            <Badge variant="outline" className={LIFECYCLE_META[item.lifecycle].cls}>{LIFECYCLE_META[item.lifecycle].label}</Badge>
            {item.type === "social" && item.deliveryMode === "csv" && (
              <Badge variant="outline" className="gap-1 text-sky-600 border-sky-300" data-testid="badge-detail-delivery-csv">
                <FileDown className="h-3 w-3" />CSV export
              </Badge>
            )}
            {item.type === "social" && !item.deliveryMode && item.lifecycle !== "delivered" && (
              <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-300" data-testid="badge-detail-delivery-orbit">
                <Zap className="h-3 w-3" />Via Orbit
              </Badge>
            )}
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

        {(() => {
          const fullContent = postDetail?.editedContent ?? postDetail?.content ?? null;
          const slides = postDetail?.carouselSlides ?? null;
          const heroImage = postDetail?.overrideImageUrl ?? item.imageUrl ?? null;
          const bodyText = fullContent ?? item.preview ?? "";
          if (!heroImage && !bodyText && !(slides && slides.length)) return null;
          const stub = safeFileStub(item.title);
          const slidesWithImages = (slides ?? []).filter(s => s.imageUrl);
          const copyText = async () => {
            try {
              await navigator.clipboard.writeText(bodyText);
              toast({ title: "Copied", description: "Post text copied to clipboard." });
            } catch {
              toast({ title: "Couldn't copy", description: "Select the text and copy it manually.", variant: "destructive" });
            }
          };
          const downloadAllSlides = async () => {
            toast({ title: `Downloading ${slidesWithImages.length} slides…` });
            for (let i = 0; i < slidesWithImages.length; i++) {
              await downloadImageFromUrl(slidesWithImages[i].imageUrl as string, `${stub}-slide-${i + 1}`);
            }
          };
          return (
            <div className="space-y-3">
              {heroImage && (
                <div className="space-y-1">
                  <img
                    src={heroImage}
                    alt=""
                    className="max-h-64 w-full rounded-md border bg-muted object-contain"
                    data-testid="img-detail-graphic"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => downloadImageFromUrl(heroImage, `${stub}-graphic`)}
                    data-testid="button-download-graphic"
                  >
                    <Download className="h-3.5 w-3.5" /> Download image
                  </Button>
                </div>
              )}
              {bodyText && (
                <div className="space-y-1">
                  <p
                    className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-sm text-muted-foreground"
                    data-testid="text-detail-content"
                  >
                    {bodyText}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={copyText}
                    data-testid="button-copy-text"
                  >
                    <Copy className="h-3.5 w-3.5" /> Copy text
                  </Button>
                </div>
              )}
              {slides && slides.length > 0 && (
                <div data-testid="detail-carousel-slides">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Carousel · {slides.length} slides</Label>
                    {slidesWithImages.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={downloadAllSlides}
                        data-testid="button-download-all-slides"
                      >
                        <Download className="h-3.5 w-3.5" /> Download all
                      </Button>
                    )}
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    {slides.map((s, i) => (
                      <div key={i} className="space-y-1">
                        <div className="overflow-hidden rounded border">
                          {s.imageUrl ? (
                            <img
                              src={s.imageUrl}
                              alt={s.headline || `Slide ${i + 1}`}
                              className="aspect-square w-full object-cover"
                              data-testid={`img-carousel-slide-${i}`}
                            />
                          ) : (
                            <div className="flex aspect-square w-full items-center justify-center p-1 text-center text-[10px] text-muted-foreground">
                              {s.headline}
                            </div>
                          )}
                        </div>
                        {s.imageUrl && (
                          <button
                            type="button"
                            className="flex w-full items-center justify-center gap-1 rounded border py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                            onClick={() => downloadImageFromUrl(s.imageUrl as string, `${stub}-slide-${i + 1}`)}
                            data-testid={`button-download-slide-${i}`}
                          >
                            <Download className="h-3 w-3" /> Save
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {item.type === "content" ? (
          <p className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground" data-testid="text-detail-content-note">
            Briefs aren't scheduled — a brief is a spec you hand off to create the actual content. Turn it into a post or draft to put that on the calendar.
          </p>
        ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Date</Label>
            <Input
              type="date"
              value={dateVal}
              disabled={locked}
              onChange={(e) => {
                setDateVal(e.target.value);
                pushSchedule(e.target.value, timeVal);
              }}
              data-testid="input-detail-date"
            />
          </div>
          <div>
            <Label className="flex items-center gap-1 text-xs"><Clock className="h-3 w-3" /> Time</Label>
            <Input
              type="time"
              value={timeVal}
              disabled={locked || !dateVal}
              onChange={(e) => {
                setTimeVal(e.target.value);
                if (dateVal) pushSchedule(dateVal, e.target.value);
              }}
              data-testid="input-detail-time"
            />
          </div>
          <div className="col-span-2">
            {locked ? (
              <p className="text-xs text-muted-foreground" data-testid="text-detail-locked">
                This post is already committed to your scheduler — its date can't be changed here.
              </p>
            ) : (
              <DateCrowdingHint
                date={dateVal}
                onPick={(d) => { setDateVal(d); pushSchedule(d, timeVal); }}
                testid="text-detail-crowding"
              />
            )}
          </div>
        </div>
        )}

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

        {isSocialFormatContent(item) && (
          <div className="rounded-md border border-violet-200 bg-violet-50 p-2.5 text-xs text-violet-900 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200" data-testid="note-content-draft">
            This is a {item.format === "x_post" ? "X" : "LinkedIn"} <strong>content draft</strong>, not a scheduled social post. The date and time above are just a planning slot — the draft has no posting account assigned and isn't in the social-post pipeline, so it won't appear in the SocialPilot CSV. Click "Schedule as social post" to turn it into a real post that exports.
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Link href={editorHref(item)}>
              <Button variant="outline" size="sm" data-testid="button-open-editor"><PenLine className="mr-2 h-4 w-4" /> Open editor</Button>
            </Link>
            {isSocialFormatContent(item) && (
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground mr-0.5">Channels:</span>
                  {([
                    { id: "linkedin", label: "LinkedIn" },
                    { id: "twitter", label: "X" },
                    { id: "facebook", label: "Facebook" },
                    { id: "instagram", label: "Instagram" },
                  ] as const).map((ch) => {
                    const on = channels.includes(ch.id);
                    return (
                      <Button
                        key={ch.id}
                        type="button"
                        variant={on ? "default" : "outline"}
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => toggleChannel(ch.id)}
                        data-testid={`toggle-channel-${ch.id}`}
                        aria-pressed={on}
                      >
                        {ch.label}
                      </Button>
                    );
                  })}
                </div>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => onScheduleAsSocial(item, channels)}
                  disabled={busy || !item.contentAssetId || channels.length === 0}
                  title={!item.contentAssetId ? "Draft the content first" : channels.length === 0 ? "Pick at least one channel" : undefined}
                  data-testid="button-schedule-as-social"
                >
                  <Send className="mr-2 h-4 w-4" />
                  {channels.length > 1 ? `Schedule ${channels.length} social posts` : "Schedule as social post"}
                </Button>
              </div>
            )}
            {canApprove && (
              <Button variant="outline" size="sm" onClick={() => onApprove(item)} disabled={busy} data-testid="button-approve"
                title={item.type === "content" ? "Approve the brief and its draft in one step" : item.type === "social" ? "Mark as approved — ready to publish or export" : undefined}>
                <CheckCircle2 className="mr-2 h-4 w-4" /> {item.type === "content" ? "Finalize" : "Approve"}
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
            {item.type === "social" && item.lifecycle === "approved" && item.deliveryMode !== "csv" && (
              <Button
                variant="default"
                size="sm"
                disabled={busy}
                data-testid="button-publish-now"
                onClick={async () => {
                  try {
                    const r = await fetch(`/api/generated-posts/${item.id}/publish`, { method: "POST", credentials: "include" });
                    const d = await r.json().catch(() => ({}));
                    if (!r.ok) throw new Error(d.error || "Publish failed");
                    invalidate();
                    setDetail(null);
                    toast({ title: "Published!", description: d.publishedUrl ? `Live at ${d.publishedUrl}` : "Post published successfully." });
                  } catch (err: any) {
                    toast({ title: "Publish failed", description: err.message, variant: "destructive" });
                  }
                }}
              >
                <Send className="mr-2 h-4 w-4" /> Publish now via Orbit
              </Button>
            )}
            {item.type === "social" && (
              <Link href={socialCalendarHref(item)}>
                <Button variant="outline" size="sm" data-testid="button-social-export"><ExternalLink className="mr-2 h-4 w-4" /> Open in Social Posts</Button>
              </Link>
            )}
            {item.type === "content" && (
              <Link href={editorHref(item)}>
                <Button variant="outline" size="sm" data-testid="button-open-editorial"><ExternalLink className="mr-2 h-4 w-4" /> Open in Editorial Calendar</Button>
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

      {/* Backlog filters — these filter only the unscheduled backlog list below, not the calendar grid above */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground font-medium">Backlog filters:</span>
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
              const postPreview = it.preview?.trim();
              return (
                <div key={k} className={`flex items-center gap-3 px-3 py-2 text-sm ${checked ? "bg-primary/5" : "hover:bg-muted/50"}`} data-testid={`backlog-row-${it.id}`}>
                  <Checkbox checked={checked} onCheckedChange={() => toggleSelected(it)} data-testid={`checkbox-item-${it.id}`} aria-label={`Select ${it.title}`} />
                  <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_META[it.type].dot}`} title={TYPE_META[it.type].label} />
                  <ChannelFormatTag item={it} />
                  {it.type === "content" ? (
                    <Link
                      href={editorHref(it)}
                      className="min-w-0 flex-1 text-left"
                      data-testid={`button-backlog-item-${it.id}`}
                    >
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate font-medium hover:underline">{it.title}</span>
                        {it.campaignName && (
                          <span className="shrink-0 rounded px-1.5 py-0 text-[10px] font-medium bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" data-testid={`badge-backlog-campaign-${it.id}`}>
                            {it.campaignName}
                          </span>
                        )}
                        {!it.campaignName && it.conferenceName && (
                          <span className="shrink-0 rounded px-1.5 py-0 text-[10px] font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                            {it.conferenceName}
                          </span>
                        )}
                      </div>
                      {postPreview && (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">{postPreview}</div>
                      )}
                    </Link>
                  ) : (
                    <button
                      onClick={() => onSelect(it)}
                      className="min-w-0 flex-1 text-left"
                      data-testid={`button-backlog-item-${it.id}`}
                    >
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate font-medium hover:underline">{it.title}</span>
                        {it.campaignName && (
                          <span className="shrink-0 rounded px-1.5 py-0 text-[10px] font-medium bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" data-testid={`badge-backlog-campaign-${it.id}`}>
                            {it.campaignName}
                          </span>
                        )}
                        {!it.campaignName && it.conferenceName && (
                          <span className="shrink-0 rounded px-1.5 py-0 text-[10px] font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                            {it.conferenceName}
                          </span>
                        )}
                      </div>
                      {postPreview && (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">{postPreview}</div>
                      )}
                    </button>
                  )}
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
