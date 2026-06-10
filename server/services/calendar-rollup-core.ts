/**
 * Calendar rollup — pure core.
 *
 * Dense social campaigns (a webinar's 8-10 posts, a conference's several
 * hundred) overwhelm the calendar/campaign views when every individual post is
 * its own row. This collapses social posts that belong to the same generation
 * batch on the same day into a single "social_batch" item carrying a count and
 * a per-platform breakdown, so the master view shows "first few + N more"
 * instead of "Twitter, Twitter, Twitter…". Drill-down (by batch, filtered by
 * platform) is handled by the caller via the batchKey. No I/O, so testable.
 */

export interface RollupSocialItem {
  id: string;
  platform: string;
  /** ISO date string or null (unscheduled). */
  date: string | null;
  lifecycle: string;
  campaignId?: string | null;
  solutionAreaId?: string | null;
  conferenceId?: string | null;
  // Batch-identity sources, in priority order.
  generationJobId?: string | null;
  variantGroup?: string | null;
  [key: string]: unknown;
}

export interface SocialBatchItem {
  type: "social_batch";
  /** Stable id for the collapsed group (batch source + day). */
  id: string;
  batchKey: string;
  date: string | null;
  count: number;
  /** Per-platform counts, e.g. { linkedin: 12, twitter: 30 }. */
  platforms: Record<string, number>;
  /** Lifecycle counts across the batch, e.g. { draft: 40, approved: 14 }. */
  lifecycleCounts: Record<string, number>;
  title: string;
  campaignId: string | null;
  solutionAreaId: string | null;
  conferenceId: string | null;
}

/**
 * The batch a post belongs to: the generation run, repurpose group, event, or
 * campaign — in that priority order. Posts with none are standalone and never
 * collapse.
 */
export function resolveBatchSource(item: RollupSocialItem): string | null {
  return (
    item.generationJobId ||
    item.variantGroup ||
    item.conferenceId ||
    item.campaignId ||
    null
  );
}

function dayKey(date: string | null): string {
  return date ? date.slice(0, 10) : "unscheduled";
}

export interface RollupResult {
  /** Collapsed batch items (groups whose size exceeds the threshold). */
  batches: SocialBatchItem[];
  /** Social items left as-is (standalone, or groups at/under the threshold). */
  loose: RollupSocialItem[];
}

/**
 * Collapse social items into per-(batch,day) groups. A group is collapsed only
 * when it has MORE than `threshold` members; smaller groups and standalone
 * posts pass through untouched.
 */
export function rollupSocialItems(
  items: RollupSocialItem[],
  opts: { threshold?: number } = {},
): RollupResult {
  const threshold = opts.threshold ?? 3;

  // Group by batch-source + day. Standalone posts (no source) bypass grouping.
  const groups = new Map<string, RollupSocialItem[]>();
  const loose: RollupSocialItem[] = [];

  for (const item of items) {
    const source = resolveBatchSource(item);
    if (!source) {
      loose.push(item);
      continue;
    }
    const key = `${source}|${dayKey(item.date)}`;
    const arr = groups.get(key);
    if (arr) arr.push(item);
    else groups.set(key, [item]);
  }

  const batches: SocialBatchItem[] = [];
  for (const [key, members] of groups) {
    if (members.length <= threshold) {
      loose.push(...members);
      continue;
    }
    const platforms: Record<string, number> = {};
    const lifecycleCounts: Record<string, number> = {};
    for (const m of members) {
      const p = (m.platform || "unknown").toLowerCase();
      platforms[p] = (platforms[p] || 0) + 1;
      lifecycleCounts[m.lifecycle] = (lifecycleCounts[m.lifecycle] || 0) + 1;
    }
    const first = members[0];
    batches.push({
      type: "social_batch",
      id: `batch:${key}`,
      batchKey: key.split("|")[0],
      date: first.date,
      count: members.length,
      platforms,
      lifecycleCounts,
      title: `${members.length} social posts`,
      campaignId: first.campaignId ?? null,
      solutionAreaId: first.solutionAreaId ?? null,
      conferenceId: first.conferenceId ?? null,
    });
  }

  return { batches, loose };
}
