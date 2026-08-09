/**
 * Pure scope-derivation logic for the bulk Orbit / CSV delivery-mode buttons
 * on the campaign detail page.
 *
 * Extracted from campaign-detail.tsx so it can be unit-tested independently of
 * the React component tree.
 */

import { batchSourceOf } from "@shared/social-rollup";

/** Minimal post shape required by the scope predicates. */
export interface ScopablePost {
  id: string;
  platform: string;
  status: string;
  publishedAt?: string | null;
  scheduledDate?: string | null;
  socialAccountId?: string | null;
  overrideImageUrl?: string | null;
  overrideBrandAssetId?: string | null;
  generationJobId?: string | null;
  variantGroup?: string | null;
  conferenceId?: string | null;
}

export interface ScopeFilters {
  /** "all" | "active" | "missing_image" | a status string */
  postFilter: string;
  /** "all" | a socialAccountId string */
  postAccountFilter: string;
  /** "all" | a platform string */
  postPlatformFilter: string;
  /** "all" | "pending" | "completed" */
  postTimeFilter: string;
  /** ISO date string lower bound for scheduledDate (inclusive), or "" */
  postDateFrom: string;
  /** ISO date string upper bound for scheduledDate (inclusive), or "" */
  postDateTo: string;
  /** When drilling into one batch, only posts from that batch key pass. */
  batchFilter: string | null;
  /**
   * The set of batch keys that are currently collapsed (posts belonging to
   * these batches are hidden from the main list unless batchFilter matches).
   */
  batchKeySet: Set<string>;
}

/**
 * Returns true when the post passes the platform / time-lifecycle / date-range
 * scope predicates.  These mirror the `postPassesScopeFilters` closure in
 * campaign-detail.tsx exactly.
 */
export function postPassesScopeFilters(
  p: Pick<ScopablePost, "platform" | "status" | "publishedAt" | "scheduledDate">,
  filters: Pick<ScopeFilters, "postPlatformFilter" | "postTimeFilter" | "postDateFrom" | "postDateTo">,
): boolean {
  if (filters.postPlatformFilter !== "all" && p.platform !== filters.postPlatformFilter) return false;

  const completed =
    !!p.publishedAt ||
    ["published", "posted", "delivered", "exported", "scheduled_external"].includes(p.status);
  if (filters.postTimeFilter === "pending" && completed) return false;
  if (filters.postTimeFilter === "completed" && !completed) return false;

  if (filters.postDateFrom || filters.postDateTo) {
    if (!p.scheduledDate) return false;
    const day = p.scheduledDate.slice(0, 10);
    if (filters.postDateFrom && day < filters.postDateFrom) return false;
    if (filters.postDateTo && day > filters.postDateTo) return false;
  }
  return true;
}

/**
 * Derive the set of post IDs that a bulk delivery-mode change should target.
 *
 * Rules (in priority order):
 * 1. If the user has explicitly selected individual posts, use exactly those.
 * 2. Otherwise, use every post that passes all active filters — the same set
 *    that "Select all visible" would capture — so the bulk action never
 *    silently touches posts outside the current view.
 */
export function deriveBulkDeliveryScope(
  posts: ScopablePost[],
  selectedIds: Set<string>,
  filters: ScopeFilters,
): string[] {
  if (selectedIds.size > 0) {
    return Array.from(selectedIds);
  }

  return posts
    .filter((p) => {
      const src = batchSourceOf(p);
      const isBatched = src != null && filters.batchKeySet.has(src);

      // Batch-drill filter
      if (filters.batchFilter) {
        if (src !== filters.batchFilter) return false;
      } else if (isBatched) {
        // Collapsed batch posts are hidden from the main list
        return false;
      }

      // Account filter
      if (filters.postAccountFilter !== "all" && p.socialAccountId !== filters.postAccountFilter)
        return false;

      // Platform / time / date-range filters
      if (!postPassesScopeFilters(p, filters)) return false;

      // Status / content filter
      if (filters.postFilter === "all") return p.status !== "deleted";
      if (filters.postFilter === "active")
        return (
          p.status !== "deleted" && p.status !== "rejected" && p.status !== "archived"
        );
      if (filters.postFilter === "missing_image")
        return p.status !== "deleted" && !p.overrideImageUrl && !p.overrideBrandAssetId;
      return p.status === filters.postFilter;
    })
    .map((p) => p.id);
}
