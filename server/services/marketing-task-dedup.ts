/**
 * Deduplication for AI-generated marketing task suggestions.
 *
 * Both generation paths (the on-demand generate-tasks endpoint and the full
 * regeneration lane) filter AI output through `filterDuplicateTasks` before
 * inserting, comparing candidates against ALL existing tasks for the plan —
 * including accepted and dismissed ones — so re-running generation never
 * re-creates a task the user already has or already declined.
 */

import type { MarketingTask } from "@shared/schema";

/** Lowercase, strip punctuation, collapse whitespace, drop filler words. */
export function normalizeTitle(title: string): string {
  const STOP_WORDS = new Set([
    "a", "an", "and", "the", "to", "for", "of", "on", "in", "with", "our",
    "your", "via", "by", "at", "from",
  ]);
  return (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(" ");
}

function tokenSet(normalized: string): Set<string> {
  return new Set(normalized.split(" ").filter(Boolean));
}

/** Jaccard similarity between two normalized titles' token sets. */
export function titleSimilarity(a: string, b: string): number {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 || sb.size === 0) return a === b ? 1 : 0;
  let intersection = 0;
  for (const t of sa) if (sb.has(t)) intersection++;
  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export const DUPLICATE_SIMILARITY_THRESHOLD = 0.75;

export interface CandidateTask {
  title: string;
  activityGroup?: string | null;
  timeframe?: string | null;
  [key: string]: unknown;
}

export interface DedupResult<T extends CandidateTask> {
  unique: T[];
  duplicates: Array<{ candidate: T; matchedTitle: string; similarity: number }>;
}

/**
 * Filter candidate AI tasks against existing plan tasks (any status,
 * including dismissed) plus tasks already accepted in this batch.
 * A candidate is a duplicate when its normalized title exactly matches, or
 * its token-set similarity exceeds the threshold, against an existing task
 * in the same activity group (or any group when the group matches loosely).
 */
export function filterDuplicateTasks<T extends CandidateTask>(
  candidates: T[],
  existing: Pick<MarketingTask, "title" | "activityGroup">[],
): DedupResult<T> {
  const existingNorm = existing.map((t) => ({
    norm: normalizeTitle(t.title),
    activityGroup: t.activityGroup,
    title: t.title,
  }));
  const unique: T[] = [];
  const duplicates: DedupResult<T>["duplicates"] = [];
  // Also dedup within the candidate batch itself.
  const batchNorm: Array<{ norm: string; activityGroup?: string | null; title: string }> = [];

  for (const candidate of candidates) {
    const norm = normalizeTitle(candidate.title);
    let matched: { title: string; similarity: number } | null = null;
    for (const ex of [...existingNorm, ...batchNorm]) {
      if (!ex.norm) continue;
      if (ex.norm === norm) {
        matched = { title: ex.title, similarity: 1 };
        break;
      }
      const sim = titleSimilarity(norm, ex.norm);
      if (sim >= DUPLICATE_SIMILARITY_THRESHOLD) {
        matched = { title: ex.title, similarity: sim };
        break;
      }
    }
    if (matched) {
      duplicates.push({ candidate, matchedTitle: matched.title, similarity: matched.similarity });
    } else {
      unique.push(candidate);
      batchNorm.push({ norm, activityGroup: candidate.activityGroup, title: candidate.title });
    }
  }
  return { unique, duplicates };
}
