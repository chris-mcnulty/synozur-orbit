import crypto from "crypto";
import type { AIFeature } from "@shared/schema";
import type { AICompletionResult } from "./ai-provider";

// ---------------------------------------------------------------------------
// P1 — AI Response Cache
// In-memory TTL cache keyed by tenantDomain:feature:promptHash:optionsHash.
// Cache hits bypass the AI provider entirely, saving cost and latency.
// ---------------------------------------------------------------------------

interface CacheEntry {
  result: AICompletionResult;
  createdAt: number;
  ttlMs: number;
  hits: number;
}

export interface CacheOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  providerKey?: string;
}

/** Per-feature TTLs (milliseconds). Conservative defaults avoid stale output. */
const FEATURE_TTL_MS: Partial<Record<string, number>> = {
  competitor_analysis: 60 * 60 * 1000,    // 60 min — analysis changes infrequently
  battlecard_generation: 30 * 60 * 1000,  // 30 min
  gap_analysis: 60 * 60 * 1000,           // 60 min
  recommendation: 30 * 60 * 1000,         // 30 min
  executive_summary: 60 * 60 * 1000,      // 60 min
  messaging_framework: 30 * 60 * 1000,    // 30 min
  company_research: 10 * 60 * 1000,       // 10 min — more dynamic
  social_analysis: 10 * 60 * 1000,        // 10 min
};

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 min default

/** The cache store. Key format: `tenantDomain:feature:sha256(prompt):sha256(options)`. */
const cache = new Map<string, CacheEntry>();

/** Max entries to prevent unbounded memory growth. */
const MAX_ENTRIES = 2000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashPrompt(prompt: string): string {
  return crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

function hashOptions(options: CacheOptions): string {
  const normalized = JSON.stringify({
    sys: options.systemPrompt ?? "",
    temp: options.temperature ?? "",
    tok: options.maxTokens ?? "",
    model: options.model ?? "",
    provider: options.providerKey ?? "",
  });
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 8);
}

function buildKey(tenantDomain: string, feature: string, promptHash: string, optionsHash: string): string {
  return `${tenantDomain}:${feature}:${promptHash}:${optionsHash}`;
}

function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.createdAt > entry.ttlMs) {
      cache.delete(key);
    }
  }
}

/** LRU-style eviction when we exceed MAX_ENTRIES. */
function evictIfFull(): void {
  if (cache.size < MAX_ENTRIES) return;
  // Remove oldest entries first
  const entries = [...cache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
  const toRemove = entries.slice(0, cache.size - MAX_ENTRIES + 100); // remove a batch
  for (const [key] of toRemove) {
    cache.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up a cached AI response.
 * Returns the cached result or `undefined` on a miss.
 */
export function getCachedResponse(
  tenantDomain: string,
  feature: AIFeature | string,
  prompt: string,
  options?: CacheOptions,
): AICompletionResult | undefined {
  const key = buildKey(tenantDomain, feature, hashPrompt(prompt), hashOptions(options ?? {}));
  const entry = cache.get(key);
  if (!entry) return undefined;

  // Check TTL
  if (Date.now() - entry.createdAt > entry.ttlMs) {
    cache.delete(key);
    return undefined;
  }

  entry.hits++;
  return entry.result;
}

/**
 * Store an AI response in the cache.
 */
export function setCachedResponse(
  tenantDomain: string,
  feature: AIFeature | string,
  prompt: string,
  result: AICompletionResult,
  options?: CacheOptions,
): void {
  const ttlMs = FEATURE_TTL_MS[feature] ?? DEFAULT_TTL_MS;
  const key = buildKey(tenantDomain, feature, hashPrompt(prompt), hashOptions(options ?? {}));

  cache.set(key, {
    result,
    createdAt: Date.now(),
    ttlMs,
    hits: 0,
  });

  // Evict after insertion to enforce the MAX_ENTRIES bound strictly
  evictIfFull();
}

/**
 * Invalidate all cached entries for a given tenant.
 * Useful after data refreshes or manual triggers.
 */
export function invalidateTenantCache(tenantDomain: string): number {
  let removed = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(`${tenantDomain}:`)) {
      cache.delete(key);
      removed++;
    }
  }
  return removed;
}

/**
 * Invalidate all cached entries for a specific feature across all tenants.
 */
export function invalidateFeatureCache(feature: string): number {
  let removed = 0;
  for (const key of cache.keys()) {
    if (key.includes(`:${feature}:`)) {
      cache.delete(key);
      removed++;
    }
  }
  return removed;
}

/**
 * Get cache statistics for admin monitoring.
 */
export function getCacheStats(): {
  totalEntries: number;
  totalHits: number;
  byFeature: Record<string, { entries: number; hits: number }>;
} {
  evictExpired();

  let totalHits = 0;
  const byFeature: Record<string, { entries: number; hits: number }> = {};

  for (const [key, entry] of cache) {
    totalHits += entry.hits;
    const parts = key.split(":");
    const feature = parts[1] ?? "unknown";
    if (!byFeature[feature]) {
      byFeature[feature] = { entries: 0, hits: 0 };
    }
    byFeature[feature].entries++;
    byFeature[feature].hits += entry.hits;
  }

  return {
    totalEntries: cache.size,
    totalHits,
    byFeature,
  };
}

/**
 * Clear the entire cache. For admin use.
 */
export function clearCache(): number {
  const size = cache.size;
  cache.clear();
  return size;
}
