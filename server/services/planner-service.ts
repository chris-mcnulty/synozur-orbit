/**
 * High-level Microsoft Planner sync orchestration for Orbit marketing plans.
 *
 * Responsibilities:
 *   - **Pull (Planner → Orbit):** For each Orbit task that is linked to a
 *     Planner task (has a `plannerTaskId`), fetch the current Planner state
 *     and apply any changes back into Orbit (title, priority, due date,
 *     completion status).
 *   - **Push (Orbit → Planner):** For each marketing task in an Orbit plan,
 *     ensure a corresponding Planner task exists in the configured
 *     (group, plan, bucket) tuple.  On subsequent syncs, push
 *     title/priority/due-date/completion changes using the stored etag for
 *     optimistic concurrency.
 *   - Record sync state (last-success timestamp, last error) on the plan.
 *
 * The sync runs pull-then-push so that Planner edits are captured before
 * Orbit pushes its own view back.  When both sides have changed since the
 * last sync, Planner values take precedence (Planner is treated as the
 * source of truth for task completion and priority edits made outside
 * Orbit).
 */

import { storage } from "../storage";
import { db } from "../db";
import { marketingTasks } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  getValidGraphToken,
  listPlanTasks,
  createTask,
  updateTask,
  getTask,
  type PlannerTask,
} from "./planner-graph-client";

export interface SyncResult {
  ok: boolean;
  pulled: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ taskId: string; message: string }>;
}

// ---- Orbit → Planner mappings ----

const STATUS_TO_PERCENT: Record<string, number> = {
  suggested: 0,
  planned: 0,
  accepted: 0,
  in_progress: 50,
  completed: 100,
  cancelled: 100,
  removed: 100,
};

const PRIORITY_MAP: Record<string, number> = {
  High: 3,
  Medium: 5,
  Low: 9,
  high: 3,
  medium: 5,
  low: 9,
};

// ---- Planner → Orbit mappings ----

/**
 * Map a Planner `percentComplete` value (0-100) back to an Orbit task status.
 * We use a conservative mapping: only promote/demote when the value clearly
 * signals completion or active work.
 */
function percentToStatus(percent: number): string {
  if (percent >= 100) return "completed";
  if (percent > 0) return "in_progress";
  return "planned";
}

/**
 * Map a Planner priority integer back to an Orbit priority string.
 * Planner: 1 = urgent, 3 = important, 5 = medium, 9 = low.
 */
function plannerPriorityToOrbit(priority: number): string {
  if (priority <= 3) return "High";
  if (priority <= 5) return "Medium";
  return "Low";
}

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
 * Sync all tasks in an Orbit marketing plan with Microsoft Planner (two-way).
 *
 * 1. Pulls current Planner task states and writes any changes back to Orbit.
 * 2. Pushes the resulting Orbit state up to Planner (create if missing,
 *    PATCH if existing).
 *
 * @param planId Orbit marketing plan id
 * @param ctx    tenant/market context (for storage filtering)
 */
export async function syncMarketingPlanToPlanner(
  planId: string,
  ctx: { tenantDomain: string; marketId: string | null },
): Promise<SyncResult> {
  const result: SyncResult = {
    ok: false,
    pulled: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

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

  // ---------------------------------------------------------------
  // STEP 1: Pull — fetch all Planner tasks for this plan and apply
  //         any changes back into Orbit.
  // ---------------------------------------------------------------

  let plannerTaskMap: Map<string, PlannerTask> = new Map();
  try {
    const plannerTasks = await listPlanTasks(token, plan.plannerPlanId);
    for (const pt of plannerTasks) {
      plannerTaskMap.set(pt.id, pt);
    }
  } catch (pullErr: any) {
    // Non-fatal: log and continue with the push phase.
    console.warn("[Planner] Pull phase failed — skipping pull:", pullErr.message);
  }

  const orbitTasks = await storage.getMarketingTasks(plan.id, ctx);

  for (const task of orbitTasks) {
    if (!task.plannerTaskId) continue; // New task — no Planner counterpart yet

    const pt = plannerTaskMap.get(task.plannerTaskId);
    if (!pt) continue; // Task deleted on Planner side — push phase will recreate it

    try {
      const updates: Record<string, any> = {};

      // Title
      if (pt.title && pt.title !== task.title) {
        updates.title = pt.title;
      }

      // Priority
      const incomingPriority = plannerPriorityToOrbit(pt.priority);
      if (incomingPriority !== task.priority) {
        updates.priority = incomingPriority;
      }

      // Due date — compare ISO strings
      const incomingDue = pt.dueDateTime
        ? new Date(pt.dueDateTime).toISOString()
        : null;
      const existingDue = task.dueDate
        ? new Date(task.dueDate).toISOString()
        : null;
      if (incomingDue !== existingDue) {
        updates.dueDate = pt.dueDateTime ? new Date(pt.dueDateTime) : null;
      }

      // Completion / status
      const incomingStatus = percentToStatus(pt.percentComplete);
      // Only update status if the Planner side represents a meaningful change.
      // Avoid overriding "cancelled" or "removed" (admin-set states).
      const preservedStatuses = new Set(["cancelled", "removed"]);
      if (incomingStatus !== task.status && !preservedStatuses.has(task.status ?? "")) {
        updates.status = incomingStatus;
      }

      // Refresh the stored etag from Planner
      if (pt.etag && pt.etag !== task.plannerEtag) {
        updates.plannerEtag = pt.etag;
      }

      if (Object.keys(updates).length > 0) {
        await db.update(marketingTasks)
          .set({ ...updates, plannerLastSyncedAt: new Date(), updatedAt: new Date() })
          .where(eq(marketingTasks.id, task.id));
        result.pulled += 1;
      }
    } catch (err: any) {
      console.error(`[Planner] Pull failed for task ${task.id}:`, err.message);
      // Non-fatal: continue with other tasks
    }
  }

  // Reload tasks so the push phase sees the freshly-pulled state.
  const tasks = await storage.getMarketingTasks(plan.id, ctx);

  // ---------------------------------------------------------------
  // STEP 2: Push — write Orbit task state up to Planner.
  // ---------------------------------------------------------------

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
        // Update existing — use etag refreshed by the pull phase if available
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
      console.error(`[Planner] Push failed for task ${task.id}:`, err.message);
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
