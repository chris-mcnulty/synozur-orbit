/**
 * Social batch rollup — shared pure core (client + server).
 *
 * Dense social pushes (a webinar's 8-10 posts, a conference's several hundred)
 * overwhelm the campaign/calendar views when every post is its own row. This
 * groups posts that belong to the same batch — its generation run, repurpose
 * group, or event, in that priority order — so the UI can show one summary per
 * batch (count + per-platform breakdown) and drill in on demand.
 */

export interface BatchablePost {
  id: string;
  platform: string;
  status: string;
  variantGroup?: string | null;
  generationJobId?: string | null;
  conferenceId?: string | null;
}

export interface PostBatch<T extends BatchablePost> {
  /** The batch source id (generation run / repurpose group / event). */
  key: string;
  posts: T[];
  count: number;
  /** Per-platform counts, e.g. { linkedin: 24, twitter: 30 }. */
  platforms: Record<string, number>;
  /** Per-status counts, e.g. { draft: 40, approved: 14 }. */
  statusCounts: Record<string, number>;
}

/**
 * A post's batch identity: its generation run, then repurpose group, then
 * event. Posts with none are standalone and never collapse.
 */
export function batchSourceOf(p: BatchablePost): string | null {
  return p.generationJobId || p.variantGroup || p.conferenceId || null;
}

export interface RollupResult<T extends BatchablePost> {
  /** Collapsed batches (groups larger than the threshold), largest first. */
  batches: PostBatch<T>[];
  /** Posts left individual (standalone, or in groups at/under the threshold). */
  loose: T[];
}

/**
 * Group posts into batches. A group collapses only when it has MORE than
 * `threshold` members; smaller groups and standalone posts pass through.
 */
export function rollupPosts<T extends BatchablePost>(
  posts: T[],
  opts: { threshold?: number } = {},
): RollupResult<T> {
  const threshold = opts.threshold ?? 3;

  const groups = new Map<string, T[]>();
  const loose: T[] = [];
  for (const p of posts) {
    const src = batchSourceOf(p);
    if (!src) {
      loose.push(p);
      continue;
    }
    const arr = groups.get(src);
    if (arr) arr.push(p);
    else groups.set(src, [p]);
  }

  const batches: PostBatch<T>[] = [];
  for (const [key, members] of groups) {
    if (members.length <= threshold) {
      loose.push(...members);
      continue;
    }
    const platforms: Record<string, number> = {};
    const statusCounts: Record<string, number> = {};
    for (const m of members) {
      const pl = (m.platform || "unknown").toLowerCase();
      platforms[pl] = (platforms[pl] || 0) + 1;
      statusCounts[m.status] = (statusCounts[m.status] || 0) + 1;
    }
    batches.push({ key, posts: members, count: members.length, platforms, statusCounts });
  }

  batches.sort((a, b) => b.count - a.count);
  return { batches, loose };
}
