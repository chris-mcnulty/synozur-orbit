/**
 * Task #102 — Sentiment backfill.
 *
 * Scores `activity` rows that have a competitorId but no analyzedAt.
 * Scoped to the last 90 days by capture time (createdAt) so old material
 * doesn't blow LLM spend, and optionally narrowed to a specific tenant
 * or competitor when an admin targets a backfill. Runs in batches; the
 * scheduled-jobs runner invokes this every 15 minutes and admins can
 * call POST /api/admin/sentiment/backfill to drain on demand.
 */

import { storage } from "../storage";
import { analyzeAndStore } from "./sentiment-analyzer-hook";

export interface BackfillResult {
  scanned: number;
  scored: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

export interface BackfillOptions {
  limit?: number;
  sinceDays?: number;
  tenantDomain?: string;
  competitorId?: string;
}

export async function backfillSentiment(opts: BackfillOptions | number = {}): Promise<BackfillResult> {
  // Back-compat: callers used to pass a bare limit number.
  const options: BackfillOptions = typeof opts === "number" ? { limit: opts } : opts;
  const limit = options.limit ?? 50;
  const sinceDays = options.sinceDays ?? 90;

  const start = Date.now();
  const rows = await storage.getUnanalyzedActivities(limit, {
    sinceDays,
    tenantDomain: options.tenantDomain,
    competitorId: options.competitorId,
  });
  let scored = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      const ok = await analyzeAndStore(row);
      if (ok) scored++;
      else skipped++;
    } catch (err) {
      errors++;
      console.warn(
        `[sentiment-backfill] failed for activity ${row.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const result: BackfillResult = {
    scanned: rows.length,
    scored,
    skipped,
    errors,
    durationMs: Date.now() - start,
  };
  if (rows.length > 0) {
    console.log(
      `[sentiment-backfill] tenant=${options.tenantDomain || "*"} competitor=${options.competitorId || "*"} scanned=${result.scanned} scored=${result.scored} skipped=${result.skipped} errors=${result.errors} in ${result.durationMs}ms`,
    );
  }
  return result;
}
