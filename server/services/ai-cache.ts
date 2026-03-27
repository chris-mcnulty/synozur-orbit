/**
 * AI Response Cache (P1 — Performance Enhancement)
 *
 * In-memory TTL cache for AI-generated artefacts.  Prevents duplicate provider
 * calls when the same content is requested multiple times within a short window
 * (e.g. rapid double-clicks, parallel requests) and provides a hook for
 * tenant-level cache invalidation when source data changes.
 *
 * Cache key format:  "<tenantDomain>:<feature>:<promptHash>"
 * TTL defaults:      analysis/battlecards → 30 min
 *                    briefings            → 10 min
 *                    other features       → 60 min
 */

import { createHash } from "crypto";

// ─── types ────────────────────────────────────────────────────────────────────

export interface CachedResult<T = unknown> {
  value: T;
  expiresAt: number;
  feature: string;
  tenantDomain: string;
  createdAt: number;
}

// ─── defaults ─────────────────────────────────────────────────────────────────

/** Default TTL in milliseconds per AI feature bucket. */
const DEFAULT_TTL_MS: Record<string, number> = {
  competitor_analysis:   30 * 60 * 1000,  // 30 minutes
  battlecard_generation: 30 * 60 * 1000,
  recommendations:       30 * 60 * 1000,
  intelligence_briefing: 10 * 60 * 1000,  // 10 minutes (briefings change more often)
  executive_summary:     30 * 60 * 1000,
  gap_analysis:          30 * 60 * 1000,
  default:               60 * 60 * 1000,  // 1 hour fallback
};

// ─── state ────────────────────────────────────────────────────────────────────

const cache = new Map<string, CachedResult>();
let hitsTotal = 0;
let missesTotal = 0;

// Prune expired entries every 5 minutes to keep memory bounded.
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  let pruned = 0;
  for (const [key, entry] of Array.from(cache.entries())) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
      pruned++;
    }
  }
  if (pruned > 0) {
    console.log(`[AICache] Pruned ${pruned} expired entries (size: ${cache.size})`);
  }
}, PRUNE_INTERVAL_MS).unref(); // unref so it doesn't prevent process exit

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a stable cache key from the tenant, feature, and any number of input
 * strings (prompts, IDs, settings, etc.).
 */
export function buildCacheKey(
  tenantDomain: string,
  feature: string,
  ...inputs: string[]
): string {
  const hash = createHash("sha256")
    .update(inputs.join("\x00"))
    .digest("hex")
    .slice(0, 16);
  return `${tenantDomain}:${feature}:${hash}`;
}

function getTtlMs(feature: string): number {
  return DEFAULT_TTL_MS[feature] ?? DEFAULT_TTL_MS.default;
}

// ─── public API ───────────────────────────────────────────────────────────────

/** Return cached value if present and not expired, or null. */
export function getCached<T>(key: string): T | null {
  const entry = cache.get(key) as CachedResult<T> | undefined;
  if (!entry) { missesTotal++; return null; }
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    missesTotal++;
    return null;
  }
  hitsTotal++;
  return entry.value;
}

/** Store a value in the cache with a feature-specific TTL. */
export function setCached<T>(
  key: string,
  value: T,
  tenantDomain: string,
  feature: string,
  ttlMs?: number,
): void {
  const effectiveTtl = ttlMs ?? getTtlMs(feature);
  cache.set(key, {
    value,
    expiresAt: Date.now() + effectiveTtl,
    feature,
    tenantDomain,
    createdAt: Date.now(),
  });
}

/**
 * Invalidate all cached entries for a given tenant (and optionally a specific
 * feature).  Call this whenever the tenant's source data changes (new crawl
 * result, document upload, manual rebuild trigger).
 */
export function invalidateTenant(tenantDomain: string, feature?: string): number {
  let count = 0;
  for (const [key, entry] of Array.from(cache.entries())) {
    if (entry.tenantDomain === tenantDomain && (!feature || entry.feature === feature)) {
      cache.delete(key);
      count++;
    }
  }
  if (count > 0) {
    console.log(
      `[AICache] Invalidated ${count} entries for tenant=${tenantDomain}${feature ? ` feature=${feature}` : ""}`,
    );
  }
  return count;
}

/** Wrap an expensive AI call with cache get/set logic. */
export async function withCache<T>(
  key: string,
  tenantDomain: string,
  feature: string,
  fn: () => Promise<T>,
  ttlMs?: number,
): Promise<T> {
  const cached = getCached<T>(key);
  if (cached !== null) {
    console.log(`[AICache] HIT  ${key}`);
    return cached;
  }
  console.log(`[AICache] MISS ${key}`);
  const result = await fn();
  setCached(key, result, tenantDomain, feature, ttlMs);
  return result;
}

/** Return cache statistics for monitoring / admin UI. */
export function getCacheStats() {
  const now = Date.now();
  let liveEntries = 0;
  for (const entry of Array.from(cache.values())) {
    if (entry.expiresAt > now) liveEntries++;
  }
  return {
    totalEntries: cache.size,
    liveEntries,
    hits: hitsTotal,
    misses: missesTotal,
    hitRate: hitsTotal + missesTotal > 0
      ? Math.round((hitsTotal / (hitsTotal + missesTotal)) * 100)
      : 0,
  };
}

/** Clear the entire cache (for testing / admin use). */
export function clearCache(): void {
  cache.clear();
  hitsTotal = 0;
  missesTotal = 0;
  console.log("[AICache] Cache cleared");
}
