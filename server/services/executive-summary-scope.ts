import { and, eq, sql, type SQL } from "drizzle-orm";
import { unifiedExecSummaries } from "@shared/schema";

/** Legacy reports have no scope: never infer a market for their mixed inputs. */
export function summaryScope(tenantDomain: string, marketId: string): SQL {
  if (!marketId) throw new Error("An explicit market is required for an executive briefing");
  return and(
    eq(unifiedExecSummaries.tenantDomain, tenantDomain),
    sql`${unifiedExecSummaries.summaryData}->'scope'->>'marketId' = ${marketId}`,
  )!;
}
