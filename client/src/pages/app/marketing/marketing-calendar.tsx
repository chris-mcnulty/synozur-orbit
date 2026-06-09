import { useMemo, useState } from "react";
import { Link } from "wouter";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  imageUrl?: string | null;
}

interface FilterOption {
  id: string;
  name: string;
}
interface FilterOptions {
  campaigns: FilterOption[];
  solutionAreas: FilterOption[];
  conferences: FilterOption[];
}

const TYPE_META: Record<ItemType, { label: string; dot: string; chip: string }> = {
  social: { label: "Social", dot: "bg-blue-500", chip: "border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900" },
  email: { label: "Email", dot: "bg-amber-500", chip: "border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900" },
  content: { label: "Content", dot: "bg-violet-500", chip: "border-violet-200 bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-900" },
};

const LIFECYCLE_META: Record<Lifecycle, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-muted text-muted-foreground" },
  approved: { label: "Approved", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  delivered: { label: "Delivered", cls: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" },
};

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

export default function MarketingCalendarPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [anchor, setAnchor] = useState(() => startOfMonth(new Date()));
  const [grouping, setGrouping] = useState<"month" | "quarter">("month");
  const [groupBy, setGroupBy] = useState<"none" | "campaign" | "theme" | "event">("none");
  const [filters, setFilters] = useState({ campaignId: "all", solutionAreaId: "all", conferenceId: "all" });

  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<CalendarItem | null>(null);

  const range = useMemo(() => {
    if (grouping === "quarter") return quarterRange(anchor);
    const start = startOfMonth(anchor);
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59);
    return { start, end };
  }, [anchor, grouping]);

  const queryUrl = useMemo(() => {
    const p = new URLSearchParams();
    p.set("from", range.start.toISOString());
    p.set("to", range.end.toISOString());
    p.set("includeUnscheduled", "true");
    if (filters.campaignId !== "all") p.set("campaignId", filters.campaignId);
    if (filters.solutionAreaId !== "all") p.set("solutionAreaId", filters.solutionAreaId);
    if (filters.conferenceId !== "all") p.set("conferenceId", filters.conferenceId);
    return `/api/marketing-calendar?${p.toString()}`;
  }, [range, filters]);

  const { data: items = [], isLoading } = useQuery<CalendarItem[]>({ queryKey: [queryUrl] });
  const { data: filterOpts } = useQuery<FilterOptions>({ queryKey: ["/api/marketing-calendar/filters"] });

  const scheduled = useMemo(() => items.filter((i) => i.date), [items]);
  const unscheduled = useMemo(() => items.filter((i) => !i.date), [items]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const it of scheduled) {
      const k = localKey(it.date);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return map;
  }, [scheduled]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [queryUrl] });
  };

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

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          {(Object.keys(TYPE_META) as ItemType[]).map((t) => (
            <span key={t} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${TYPE_META[t].dot}`} /> {TYPE_META[t].label}</span>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
          {/* Calendar */}
          <div>
            {isLoading ? (
              <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : groupBy !== "none" ? (
              <GroupedList items={items} groupBy={groupBy} filterOpts={filterOpts} onSelect={setDetail} />
            ) : grouping === "month" ? (
              <MonthGrid anchor={anchor} byDay={byDay} onSelect={setDetail} />
            ) : (
              <QuarterList anchor={anchor} items={scheduled} onSelect={setDetail} />
            )}
          </div>

          {/* Unscheduled tray */}
          <Card className="h-fit">
            <CardContent className="p-3">
              <h3 className="mb-2 text-sm font-semibold">Unscheduled ({unscheduled.length})</h3>
              {unscheduled.length === 0 ? (
                <p className="text-xs text-muted-foreground">Everything has a date. Nice.</p>
              ) : (
                <div className="space-y-2" data-testid="list-unscheduled">
                  {unscheduled.map((it) => (
                    <button key={`${it.type}-${it.id}`} onClick={() => setDetail(it)} className="w-full rounded-md border p-2 text-left hover:bg-muted" data-testid={`item-unscheduled-${it.id}`}>
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_META[it.type].dot}`} />
                        <span className="truncate text-xs font-medium">{it.title}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-1">
                        <Badge variant="outline" className={`px-1 py-0 text-[10px] ${LIFECYCLE_META[it.lifecycle].cls}`}>{LIFECYCLE_META[it.lifecycle].label}</Badge>
                        <Input
                          type="date"
                          className="h-6 w-[120px] text-[11px]"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v) rescheduleMut.mutate({ it, date: new Date(`${v}T09:00:00`).toISOString() });
                          }}
                          data-testid={`input-schedule-${it.id}`}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AddItemDialog open={addOpen} onOpenChange={setAddOpen} filterOpts={filterOpts} onCreated={() => qc.invalidateQueries({ queryKey: [queryUrl] })} />

      <DetailDialog
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

function ItemPill({ item, onSelect }: { item: CalendarItem; onSelect: (i: CalendarItem) => void }) {
  return (
    <button
      onClick={() => onSelect(item)}
      className={`flex w-full items-center gap-1 truncate rounded border px-1 py-0.5 text-left text-[11px] ${TYPE_META[item.type].chip}`}
      data-testid={`item-calendar-${item.id}`}
      title={item.title}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.lifecycle === "delivered" ? "bg-green-500" : item.lifecycle === "approved" ? "bg-blue-500" : "bg-gray-400"}`} />
      <span className="truncate">{item.title}</span>
    </button>
  );
}

function MonthGrid({ anchor, byDay, onSelect }: { anchor: Date; byDay: Map<string, CalendarItem[]>; onSelect: (i: CalendarItem) => void }) {
  const first = startOfMonth(anchor);
  const startDow = first.getDay();
  const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  const todayKey = ymd(new Date());

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(anchor.getFullYear(), anchor.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs font-medium text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date, i) => {
          const key = date ? ymd(date) : null;
          const dayItems = key ? byDay.get(key) || [] : [];
          return (
            <div key={i} className={`min-h-[96px] border-b border-r p-1 ${date ? "" : "bg-muted/20"} ${key === todayKey ? "bg-primary/5" : ""}`}>
              {date && (
                <>
                  <div className={`mb-1 text-right text-xs ${key === todayKey ? "font-bold text-primary" : "text-muted-foreground"}`}>{date.getDate()}</div>
                  <div className="space-y-0.5">
                    {dayItems.slice(0, 4).map((it) => <ItemPill key={`${it.type}-${it.id}`} item={it} onSelect={onSelect} />)}
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

function QuarterList({ anchor, items, onSelect }: { anchor: Date; items: CalendarItem[]; onSelect: (i: CalendarItem) => void }) {
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
                    <span className="truncate">{it.title}</span>
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
  if (!item) return null;
  const dateVal = item.date ? localKey(item.date) || "" : "";
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
            <Badge variant="outline" className={LIFECYCLE_META[item.lifecycle].cls}>{LIFECYCLE_META[item.lifecycle].label}</Badge>
          </DialogDescription>
        </DialogHeader>

        {item.preview && <p className="rounded-md bg-muted p-2 text-sm text-muted-foreground">{item.preview}</p>}

        <div>
          <Label className="text-xs">Date</Label>
          <Input
            type="date"
            defaultValue={dateVal}
            onChange={(e) => onReschedule(item, e.target.value ? new Date(`${e.target.value}T09:00:00`).toISOString() : null)}
            data-testid="input-detail-date"
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
                    <span className="flex-1 truncate">{it.title}</span>
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
