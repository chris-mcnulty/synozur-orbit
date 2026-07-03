/**
 * Campaign "next actions" — pure, grouping-agnostic core (client + server).
 *
 * Turns a campaign's content (social posts, content briefs, emails) into a
 * rollup of "what needs to happen next", grouped by a chosen dimension. Today
 * the marketing UI groups by social *batch* (generation run / repurpose group /
 * conference); the same core groups by *account* for a future ABM view — the
 * caller just sets `groupBy` and supplies the account key/label on each item.
 *
 * No I/O: callers map their rows into `ActionableItem`s (and resolve human
 * labels, e.g. a conference name) before calling in. That keeps the lifecycle →
 * action mapping in one tested place for both the campaign page and the hub.
 */

export type ContentItemType = "social" | "brief" | "email";

/** The single next step an item (or group) is waiting on. */
export type NextAction = "generate" | "draft" | "approve" | "schedule" | "post" | "fix" | "done";

/**
 * Headline priority: a failure outranks everything; otherwise the earliest
 * incomplete pipeline stage is what the user should do next.
 */
export const ACTION_PRIORITY: NextAction[] = [
  "fix",
  "generate",
  "draft",
  "approve",
  "schedule",
  "post",
  "done",
];

export const ACTION_LABELS: Record<NextAction, string> = {
  generate: "Generate content",
  draft: "Finish drafting",
  approve: "Review & approve",
  schedule: "Schedule",
  post: "Post / send",
  fix: "Fix failures",
  done: "Complete",
};

export interface ActionableItem {
  id: string;
  itemType: ContentItemType;
  action: NextAction;
  status: string;
  /** Social batch identity (generation run / repurpose group / conference). */
  batchKey?: string | null;
  batchLabel?: string | null;
  /** Account / company identity — the ABM grouping seam. */
  accountKey?: string | null;
  accountLabel?: string | null;
}

export type GroupBy = "batch" | "account";

export interface ActionGroup {
  key: string;
  label: string;
  itemType: ContentItemType | "mixed";
  total: number;
  /** Top non-complete action across the group (or "done" if all complete). */
  headlineAction: NextAction;
  actionCounts: Partial<Record<NextAction, number>>;
  statusCounts: Record<string, number>;
  /** How many items still need any action (total − done). */
  pending: number;
  /**
   * The single item's id when the group holds exactly one item — lets a nudge
   * deep-link straight to that brief / email / post instead of just its tab.
   * Undefined for multi-item (batched) groups.
   */
  itemId?: string;
}

const TYPE_LABELS: Record<ContentItemType, string> = {
  social: "Social posts",
  brief: "Content briefs",
  email: "Emails",
};

// ── Per-item lifecycle → action mappers (pure) ──────────────────────────────

export interface SocialPostLike {
  status: string;
  scheduledDate?: string | null;
  publishedAt?: string | null;
  publishError?: string | null;
  /** null = Orbit auto-posting, "csv" = manual CSV export */
  deliveryMode?: string | null;
}

/** Map a generated social post to the next action it is waiting on. */
export function socialPostAction(p: SocialPostLike): NextAction {
  // Already published / externally scheduled / CSV-confirmed — nothing left to do.
  if (p.publishedAt || p.status === "published" || p.status === "exported" || p.status === "scheduled_external") return "done";
  if (p.status === "rejected" || p.status === "deleted" || p.status === "archived") return "done";
  if (p.status === "publish_failed" || p.publishError) return "fix";
  if (p.status === "approved") {
    if (!p.scheduledDate) return "schedule";
    // CSV-only posts still need the user to run an export even after scheduling.
    if (p.deliveryMode === "csv") return "post";
    // Orbit-scheduled posts are queued for auto-posting — user has nothing left to do.
    return "done";
  }
  return "approve"; // draft / anything earlier
}

/** Map a content brief's status to its next action. */
export function briefAction(status: string): NextAction {
  switch (status) {
    case "suggested":
    case "accepted":
      return "generate";
    case "in_progress":
      return "draft";
    case "drafted":
      return "approve";
    case "approved":
      return "schedule";
    case "scheduled":
      return "post";
    case "published":
    case "removed":
      return "done";
    default:
      return "draft";
  }
}

/** Map a generated email's status to its next action. */
export function emailAction(status: string): NextAction {
  if (status === "sent") return "done";
  if (status === "approved") return "post";
  return "approve"; // draft
}

// ── Grouping ────────────────────────────────────────────────────────────────

function pickGroup(item: ActionableItem, groupBy: GroupBy): { key: string; label: string } {
  if (groupBy === "account") {
    return {
      key: item.accountKey || "__no_account__",
      label: item.accountLabel || "Unassigned account",
    };
  }
  // Batch grouping: real batch when present, else bucket loose items by type so
  // standalone posts / briefs / emails still get a row.
  if (item.batchKey) {
    return { key: item.batchKey, label: item.batchLabel || "Batch" };
  }
  return { key: `type:${item.itemType}`, label: TYPE_LABELS[item.itemType] };
}

/** The top non-complete action present, by priority (or "done" if none). */
export function headlineAction(actionCounts: Partial<Record<NextAction, number>>): NextAction {
  for (const a of ACTION_PRIORITY) {
    if (a === "done") continue;
    if ((actionCounts[a] ?? 0) > 0) return a;
  }
  return "done";
}

/**
 * Group actionable items and compute each group's headline action. Groups that
 * still need work sort first (by action priority), then by size.
 */
export function groupNextActions(items: ActionableItem[], groupBy: GroupBy = "batch"): ActionGroup[] {
  const map = new Map<string, ActionGroup>();
  for (const item of items) {
    const { key, label } = pickGroup(item, groupBy);
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        label,
        itemType: item.itemType,
        total: 0,
        headlineAction: "done",
        actionCounts: {},
        statusCounts: {},
        pending: 0,
      };
      map.set(key, g);
    } else if (g.itemType !== item.itemType) {
      g.itemType = "mixed";
    }
    g.total += 1;
    // Track the lone item's id so a single-item group can deep-link to it;
    // clear it the moment a second item joins the group.
    g.itemId = g.total === 1 ? item.id : undefined;
    g.actionCounts[item.action] = (g.actionCounts[item.action] ?? 0) + 1;
    g.statusCounts[item.status] = (g.statusCounts[item.status] ?? 0) + 1;
    if (item.action !== "done") g.pending += 1;
  }

  const groups = Array.from(map.values());
  for (const g of groups) g.headlineAction = headlineAction(g.actionCounts);
  groups.sort((a, b) => {
    const pa = ACTION_PRIORITY.indexOf(a.headlineAction);
    const pb = ACTION_PRIORITY.indexOf(b.headlineAction);
    if (pa !== pb) return pa - pb;
    return b.total - a.total;
  });
  return groups;
}

/** Convenience: only the groups that still need action. */
export function pendingGroups(items: ActionableItem[], groupBy: GroupBy = "batch"): ActionGroup[] {
  return groupNextActions(items, groupBy).filter((g) => g.pending > 0);
}

/**
 * Deep-link straight to the one item a single-item group represents, so an
 * approver lands on the exact brief / email / post instead of a tab full of
 * cards to hunt through. Returns undefined for multi-item (batched) rollups —
 * those keep opening the tab.
 *  - brief  → editorial calendar, editor auto-opened (`?brief=`)
 *  - email  → email newsletters, viewer auto-opened (`?emailId=`)
 *  - social → the campaign's Social Posts tab, scrolled to + highlighted (`?post=`)
 */
export function singleItemHref(campaignId: string, group: ActionGroup): string | undefined {
  if (group.total !== 1 || !group.itemId) return undefined;
  const itemId = encodeURIComponent(group.itemId);
  switch (group.itemType) {
    case "brief":
      return `/app/marketing/editorial-calendar?campaignId=${encodeURIComponent(campaignId)}&brief=${itemId}`;
    case "email":
      return `/app/marketing/email-newsletters?emailId=${itemId}`;
    case "social":
      return `/app/marketing/campaigns/${encodeURIComponent(campaignId)}?post=${itemId}#posts`;
    default:
      return undefined;
  }
}

// ── Multi-item (batched) group tab routing ──────────────────────────────────
// Single-item groups deep-link to the exact item (singleItemHref); multi-item
// groups instead open the right campaign *tab*, optionally pre-filtered. These
// live here (not in the component) so the tab/filter/href mapping is testable.

/** Which campaign tab a group's headline action should open. */
export function actionTab(group: ActionGroup): string {
  if (group.itemType === "email" || group.itemType === "brief") return "plan";
  // social or mixed:
  switch (group.headlineAction) {
    case "approve":
      return "review";
    case "generate":
    case "draft":
      return "plan";
    default:
      return "posts"; // schedule / post / fix
  }
}

/** The posts-tab filter a headline action should pre-apply, if any. */
export function actionFilter(group: ActionGroup): string | undefined {
  return group.headlineAction === "fix" ? "publish_failed" : undefined;
}

/** Campaign deep-link for a group: right tab, and (for failures) pre-filtered. */
export function groupHref(campaignId: string, group: ActionGroup): string {
  const filter = actionFilter(group);
  const search = filter ? `?filter=${encodeURIComponent(filter)}` : "";
  return `/app/marketing/campaigns/${encodeURIComponent(campaignId)}${search}#${actionTab(group)}`;
}
