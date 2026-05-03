import { sql } from "drizzle-orm";
import { db } from "../db";
import { rateLimitBuckets, tenants } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Persistent, tenant-aware rate limiter.
 *
 * Buckets live in the `rate_limit_buckets` table so they survive process
 * restarts and are consistent across multiple server instances. Each call
 * performs a single atomic INSERT ... ON CONFLICT DO UPDATE that either
 * increments the existing window's counter or starts a fresh window when the
 * previous one has expired.
 *
 * For non-tenant-scoped limits (e.g. anonymous signup by IP) pass
 * `tenantDomain: GLOBAL_TENANT` so all rows share a single namespace.
 */

export const GLOBAL_TENANT = "_global";

export const DEFAULT_PUBLIC_RATE_LIMIT_PER_MINUTE = 10;
export const SIGNUP_RATE_LIMIT_PER_10_MIN = 10;
export const PASSWORD_RESET_RATE_LIMIT_PER_HOUR = 5;

export interface RateLimitOptions {
  tenantDomain: string;
  scope: string;
  key: string;
  max: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

// Small in-memory cache used purely as an optimisation when a key is already
// known to be over the limit. We never use it as the source of truth for
// allowing requests — only for short-circuiting deny decisions before a fresh
// DB roundtrip. Across multi-process deployments each process simply holds its
// own copy; the DB row remains canonical.
const denyCache = new Map<string, number>();

function denyCacheKey(o: { tenantDomain: string; scope: string; key: string }): string {
  return `${o.tenantDomain}|${o.scope}|${o.key}`;
}

// Fail-degraded fallback: when Postgres is unreachable we don't want to either
// (a) fail open — disabling protection entirely — or (b) fail closed — taking
// down anonymous endpoints during a DB blip. Instead we transparently
// downgrade to a per-process in-memory bucket using the same cap. This still
// throttles abuse (per-process rather than globally) until the DB recovers.
interface InMemoryBucket {
  count: number;
  resetAt: number;
}
const inMemoryBuckets = new Map<string, InMemoryBucket>();
let lastDbFailureLogAt = 0;

function logDbFailureThrottled(err: unknown): void {
  const now = Date.now();
  if (now - lastDbFailureLogAt > 30_000) {
    lastDbFailureLogAt = now;
    console.error("[rate-limiter] DB error — degrading to in-memory limiter:", err);
  }
}

function inMemoryConsume(opts: RateLimitOptions): RateLimitResult {
  const cacheKey = denyCacheKey(opts);
  const now = Date.now();
  const existing = inMemoryBuckets.get(cacheKey);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + opts.windowMs;
    inMemoryBuckets.set(cacheKey, { count: 1, resetAt });
    return { allowed: true, remaining: Math.max(0, opts.max - 1), resetAt };
  }
  existing.count += 1;
  if (existing.count > opts.max) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }
  return { allowed: true, remaining: Math.max(0, opts.max - existing.count), resetAt: existing.resetAt };
}

export async function consumeRateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  const now = Date.now();
  const cacheKey = denyCacheKey(opts);
  const cachedDenyUntil = denyCache.get(cacheKey);
  if (cachedDenyUntil && cachedDenyUntil > now) {
    return { allowed: false, remaining: 0, resetAt: cachedDenyUntil };
  } else if (cachedDenyUntil) {
    denyCache.delete(cacheKey);
  }

  const windowSeconds = Math.max(1, Math.floor(opts.windowMs / 1000));
  const intervalSql = sql.raw(`interval '${windowSeconds} seconds'`);

  try {
    // Atomic upsert: if no row OR the existing window has expired, start a
    // fresh window with count=1. Otherwise increment the existing counter.
    const result = await db
      .insert(rateLimitBuckets)
      .values({
        tenantDomain: opts.tenantDomain,
        scope: opts.scope,
        key: opts.key,
        count: 1,
        resetAt: sql<Date>`now() + ${intervalSql}`,
      })
      .onConflictDoUpdate({
        target: [rateLimitBuckets.tenantDomain, rateLimitBuckets.scope, rateLimitBuckets.key],
        set: {
          count: sql<number>`CASE WHEN ${rateLimitBuckets.resetAt} <= now() THEN 1 ELSE ${rateLimitBuckets.count} + 1 END`,
          resetAt: sql<Date>`CASE WHEN ${rateLimitBuckets.resetAt} <= now() THEN now() + ${intervalSql} ELSE ${rateLimitBuckets.resetAt} END`,
          updatedAt: sql<Date>`now()`,
        },
      })
      .returning({ count: rateLimitBuckets.count, resetAt: rateLimitBuckets.resetAt });

    const row = result[0];
    const count = row?.count ?? 0;
    const resetAt = row?.resetAt ? new Date(row.resetAt).getTime() : now + opts.windowMs;

    if (count > opts.max) {
      denyCache.set(cacheKey, resetAt);
      return { allowed: false, remaining: 0, resetAt };
    }
    return { allowed: true, remaining: Math.max(0, opts.max - count), resetAt };
  } catch (err) {
    // Degrade to per-process in-memory limiter so abuse protection stays on
    // during a DB outage. The DB row remains canonical once Postgres
    // recovers.
    logDbFailureThrottled(err);
    return inMemoryConsume(opts);
  }
}

/**
 * Best-effort cleanup of expired buckets. Safe to call from a background
 * scheduler; not required for correctness because expired rows are reset
 * in-place by `consumeRateLimit` on next access.
 */
export async function cleanupExpiredBuckets(olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  try {
    const cutoffSeconds = Math.max(60, Math.floor(olderThanMs / 1000));
    const cutoffSql = sql.raw(`interval '${cutoffSeconds} seconds'`);
    const deleted = await db
      .delete(rateLimitBuckets)
      .where(sql`${rateLimitBuckets.resetAt} < now() - ${cutoffSql}`)
      .returning({ key: rateLimitBuckets.key });
    return deleted.length;
  } catch (err) {
    console.error("[rate-limiter] cleanup error:", err);
    return 0;
  }
}

/**
 * Resolve the per-minute public rate limit for a tenant, honouring the
 * `tenants.public_rate_limit_per_minute` admin override when present.
 */
export async function getTenantPublicRateLimit(tenantDomain: string): Promise<number> {
  try {
    const rows = await db
      .select({ limit: tenants.publicRateLimitPerMinute })
      .from(tenants)
      .where(eq(tenants.domain, tenantDomain))
      .limit(1);
    const value = rows[0]?.limit;
    if (typeof value === "number" && value > 0) return value;
  } catch (err) {
    console.error("[rate-limiter] tenant lookup error:", err);
  }
  return DEFAULT_PUBLIC_RATE_LIMIT_PER_MINUTE;
}
