import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  Columns3 as ColumnsIcon,
  ExternalLink,
  ListChecks,
  Mail,
  MoreVertical,
  Rows3 as RowsIcon,
  Search,
  Share2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import AppLayout from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  PIPELINE_STAGES,
  TYPE_LABELS,
  allowedDropStages,
  briefToPipelineItem,
  emailToPipelineItem,
  patchUrlFor,
  postToPipelineItem,
  transitionFor,
  type CalendarPostRow,
  type PipelineItem,
  type PipelineStage,
  type SavedEmailRow,
} from "@/lib/pipeline";

const VIEW_STORAGE_KEY = "orbit-pipeline-view";

const TYPE_ICONS = {
  post: Share2,
  email: Mail,
  brief: ClipboardList,
} as const;

function PipelineCard({
  item,
  dragging,
  overlay,
  onOpen,
  onMove,
}: {
  item: PipelineItem;
  dragging?: boolean;
  overlay?: boolean;
  onOpen?: (item: PipelineItem) => void;
  onMove?: (item: PipelineItem, stage: PipelineStage) => void;
}) {
  const Icon = TYPE_ICONS[item.type];
  // The raw status chip only appears when it says more than the column does
  // (e.g. a brief sitting in Approved may really be "in_progress").
  const showSourceStatus =
    (item.type === "brief" && ["in_progress", "drafted"].includes(item.sourceStatus)) ||
    item.sourceStatus === "exported";
  const moveTargets = onMove ? allowedDropStages(item) : [];
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen?.(item);
        }
      }}
      data-testid={`pipeline-card-${item.key}`}
      className={cn(
        "rounded-lg border bg-card p-3 text-left shadow-sm transition-shadow cursor-grab active:cursor-grabbing",
        item.failed ? "border-destructive/50 bg-destructive/5" : "border-border hover:shadow-md",
        dragging && "opacity-40",
        overlay && "rotate-2 shadow-xl ring-2 ring-primary cursor-grabbing",
      )}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-[11px] font-medium text-muted-foreground truncate">
          {item.subtitle || TYPE_LABELS[item.type]}
        </span>
        <span className="ml-auto flex items-center gap-1 shrink-0">
          {showSourceStatus && (
            <Badge variant="outline" className="h-4 px-1 text-[9px] capitalize">
              {item.sourceStatus.replace(/_/g, " ")}
            </Badge>
          )}
          {/* Keyboard/screen-reader/touch-friendly alternative to dragging:
              every stage a drag could reach is reachable from this menu. */}
          {onMove && moveTargets.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Move ${TYPE_LABELS[item.type].toLowerCase()} to another stage`}
                  className="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  data-testid={`pipeline-move-${item.key}`}
                >
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuLabel className="text-xs">Move to</DropdownMenuLabel>
                {moveTargets.map((stage) => {
                  const stageDef = PIPELINE_STAGES.find((s) => s.id === stage)!;
                  return (
                    <DropdownMenuItem
                      key={stage}
                      className="text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMove(item, stage);
                      }}
                      data-testid={`pipeline-move-${item.key}-${stage}`}
                    >
                      <span className={cn("w-2 h-2 rounded-full mr-2", stageDef.dotClass)} />
                      {stageDef.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </span>
      </div>
      <div className="flex gap-2">
        {item.imageUrl && (
          <img
            src={item.imageUrl}
            alt=""
            className="w-12 h-12 rounded object-cover shrink-0 border border-border"
            loading="lazy"
          />
        )}
        <p className="text-xs leading-snug line-clamp-2 flex-1">{item.title}</p>
      </div>
      <div className="flex items-center gap-2 mt-2 min-h-[18px]">
        {item.failed && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-destructive">
            <AlertTriangle className="w-3 h-3" /> publish failed
          </span>
        )}
        {!item.failed && item.scheduledAt && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-teal-700 dark:text-teal-400 bg-teal-500/10 rounded-full px-1.5 py-0.5">
            <CalendarClock className="w-3 h-3" />
            {format(new Date(item.scheduledAt), "EEE MMM d, HH:mm")}
          </span>
        )}
        {!item.failed && !item.scheduledAt && item.createdAt && (
          <span className="text-[10px] text-muted-foreground">
            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
          </span>
        )}
      </div>
    </div>
  );
}

function DraggableCard({
  item,
  onOpen,
  onMove,
}: {
  item: PipelineItem;
  onOpen: (item: PipelineItem) => void;
  onMove: (item: PipelineItem, stage: PipelineStage) => void;
}) {
  const draggable = item.stage !== "live";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.key,
    data: { item },
    disabled: !draggable,
  });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className="touch-manipulation">
      <PipelineCard item={item} dragging={isDragging} onOpen={onOpen} onMove={onMove} />
    </div>
  );
}

function StageColumn({
  stage,
  label,
  dotClass,
  items,
  activeItem,
  collapsed,
  onToggleCollapsed,
  onOpen,
  onMove,
}: {
  stage: PipelineStage;
  label: string;
  dotClass: string;
  items: PipelineItem[];
  activeItem: PipelineItem | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpen: (item: PipelineItem) => void;
  onMove: (item: PipelineItem, stage: PipelineStage) => void;
}) {
  const droppable = !!activeItem && allowedDropStages(activeItem).includes(stage);
  const { setNodeRef, isOver } = useDroppable({ id: stage, disabled: !droppable });

  return (
    <div
      ref={setNodeRef}
      data-testid={`pipeline-column-${stage}`}
      className={cn(
        "flex flex-col rounded-xl bg-muted/40 border border-transparent min-h-[200px]",
        collapsed ? "w-[120px] shrink-0" : "flex-1 min-w-[230px]",
        droppable && "border-primary/30",
        droppable && isOver && "border-primary bg-primary/5",
        activeItem && !droppable && activeItem.stage !== stage && "opacity-50",
      )}
    >
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex items-center gap-2 px-3 py-2.5 text-left"
        title={collapsed ? "Expand column" : "Collapse column"}
      >
        <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", dotClass)} />
        <span className="text-xs font-semibold truncate">{label}</span>
        <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
          {items.length}
        </Badge>
      </button>
      {!collapsed && (
        <div className="flex-1 space-y-2 px-2 pb-2 overflow-y-auto max-h-[calc(100vh-330px)]">
          {items.map((item) => (
            <DraggableCard key={item.key} item={item} onOpen={onOpen} onMove={onMove} />
          ))}
          {droppable && isOver && (
            <div className="rounded-lg border-2 border-dashed border-primary/60 bg-primary/5 p-3 text-center text-[11px] font-medium text-primary">
              {stage === "scheduled" ? "Drop to pick a date…" : `Drop to mark ${label.toLowerCase()}`}
            </div>
          )}
          {items.length === 0 && !isOver && (
            <p className="text-center text-[11px] text-muted-foreground/60 py-6">Nothing here</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ContentPipelinePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [view, setView] = useState<"board" | "list">(() => {
    try {
      const stored = localStorage.getItem(VIEW_STORAGE_KEY);
      if (stored === "list" || stored === "board") return stored;
    } catch {
      /* fall through to the device default */
    }
    // Touch-first devices default to the list: vertical scrolling beats a
    // five-column horizontal board on a phone. The toggle still persists
    // whichever view the user picks.
    const coarsePointer =
      typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    return coarsePointer ? "list" : "board";
  });
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [activeItem, setActiveItem] = useState<PipelineItem | null>(null);
  // The Published/Sent archive loads collapsed so the board stays focused on
  // in-flight work.
  const [collapsedStages, setCollapsedStages] = useState<Set<PipelineStage>>(
    () => new Set<PipelineStage>(["live"]),
  );
  const [schedulePending, setSchedulePending] = useState<PipelineItem | null>(null);
  const [scheduleValue, setScheduleValue] = useState("");

  const setViewPersisted = (v: "board" | "list") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  };

  // Mouse drags start after a small movement; touch drags require a
  // long-press so scrolling the board (or the page) never turns into an
  // accidental drag on iOS/Android. MouseSensor + TouchSensor (instead of
  // PointerSensor) keeps the two activation rules independent.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  // ─── Sources. Each degrades to empty when its feature is gated off. ───

  const postsWindow = useMemo(() => {
    const from = new Date();
    from.setDate(from.getDate() - 60);
    const to = new Date();
    to.setDate(to.getDate() + 120);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const { data: postRows = [], isLoading: postsLoading } = useQuery<CalendarPostRow[]>({
    queryKey: ["/api/generated-posts/calendar", "pipeline", postsWindow.from, postsWindow.to],
    queryFn: async () => {
      const params = new URLSearchParams({
        from: postsWindow.from,
        to: postsWindow.to,
        includeUnscheduled: "true",
      });
      const r = await fetch(`/api/generated-posts/calendar?${params}`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: emailRows = [] } = useQuery<SavedEmailRow[]>({
    queryKey: ["/api/email/saved"],
    queryFn: async () => {
      const r = await fetch("/api/email/saved", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: briefRows = [] } = useQuery<any[]>({
    queryKey: ["/api/content-briefs"],
    queryFn: async () => {
      // Flat, tenant+market-scoped brief list — every calendar's briefs in
      // one request, so the unified pipeline really is complete.
      const r = await fetch("/api/content-briefs", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: campaigns = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/campaigns"],
    queryFn: async () => {
      const r = await fetch("/api/campaigns", { credentials: "include" });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : data.campaigns ?? [];
    },
  });

  const allItems = useMemo<PipelineItem[]>(() => {
    const posts = postRows.map(postToPipelineItem);
    const emails = emailRows.map(emailToPipelineItem);
    const briefs = briefRows.map(briefToPipelineItem);
    return [...posts, ...emails, ...briefs].filter((i): i is PipelineItem => i !== null);
  }, [postRows, emailRows, briefRows]);

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((i) => {
      if (typeFilter !== "all" && i.type !== typeFilter) return false;
      if (campaignFilter !== "all" && i.campaignId !== campaignFilter) return false;
      if (q && !`${i.title} ${i.subtitle ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allItems, typeFilter, campaignFilter, search]);

  const byStage = useMemo(() => {
    const map: Record<PipelineStage, PipelineItem[]> = {
      draft: [],
      in_review: [],
      approved: [],
      scheduled: [],
      live: [],
    };
    for (const item of items) map[item.stage].push(item);
    // Scheduled column in date order; everything else newest-ish as returned.
    map.scheduled.sort((a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime());
    return map;
  }, [items]);

  const invalidateSources = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/generated-posts/calendar"] });
    queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
    queryClient.invalidateQueries({ queryKey: ["/api/editorial-calendars"] });
    queryClient.invalidateQueries({ queryKey: ["/api/content-briefs"] });
  };

  const moveMutation = useMutation({
    mutationFn: async ({ item, body }: { item: PipelineItem; body: Record<string, unknown> }) => {
      const r = await fetch(patchUrlFor(item), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update");
      }
      return r.json();
    },
    onSuccess: (_data, { item }) => {
      invalidateSources();
      toast({ title: "Moved", description: `${TYPE_LABELS[item.type]} updated.` });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't move item", description: error.message, variant: "destructive" });
    },
  });

  const handleDragStart = (event: DragStartEvent) => {
    setActiveItem((event.active.data.current?.item as PipelineItem) ?? null);
  };

  // Single move path shared by drag-and-drop and each card's "Move to" menu.
  const moveItem = (item: PipelineItem, target: PipelineStage) => {
    if (target === item.stage) return;
    const transition = transitionFor(item, target);
    if (!transition) {
      toast({
        title: "That move isn't allowed",
        description:
          item.type === "email" && target === "scheduled"
            ? "Emails are scheduled per recipient list — open the Email page to schedule a send."
            : "This item can't move to that stage from here.",
      });
      return;
    }
    if (transition.needsDate) {
      const base = item.scheduledAt ? new Date(item.scheduledAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);
      base.setMinutes(0, 0, 0);
      setScheduleValue(format(base, "yyyy-MM-dd'T'HH:mm"));
      setSchedulePending(item);
      return;
    }
    moveMutation.mutate({ item, body: transition.body });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const item = activeItem;
    setActiveItem(null);
    if (!item || !event.over) return;
    moveItem(item, event.over.id as PipelineStage);
  };

  const confirmSchedule = () => {
    if (!schedulePending || !scheduleValue) return;
    const date = new Date(scheduleValue);
    if (Number.isNaN(date.getTime())) return;
    moveMutation.mutate({
      item: schedulePending,
      body: { status: "approved", scheduledDate: date.toISOString() },
    });
    setSchedulePending(null);
  };

  const openItem = (item: PipelineItem) => setLocation(item.href);

  const toggleCollapsed = (stage: PipelineStage) => {
    setCollapsedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };

  return (
    <AppLayout>
      <div className="space-y-4" data-testid="page-pipeline">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ListChecks className="w-6 h-6 text-primary" />
              Content Pipeline
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Every in-flight piece — social posts, emails, and briefs — on one board. Drag between
              columns or use a card's ⋮ menu to change status; click a card to open its editor.
            </p>
          </div>
          <div className="flex items-center rounded-lg border border-border p-0.5">
            <Button
              variant={view === "board" ? "default" : "ghost"}
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => setViewPersisted("board")}
              data-testid="pipeline-view-board"
            >
              <ColumnsIcon className="w-3.5 h-3.5 mr-1.5" /> Board
            </Button>
            <Button
              variant={view === "list" ? "default" : "ghost"}
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => setViewPersisted("list")}
              data-testid="pipeline-view-list"
            >
              <RowsIcon className="w-3.5 h-3.5 mr-1.5" /> List
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[150px] h-8 text-xs" data-testid="pipeline-filter-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="post">Social posts</SelectItem>
              <SelectItem value="email">Emails</SelectItem>
              <SelectItem value="brief">Briefs</SelectItem>
            </SelectContent>
          </Select>
          {campaigns.length > 0 && (
            <Select value={campaignFilter} onValueChange={setCampaignFilter}>
              <SelectTrigger className="w-[200px] h-8 text-xs" data-testid="pipeline-filter-campaign">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All campaigns</SelectItem>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search content…"
              className="h-8 w-[220px] pl-8 text-xs"
              data-testid="pipeline-search"
            />
          </div>
          <span className="ml-auto text-xs text-muted-foreground">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        </div>

        {view === "board" ? (
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="flex gap-3 items-stretch overflow-x-auto pb-2">
              {PIPELINE_STAGES.map((stage) => (
                <StageColumn
                  key={stage.id}
                  stage={stage.id}
                  label={stage.label}
                  dotClass={stage.dotClass}
                  items={byStage[stage.id]}
                  activeItem={activeItem}
                  collapsed={collapsedStages.has(stage.id)}
                  onToggleCollapsed={() => toggleCollapsed(stage.id)}
                  onOpen={openItem}
                  onMove={moveItem}
                />
              ))}
            </div>
            <DragOverlay>
              {activeItem && <div className="w-[230px]"><PipelineCard item={activeItem} overlay /></div>}
            </DragOverlay>
          </DndContext>
        ) : (
          <Card>
            <div className="divide-y divide-border">
              {items.length === 0 && (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  {postsLoading ? "Loading…" : "No content matches these filters."}
                </p>
              )}
              {items.map((item) => {
                const Icon = TYPE_ICONS[item.type];
                const stage = PIPELINE_STAGES.find((s) => s.id === item.stage)!;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => openItem(item)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 transition-colors"
                    data-testid={`pipeline-row-${item.key}`}
                  >
                    <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{item.title}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {item.subtitle || TYPE_LABELS[item.type]}
                        {item.scheduledAt && ` · ${format(new Date(item.scheduledAt), "EEE MMM d, HH:mm")}`}
                      </p>
                    </div>
                    {item.failed ? (
                      <Badge variant="destructive" className="text-[10px] shrink-0">failed</Badge>
                    ) : (
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0">
                        <span className={cn("w-2 h-2 rounded-full", stage.dotClass)} />
                        {stage.label}
                      </span>
                    )}
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        <p className="text-[11px] text-muted-foreground">
          Published and sent items can't be moved. Emails are approved here but scheduled per
          recipient list on the Email page. Failed publishes stay in Scheduled with an alert —
          drag one back to Approved to retry it via a new schedule. On touch screens,
          long-press a card to start dragging.
        </p>
      </div>

      {/* Drop-on-Scheduled date picker */}
      <Dialog open={!!schedulePending} onOpenChange={(open) => !open && setSchedulePending(null)}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Schedule post</DialogTitle>
            <DialogDescription className="line-clamp-2">{schedulePending?.title}</DialogDescription>
          </DialogHeader>
          <Input
            type="datetime-local"
            value={scheduleValue}
            onChange={(e) => setScheduleValue(e.target.value)}
            data-testid="pipeline-schedule-input"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSchedulePending(null)}>
              Cancel
            </Button>
            <Button onClick={confirmSchedule} disabled={!scheduleValue} data-testid="pipeline-schedule-confirm">
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
