/**
 * Market Intelligence Sources — provenance persistence (Task #543 foundation)
 *
 * Thin CRUD over the `market_intelligence_sources` table: the shared, polymorphic
 * store behind every cited figure (#543 sizing / needs maps), matrix cell (#544),
 * and study source panel (#547). Providers return citations; the estimation
 * service persists them here keyed by (scopeType, scopeId).
 */

import { db } from "../db";
import { and, eq } from "drizzle-orm";
import { marketIntelligenceSources } from "@shared/schema";
import type {
  SourceScopeType,
  MarketIntelligenceSourceInput,
} from "@shared/market-intelligence";

export interface RecordSourcesParams {
  tenantDomain: string;
  marketId?: string | null;
  scopeType: SourceScopeType;
  scopeId: string;
  sources: MarketIntelligenceSourceInput[];
}

/** Insert citations for a scope. Returns the number of rows written. */
export async function recordSources(params: RecordSourcesParams): Promise<number> {
  const rows = params.sources.filter((s) => s && (s.url || s.title));
  if (rows.length === 0) return 0;

  await db.insert(marketIntelligenceSources).values(
    rows.map((s) => ({
      tenantDomain: params.tenantDomain,
      marketId: params.marketId ?? null,
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      usedForField: s.usedForField ?? null,
      url: s.url ?? null,
      title: s.title ?? null,
      publisher: s.publisher ?? null,
      excerpt: s.excerpt ?? null,
    })),
  );
  return rows.length;
}

/** Any drizzle executor — the base `db` or a transaction handle. */
type Executor = Pick<typeof db, "delete" | "insert">;

async function replaceSourcesOn(exec: Executor, params: RecordSourcesParams): Promise<number> {
  await exec
    .delete(marketIntelligenceSources)
    .where(
      and(
        eq(marketIntelligenceSources.tenantDomain, params.tenantDomain),
        eq(marketIntelligenceSources.scopeType, params.scopeType),
        eq(marketIntelligenceSources.scopeId, params.scopeId),
      ),
    );

  const rows = params.sources.filter((s) => s && (s.url || s.title));
  if (rows.length === 0) return 0;

  await exec.insert(marketIntelligenceSources).values(
    rows.map((s) => ({
      tenantDomain: params.tenantDomain,
      marketId: params.marketId ?? null,
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      usedForField: s.usedForField ?? null,
      url: s.url ?? null,
      title: s.title ?? null,
      publisher: s.publisher ?? null,
      excerpt: s.excerpt ?? null,
    })),
  );
  return rows.length;
}

/**
 * Replace all citations for a scope — the correct primitive for a re-estimate /
 * study refresh so stale sources never accumulate. Pass `tx` to run inside a
 * caller's transaction (e.g. atomically with the segment's sizing update);
 * otherwise it runs in its own transaction.
 */
export async function replaceSources(params: RecordSourcesParams, tx?: Executor): Promise<number> {
  if (tx) return replaceSourcesOn(tx, params);
  return db.transaction((t) => replaceSourcesOn(t, params));
}

/** Fetch citations for a scope, newest first. */
export async function getSources(
  tenantDomain: string,
  scopeType: SourceScopeType,
  scopeId: string,
) {
  return db
    .select()
    .from(marketIntelligenceSources)
    .where(
      and(
        eq(marketIntelligenceSources.tenantDomain, tenantDomain),
        eq(marketIntelligenceSources.scopeType, scopeType),
        eq(marketIntelligenceSources.scopeId, scopeId),
      ),
    );
}
