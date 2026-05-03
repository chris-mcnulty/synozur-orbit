import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { manualActionUsage, manualActionBonuses } from "@shared/schema";
import {
  getManualActionQuota,
  getAllManualActionQuotas,
  nextPlanForManualAction,
  MANUAL_ACTION_LABELS,
  MANUAL_ACTION_KEYS,
  MANUAL_ACTION_COST_TIERS,
  type ManualActionKey,
} from "./plan-policy";

export function getCurrentPeriodStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function getNextPeriodStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export interface ManualActionUsageRow {
  action: ManualActionKey;
  used: number;
  bonus: number;
  limit: number; // -1 = unlimited
  remaining: number; // -1 = unlimited
  resetsAt: string;
  label: string;
  costTier: "low" | "medium" | "high";
}

export interface ManualActionGateDenied {
  ok: false;
  reason: string;
  upgradeRequired: true;
  requiredPlan: string;
  used: number;
  limit: number;
}

export interface ManualActionReservation {
  ok: true;
  commit: (succeeded: boolean) => Promise<void>;
}

// Stable 31-bit hash for advisory locking (Postgres advisory lock keys are bigint, safe to fit).
function hashKey(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i);
    h |= 0;
  }
  // mask to positive 31-bit
  return h & 0x7fffffff;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function countBonus(
  tx: Tx,
  tenantDomain: string,
  action: ManualActionKey,
  periodStart: Date,
): Promise<number> {
  const rows = await tx
    .select({ s: sql<number>`coalesce(sum(${manualActionBonuses.delta}), 0)` })
    .from(manualActionBonuses)
    .where(and(
      eq(manualActionBonuses.tenantDomain, tenantDomain),
      eq(manualActionBonuses.action, action),
      gte(manualActionBonuses.periodStart, periodStart),
    ));
  return Number(rows[0]?.s || 0);
}

async function countUsedOrPending(
  tx: Tx,
  tenantDomain: string,
  action: ManualActionKey,
  periodStart: Date,
): Promise<number> {
  // Count rows that are either committed-success OR still pending (succeeded IS NULL).
  // Pending rows hold a reservation slot until commit() finalizes them.
  const rows = await tx
    .select({ c: sql<number>`count(*)` })
    .from(manualActionUsage)
    .where(and(
      eq(manualActionUsage.tenantDomain, tenantDomain),
      eq(manualActionUsage.action, action),
      gte(manualActionUsage.occurredAt, periodStart),
      or(eq(manualActionUsage.succeeded, true), isNull(manualActionUsage.succeeded)),
    ));
  return Number(rows[0]?.c || 0);
}

/**
 * Atomically reserve a quota slot.
 *
 * - Acquires a transaction-scoped advisory lock keyed on (tenant, action, period)
 *   so concurrent reservations cannot both pass when at the limit.
 * - Inserts a row with succeeded=NULL (pending) that reserves the slot.
 * - Returns a `commit(succeeded)` callback the caller invokes after the work
 *   succeeds or fails. A pending row that is committed with succeeded=false
 *   is removed from the count automatically.
 */
export async function reserveManualAction(
  tenantDomain: string,
  plan: string,
  action: ManualActionKey,
  userId: string | null | undefined,
): Promise<ManualActionReservation | ManualActionGateDenied> {
  const limit = getManualActionQuota(plan, action);
  const costTier = MANUAL_ACTION_COST_TIERS[action];
  const periodStart = getCurrentPeriodStart();

  return await db.transaction(async (tx) => {
    const lockKey = hashKey(`${tenantDomain}:${action}:${periodStart.getTime()}`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

    if (limit !== -1) {
      const [used, bonus] = await Promise.all([
        countUsedOrPending(tx, tenantDomain, action, periodStart),
        countBonus(tx, tenantDomain, action, periodStart),
      ]);
      const effectiveLimit = limit + bonus;
      if (used >= effectiveLimit) {
        const label = MANUAL_ACTION_LABELS[action];
        return {
          ok: false,
          reason: `Monthly ${label} quota reached (${used}/${effectiveLimit}) for your ${plan} plan. Upgrade or request additional quota.`,
          upgradeRequired: true,
          requiredPlan: nextPlanForManualAction(plan, action),
          used,
          limit: effectiveLimit,
        };
      }
    }

    const inserted = await tx
      .insert(manualActionUsage)
      .values({
        tenantDomain,
        userId: userId || null,
        action,
        costTier,
        succeeded: null,
      })
      .returning({ id: manualActionUsage.id });
    const reservationId = inserted[0]?.id;
    if (!reservationId) {
      throw new Error("Failed to reserve manual action slot");
    }

    return {
      ok: true,
      commit: async (succeeded: boolean) => {
        try {
          await db
            .update(manualActionUsage)
            .set({ succeeded })
            .where(eq(manualActionUsage.id, reservationId));
        } catch (err) {
          console.error("[ManualActionQuota] failed to finalize reservation", reservationId, err);
        }
      },
    };
  });
}

export async function getManualActionUsageSummary(
  tenantDomain: string,
  plan: string,
): Promise<ManualActionUsageRow[]> {
  const periodStart = getCurrentPeriodStart();
  const resetsAt = getNextPeriodStart().toISOString();
  const quotas = getAllManualActionQuotas(plan);

  // Single grouped query for committed-success usage.
  const usageRows = await db
    .select({
      action: manualActionUsage.action,
      c: sql<number>`count(*)`,
    })
    .from(manualActionUsage)
    .where(and(
      eq(manualActionUsage.tenantDomain, tenantDomain),
      eq(manualActionUsage.succeeded, true),
      gte(manualActionUsage.occurredAt, periodStart),
    ))
    .groupBy(manualActionUsage.action);
  const usedByAction = new Map<string, number>();
  for (const r of usageRows) usedByAction.set(r.action, Number(r.c || 0));

  const bonusRows = await db
    .select({
      action: manualActionBonuses.action,
      s: sql<number>`coalesce(sum(${manualActionBonuses.delta}), 0)`,
    })
    .from(manualActionBonuses)
    .where(and(
      eq(manualActionBonuses.tenantDomain, tenantDomain),
      gte(manualActionBonuses.periodStart, periodStart),
    ))
    .groupBy(manualActionBonuses.action);
  const bonusByAction = new Map<string, number>();
  for (const r of bonusRows) bonusByAction.set(r.action, Number(r.s || 0));

  return MANUAL_ACTION_KEYS.map((action) => {
    const baseLimit = quotas[action];
    const used = usedByAction.get(action) || 0;
    const bonus = bonusByAction.get(action) || 0;
    const limit = baseLimit === -1 ? -1 : baseLimit + bonus;
    const remaining = limit === -1 ? -1 : Math.max(0, limit - used);
    return {
      action,
      used,
      bonus,
      limit,
      remaining,
      resetsAt,
      label: MANUAL_ACTION_LABELS[action],
      costTier: MANUAL_ACTION_COST_TIERS[action],
    };
  });
}

export async function grantManualActionBonus(
  tenantDomain: string,
  action: ManualActionKey,
  delta: number,
  grantedBy: string | null,
  reason?: string,
): Promise<void> {
  await db.insert(manualActionBonuses).values({
    tenantDomain,
    action,
    delta,
    periodStart: getCurrentPeriodStart(),
    reason: reason || null,
    grantedBy: grantedBy || null,
  });
}

export interface ManualActionBonusLogEntry {
  id: string;
  action: ManualActionKey;
  delta: number;
  periodStart: string;
  reason: string | null;
  grantedBy: string | null;
  grantedByEmail: string | null;
  createdAt: string;
}

export async function listManualActionBonuses(
  tenantDomain: string,
  limit = 50,
): Promise<ManualActionBonusLogEntry[]> {
  const rows = await db.execute(sql`
    SELECT b.id, b.action, b.delta, b.period_start, b.reason,
           b.granted_by, u.email AS granted_by_email, b.created_at
    FROM manual_action_bonuses b
    LEFT JOIN users u ON u.id = b.granted_by
    WHERE b.tenant_domain = ${tenantDomain}
    ORDER BY b.created_at DESC
    LIMIT ${limit}
  `);
  return (rows.rows as any[]).map((r) => ({
    id: r.id,
    action: r.action as ManualActionKey,
    delta: Number(r.delta),
    periodStart: new Date(r.period_start).toISOString(),
    reason: r.reason || null,
    grantedBy: r.granted_by || null,
    grantedByEmail: r.granted_by_email || null,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}
