/**
 * Query Timer Utility (P2 — Performance Enhancement)
 *
 * Wraps any async database operation and emits a warning log if it exceeds
 * SLOW_QUERY_THRESHOLD_MS.  Attach to any storage function call to surface
 * N+1 patterns and unexpected slow queries in server logs.
 *
 * Usage:
 *   import { timedQuery } from "./utils/query-timer";
 *   const rows = await timedQuery("getCompetitorsByTenant", () =>
 *     db.select().from(competitors).where(eq(competitors.tenantDomain, domain))
 *   );
 */

const SLOW_QUERY_THRESHOLD_MS = 200;

interface QueryTimerStats {
  label: string;
  durationMs: number;
  isSlow: boolean;
  timestamp: number;
}

// Keep a rolling window of the last 100 slow queries for the admin panel
const recentSlowQueries: QueryTimerStats[] = [];
const MAX_SLOW_QUERY_HISTORY = 100;

/**
 * Run `fn` and log a warning if it takes longer than the slow-query threshold.
 * Returns the result of `fn` unchanged.
 */
export async function timedQuery<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
      console.warn(`[SlowQuery] ${label} took ${durationMs}ms (threshold: ${SLOW_QUERY_THRESHOLD_MS}ms)`);
      recentSlowQueries.unshift({ label, durationMs, isSlow: true, timestamp: start });
      if (recentSlowQueries.length > MAX_SLOW_QUERY_HISTORY) {
        recentSlowQueries.length = MAX_SLOW_QUERY_HISTORY;
      }
    }
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    console.warn(`[SlowQuery] ${label} failed after ${durationMs}ms`);
    throw err;
  }
}

/** Expose recent slow queries for admin monitoring. */
export function getSlowQueryLog(): QueryTimerStats[] {
  return [...recentSlowQueries];
}

/** Clear slow query history (admin action). */
export function clearSlowQueryLog(): void {
  recentSlowQueries.length = 0;
}
