/**
 * Marketing Workflow Engine
 *
 * Durable multi-step automation engine for marketing contacts.
 * Modeled on the cadence-core/cadence-service patterns: pure state logic
 * lives here; side-effects (email send, Planner task, notification) are
 * delegated to the appropriate existing services.
 *
 * Key concepts:
 *   - A **workflow** has a trigger and an ordered list of steps.
 *   - An **enrollment** tracks one contact's position in a workflow.
 *   - `advanceEnrollment()` executes the current step and transitions to the next,
 *     persisting a step_run row for every execution.
 *   - Wait steps schedule a future advance via `nextRunAt` rather than
 *     blocking; the scheduled-jobs sweep calls `tickWorkflowEngine()`.
 *   - Branch steps evaluate a condition and route to the yes/no next step.
 *
 * Step types supported:
 *   send_email   — delegates to email-campaign-sender (single contact send)
 *   wait         — sets nextRunAt and returns; the tick picks it up later
 *   branch       — evaluates config.condition against the contact, routes
 *   set_property — updates marketing_contacts field
 *   create_task  — creates a marketing_tasks row (Planner-compatible)
 *   notify       — creates in-app notifications via notification-service
 */

import { db } from "../db";
import {
  marketingWorkflows,
  marketingWorkflowSteps,
  marketingWorkflowEnrollments,
  marketingWorkflowStepRuns,
  marketingContacts,
  marketingSegmentMembers,
  type MarketingWorkflow,
  type MarketingWorkflowStep,
  type MarketingWorkflowEnrollment,
} from "@shared/schema";
import { and, eq, lte, sql } from "drizzle-orm";
import { createNotification } from "./notification-service";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkflowTrigger =
  | { type: "segment_membership"; segmentId: string }
  | { type: "contact_event"; eventType: string }
  | { type: "lead_score_threshold"; threshold: number; direction: "above" | "below" }
  | { type: "manual" };

export type StepConfig =
  | { stepType: "send_email"; generatedEmailId: string }
  | { stepType: "wait"; amount: number; unit: "hours" | "days" }
  | { stepType: "branch"; condition: Record<string, any> }
  | { stepType: "set_property"; field: string; value: string }
  | { stepType: "create_task"; title: string; description?: string; assigneeUserId?: string }
  | { stepType: "notify"; message: string; targetUserIds?: string[] };

export interface AdvanceResult {
  enrollmentId: string;
  stepId: string | null;
  stepType: string | null;
  outcome: "completed" | "waiting" | "branched" | "exited" | "error";
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sentinel stored in currentStepId when all steps have been queued but the
 * final wait/branch has not yet elapsed.  The tick will complete the enrollment
 * when it finds a non-null currentStepId that matches no real step.
 */
const AWAITING_COMPLETION = "__complete_after_wait__";

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

function unitToMs(amount: number, unit: "hours" | "days"): number {
  return unit === "hours" ? amount * 60 * 60 * 1000 : amount * 24 * 60 * 60 * 1000;
}

/** Evaluate a simple branch condition against a contact row. */
function evaluateCondition(condition: any, contact: any): boolean {
  if (!condition || !condition.field) return true;
  const { field, op, value } = condition;
  const contactVal = (contact as any)[field];
  if (op === "eq") return String(contactVal) === String(value);
  if (op === "neq") return String(contactVal) !== String(value);
  if (op === "contains") return String(contactVal ?? "").toLowerCase().includes(String(value).toLowerCase());
  if (op === "gte") return Number(contactVal) >= Number(value);
  if (op === "lte") return Number(contactVal) <= Number(value);
  if (op === "is_null") return contactVal == null;
  if (op === "is_not_null") return contactVal != null;
  return false;
}

/** Ordered steps for a workflow (sorted by stepOrder). */
async function loadSteps(workflowId: string): Promise<MarketingWorkflowStep[]> {
  return db
    .select()
    .from(marketingWorkflowSteps)
    .where(eq(marketingWorkflowSteps.workflowId, workflowId))
    .orderBy(marketingWorkflowSteps.stepOrder);
}

/** Persist a step_run row. */
async function recordStepRun(
  enrollmentId: string,
  stepId: string,
  outcome: Record<string, any> | null,
  error?: string,
): Promise<void> {
  await db.insert(marketingWorkflowStepRuns).values({
    enrollmentId,
    stepId,
    ranAt: new Date(),
    outcomeJson: outcome,
    error: error ?? null,
  });
}

// ─── Step Executors ───────────────────────────────────────────────────────────

async function executeSendEmail(
  step: MarketingWorkflowStep,
  enrollment: MarketingWorkflowEnrollment,
  contact: any,
): Promise<{ ok: boolean; outcome: any; error?: string }> {
  try {
    const cfg = step.configJson as any;
    if (!cfg.generatedEmailId) {
      return { ok: false, outcome: null, error: "send_email step missing generatedEmailId" };
    }
    // Delegate to email-campaign-sender: single test-recipient send to contact email.
    // Import lazily to avoid circular dependency at module load.
    const { dispatchEmailSend } = await import("./email-campaign-sender");
    const { generatedEmails } = await import("@shared/schema");
    // Scope fetch to tenant to prevent cross-tenant email use
    const [emailRow] = await db
      .select()
      .from(generatedEmails)
      .where(
        and(
          eq(generatedEmails.id, cfg.generatedEmailId),
          eq(generatedEmails.tenantDomain, enrollment.tenantDomain),
        ),
      );
    if (!emailRow) {
      return { ok: false, outcome: null, error: `Email ${cfg.generatedEmailId} not found for this tenant` };
    }
    const baseUrl = process.env.PUBLIC_APP_URL || "https://localhost:5000";
    const result = await dispatchEmailSend({
      tenantDomain: enrollment.tenantDomain,
      marketId: null,
      email: emailRow,
      testRecipient: contact.email,
      createdBy: "workflow",
      baseUrl,
    });
    return { ok: !result.errorMessage, outcome: { sendId: result.send?.id, sentCount: result.sentCount }, error: result.errorMessage };
  } catch (err: any) {
    return { ok: false, outcome: null, error: err?.message ?? String(err) };
  }
}

async function executeSetProperty(
  step: MarketingWorkflowStep,
  enrollment: MarketingWorkflowEnrollment,
): Promise<{ ok: boolean; outcome: any; error?: string }> {
  try {
    const cfg = step.configJson as any;
    const ALLOWED_FIELDS: Record<string, boolean> = {
      lifecycleStage: true,
      company: true,
      jobTitle: true,
      country: true,
      source: true,
    };
    if (!cfg.field || !ALLOWED_FIELDS[cfg.field]) {
      return { ok: false, outcome: null, error: `set_property: field '${cfg.field}' is not allowed` };
    }
    await db
      .update(marketingContacts)
      .set({ [cfg.field]: cfg.value, updatedAt: new Date() })
      .where(eq(marketingContacts.id, enrollment.contactId));
    return { ok: true, outcome: { field: cfg.field, value: cfg.value } };
  } catch (err: any) {
    return { ok: false, outcome: null, error: err?.message ?? String(err) };
  }
}

async function executeCreateTask(
  step: MarketingWorkflowStep,
  enrollment: MarketingWorkflowEnrollment,
  contact: any,
): Promise<{ ok: boolean; outcome: any; error?: string }> {
  try {
    const cfg = step.configJson as any;
    const title: string = cfg.title ?? "Workflow task";
    const description: string = cfg.description ?? "";
    const assigneeUserId: string | undefined = cfg.assigneeUserId;

    // Persist as an in-app notification to the assignee (or tenant admins).
    const { users } = await import("@shared/schema");
    let targetUserIds: string[] = [];

    if (assigneeUserId) {
      // Verify the assignee belongs to this tenant before using their ID
      const tenantCheck = await db
        .select({ id: users.id })
        .from(users)
        .where(
          sql`${users.id} = ${assigneeUserId}
              AND lower(split_part(${users.email}, '@', 2)) = lower(${enrollment.tenantDomain})
              AND ${users.status} = 'active'`,
        )
        .limit(1);
      if (tenantCheck.length > 0) targetUserIds = [tenantCheck[0].id];
    }

    if (targetUserIds.length === 0) {
      const admins = await db
        .select({ id: users.id })
        .from(users)
        .where(
          sql`lower(split_part(${users.email}, '@', 2)) = lower(${enrollment.tenantDomain})
              AND ${users.role} IN ('Domain Admin', 'Global Admin')
              AND ${users.status} = 'active'`,
        )
        .limit(5);
      targetUserIds = admins.map((u) => u.id);
    }

    for (const userId of targetUserIds) {
      await createNotification({
        userId,
        tenantDomain: enrollment.tenantDomain,
        type: "action_item_assigned",
        title: `Workflow task: ${title.slice(0, 120)}`,
        message: description ? description.slice(0, 500) : `Created by workflow for contact ${enrollment.contactId}`,
        link: `/app/marketing/workflows`,
        readAt: null,
      });
    }

    return { ok: true, outcome: { title, notified: targetUserIds.length } };
  } catch (err: any) {
    return { ok: false, outcome: null, error: err?.message ?? String(err) };
  }
}

async function executeNotify(
  step: MarketingWorkflowStep,
  enrollment: MarketingWorkflowEnrollment,
): Promise<{ ok: boolean; outcome: any; error?: string }> {
  try {
    const cfg = step.configJson as any;
    const message: string = cfg.message ?? "Workflow notification";
    const rawTargetIds: string[] = cfg.targetUserIds ?? [];

    const { users } = await import("@shared/schema");
    let userIds: string[] = [];

    if (rawTargetIds.length > 0) {
      // Verify all explicitly-configured target users belong to this tenant
      const verified = await db
        .select({ id: users.id })
        .from(users)
        .where(
          sql`${users.id} = ANY(ARRAY[${sql.raw(rawTargetIds.slice(0, 20).map(() => "?").join(","))}]::text[])
              AND lower(split_part(${users.email}, '@', 2)) = lower(${enrollment.tenantDomain})
              AND ${users.status} = 'active'`,
        );
      // Fallback: sequential ID check (works with Drizzle param binding)
      userIds = [];
      for (const uid of rawTargetIds.slice(0, 20)) {
        const [u] = await db.select({ id: users.id }).from(users).where(
          sql`${users.id} = ${uid}
              AND lower(split_part(${users.email}, '@', 2)) = lower(${enrollment.tenantDomain})
              AND ${users.status} = 'active'`,
        ).limit(1);
        if (u) userIds.push(u.id);
      }
    }

    if (userIds.length === 0) {
      // Default to Domain / Global Admins of this tenant
      const admins = await db
        .select({ id: users.id })
        .from(users)
        .where(
          sql`lower(split_part(${users.email}, '@', 2)) = lower(${enrollment.tenantDomain})
              AND ${users.role} IN ('Domain Admin', 'Global Admin')
              AND ${users.status} = 'active'`,
        )
        .limit(20);
      userIds = admins.map((r) => r.id);
    }

    for (const userId of userIds) {
      await createNotification({
        userId,
        tenantDomain: enrollment.tenantDomain,
        type: "job_complete",
        title: "Workflow notification",
        message: message.slice(0, 500),
        link: `/app/marketing/workflows`,
        readAt: null,
      });
    }
    return { ok: true, outcome: { notified: userIds.length } };
  } catch (err: any) {
    return { ok: false, outcome: null, error: err?.message ?? String(err) };
  }
}

// ─── Core advance function ────────────────────────────────────────────────────

/**
 * Execute the current step for an enrollment and transition to the next step.
 * - wait steps: set nextRunAt and return outcome="waiting"
 * - branch steps: evaluate condition, pick yes or no arm
 * - all other steps: execute the action, advance to next by stepOrder
 * - when no more steps remain: mark enrollment completed
 */
export async function advanceEnrollment(enrollmentId: string): Promise<AdvanceResult> {
  const [enrollment] = await db
    .select()
    .from(marketingWorkflowEnrollments)
    .where(eq(marketingWorkflowEnrollments.id, enrollmentId));

  if (!enrollment) {
    return { enrollmentId, stepId: null, stepType: null, outcome: "error", error: "Enrollment not found" };
  }

  if (enrollment.status !== "active") {
    return { enrollmentId, stepId: enrollment.currentStepId, stepType: null, outcome: "exited" };
  }

  const [contact] = await db
    .select()
    .from(marketingContacts)
    .where(eq(marketingContacts.id, enrollment.contactId));

  if (!contact) {
    await db.update(marketingWorkflowEnrollments).set({
      status: "exited",
      exitedAt: new Date(),
      exitReason: "contact_not_found",
      updatedAt: new Date(),
    }).where(eq(marketingWorkflowEnrollments.id, enrollmentId));
    return { enrollmentId, stepId: null, stepType: null, outcome: "exited", error: "Contact not found" };
  }

  const steps = await loadSteps(enrollment.workflowId);
  if (steps.length === 0) {
    // No steps — immediately complete
    await db.update(marketingWorkflowEnrollments).set({
      status: "completed",
      completedAt: new Date(),
      currentStepId: null,
      nextRunAt: null,
      updatedAt: new Date(),
    }).where(eq(marketingWorkflowEnrollments.id, enrollmentId));
    return { enrollmentId, stepId: null, stepType: null, outcome: "completed" };
  }

  // Determine which step to run next
  let step: MarketingWorkflowStep | undefined;
  if (enrollment.currentStepId) {
    if (enrollment.currentStepId === AWAITING_COMPLETION) {
      // A terminal wait/branch already recorded its step_run; the delay has
      // now elapsed — complete the enrollment.
      await db.update(marketingWorkflowEnrollments).set({
        status: "completed",
        completedAt: new Date(),
        currentStepId: null,
        nextRunAt: null,
        updatedAt: new Date(),
      }).where(eq(marketingWorkflowEnrollments.id, enrollmentId));
      return { enrollmentId, stepId: null, stepType: null, outcome: "completed" };
    }
    // Find the step we're pointing at
    step = steps.find((s) => s.id === enrollment.currentStepId);
  } else {
    // First run: start at the first step
    step = steps[0];
  }

  if (!step) {
    // currentStepId set to an unknown ID — treat as completed (safety fallback)
    await db.update(marketingWorkflowEnrollments).set({
      status: "completed",
      completedAt: new Date(),
      nextRunAt: null,
      updatedAt: new Date(),
    }).where(eq(marketingWorkflowEnrollments.id, enrollmentId));
    return { enrollmentId, stepId: null, stepType: null, outcome: "completed" };
  }

  // ── Execute the step ────────────────────────────────────────────────────────

  const now = new Date();

  if (step.stepType === "wait") {
    const cfg = step.configJson as any;
    const amount = Number(cfg.amount ?? 1);
    const unit = (cfg.unit ?? "days") as "hours" | "days";
    const nextRunAt = addMs(now, unitToMs(amount, unit));

    // Advance currentStepId to the next step after the wait.
    // If this is the terminal wait, store the sentinel so the tick can
    // complete the enrollment once the delay has elapsed rather than
    // completing immediately (which would ignore the configured delay).
    const nextStep = resolveNextStep(steps, step, null);
    const nextStepId = nextStep?.id ?? AWAITING_COMPLETION;

    await recordStepRun(enrollmentId, step.id, { scheduledFor: nextRunAt.toISOString() });
    await db.update(marketingWorkflowEnrollments).set({
      currentStepId: nextStepId,
      nextRunAt,
      updatedAt: now,
    }).where(eq(marketingWorkflowEnrollments.id, enrollmentId));

    return { enrollmentId, stepId: step.id, stepType: "wait", outcome: "waiting" };
  }

  if (step.stepType === "branch") {
    const cfg = step.configJson as any;
    const condMet = evaluateCondition(cfg.condition, contact);
    const nextStepId = condMet ? (step.nextStepId ?? null) : (step.branchNoStepId ?? null);
    const nextStep = nextStepId ? steps.find((s) => s.id === nextStepId) : resolveNextStep(steps, step, null);
    // Terminal branch: store sentinel so subsequent advance completes properly
    const resolvedNextStepId = nextStep?.id ?? AWAITING_COMPLETION;

    await recordStepRun(enrollmentId, step.id, { conditionMet: condMet, branchTo: nextStep?.id ?? "completed" });
    await db.update(marketingWorkflowEnrollments).set({
      currentStepId: resolvedNextStepId,
      nextRunAt: null,
      updatedAt: now,
    }).where(eq(marketingWorkflowEnrollments.id, enrollmentId));

    if (!nextStep) {
      // No wait needed — complete immediately via the sentinel check on next advance
      // But branch has no delay, so complete now
      await db.update(marketingWorkflowEnrollments).set({
        status: "completed",
        completedAt: now,
        currentStepId: null,
        nextRunAt: null,
        updatedAt: now,
      }).where(eq(marketingWorkflowEnrollments.id, enrollmentId));
    }

    return { enrollmentId, stepId: step.id, stepType: "branch", outcome: "branched" };
  }

  // Action steps: send_email, set_property, create_task, notify
  let execResult: { ok: boolean; outcome: any; error?: string } = { ok: true, outcome: null };

  if (step.stepType === "send_email") {
    execResult = await executeSendEmail(step, enrollment, contact);
  } else if (step.stepType === "set_property") {
    execResult = await executeSetProperty(step, enrollment);
  } else if (step.stepType === "create_task") {
    execResult = await executeCreateTask(step, enrollment, contact);
  } else if (step.stepType === "notify") {
    execResult = await executeNotify(step, enrollment);
  } else {
    execResult = { ok: false, outcome: null, error: `Unknown step type: ${step.stepType}` };
  }

  await recordStepRun(enrollmentId, step.id, execResult.outcome, execResult.error);

  // Advance to next step
  const nextStep = resolveNextStep(steps, step, null);

  if (!nextStep) {
    await db.update(marketingWorkflowEnrollments).set({
      status: "completed",
      completedAt: now,
      currentStepId: null,
      nextRunAt: null,
      updatedAt: now,
    }).where(eq(marketingWorkflowEnrollments.id, enrollmentId));
    return { enrollmentId, stepId: step.id, stepType: step.stepType, outcome: "completed" };
  }

  await db.update(marketingWorkflowEnrollments).set({
    currentStepId: nextStep.id,
    nextRunAt: null,
    updatedAt: now,
  }).where(eq(marketingWorkflowEnrollments.id, enrollmentId));

  // For non-wait steps, immediately advance to the next step
  return advanceEnrollment(enrollmentId);
}

/** Resolve the next step after the current one by stepOrder. */
function resolveNextStep(
  steps: MarketingWorkflowStep[],
  current: MarketingWorkflowStep,
  explicitNextId: string | null,
): MarketingWorkflowStep | undefined {
  if (explicitNextId) return steps.find((s) => s.id === explicitNextId);
  const currentIndex = steps.findIndex((s) => s.id === current.id);
  return steps[currentIndex + 1];
}

// ─── Enrollment ───────────────────────────────────────────────────────────────

/**
 * Enroll a contact in a workflow, respecting the re-enrollment policy.
 * Returns null when enrollment is skipped (already enrolled, policy = never, etc.).
 */
export async function enrollContact(
  workflowId: string,
  contactId: string,
  tenantDomain: string,
): Promise<MarketingWorkflowEnrollment | null> {
  const [workflow] = await db
    .select()
    .from(marketingWorkflows)
    .where(and(eq(marketingWorkflows.id, workflowId), eq(marketingWorkflows.tenantDomain, tenantDomain)));

  if (!workflow || workflow.status !== "active") return null;

  // Security: verify the contact belongs to this tenant before enrolling
  const [contactCheck] = await db
    .select({ id: marketingContacts.id })
    .from(marketingContacts)
    .where(
      and(
        eq(marketingContacts.id, contactId),
        eq(marketingContacts.tenantDomain, tenantDomain),
      ),
    );
  if (!contactCheck) return null;

  // Re-enrollment policy check
  const existing = await db
    .select()
    .from(marketingWorkflowEnrollments)
    .where(
      and(
        eq(marketingWorkflowEnrollments.workflowId, workflowId),
        eq(marketingWorkflowEnrollments.contactId, contactId),
      ),
    )
    .orderBy(sql`enrolled_at DESC`)
    .limit(1);

  const lastEnrollment = existing[0];

  if (lastEnrollment) {
    const policy = workflow.reEnrollPolicy;
    if (policy === "never") return null;
    if (policy === "always") {
      // Exit the current active enrollment first
      if (lastEnrollment.status === "active") {
        await db.update(marketingWorkflowEnrollments).set({
          status: "exited",
          exitedAt: new Date(),
          exitReason: "re_enrolled",
          updatedAt: new Date(),
        }).where(eq(marketingWorkflowEnrollments.id, lastEnrollment.id));
      }
    }
    if (policy === "once_per_days" && workflow.reEnrollDays) {
      const daysSince = (Date.now() - new Date(lastEnrollment.enrolledAt).getTime()) / (24 * 60 * 60 * 1000);
      if (daysSince < workflow.reEnrollDays) return null;
    }
  }

  const steps = await loadSteps(workflowId);
  const firstStep = steps[0] ?? null;

  const [enrollment] = await db.insert(marketingWorkflowEnrollments).values({
    workflowId,
    contactId,
    tenantDomain,
    currentStepId: firstStep?.id ?? null,
    status: "active",
    enrolledAt: new Date(),
    nextRunAt: null,
  }).returning();

  return enrollment;
}

// ─── Trigger evaluation ───────────────────────────────────────────────────────

/**
 * Evaluate segment-membership triggers for a single tenant:
 * find all active workflows with segment_membership triggers, then enroll
 * segment members who aren't already actively enrolled.
 */
export async function evaluateSegmentTriggers(tenantDomain: string): Promise<number> {
  const workflows = await db
    .select()
    .from(marketingWorkflows)
    .where(and(eq(marketingWorkflows.tenantDomain, tenantDomain), eq(marketingWorkflows.status, "active")));

  let enrolled = 0;
  for (const wf of workflows) {
    const trigger = wf.triggerJson as any;
    if (trigger?.type !== "segment_membership" || !trigger.segmentId) continue;

    // Get all contacts in this segment
    const members = await db
      .select({ contactId: marketingSegmentMembers.contactId })
      .from(marketingSegmentMembers)
      .where(eq(marketingSegmentMembers.segmentId, trigger.segmentId));

    for (const { contactId } of members) {
      const e = await enrollContact(wf.id, contactId, tenantDomain);
      if (e) {
        enrolled++;
        // Fire the first advance immediately for non-wait steps
        await advanceEnrollment(e.id).catch((err) =>
          console.error(`[WorkflowEngine] advance failed for enrollment ${e.id}:`, err?.message),
        );
      }
    }
  }

  return enrolled;
}

/**
 * Fire the workflow engine for a contact event (form_submit, link_click, etc.).
 * Called from the contact event ingest endpoint.
 */
export async function fireContactEvent(
  tenantDomain: string,
  contactId: string,
  eventType: string,
): Promise<void> {
  const workflows = await db
    .select()
    .from(marketingWorkflows)
    .where(and(eq(marketingWorkflows.tenantDomain, tenantDomain), eq(marketingWorkflows.status, "active")));

  for (const wf of workflows) {
    const trigger = wf.triggerJson as any;
    if (trigger?.type !== "contact_event") continue;
    if (trigger.eventType !== eventType && trigger.eventType !== "*") continue;

    const e = await enrollContact(wf.id, contactId, tenantDomain);
    if (e) {
      await advanceEnrollment(e.id).catch((err) =>
        console.error(`[WorkflowEngine] advance failed for enrollment ${e.id}:`, err?.message),
      );
    }
  }
}

// ─── Scheduled tick ───────────────────────────────────────────────────────────

export interface WorkflowTickResult {
  enrollmentsAdvanced: number;
  enrollmentsCompleted: number;
  errors: number;
}

/**
 * Advance all enrollments whose nextRunAt is in the past.
 * Called by the scheduled-jobs sweep on a short interval (e.g. every minute).
 *
 * Uses an atomic UPDATE ... FOR UPDATE SKIP LOCKED pattern to prevent
 * duplicate execution when multiple app instances run concurrently.
 */
export async function tickWorkflowEngine(): Promise<WorkflowTickResult> {
  const now = new Date();
  const result: WorkflowTickResult = { enrollmentsAdvanced: 0, enrollmentsCompleted: 0, errors: 0 };

  // Atomically claim up to 200 due enrollments by nulling their nextRunAt.
  // The subquery uses FOR UPDATE SKIP LOCKED so a concurrent tick on another
  // instance will skip any row being processed here.
  const claimed = await db.execute<{ id: string }>(sql`
    UPDATE marketing_workflow_enrollments
    SET next_run_at = NULL, updated_at = ${now}
    WHERE id IN (
      SELECT id FROM marketing_workflow_enrollments
      WHERE status = 'active' AND next_run_at <= ${now}
      ORDER BY next_run_at ASC
      LIMIT 200
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);

  const claimedIds = (claimed.rows as { id: string }[]).map((r) => r.id);

  for (const id of claimedIds) {
    try {
      const r = await advanceEnrollment(id);
      result.enrollmentsAdvanced++;
      if (r.outcome === "completed") result.enrollmentsCompleted++;
    } catch (err: any) {
      result.errors++;
      console.error(`[WorkflowEngine] tick error for enrollment ${id}:`, err?.message);
    }
  }

  return result;
}

/**
 * Evaluate lead-score threshold triggers for a single contact after their
 * score changes. Enrolls them in any active workflow whose trigger matches.
 */
export async function evaluateLeadScoreTriggers(
  tenantDomain: string,
  contactId: string,
  newScore: number,
): Promise<void> {
  const workflows = await db
    .select()
    .from(marketingWorkflows)
    .where(and(eq(marketingWorkflows.tenantDomain, tenantDomain), eq(marketingWorkflows.status, "active")));

  for (const wf of workflows) {
    const trigger = wf.triggerJson as any;
    if (trigger?.type !== "lead_score_threshold") continue;
    const threshold = Number(trigger.threshold ?? 0);
    const direction: "above" | "below" = trigger.direction ?? "above";
    const matches = direction === "above" ? newScore >= threshold : newScore <= threshold;
    if (!matches) continue;
    const e = await enrollContact(wf.id, contactId, tenantDomain);
    if (e) {
      advanceEnrollment(e.id).catch((err) =>
        console.error(`[WorkflowEngine] advance failed for enrollment ${e.id}:`, err?.message),
      );
    }
  }
}

/**
 * Sweep all tenants that have active workflows: evaluate segment membership
 * triggers for each. Called by the scheduler on a moderate cadence.
 */
export async function sweepAllTenantWorkflowTriggers(): Promise<void> {
  // Find all distinct tenant domains with active segment-triggered workflows
  const tenants = await db
    .selectDistinct({ tenantDomain: marketingWorkflows.tenantDomain })
    .from(marketingWorkflows)
    .where(
      and(
        eq(marketingWorkflows.status, "active"),
        sql`(${marketingWorkflows.triggerJson}->>'type') = 'segment_membership'`,
      ),
    );

  for (const { tenantDomain } of tenants) {
    await evaluateSegmentTriggers(tenantDomain).catch((err) =>
      console.error(`[WorkflowEngine] segment trigger sweep error for ${tenantDomain}:`, err?.message),
    );
  }
}
