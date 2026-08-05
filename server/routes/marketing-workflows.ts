/**
 * Marketing Workflow Routes
 *
 * Endpoints:
 *   GET    /api/marketing-workflows              — list workflows for tenant
 *   POST   /api/marketing-workflows              — create workflow
 *   GET    /api/marketing-workflows/:id          — get workflow + steps
 *   PATCH  /api/marketing-workflows/:id          — update workflow
 *   DELETE /api/marketing-workflows/:id          — delete workflow
 *   PATCH  /api/marketing-workflows/:id/activate — set status=active
 *   PATCH  /api/marketing-workflows/:id/pause    — set status=paused
 *
 *   GET    /api/marketing-workflows/:id/steps             — list steps
 *   POST   /api/marketing-workflows/:id/steps             — add step
 *   PATCH  /api/marketing-workflows/:id/steps/:stepId     — update step
 *   DELETE /api/marketing-workflows/:id/steps/:stepId     — delete step
 *   POST   /api/marketing-workflows/:id/steps/reorder     — reorder steps
 *
 *   GET    /api/marketing-workflows/:id/enrollments       — enrollment list
 *   POST   /api/marketing-workflows/:id/enroll            — manual enroll a contact
 *   DELETE /api/marketing-workflows/:id/enrollments/:eid  — exit an enrollment
 *
 * All routes are gated by the `marketingWorkflows` feature flag.
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { eq, and, desc, asc, count, sql } from "drizzle-orm";
import {
  marketingWorkflows,
  marketingWorkflowSteps,
  marketingWorkflowEnrollments,
  marketingWorkflowStepRuns,
  marketingContacts,
} from "@shared/schema";
import { getRequestContext } from "../context";
import { checkFeatureAccessAsync } from "../services/plan-policy";
import { storage } from "../storage";
import {
  enrollContact,
  advanceEnrollment,
} from "../services/marketing-workflow-service";

// ─── Guard ────────────────────────────────────────────────────────────────────

async function guardWorkflows(req: Request, res: Response): Promise<string | null> {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  try {
    const ctx = await getRequestContext(req);
    const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
    const plan = tenant?.plan ?? "free";
    const gate = await checkFeatureAccessAsync(plan, "marketingWorkflows");
    if (!gate.allowed) {
      res.status(403).json({ error: gate.reason, upgradeRequired: gate.upgradeRequired, requiredPlan: gate.requiredPlan });
      return null;
    }
    return ctx.tenantDomain;
  } catch (err: any) {
    const status = err?.status ?? 500;
    res.status(status).json({ error: status === 401 ? "Not authenticated" : status === 403 ? "Forbidden" : "Internal server error" });
    return null;
  }
}

async function guardWorkflowsAdmin(req: Request, res: Response): Promise<string | null> {
  const tenantDomain = await guardWorkflows(req, res);
  if (!tenantDomain) return null;
  const caller = await storage.getUser(req.session.userId!);
  if (!caller || !["Global Admin", "Domain Admin", "Analyst"].includes(caller.role)) {
    res.status(403).json({ error: "Analyst or Admin access required to manage workflows" });
    return null;
  }
  return tenantDomain;
}

/** Ensure the workflow belongs to this tenant and return it. */
async function loadWorkflow(id: string, tenantDomain: string, res: Response) {
  const [wf] = await db
    .select()
    .from(marketingWorkflows)
    .where(and(eq(marketingWorkflows.id, id), eq(marketingWorkflows.tenantDomain, tenantDomain)));
  if (!wf) {
    res.status(404).json({ error: "Workflow not found" });
    return null;
  }
  return wf;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export function registerMarketingWorkflowRoutes(app: Express) {
  // ── Workflow CRUD ────────────────────────────────────────────────────────

  app.get("/api/marketing-workflows", async (req, res) => {
    const tenantDomain = await guardWorkflows(req, res);
    if (!tenantDomain) return;
    try {
      const rows = await db
        .select()
        .from(marketingWorkflows)
        .where(eq(marketingWorkflows.tenantDomain, tenantDomain))
        .orderBy(desc(marketingWorkflows.updatedAt));

      // Attach enrollment counts
      const enriched = await Promise.all(
        rows.map(async (wf) => {
          const [activeRow] = await db
            .select({ c: sql<number>`count(*)::int` })
            .from(marketingWorkflowEnrollments)
            .where(and(eq(marketingWorkflowEnrollments.workflowId, wf.id), eq(marketingWorkflowEnrollments.status, "active")));
          const [totalRow] = await db
            .select({ c: sql<number>`count(*)::int` })
            .from(marketingWorkflowEnrollments)
            .where(eq(marketingWorkflowEnrollments.workflowId, wf.id));
          const [stepCountRow] = await db
            .select({ c: sql<number>`count(*)::int` })
            .from(marketingWorkflowSteps)
            .where(eq(marketingWorkflowSteps.workflowId, wf.id));
          return {
            ...wf,
            activeEnrollments: activeRow?.c ?? 0,
            totalEnrollments: totalRow?.c ?? 0,
            stepCount: stepCountRow?.c ?? 0,
          };
        }),
      );

      res.json(enriched);
    } catch (err: any) {
      console.error("[marketing-workflows] list error:", err?.message);
      res.status(500).json({ error: "Failed to load workflows" });
    }
  });

  app.post("/api/marketing-workflows", async (req, res) => {
    const tenantDomain = await guardWorkflowsAdmin(req, res);
    if (!tenantDomain) return;
    try {
      const { name, description, triggerJson, reEnrollPolicy, reEnrollDays } = req.body;
      if (!name) return res.status(400).json({ error: "name is required" });

      const [wf] = await db.insert(marketingWorkflows).values({
        tenantDomain,
        name,
        description: description ?? null,
        triggerJson: triggerJson ?? { type: "manual" },
        status: "draft",
        reEnrollPolicy: reEnrollPolicy ?? "never",
        reEnrollDays: reEnrollDays ?? null,
        createdBy: req.session.userId!,
      }).returning();

      res.status(201).json(wf);
    } catch (err: any) {
      console.error("[marketing-workflows] create error:", err?.message);
      res.status(500).json({ error: "Failed to create workflow" });
    }
  });

  app.get("/api/marketing-workflows/:id", async (req, res) => {
    const tenantDomain = await guardWorkflows(req, res);
    if (!tenantDomain) return;
    try {
      const wf = await loadWorkflow(req.params.id, tenantDomain, res);
      if (!wf) return;
      const steps = await db
        .select()
        .from(marketingWorkflowSteps)
        .where(eq(marketingWorkflowSteps.workflowId, wf.id))
        .orderBy(asc(marketingWorkflowSteps.stepOrder));
      res.json({ ...wf, steps });
    } catch (err: any) {
      console.error("[marketing-workflows] get error:", err?.message);
      res.status(500).json({ error: "Failed to load workflow" });
    }
  });

  app.patch("/api/marketing-workflows/:id", async (req, res) => {
    const tenantDomain = await guardWorkflowsAdmin(req, res);
    if (!tenantDomain) return;
    try {
      const wf = await loadWorkflow(req.params.id, tenantDomain, res);
      if (!wf) return;
      const { name, description, triggerJson, reEnrollPolicy, reEnrollDays } = req.body;
      const [updated] = await db.update(marketingWorkflows).set({
        name: name ?? wf.name,
        description: description !== undefined ? description : wf.description,
        triggerJson: triggerJson ?? wf.triggerJson,
        reEnrollPolicy: reEnrollPolicy ?? wf.reEnrollPolicy,
        reEnrollDays: reEnrollDays !== undefined ? reEnrollDays : wf.reEnrollDays,
        updatedAt: new Date(),
      }).where(eq(marketingWorkflows.id, wf.id)).returning();
      res.json(updated);
    } catch (err: any) {
      console.error("[marketing-workflows] patch error:", err?.message);
      res.status(500).json({ error: "Failed to update workflow" });
    }
  });

  app.delete("/api/marketing-workflows/:id", async (req, res) => {
    const tenantDomain = await guardWorkflowsAdmin(req, res);
    if (!tenantDomain) return;
    try {
      const wf = await loadWorkflow(req.params.id, tenantDomain, res);
      if (!wf) return;
      await db.delete(marketingWorkflows).where(eq(marketingWorkflows.id, wf.id));
      res.status(204).end();
    } catch (err: any) {
      console.error("[marketing-workflows] delete error:", err?.message);
      res.status(500).json({ error: "Failed to delete workflow" });
    }
  });

  app.patch("/api/marketing-workflows/:id/activate", async (req, res) => {
    const tenantDomain = await guardWorkflowsAdmin(req, res);
    if (!tenantDomain) return;
    try {
      const wf = await loadWorkflow(req.params.id, tenantDomain, res);
      if (!wf) return;
      const [updated] = await db.update(marketingWorkflows)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(marketingWorkflows.id, wf.id))
        .returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to activate workflow" });
    }
  });

  app.patch("/api/marketing-workflows/:id/pause", async (req, res) => {
    const tenantDomain = await guardWorkflowsAdmin(req, res);
    if (!tenantDomain) return;
    try {
      const wf = await loadWorkflow(req.params.id, tenantDomain, res);
      if (!wf) return;
      const [updated] = await db.update(marketingWorkflows)
        .set({ status: "paused", updatedAt: new Date() })
        .where(eq(marketingWorkflows.id, wf.id))
        .returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to pause workflow" });
    }
  });

  // ── Steps ────────────────────────────────────────────────────────────────

  app.get("/api/marketing-workflows/:id/steps", async (req, res) => {
    const tenantDomain = await guardWorkflows(req, res);
    if (!tenantDomain) return;
    try {
      const wf = await loadWorkflow(req.params.id, tenantDomain, res);
      if (!wf) return;
      const steps = await db
        .select()
        .from(marketingWorkflowSteps)
        .where(eq(marketingWorkflowSteps.workflowId, wf.id))
        .orderBy(asc(marketingWorkflowSteps.stepOrder));
      res.json(steps);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load steps" });
    }
  });

  app.post("/api/marketing-workflows/:id/steps", async (req, res) => {
    const tenantDomain = await guardWorkflowsAdmin(req, res);
    if (!tenantDomain) return;
    try {
      const wf = await loadWorkflow(req.params.id, tenantDomain, res);
      if (!wf) return;
      const { stepType, configJson, stepOrder, nextStepId, branchNoStepId } = req.body;
      if (!stepType) return res.status(400).json({ error: "stepType is required" });

      // Auto-assign order if not provided
      let order = stepOrder;
      if (order == null) {
        const [maxRow] = await db
          .select({ m: sql<number>`coalesce(max(step_order), -1)::int` })
          .from(marketingWorkflowSteps)
          .where(eq(marketingWorkflowSteps.workflowId, wf.id));
        order = (maxRow?.m ?? -1) + 1;
      }

      const [step] = await db.insert(marketingWorkflowSteps).values({
        workflowId: wf.id,
        stepType,
        configJson: configJson ?? {},
        stepOrder: order,
        nextStepId: nextStepId ?? null,
        branchNoStepId: branchNoStepId ?? null,
      }).returning();

      res.status(201).json(step);
    } catch (err: any) {
      console.error("[marketing-workflows] add step error:", err?.message);
      res.status(500).json({ error: "Failed to add step" });
    }
  });

  app.patch("/api/marketing-workflows/:id/steps/:stepId", async (req, res) => {
    const tenantDomain = await guardWorkflowsAdmin(req, res);
    if (!tenantDomain) return;
    try {
      const wf = await loadWorkflow(req.params.id, tenantDomain, res);
      if (!wf) return;
      const [existing] = await db
        .select()
        .from(marketingWorkflowSteps)
        .where(and(eq(marketingWorkflowSteps.id, req.params.stepId), eq(marketingWorkflowSteps.workflowId, wf.id)));
      if (!existing) return res.status(404).json({ error: "Step not found" });

      const { stepType, configJson, stepOrder, nextStepId, branchNoStepId } = req.body;
      const [updated] = await db.update(marketingWorkflowSteps).set({
        stepType: stepType ?? existing.stepType,
        configJson: configJson ?? existing.configJson,
        stepOrder: stepOrder ?? existing.stepOrder,
        nextStepId: nextStepId !== undefined ? nextStepId : existing.nextStepId,
        branchNoStepId: branchNoStepId !== undefined ? branchNoStepId : existing.branchNoStepId,
        updatedAt: new Date(),
      }).where(eq(marketingWorkflowSteps.id, existing.id)).returning();

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to update step" });
    }
  });

  app.delete("/api/marketing-workflows/:id/steps/:stepId", async (req, res) => {
    const tenantDomain = await guardWorkflowsAdmin(req, res);
    if (!tenantDomain) return;
    try {
      const wf = await loadWorkflow(req.params.id, tenantDomain, res);
      if (!wf) return;
      await db.delete(marketingWorkflowSteps).where(
        and(eq(marketingWorkflowSteps.id, req.params.stepId), eq(marketingWorkflowSteps.workflowId, wf.id)),
      );
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ error: "Failed to delete step" });
    }
  });

  /** Reorder: body = { orderedIds: string[] } */
  app.post("/api/marketing-workflows/:id/steps/reorder", async (req, res) => {
    const tenantDomain = await guardWorkflowsAdmin(req, res);
    if (!tenantDomain) return;
    try {
      const wf = await loadWorkflow(req.params.id, tenantDomain, res);
      if (!wf) return;
      const { orderedIds } = req.body;
      if (!Array.isArray(orderedIds)) return res.status(400).json({ error: "orderedIds must be an array" });

      for (let i = 0; i < orderedIds.length; i++) {
        await db.update(marketingWorkflowSteps)
          .set({ stepOrder: i, updatedAt: new Date() })
          .where(and(eq(marketingWorkflowSteps.id, orderedIds[i]), eq(marketingWorkflowSteps.workflowId, wf.id)));
      }
      const steps = await db
        .select()
        .from(marketingWorkflowSteps)
        .where(eq(marketingWorkflowSteps.workflowId, wf.id))
        .orderBy(asc(marketingWorkflowSteps.stepOrder));
      res.json(steps);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to reorder steps" });
    }
  });

  // ── Enrollments ──────────────────────────────────────────────────────────

  app.get("/api/marketing-workflows/:id/enrollments", async (req, res) => {
    const tenantDomain = await guardWorkflows(req, res);
    if (!tenantDomain) return;
    try {
      const wf = await loadWorkflow(req.params.id, tenantDomain, res);
      if (!wf) return;

      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const offset = Number(req.query.offset ?? 0);
      const status = (req.query.status as string) || undefined;

      const conditions = [eq(marketingWorkflowEnrollments.workflowId, wf.id)];
      if (status) conditions.push(eq(marketingWorkflowEnrollments.status, status));

      const rows = await db
        .select()
        .from(marketingWorkflowEnrollments)
        .where(and(...conditions))
        .orderBy(desc(marketingWorkflowEnrollments.enrolledAt))
        .limit(limit)
        .offset(offset);

      // Attach contact name/email — sequential for correctness (page is ≤200 rows)
      const contactIds = [...new Set(rows.map((r) => r.contactId))];
      const contactMap = new Map<string, any>();
      for (const cid of contactIds.slice(0, 200)) {
        const [c] = await db
          .select({ id: marketingContacts.id, firstName: marketingContacts.firstName, lastName: marketingContacts.lastName, email: marketingContacts.email })
          .from(marketingContacts)
          .where(eq(marketingContacts.id, cid));
        if (c) contactMap.set(c.id, c);
      }

      const enriched = rows.map((e) => ({ ...e, contact: contactMap.get(e.contactId) ?? null }));

      const [totalRow] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(marketingWorkflowEnrollments)
        .where(and(...conditions));

      res.json({ enrollments: enriched, total: totalRow?.c ?? 0, limit, offset });
    } catch (err: any) {
      console.error("[marketing-workflows] enrollments error:", err?.message);
      res.status(500).json({ error: "Failed to load enrollments" });
    }
  });

  app.post("/api/marketing-workflows/:id/enroll", async (req, res) => {
    const tenantDomain = await guardWorkflowsAdmin(req, res);
    if (!tenantDomain) return;
    try {
      const wf = await loadWorkflow(req.params.id, tenantDomain, res);
      if (!wf) return;
      const { contactId } = req.body;
      if (!contactId) return res.status(400).json({ error: "contactId is required" });

      const enrollment = await enrollContact(wf.id, contactId, tenantDomain);
      if (!enrollment) {
        return res.status(409).json({ error: "Contact already enrolled (re-enrollment policy prevents re-entry)" });
      }

      // Advance immediately (first non-wait step runs now)
      const result = await advanceEnrollment(enrollment.id);
      res.status(201).json({ enrollment, advance: result });
    } catch (err: any) {
      console.error("[marketing-workflows] enroll error:", err?.message);
      res.status(500).json({ error: "Failed to enroll contact" });
    }
  });

  app.delete("/api/marketing-workflows/:id/enrollments/:eid", async (req, res) => {
    const tenantDomain = await guardWorkflowsAdmin(req, res);
    if (!tenantDomain) return;
    try {
      const wf = await loadWorkflow(req.params.id, tenantDomain, res);
      if (!wf) return;
      const [enrollment] = await db
        .select()
        .from(marketingWorkflowEnrollments)
        .where(and(eq(marketingWorkflowEnrollments.id, req.params.eid), eq(marketingWorkflowEnrollments.workflowId, wf.id)));
      if (!enrollment) return res.status(404).json({ error: "Enrollment not found" });

      await db.update(marketingWorkflowEnrollments).set({
        status: "exited",
        exitedAt: new Date(),
        exitReason: "manual_exit",
        updatedAt: new Date(),
      }).where(eq(marketingWorkflowEnrollments.id, enrollment.id));

      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ error: "Failed to exit enrollment" });
    }
  });

  // ── Step run history ─────────────────────────────────────────────────────

  app.get("/api/marketing-workflows/:id/enrollments/:eid/runs", async (req, res) => {
    const tenantDomain = await guardWorkflows(req, res);
    if (!tenantDomain) return;
    try {
      const wf = await loadWorkflow(req.params.id, tenantDomain, res);
      if (!wf) return;
      const [enrollment] = await db
        .select()
        .from(marketingWorkflowEnrollments)
        .where(and(eq(marketingWorkflowEnrollments.id, req.params.eid), eq(marketingWorkflowEnrollments.workflowId, wf.id)));
      if (!enrollment) return res.status(404).json({ error: "Enrollment not found" });

      const runs = await db
        .select()
        .from(marketingWorkflowStepRuns)
        .where(eq(marketingWorkflowStepRuns.enrollmentId, enrollment.id))
        .orderBy(asc(marketingWorkflowStepRuns.ranAt));

      res.json(runs);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load step runs" });
    }
  });
}
