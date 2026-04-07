// ---------------------------------------------------------------------------
// P2 — Slow Query Logger
// Wraps any async DB operation and logs a warning when it exceeds a threshold.
// ---------------------------------------------------------------------------

const DEFAULT_SLOW_QUERY_THRESHOLD_MS = 200;
const rawSlowQueryThresholdMs = process.env.SLOW_QUERY_THRESHOLD_MS;
const parsedSlowQueryThresholdMs = rawSlowQueryThresholdMs == null
  ? DEFAULT_SLOW_QUERY_THRESHOLD_MS
  : Number.parseInt(rawSlowQueryThresholdMs, 10);
const SLOW_QUERY_THRESHOLD_MS = Number.isFinite(parsedSlowQueryThresholdMs)
  ? Math.max(0, parsedSlowQueryThresholdMs)
  : DEFAULT_SLOW_QUERY_THRESHOLD_MS;

/**
 * Execute an async DB operation and log a warning if it takes longer than
 * `SLOW_QUERY_THRESHOLD_MS` (default 200 ms).
 *
 * Usage:
 * ```ts
 * const rows = await timedQuery("getCompetitors", () =>
 *   db.select().from(competitors).where(...)
 * );
 * ```
 */
export async function timedQuery<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await operation();
  } finally {
    const elapsed = Date.now() - start;
    if (elapsed > SLOW_QUERY_THRESHOLD_MS) {
      console.warn(`[SlowQuery] ${label} took ${elapsed}ms (threshold: ${SLOW_QUERY_THRESHOLD_MS}ms)`);
    }
  }
}
