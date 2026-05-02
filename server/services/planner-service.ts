/**
 * High-level Microsoft Planner sync orchestration for Orbit marketing plans.
 *
 * Responsibilities:
 *   - For each marketing task in an Orbit plan, ensure a corresponding
 *     Planner task exists in the configured (group, plan, bucket) tuple.
 *   - On subsequent syncs, push title/priority/due-date/completion changes
 *     using the stored etag for optimistic concurrency.
 *   - Record sync state (last-success timestamp, last error) on the plan.
 *
 * This is a *one-way push* (Orbit → Planner) for the first iteration. Pulling
 * Planner changes back into Orbit is left for a follow-up.
 */

import { storage } from "../storage";
import { db } from "../db";
import { marketingTasks } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  getValidGraphToken,
  createTask,
  updateTask,
  getTask,
  type PlannerTask,
} from "./planner-graph-client";

export interface SyncResult {
  ok: boolean;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ taskId: string; message: string }>;
}

const STATUS_TO_PERCENT: Record<string, number> = {
  suggested: 0,
  planned: 0,
  accepted: 0,
  in_progress: 50,
  completed: 100,
  cancelled: 100, // Cancelled = closed in Planner
  removed: 100,
};

const PRIORITY_MAP: Record<string, number> = {
  // Planner uses: 1 (urgent), 3 (important), 5 (medium), 9 (low)
  High: 3,
  Medium: 5,
  Low: 9,
  high: 3,
  medium: 5,
  low: 9,
};

function toPlannerPriority(priority: string | null | undefined): number {
  if (!priority) return 5;
  return PRIORITY_MAP[priority] ?? 5;
}

function toPercentComplete(status: string | null | undefined): number {
  if (!status) return 0;
  return STATUS_TO_PERCENT[status] ?? 0;
}

function toGraphDateTime(due: Date | string | null | undefined): string | null {
  if (!due) return null;
  const d = typeof due === "string" ? new Date(due) : due;
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Sync all tasks in an Orbit marketing plan to Microsoft Planner.
 *
 * @param planId Orbit marketing plan id
 * @param ctx    tenant/market context (for storage filtering)
 */
export async function syncMarketingPlanToPlanner(
  planId: string,
  ctx: { tenantDomain: string; marketId: string | null },
): Promise<SyncResult> {
  const result: SyncResult = { ok: false, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };

  const plan = await storage.getMarketingPlan(planId, ctx);
  if (!plan) {
    result.errors.push({ taskId: "(plan)", message: "Marketing plan not found" });
    return result;
  }
  if (!plan.plannerSyncEnabled || !plan.plannerPlanId || !plan.plannerConnectedBy) {
    result.errors.push({ taskId: "(plan)", message: "Planner sync is not configured for this plan" });
    return result;
  }

  const token = await getValidGraphToken(plan.plannerConnectedBy);
  if (!token) {
    const msg = "Planner consent required — please reconnect to Microsoft Planner.";
    await storage.updateMarketingPlan(plan.id, { plannerLastSyncError: msg } as any, ctx);
    result.errors.push({ taskId: "(plan)", message: msg });
    return result;
  }

  const tasks = await storage.getMarketingTasks(plan.id, ctx);

  for (const task of tasks) {
    try {
      const dueIso = toGraphDateTime(task.dueDate);
      const priority = toPlannerPriority(task.priority);
      const percent = toPercentComplete(task.status);

      if (!task.plannerTaskId) {
        // Create new Planner task
        const created: PlannerTask = await createTask(token, {
          planId: plan.plannerPlanId,
          bucketId: plan.plannerBucketId || null,
          title: task.title,
          priority,
          dueDateTime: dueIso,
          percentComplete: percent,
        });
        await db.update(marketingTasks)
          .set({
            plannerTaskId: created.id,
            plannerEtag: created.etag,
            plannerLastSyncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(marketingTasks.id, task.id));
        result.created += 1;
      } else {
        // Update existing — fetch latest etag if we don't have it
        let etag = task.plannerEtag;
        if (!etag) {
          const existing = await getTask(token, task.plannerTaskId);
          if (!existing) {
            // Task was deleted on the Planner side — recreate it
            const created: PlannerTask = await createTask(token, {
              planId: plan.plannerPlanId,
              bucketId: plan.plannerBucketId || null,
              title: task.title,
              priority,
              dueDateTime: dueIso,
              percentComplete: percent,
            });
            await db.update(marketingTasks)
              .set({
                plannerTaskId: created.id,
                plannerEtag: created.etag,
                plannerLastSyncedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(marketingTasks.id, task.id));
            result.created += 1;
            continue;
          }
          etag = existing.etag ?? null;
        }
        if (!etag) {
          result.skipped += 1;
          continue;
        }
        const newEtag = await updateTask(token, task.plannerTaskId, etag, {
          title: task.title,
          bucketId: plan.plannerBucketId || null,
          priority,
          dueDateTime: dueIso,
          percentComplete: percent,
        });
        await db.update(marketingTasks)
          .set({
            plannerEtag: newEtag,
            plannerLastSyncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(marketingTasks.id, task.id));
        result.updated += 1;
      }
    } catch (err: any) {
      console.error(`[Planner] Sync failed for task ${task.id}:`, err.message);
      result.failed += 1;
      result.errors.push({ taskId: task.id, message: err.message || String(err) });
    }
  }

  const errorSummary = result.errors.length > 0
    ? `${result.errors.length} task(s) failed: ${result.errors.slice(0, 3).map(e => e.message).join("; ")}`
    : null;

  await storage.updateMarketingPlan(plan.id, {
    plannerLastSyncAt: new Date(),
    plannerLastSyncError: errorSummary,
  } as any, ctx);

  result.ok = result.failed === 0;
  return result;
}
