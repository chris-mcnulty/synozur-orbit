// Pure decision logic for Master Marketing Calendar deep-link landings.
//
// A `?post=`/`?brief=`/`?emailId=` deep link has to land on the right item
// across three tricky shapes: a dated item shown directly on the grid, a dated
// item collapsed inside a dense social batch (drill-in), and an *undated* item
// that lives only in the backlog rail. The landing logic used to live entirely
// inside one component `useEffect` with several settle/relax passes and had no
// automated coverage — a refactor could silently break approver links.
//
// These functions are the pure core of that decision so they can be unit
// tested without a browser. The component effect stays a thin adapter that maps
// the returned action to React state setters and DOM side effects.

export type DeepLinkItemType = "social" | "email" | "content";

export interface DeepLinkTarget {
  type: DeepLinkItemType;
  id: string;
}

// Structural subset of the calendar's CalendarItem — only the fields the
// landing decision reads. CalendarItem is a superset, so it slots in directly.
export interface DeepLinkItem {
  type: DeepLinkItemType;
  id: string;
  isBatch?: boolean;
  date?: string | null;
  platform?: string | null;
  format?: string | null;
  campaignId?: string | null;
  solutionAreaId?: string | null;
  conferenceId?: string | null;
}

export interface DeepLinkFilters {
  campaignId: string;
  solutionAreaId: string;
  conferenceId: string;
}

// Only the view/filter state that can hide the target from view. `anchorYmd` is
// `ymd(anchor)` (always the first of the shown month).
export interface DeepLinkViewState {
  view: "calendar" | "backlog";
  grouping: "month" | "quarter";
  groupBy: "none" | "campaign" | "theme" | "event";
  typeFilter: string;
  filters: DeepLinkFilters;
  anchorYmd: string;
}

// View/filter changes needed before the target can be shown. Applied by the
// caller, which then lets the effect re-run so the item is visible.
export interface DeepLinkSettleChanges {
  view?: "calendar";
  grouping?: "month";
  groupBy?: "none";
  typeFilter?: "all";
  filters?: Partial<Record<keyof DeepLinkFilters, "all">>;
  anchorYmd?: string;
}

export type DeepLinkAction =
  | { kind: "wait" }
  | { kind: "already-honored" }
  | { kind: "none" }
  | { kind: "settle"; changes: DeepLinkSettleChanges }
  | { kind: "focus-backlog"; backlogKey: string; honorKey: string }
  | { kind: "resolve-batch"; honorKey: string }
  | { kind: "focus-day"; dayKey: string; honorKey: string };

export interface LocateResult {
  found: boolean;
  date: string | null;
  batch: { key: string; day: string } | null;
}

export type BatchLocateAction =
  | { kind: "no-drill" }
  | { kind: "drill"; anchorYmd: string; batch: { key: string; day: string } };

// ── Local date helpers (kept in sync with the component's copies) ──
// Local "yyyy-mm-dd" for an ISO timestamp, or null when absent/invalid. Mirrors
// the component's localKey so a target on the grid resolves to the same cell.
export function isoToDayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

// First-of-month key ("yyyy-mm-01") for a "yyyy-mm-dd" day key. Matches
// ymd(startOfMonth(parseLocalDay(day))) without constructing a Date.
export function monthAnchorYmd(dayKey: string): string {
  return `${dayKey.slice(0, 7)}-01`;
}

// Does the item survive the active type/channel/format filter? Single source of
// truth shared with the component (imported there to avoid divergence).
export function matchesTypeFilter(
  item: Pick<DeepLinkItem, "type" | "platform" | "format">,
  tf: string,
): boolean {
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

function hasSettleChange(c: DeepLinkSettleChanges): boolean {
  return (
    c.view !== undefined ||
    c.grouping !== undefined ||
    c.groupBy !== undefined ||
    c.typeFilter !== undefined ||
    c.anchorYmd !== undefined ||
    (c.filters !== undefined && Object.keys(c.filters).length > 0)
  );
}

export interface DecideDeepLinkInput extends DeepLinkViewState {
  target: DeepLinkTarget | null;
  // grid + backlog still loading — can't decide where the item lives yet.
  loading: boolean;
  honoredDeepLink: string | null;
  batchResolveAttempted: string | null;
  // Dated, non-batch scheduled items currently loaded for the shown window.
  scheduled: DeepLinkItem[];
  // Undated drafts fetched individually (loose or collapsed) for the backlog.
  backlogItems: DeepLinkItem[];
}

// The synchronous landing decision. Returns exactly one action describing what
// the component effect should do next; it never mutates its inputs.
export function decideDeepLinkLanding(input: DecideDeepLinkInput): DeepLinkAction {
  const { target } = input;
  if (!target || input.loading) return { kind: "wait" };

  const honorKey = `${target.type}:${target.id}`;
  if (input.honoredDeepLink === honorKey) return { kind: "already-honored" };

  const match =
    input.scheduled.find(
      (i) => i.type === target.type && i.id === target.id && !i.isBatch,
    ) ?? null;

  // Not on a scheduled day — the target may be an undated draft that lives only
  // in the backlog rail. Relax whatever view/filter would hide it, then focus.
  if (!match) {
    const backlogMatch =
      input.backlogItems.find(
        (i) => i.type === target.type && i.id === target.id,
      ) ?? null;
    if (backlogMatch) {
      const changes: DeepLinkSettleChanges = {};
      if (input.view !== "calendar") changes.view = "calendar";
      if (input.grouping !== "month") changes.grouping = "month";
      if (input.groupBy !== "none") changes.groupBy = "none";
      if (!matchesTypeFilter(backlogMatch, input.typeFilter))
        changes.typeFilter = "all";
      const filterChanges: Partial<Record<keyof DeepLinkFilters, "all">> = {};
      if (
        input.filters.campaignId !== "all" &&
        (backlogMatch.campaignId ?? "") !== input.filters.campaignId
      )
        filterChanges.campaignId = "all";
      if (
        input.filters.solutionAreaId !== "all" &&
        (backlogMatch.solutionAreaId ?? "") !== input.filters.solutionAreaId
      )
        filterChanges.solutionAreaId = "all";
      if (
        input.filters.conferenceId !== "all" &&
        (backlogMatch.conferenceId ?? "") !== input.filters.conferenceId
      )
        filterChanges.conferenceId = "all";
      if (Object.keys(filterChanges).length > 0) changes.filters = filterChanges;
      if (hasSettleChange(changes)) return { kind: "settle", changes };
      return {
        kind: "focus-backlog",
        backlogKey: `${backlogMatch.type}-${backlogMatch.id}`,
        honorKey,
      };
    }
  }

  // A `?post=` target can be collapsed inside a dense social batch on a dated
  // day — the rollup only ships batch summaries, so it isn't in `scheduled` by
  // id. Ask the server where it lives (once per target).
  if (
    !match &&
    target.type === "social" &&
    input.batchResolveAttempted !== honorKey
  ) {
    return { kind: "resolve-batch", honorKey };
  }

  // Not in the loaded window and not an undated draft — leave the calendar be.
  if (!match) return { kind: "none" };

  const dayKey = isoToDayKey(match.date ?? null);
  if (!dayKey) return { kind: "none" };

  // Make sure the target's month grid is actually rendered (calendar view,
  // month grouping, no hiding type filter, right month) before we focus its day.
  const changes: DeepLinkSettleChanges = {};
  if (input.view !== "calendar") changes.view = "calendar";
  if (input.grouping !== "month") changes.grouping = "month";
  if (!matchesTypeFilter(match, input.typeFilter)) changes.typeFilter = "all";
  const anchor = monthAnchorYmd(dayKey);
  if (anchor !== input.anchorYmd) changes.anchorYmd = anchor;
  if (hasSettleChange(changes)) return { kind: "settle", changes };

  return { kind: "focus-day", dayKey, honorKey };
}

// The item is beyond the grid's 4-pill cap (in "+N more"), so the day panel has
// to open to reveal it. `dayItems` is the target day's list, in render order.
export function shouldOpenDayPanel(
  dayItems: DeepLinkItem[],
  target: DeepLinkTarget,
): boolean {
  const idx = dayItems.findIndex(
    (i) => i.type === target.type && i.id === target.id,
  );
  return idx >= 4;
}

// After a batch locate resolves: drill into a *dated* batch, but never an
// undated ("unscheduled") one — its members live in the backlog rail, and
// drilling the windowed grid for them would render nothing.
export function decideBatchLocateLanding(loc: LocateResult): BatchLocateAction {
  if (!loc.found || !loc.batch) return { kind: "no-drill" };
  if (loc.batch.day === "unscheduled") return { kind: "no-drill" };
  return {
    kind: "drill",
    anchorYmd: monthAnchorYmd(loc.batch.day),
    batch: loc.batch,
  };
}
