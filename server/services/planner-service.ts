/**
 * High-level Microsoft Planner sync orchestration for Orbit marketing plans.
 *
 * Phase 2 (Task #104) responsibilities:
 *   - **Pull (Planner → Orbit):** For each Orbit task that is linked to a
 *     Planner task (has a `plannerTaskId`), fetch the current Planner state
 *     and apply any changes back into Orbit (title, priority, due date,
 *     completion status, assignee). Webhook-driven `pullAndReconcileTask()`
 *     allows near-real-time pulls for a single task.
 *   - **Push (Orbit → Planner):** For each marketing task in an Orbit plan,
 *     ensure a corresponding Planner task exists in the bucket configured
 *     for that task's activity category (falling back to the plan default).
 *   - **Reconcile + last-write-wins audit:** every field change is logged
 *     in `planner_task_sync_log` with `{previous, applied, winner}` so the
 *     loser's value is recoverable for audit.
 */

import { storage } from "../storage";
import { db } from "../db";
import {
  marketingTasks,
  plannerTaskSyncLog,
  type InsertPlannerTaskSyncLog,
  type InsertMarketingPlan,
  type MarketingPlan,
  type MarketingTask,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  getValidGraphToken,
  listPlanTasks,
  createTask,
  updateTask,
  getTask,
  buildAssignmentsPayload,
  type PlannerTask,
} from "./planner-graph-client";
import { enqueuePlannerSync, getJobStatusByLabel } from "./job-queue";

/** Stable label prefix for queued plan sync jobs — used by status polling. */
export function plannerSyncJobLabel(planId: string): string {
  return `planner-sync:${planId}`;
}

export interface SyncResult {
  ok: boolean;
  pulled: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ taskId: string; message: string }>;
}

type ContextFilter = { tenantDomain: string; marketId: string | null };

type SyncDirection = "pull" | "push" | "reconcile" | "webhook";

/** Per-field audit entry recorded in `planner_task_sync_log.fields`. */
type FieldAudit = Record<string, { previous: unknown; applied: unknown; winner: "planner" | "orbit" }>;

// ---- Orbit ↔ Planner mappings ----

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

const NOT_STARTED_STATUSES = new Set(["suggested", "planned", "accepted"]);
const PRESERVED_STATUSES = new Set(["cancelled", "removed"]);

function percentToStatus(percent: number, currentStatus: string | null | undefined): string | null {
  if (percent >= 100) return "completed";
  if (percent > 0) return "in_progress";
  if (NOT_STARTED_STATUSES.has(currentStatus ?? "")) return null;
  return "planned";
}

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

async function logSync(entry: {
  planId: string;
  taskId?: string | null;
  plannerTaskId?: string | null;
  direction: SyncDirection;
  fields?: FieldAudit | Record<string, unknown> | null;
  success: boolean;
  errorMessage?: string | null;
}): Promise<void> {
  try {
    const row: InsertPlannerTaskSyncLog = {
      planId: entry.planId,
      taskId: entry.taskId ?? null,
      plannerTaskId: entry.plannerTaskId ?? null,
      direction: entry.direction,
      fields: entry.fields ?? null,
      success: entry.success,
      errorMessage: entry.errorMessage ?? null,
    };
    await db.insert(plannerTaskSyncLog).values(row);
  } catch (err: any) {
    console.warn("[Planner] Failed to write sync log:", err.message);
  }
}

/**
 * Resolve the Planner bucketId to use for a given activity category.
 * Falls back to the plan's `plannerBucketId` (Phase 1 single-bucket setup),
 * or null when no bucket is configured.
 */
function resolveBucketId(
  activityCategory: string | null | undefined,
  mappings: Map<string, string>,
  plan: { plannerBucketId: string | null },
): string | null {
  if (activityCategory && mappings.has(activityCategory)) {
    return mappings.get(activityCategory) ?? null;
  }
  return plan.plannerBucketId || null;
}

/** Map an Orbit user id to an Entra (AAD) oid via the users table. */
async function orbitUserToOid(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const user = await storage.getUser(userId);
  return user?.entraId ?? null;
}

/** Map an Entra (AAD) oid back to an Orbit user id. */
async function oidToOrbitUser(oid: string | null | undefined): Promise<string | null> {
  if (!oid) return null;
  const user = await storage.getUserByEntraId(oid);
  return user?.id ?? null;
}

/**
 * Compare a Planner task with an Orbit task and return the field-level diff
 * to apply to the Orbit row, plus an audit map of the loser's previous
 * values. Caller decides whether to write the diff (last-write-wins keeps
 * Planner as the winner during pull/reconcile).
 */
async function diffPlannerToOrbit(
  pt: PlannerTask,
  orbit: MarketingTask,
): Promise<{ updates: Partial<MarketingTask>; audit: FieldAudit }> {
  const updates: Partial<MarketingTask> = {};
  const audit: FieldAudit = {};

  if (pt.title && pt.title !== orbit.title) {
    audit.title = { previous: orbit.title, applied: pt.title, winner: "planner" };
    updates.title = pt.title;
  }

  const incomingPriority = plannerPriorityToOrbit(pt.priority);
  if (incomingPriority !== orbit.priority) {
    audit.priority = { previous: orbit.priority, applied: incomingPriority, winner: "planner" };
    updates.priority = incomingPriority;
  }

  const incomingDueMs = pt.dueDateTime ? new Date(pt.dueDateTime).getTime() : null;
  const existingDueMs = orbit.dueDate ? new Date(orbit.dueDate).getTime() : null;
  if (incomingDueMs !== existingDueMs) {
    const newDue = incomingDueMs !== null ? new Date(incomingDueMs) : null;
    audit.dueDate = { previous: orbit.dueDate, applied: newDue, winner: "planner" };
    updates.dueDate = newDue;
  }

  const incomingStatus = percentToStatus(pt.percentComplete, orbit.status);
  if (incomingStatus !== null && incomingStatus !== orbit.status && !PRESERVED_STATUSES.has(orbit.status ?? "")) {
    audit.status = { previous: orbit.status, applied: incomingStatus, winner: "planner" };
    updates.status = incomingStatus;
  }

  // Assignee: only update assignedTo when the Planner assignee maps to a known
  // Orbit user. If Planner has no assignees, or has assignees that don't map to
  // any Orbit user, leave assignedTo unchanged (rather than clearing it).
  const assignmentOids = Object.keys(pt.assignments || {});
  if (assignmentOids.length > 0) {
    let mappedUserId: string | null = null;
    for (const oid of assignmentOids) {
      const candidate = await oidToOrbitUser(oid);
      if (candidate) {
        mappedUserId = candidate;
        break;
      }
    }
    if (mappedUserId && mappedUserId !== (orbit.assignedTo ?? null)) {
      audit.assignedTo = { previous: orbit.assignedTo, applied: mappedUserId, winner: "planner" };
      updates.assignedTo = mappedUserId;
    }
  }

  if (pt.etag && pt.etag !== orbit.plannerEtag) {
    updates.plannerEtag = pt.etag;
  }

  return { updates, audit };
}

/**
 * Decide which side wins a last-write-wins reconcile by comparing the most
 * recent modification timestamp on each side. Planner's `lastModifiedDateTime`
 * is authoritative for the Planner side; Orbit's `updatedAt` is authoritative
 * for the Orbit side. If timestamps are missing or equal, Planner wins (it is
 * the system that initiated the change notification).
 */
function chooseWinner(
  pt: PlannerTask,
  orbit: MarketingTask,
): "planner" | "orbit" {
  const plannerMs = pt.lastModifiedDateTime ? new Date(pt.lastModifiedDateTime).getTime() : 0;
  const orbitMs = orbit.updatedAt ? new Date(orbit.updatedAt).getTime() : 0;
  if (orbitMs > plannerMs) return "orbit";
  return "planner";
}

/**
 * Sync all tasks in an Orbit marketing plan with Microsoft Planner (two-way).
 */
export async function syncMarketingPlanToPlanner(
  planId: string,
  ctx: ContextFilter,
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
    const planErrUpdate: Partial<InsertMarketingPlan> = { plannerLastSyncError: msg };
    await storage.updateMarketingPlan(plan.id, planErrUpdate, ctx);
    result.errors.push({ taskId: "(plan)", message: msg });
    return result;
  }

  // Per-category bucket mappings (Phase 2)
  const categoryMappings = await storage.getMarketingPlanBucketMappings(plan.id);
  const bucketByCategory = new Map<string, string>();
  for (const m of categoryMappings) {
    bucketByCategory.set(m.activityCategory, m.bucketId);
  }

  // ---------------------------------------------------------------
  // STEP 1: Pull (Planner → Orbit) — last-write-wins, Planner wins
  // ---------------------------------------------------------------
  const plannerTaskMap: Map<string, PlannerTask> = new Map();
  try {
    const plannerTasks = await listPlanTasks(token, plan.plannerPlanId);
    for (const pt of plannerTasks) plannerTaskMap.set(pt.id, pt);
  } catch (pullErr: any) {
    console.warn("[Planner] Pull phase failed — skipping pull:", pullErr.message);
  }

  const orbitTasks = await storage.getMarketingTasks(plan.id, ctx);

  for (const task of orbitTasks) {
    if (!task.plannerTaskId) continue;
    const pt = plannerTaskMap.get(task.plannerTaskId);
    if (!pt) continue;

    // Last-write-wins: only apply Planner→Orbit if Planner has the newer mod
    // timestamp. Otherwise leave it for the push phase to overwrite Planner.
    if (chooseWinner(pt, task) !== "planner") continue;

    try {
      const { updates, audit } = await diffPlannerToOrbit(pt, task);
      if (Object.keys(audit).length === 0) continue;

      await db.update(marketingTasks)
        .set({ ...updates, plannerLastSyncedAt: new Date(), updatedAt: new Date() })
        .where(eq(marketingTasks.id, task.id));
      result.pulled += 1;
      await logSync({
        planId: plan.id,
        taskId: task.id,
        plannerTaskId: task.plannerTaskId,
        direction: "reconcile",
        fields: audit,
        success: true,
      });
    } catch (err: any) {
      console.error(`[Planner] Pull failed for task ${task.id}:`, err.message);
      await logSync({
        planId: plan.id,
        taskId: task.id,
        plannerTaskId: task.plannerTaskId,
        direction: "reconcile",
        success: false,
        errorMessage: err.message,
      });
    }
  }

  // Reload tasks for push phase
  const tasks = await storage.getMarketingTasks(plan.id, ctx);

  // ---------------------------------------------------------------
  // STEP 2: Push (Orbit → Planner) — Orbit wins, log loser's previous Planner state
  // ---------------------------------------------------------------
  for (const task of tasks) {
    try {
      const dueIso = toGraphDateTime(task.dueDate);
      const priority = toPlannerPriority(task.priority);
      const percent = toPercentComplete(task.status);
      const bucketId = resolveBucketId(task.activityGroup, bucketByCategory, plan);
      const assigneeOid = await orbitUserToOid(task.assignedTo);

      if (!task.plannerTaskId) {
        const assignments = assigneeOid
          ? { [assigneeOid]: { "@odata.type": "#microsoft.graph.plannerAssignment", orderHint: " !" } }
          : null;
        const created: PlannerTask = await createTask(token, {
          planId: plan.plannerPlanId,
          bucketId,
          title: task.title,
          priority,
          dueDateTime: dueIso,
          percentComplete: percent,
          assignments,
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
        await logSync({
          planId: plan.id,
          taskId: task.id,
          plannerTaskId: created.id,
          direction: "push",
          fields: {
            created: { previous: null, applied: { bucketId, assigneeOid }, winner: "orbit" },
          },
          success: true,
        });
        continue;
      }

      // Fetch current Planner state so we can record loser values + use latest etag.
      const existing = await getTask(token, task.plannerTaskId);
      if (existing && chooseWinner(existing, task) !== "orbit") {
        // Planner side is newer — pull phase already handled it (or no-op).
        result.skipped += 1;
        continue;
      }
      if (!existing) {
        // Task disappeared on Planner — recreate.
        const assignments = assigneeOid
          ? { [assigneeOid]: { "@odata.type": "#microsoft.graph.plannerAssignment", orderHint: " !" } }
          : null;
        const created: PlannerTask = await createTask(token, {
          planId: plan.plannerPlanId,
          bucketId,
          title: task.title,
          priority,
          dueDateTime: dueIso,
          percentComplete: percent,
          assignments,
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
      if (!existing.etag) {
        result.skipped += 1;
        continue;
      }

      const audit: FieldAudit = {};
      const updates: {
        title?: string;
        bucketId?: string | null;
        priority?: number;
        dueDateTime?: string | null;
        percentComplete?: number;
        assignments?: Record<string, any> | null;
      } = {};

      if (existing.title !== task.title) {
        audit.title = { previous: existing.title, applied: task.title, winner: "orbit" };
        updates.title = task.title;
      }
      if ((existing.bucketId ?? null) !== (bucketId ?? null)) {
        audit.bucketId = { previous: existing.bucketId, applied: bucketId, winner: "orbit" };
        updates.bucketId = bucketId;
      }
      if (existing.priority !== priority) {
        audit.priority = { previous: existing.priority, applied: priority, winner: "orbit" };
        updates.priority = priority;
      }
      const existingDue = existing.dueDateTime ?? null;
      if ((existingDue ?? null) !== (dueIso ?? null)) {
        audit.dueDate = { previous: existingDue, applied: dueIso, winner: "orbit" };
        updates.dueDateTime = dueIso;
      }
      if (existing.percentComplete !== percent) {
        audit.status = { previous: existing.percentComplete, applied: percent, winner: "orbit" };
        updates.percentComplete = percent;
      }
      const currentOids = Object.keys(existing.assignments || {});
      const desiredOids = assigneeOid ? [assigneeOid] : [];
      const assignmentsPayload = buildAssignmentsPayload(desiredOids, currentOids);
      if (assignmentsPayload) {
        audit.assignedTo = { previous: currentOids, applied: desiredOids, winner: "orbit" };
        updates.assignments = assignmentsPayload;
      }

      if (Object.keys(updates).length === 0) {
        result.skipped += 1;
        continue;
      }

      const newEtag = await updateTask(token, task.plannerTaskId, existing.etag, updates);
      await db.update(marketingTasks)
        .set({
          plannerEtag: newEtag,
          plannerLastSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(marketingTasks.id, task.id));
      result.updated += 1;
      await logSync({
        planId: plan.id,
        taskId: task.id,
        plannerTaskId: task.plannerTaskId,
        direction: "push",
        fields: audit,
        success: true,
      });
    } catch (err: any) {
      console.error(`[Planner] Push failed for task ${task.id}:`, err.message);
      result.failed += 1;
      result.errors.push({ taskId: task.id, message: err.message || String(err) });
      await logSync({
        planId: plan.id,
        taskId: task.id,
        plannerTaskId: task.plannerTaskId,
        direction: "push",
        success: false,
        errorMessage: err.message,
      });
    }
  }

  const errorSummary = result.errors.length > 0
    ? `${result.errors.length} task(s) failed: ${result.errors.slice(0, 3).map(e => e.message).join("; ")}`
    : null;

  const planUpdate: Partial<InsertMarketingPlan> = {
    plannerLastSyncAt: new Date(),
    plannerLastSyncError: errorSummary,
  };
  await storage.updateMarketingPlan(plan.id, planUpdate, ctx);

  result.ok = result.failed === 0;
  return result;
}

/**
 * Pull a single Planner task by id and reconcile it with its linked Orbit
 * task. Used by the Graph webhook receiver to apply individual change
 * notifications without doing a full plan sweep.
 */
export async function pullAndReconcileTask(
  plannerTaskId: string,
): Promise<{ matched: boolean; updated: boolean; error?: string }> {
  const [orbitTask] = await db.select().from(marketingTasks)
    .where(eq(marketingTasks.plannerTaskId, plannerTaskId));
  if (!orbitTask) return { matched: false, updated: false };

  const plan: MarketingPlan | undefined = await db.query.marketingPlans.findFirst({
    where: (p, { eq }) => eq(p.id, orbitTask.planId),
  });
  if (!plan || !plan.plannerConnectedBy) {
    return { matched: true, updated: false, error: "Plan not connected to Planner" };
  }

  const token = await getValidGraphToken(plan.plannerConnectedBy);
  if (!token) return { matched: true, updated: false, error: "Planner token unavailable" };

  try {
    const pt = await getTask(token, plannerTaskId);
    if (!pt) {
      // Task deleted on Planner — clear linkage so next push recreates it
      await db.update(marketingTasks)
        .set({ plannerTaskId: null, plannerEtag: null, updatedAt: new Date() })
        .where(eq(marketingTasks.id, orbitTask.id));
      await logSync({
        planId: plan.id,
        taskId: orbitTask.id,
        plannerTaskId,
        direction: "webhook",
        fields: {
          deleted: { previous: { plannerTaskId, etag: orbitTask.plannerEtag }, applied: null, winner: "planner" },
        },
        success: true,
      });
      return { matched: true, updated: true };
    }

    // Last-write-wins: only apply if Planner is the newer side.
    if (chooseWinner(pt, orbitTask) !== "planner") {
      return { matched: true, updated: false };
    }
    const { updates, audit } = await diffPlannerToOrbit(pt, orbitTask);
    if (Object.keys(audit).length === 0) {
      return { matched: true, updated: false };
    }

    await db.update(marketingTasks)
      .set({ ...updates, plannerLastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(marketingTasks.id, orbitTask.id));
    await logSync({
      planId: plan.id,
      taskId: orbitTask.id,
      plannerTaskId,
      direction: "webhook",
      fields: audit,
      success: true,
    });
    return { matched: true, updated: true };
  } catch (err: any) {
    await logSync({
      planId: plan.id,
      taskId: orbitTask.id,
      plannerTaskId,
      direction: "webhook",
      success: false,
      errorMessage: err.message,
    });
    return { matched: true, updated: false, error: err.message };
  }
}

export interface QueuedPlannerSync {
  queued: true;
  label: string;
  status: "active" | "pending";
  queuePosition?: number;
  pendingAhead?: number;
}

/**
 * Enqueue a Planner sync for a marketing plan. The HTTP request returns
 * immediately with the queue label; the caller polls
 * `/api/queue/job-status?label=...` to observe progress, and the existing
 * `plannerLastSyncAt` / `plannerLastSyncError` fields on the plan capture
 * the final outcome (which is also reflected on the sync banner).
 *
 * If a sync for this plan is already queued or running, that existing job
 * is returned instead of stacking duplicates — the queue's retry / DLQ
 * handling will surface any failure.
 */
export function queuePlannerSyncForPlan(
  planId: string,
  ctx: ContextFilter,
): QueuedPlannerSync {
  const label = plannerSyncJobLabel(planId);
  const existing = getJobStatusByLabel(label, ctx.tenantDomain);
  if (existing.status === "active" || existing.status === "pending") {
    return {
      queued: true,
      label,
      status: existing.status,
      queuePosition: existing.queuePosition,
      pendingAhead: existing.pendingAhead,
    };
  }

  const promise = enqueuePlannerSync(
    label,
    async () => {
      try {
        const result = await syncMarketingPlanToPlanner(planId, ctx);
        // Surface partial failure as a thrown error so the queue applies
        // retry/back-off and ultimately moves the job to the DLQ once
        // attempts are exhausted. `syncMarketingPlanToPlanner` has already
        // recorded `plannerLastSyncError` on the plan for the banner.
        if (!result.ok && result.failed > 0) {
          throw new Error(
            `Planner sync completed with ${result.failed} task failure(s): ${result.errors
              .slice(0, 3)
              .map((e) => e.message)
              .join("; ")}`,
          );
        }
        return result;
      } catch (err: any) {
        // Persist the error onto the plan so the banner reflects the
        // failure even when the caller has long since disconnected.
        try {
          await storage.updateMarketingPlan(
            planId,
            { plannerLastSyncError: err?.message || String(err) } as Partial<InsertMarketingPlan>,
            ctx,
          );
        } catch {
          // Swallow secondary error — primary failure already logged.
        }
        throw err;
      }
    },
    {
      ctx: {
        tenantDomain: ctx.tenantDomain,
        targetId: planId,
        targetName: `marketing-plan:${planId}`,
      },
    },
  );
  promise.catch((err) => {
    // Final failure (retries exhausted). The plan's error column has
    // already been updated above; just log so it's visible in console.
    console.error(`[Planner] Queued sync for ${planId} failed permanently:`, err.message);
  });

  // Re-query immediately so the caller sees the real initial state — the
  // job may already be active if a queue slot was free.
  const initial = getJobStatusByLabel(label, ctx.tenantDomain);
  return {
    queued: true,
    label,
    status: initial.status === "active" ? "active" : "pending",
    queuePosition: initial.queuePosition,
    pendingAhead: initial.pendingAhead,
  };
}
