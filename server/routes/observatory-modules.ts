/**
 * Observatory — specialized assessment module routes (workbenches).
 *
 * Six workbenches on top of the Observatory foundation:
 *   - Accessibility Review    (checklist: 12 categories)
 *   - Source Code Review      (checklist: 10 categories + source metadata)
 *   - Penetration Test Mgmt   (pen test records + CVSS findings → shared findings)
 *   - Architecture Review     (checklist: 8 areas + Azure capability checklist)
 *   - Privacy & Compliance    (checklist: 7 areas, mapped to standards library)
 *   - AI Governance           (checklist: 8 areas — AI-enabled applications only)
 *
 * Checklist rows live in obs_review_items (module + category), sharing one
 * link model to findings and evidence so the traceability chain
 * (Application → Version → Assessment → Finding → Evidence) is preserved.
 * Pen-test findings always create/wrap rows in the shared obs_findings table.
 */
import type { Express, Request, Response } from "express";
import { db } from "../db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getRequestContext, ContextError, type RequestContext } from "../context";
import { hasAdminAccess, hasContentAccess, logAiUsage } from "./helpers";
import {
  obsApplications,
  obsAssessments,
  obsFindings,
  obsEvidence,
  obsReviewItems,
  obsReviewItemFindings,
  obsReviewItemEvidence,
  obsSourceReviewMeta,
  obsPenTests,
  obsPenTestFindings,
  obsAuditLogs,
  insertObsSourceReviewMetaSchema,
  insertObsPenTestSchema,
  OBS_REVIEW_MODULES,
  OBS_REVIEW_STATUSES,
  OBS_AZURE_STATUSES,
  OBS_MODULE_CATEGORIES,
  OBS_PEN_TEST_RESULTS,
  OBS_VALIDATION_STATUSES,
  OBS_EXPLOITABILITY_LEVELS,
  OBS_FINDING_SEVERITIES,
  OBS_FINDING_DOMAINS,
  AI_FEATURES,
  type ObsReviewModule,
} from "@shared/schema";
import { z } from "zod";
import { completeForFeature } from "../services/ai-provider";

// ── helpers (mirror server/routes/observatory.ts) ───────────────────────────

async function ctxOr401(req: Request, res: Response): Promise<RequestContext | null> {
  try {
    return await getRequestContext(req);
  } catch (err) {
    if (err instanceof ContextError) {
      res.status(err.status).json({ message: err.message });
      return null;
    }
    throw err;
  }
}

function canWrite(ctx: RequestContext): boolean {
  return hasContentAccess(ctx.userRole);
}

function canDelete(ctx: RequestContext): boolean {
  return hasAdminAccess(ctx.userRole) || hasContentAccess(ctx.userRole);
}

async function audit(
  ctx: RequestContext,
  entityType: string,
  entityId: string,
  action: string,
  summary?: string,
  changes?: Record<string, unknown>,
) {
  try {
    await db.insert(obsAuditLogs).values({
      tenantDomain: ctx.tenantDomain,
      userId: ctx.userId,
      entityType,
      entityId,
      action,
      summary: summary ?? null,
      changes: changes ?? null,
    });
  } catch (err) {
    console.error("[observatory-modules] audit log write failed:", err);
  }
}

const dateish = z.preprocess(
  (v) => (typeof v === "string" && v ? new Date(v) : v === "" ? null : v),
  z.date().nullable().optional(),
);

function handleError(res: Response, err: unknown, what: string) {
  if (err instanceof z.ZodError) {
    return res.status(400).json({ message: `Invalid ${what}`, errors: err.errors });
  }
  console.error(`[observatory-modules] ${what} error:`, err);
  return res.status(500).json({ message: `Failed to process ${what}` });
}

/** Statuses valid for a given module's checklist rows. */
function statusesForModule(module: ObsReviewModule): readonly string[] {
  return module === "architecture_azure" ? OBS_AZURE_STATUSES : OBS_REVIEW_STATUSES;
}

/** Which assessment types each workbench module may be initialized on. */
const MODULE_ASSESSMENT_TYPES: Record<ObsReviewModule, readonly string[]> = {
  accessibility: ["accessibility"],
  source_code: ["security_source_review", "code_quality"],
  architecture: ["architecture_review"],
  architecture_azure: ["architecture_review"],
  privacy: ["privacy_review", "compliance"],
  ai_governance: ["ai_governance"],
};

/** Map a CVSS 3.x base score to an Observatory severity. */
export function severityFromCvss(score: number): (typeof OBS_FINDING_SEVERITIES)[number] {
  if (score >= 9.0) return "Critical";
  if (score >= 7.0) return "High";
  if (score >= 4.0) return "Medium";
  if (score > 0) return "Low";
  return "Informational";
}

async function getTenantAssessment(ctx: RequestContext, assessmentId: string) {
  const [assessment] = await db
    .select()
    .from(obsAssessments)
    .where(and(eq(obsAssessments.id, assessmentId), eq(obsAssessments.tenantDomain, ctx.tenantDomain)));
  return assessment ?? null;
}

// ── route registration ──────────────────────────────────────────────────────

export function registerObservatoryModuleRoutes(app: Express) {
  // ══ Review items (shared checklist model) ═════════════════════════════════

  /**
   * Initialize a workbench: seed the module's default category rows for an
   * assessment. Idempotent — existing rows are kept, missing ones are added.
   * AI Governance can only be initialized for AI-enabled applications.
   */
  app.post("/api/observatory/assessments/:id/review-items/init", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const { module } = z.object({ module: z.enum(OBS_REVIEW_MODULES) }).parse(req.body);
      const assessment = await getTenantAssessment(ctx, req.params.id);
      if (!assessment) return res.status(404).json({ message: "Assessment not found" });

      const allowedTypes = MODULE_ASSESSMENT_TYPES[module];
      if (allowedTypes && !allowedTypes.includes(assessment.type)) {
        return res.status(400).json({
          message: `The ${module} checklist cannot be initialized on a "${assessment.type}" assessment. Expected assessment type: ${allowedTypes.join(" or ")}.`,
        });
      }

      if (module === "ai_governance") {
        const [appRow] = await db
          .select()
          .from(obsApplications)
          .where(and(eq(obsApplications.id, assessment.applicationId), eq(obsApplications.tenantDomain, ctx.tenantDomain)));
        if (!appRow?.aiEnabled) {
          return res.status(400).json({ message: "AI Governance reviews are only available for AI-enabled applications. Flag the application as AI-enabled first." });
        }
      }

      const categories = OBS_MODULE_CATEGORIES[module];
      const inserted = await db
        .insert(obsReviewItems)
        .values(
          categories.map((category, i) => ({
            tenantDomain: ctx.tenantDomain,
            assessmentId: assessment.id,
            module,
            category,
            sortOrder: i,
            createdBy: ctx.userId,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: obsReviewItems.id });
      if (inserted.length > 0) {
        await audit(ctx, "review_item", assessment.id, "create", `Initialized ${module} workbench (${inserted.length} checklist rows)`);
      }
      res.status(201).json({ created: inserted.length });
    } catch (err) {
      handleError(res, err, "workbench init");
    }
  });

  /** List review items for an assessment (optionally one module), with linked finding/evidence summaries. */
  app.get("/api/observatory/assessments/:id/review-items", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    try {
      const assessment = await getTenantAssessment(ctx, req.params.id);
      if (!assessment) return res.status(404).json({ message: "Assessment not found" });
      const conditions = [eq(obsReviewItems.assessmentId, assessment.id)];
      if (typeof req.query.module === "string" && (OBS_REVIEW_MODULES as readonly string[]).includes(req.query.module)) {
        conditions.push(eq(obsReviewItems.module, req.query.module));
      }
      const items = await db
        .select()
        .from(obsReviewItems)
        .where(and(...conditions))
        .orderBy(asc(obsReviewItems.module), asc(obsReviewItems.sortOrder));

      const itemIds = items.map((i) => i.id);
      const findingLinks = itemIds.length
        ? await db
            .select({
              reviewItemId: obsReviewItemFindings.reviewItemId,
              finding: obsFindings,
            })
            .from(obsReviewItemFindings)
            .innerJoin(obsFindings, eq(obsReviewItemFindings.findingId, obsFindings.id))
            .where(inArray(obsReviewItemFindings.reviewItemId, itemIds))
        : [];
      const evidenceLinks = itemIds.length
        ? await db
            .select({
              reviewItemId: obsReviewItemEvidence.reviewItemId,
              evidence: obsEvidence,
            })
            .from(obsReviewItemEvidence)
            .innerJoin(obsEvidence, eq(obsReviewItemEvidence.evidenceId, obsEvidence.id))
            .where(inArray(obsReviewItemEvidence.reviewItemId, itemIds))
        : [];

      res.json(
        items.map((item) => ({
          ...item,
          findings: findingLinks
            .filter((l) => l.reviewItemId === item.id)
            .map((l) => ({ id: l.finding.id, title: l.finding.title, severity: l.finding.severity, status: l.finding.status })),
          evidence: evidenceLinks
            .filter((l) => l.reviewItemId === item.id)
            .map((l) => ({ id: l.evidence.id, title: l.evidence.title, evidenceType: l.evidence.evidenceType })),
        })),
      );
    } catch (err) {
      handleError(res, err, "review items");
    }
  });

  /** Update a checklist row: status, notes, reviewer, reviewedAt. */
  app.patch("/api/observatory/review-items/:id", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const data = z
        .object({
          status: z.string().optional(),
          notes: z.string().nullable().optional(),
          reviewer: z.string().nullable().optional(),
          reviewedAt: dateish,
        })
        .parse(req.body);
      const [existing] = await db
        .select()
        .from(obsReviewItems)
        .where(and(eq(obsReviewItems.id, req.params.id), eq(obsReviewItems.tenantDomain, ctx.tenantDomain)));
      if (!existing) return res.status(404).json({ message: "Review item not found" });
      if (data.status !== undefined) {
        const valid = statusesForModule(existing.module as ObsReviewModule);
        if (!valid.includes(data.status)) {
          return res.status(400).json({ message: `Invalid status. Expected one of: ${valid.join(", ")}` });
        }
      }
      const set: Record<string, unknown> = { ...data, updatedAt: new Date() };
      // Auto-stamp the review date when a status is set and none was provided.
      if (data.status && data.reviewedAt === undefined) set.reviewedAt = new Date();
      const [updated] = await db
        .update(obsReviewItems)
        .set(set)
        .where(eq(obsReviewItems.id, existing.id))
        .returning();
      await audit(ctx, "review_item", updated.id, "update", `${existing.module} · ${existing.category} → ${updated.status}`, { fields: Object.keys(data) });
      res.json(updated);
    } catch (err) {
      handleError(res, err, "review item");
    }
  });

  /** Create a new finding from a checklist row and link it. */
  app.post("/api/observatory/review-items/:id/findings", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const body = z
        .object({
          title: z.string().min(1),
          description: z.string().nullable().optional(),
          severity: z.enum(OBS_FINDING_SEVERITIES).default("Medium"),
          domain: z.enum(OBS_FINDING_DOMAINS),
          recommendation: z.string().nullable().optional(),
          affectedComponent: z.string().nullable().optional(),
          wcagCriterion: z.string().nullable().optional(),
          cweId: z.string().nullable().optional(),
          sourceFile: z.string().nullable().optional(),
          sourceLine: z.number().int().nullable().optional(),
        })
        .parse(req.body);
      const [item] = await db
        .select()
        .from(obsReviewItems)
        .where(and(eq(obsReviewItems.id, req.params.id), eq(obsReviewItems.tenantDomain, ctx.tenantDomain)));
      if (!item) return res.status(404).json({ message: "Review item not found" });
      if (item.module === "source_code" && !body.sourceFile?.trim()) {
        return res.status(400).json({ message: "Source code review findings must include the affected source file." });
      }
      const assessment = await getTenantAssessment(ctx, item.assessmentId);
      if (!assessment) return res.status(404).json({ message: "Assessment not found" });

      const created = await db.transaction(async (tx) => {
        const [finding] = await tx
          .insert(obsFindings)
          .values({
            tenantDomain: ctx.tenantDomain,
            assessmentId: assessment.id,
            applicationId: assessment.applicationId,
            versionId: assessment.versionId,
            title: body.title,
            description: body.description ?? null,
            severity: body.severity,
            domain: body.domain,
            status: "open",
            recommendation: body.recommendation ?? null,
            affectedComponent: body.affectedComponent ?? null,
            wcagCriterion: body.wcagCriterion ?? null,
            cweId: body.cweId ?? null,
            sourceFile: body.sourceFile ?? null,
            sourceLine: body.sourceLine ?? null,
            createdBy: ctx.userId,
          })
          .returning();
        await tx.insert(obsReviewItemFindings).values({ reviewItemId: item.id, findingId: finding.id }).onConflictDoNothing();
        return finding;
      });
      await audit(ctx, "finding", created.id, "create", `Created finding "${created.title}" from ${item.module} · ${item.category}`);
      res.status(201).json(created);
    } catch (err) {
      handleError(res, err, "review item finding");
    }
  });

  /** Link / unlink an existing finding to a checklist row. */
  app.post("/api/observatory/review-items/:id/findings/:findingId", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const [item] = await db
        .select()
        .from(obsReviewItems)
        .where(and(eq(obsReviewItems.id, req.params.id), eq(obsReviewItems.tenantDomain, ctx.tenantDomain)));
      const [finding] = await db
        .select()
        .from(obsFindings)
        .where(and(eq(obsFindings.id, req.params.findingId), eq(obsFindings.tenantDomain, ctx.tenantDomain)));
      if (!item || !finding) return res.status(404).json({ message: "Review item or finding not found" });
      await db.insert(obsReviewItemFindings).values({ reviewItemId: item.id, findingId: finding.id }).onConflictDoNothing();
      await audit(ctx, "review_item", item.id, "link", `Linked finding "${finding.title}" to ${item.module} · ${item.category}`);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err, "review item finding link");
    }
  });

  app.delete("/api/observatory/review-items/:id/findings/:findingId", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const [item] = await db
        .select()
        .from(obsReviewItems)
        .where(and(eq(obsReviewItems.id, req.params.id), eq(obsReviewItems.tenantDomain, ctx.tenantDomain)));
      if (!item) return res.status(404).json({ message: "Review item not found" });
      await db
        .delete(obsReviewItemFindings)
        .where(and(eq(obsReviewItemFindings.reviewItemId, item.id), eq(obsReviewItemFindings.findingId, req.params.findingId)));
      await audit(ctx, "review_item", item.id, "unlink", "Unlinked finding from checklist row");
      res.json({ success: true });
    } catch (err) {
      handleError(res, err, "review item finding unlink");
    }
  });

  /** Link / unlink evidence to a checklist row. */
  app.post("/api/observatory/review-items/:id/evidence/:evidenceId", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const [item] = await db
        .select()
        .from(obsReviewItems)
        .where(and(eq(obsReviewItems.id, req.params.id), eq(obsReviewItems.tenantDomain, ctx.tenantDomain)));
      const [ev] = await db
        .select()
        .from(obsEvidence)
        .where(and(eq(obsEvidence.id, req.params.evidenceId), eq(obsEvidence.tenantDomain, ctx.tenantDomain)));
      if (!item || !ev) return res.status(404).json({ message: "Review item or evidence not found" });
      await db.insert(obsReviewItemEvidence).values({ reviewItemId: item.id, evidenceId: ev.id }).onConflictDoNothing();
      await audit(ctx, "review_item", item.id, "link", `Linked evidence "${ev.title}" to ${item.module} · ${item.category}`);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err, "review item evidence link");
    }
  });

  app.delete("/api/observatory/review-items/:id/evidence/:evidenceId", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const [item] = await db
        .select()
        .from(obsReviewItems)
        .where(and(eq(obsReviewItems.id, req.params.id), eq(obsReviewItems.tenantDomain, ctx.tenantDomain)));
      if (!item) return res.status(404).json({ message: "Review item not found" });
      await db
        .delete(obsReviewItemEvidence)
        .where(and(eq(obsReviewItemEvidence.reviewItemId, item.id), eq(obsReviewItemEvidence.evidenceId, req.params.evidenceId)));
      await audit(ctx, "review_item", item.id, "unlink", "Unlinked evidence from checklist row");
      res.json({ success: true });
    } catch (err) {
      handleError(res, err, "review item evidence unlink");
    }
  });

  // ══ Source code review metadata ═══════════════════════════════════════════

  app.get("/api/observatory/assessments/:id/source-meta", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    try {
      const assessment = await getTenantAssessment(ctx, req.params.id);
      if (!assessment) return res.status(404).json({ message: "Assessment not found" });
      const [meta] = await db
        .select()
        .from(obsSourceReviewMeta)
        .where(eq(obsSourceReviewMeta.assessmentId, assessment.id));
      res.json(meta ?? null);
    } catch (err) {
      handleError(res, err, "source metadata");
    }
  });

  const sourceMetaBodySchema = insertObsSourceReviewMetaSchema.omit({
    tenantDomain: true,
    assessmentId: true,
    createdBy: true,
  });

  /** Upsert (one row per assessment). */
  app.put("/api/observatory/assessments/:id/source-meta", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const data = sourceMetaBodySchema.parse(req.body);
      const assessment = await getTenantAssessment(ctx, req.params.id);
      if (!assessment) return res.status(404).json({ message: "Assessment not found" });
      const [existing] = await db
        .select()
        .from(obsSourceReviewMeta)
        .where(eq(obsSourceReviewMeta.assessmentId, assessment.id));
      let row;
      if (existing) {
        [row] = await db
          .update(obsSourceReviewMeta)
          .set({ ...data, updatedAt: new Date() })
          .where(eq(obsSourceReviewMeta.id, existing.id))
          .returning();
      } else {
        [row] = await db
          .insert(obsSourceReviewMeta)
          .values({ ...data, tenantDomain: ctx.tenantDomain, assessmentId: assessment.id, createdBy: ctx.userId })
          .returning();
      }
      await audit(ctx, "source_meta", row.id, existing ? "update" : "create", `Source review metadata for "${assessment.title}"`);
      res.json(row);
    } catch (err) {
      handleError(res, err, "source metadata");
    }
  });

  // ══ Penetration tests ═════════════════════════════════════════════════════

  app.get("/api/observatory/pen-tests", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    try {
      const rows = await db
        .select({
          penTest: obsPenTests,
          assessment: obsAssessments,
          application: obsApplications,
          findingCount: sql<number>`(select count(*)::int from obs_pen_test_findings ptf where ptf.pen_test_id = ${obsPenTests.id})`,
        })
        .from(obsPenTests)
        .innerJoin(obsAssessments, eq(obsPenTests.assessmentId, obsAssessments.id))
        .innerJoin(obsApplications, eq(obsAssessments.applicationId, obsApplications.id))
        .where(eq(obsPenTests.tenantDomain, ctx.tenantDomain))
        .orderBy(desc(obsPenTests.createdAt));
      res.json(
        rows.map((r) => ({
          ...r.penTest,
          assessmentTitle: r.assessment.title,
          applicationId: r.application.id,
          applicationName: r.application.name,
          findingCount: r.findingCount,
        })),
      );
    } catch (err) {
      handleError(res, err, "pen tests");
    }
  });

  const penTestBodySchema = insertObsPenTestSchema
    .omit({ tenantDomain: true, createdBy: true })
    .extend({ startDate: dateish, endDate: dateish });

  function validatePenTestEnums(data: { result?: string | null }, res: Response): boolean {
    if (data.result && !(OBS_PEN_TEST_RESULTS as readonly string[]).includes(data.result)) {
      res.status(400).json({ message: `Invalid result. Expected one of: ${OBS_PEN_TEST_RESULTS.join(", ")}` });
      return false;
    }
    return true;
  }

  app.post("/api/observatory/pen-tests", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const data = penTestBodySchema.parse(req.body);
      if (!validatePenTestEnums(data, res)) return;
      const assessment = await getTenantAssessment(ctx, data.assessmentId);
      if (!assessment) return res.status(404).json({ message: "Assessment not found" });
      const [existing] = await db.select().from(obsPenTests).where(eq(obsPenTests.assessmentId, assessment.id));
      if (existing) return res.status(409).json({ message: "This assessment already has a pen test record" });
      const [created] = await db
        .insert(obsPenTests)
        .values({ ...data, tenantDomain: ctx.tenantDomain, createdBy: ctx.userId })
        .returning();
      await audit(ctx, "pen_test", created.id, "create", `Created pen test "${created.testName}"`);
      res.status(201).json(created);
    } catch (err) {
      handleError(res, err, "pen test");
    }
  });

  app.get("/api/observatory/pen-tests/:id", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    try {
      const [row] = await db
        .select({ penTest: obsPenTests, assessment: obsAssessments, application: obsApplications })
        .from(obsPenTests)
        .innerJoin(obsAssessments, eq(obsPenTests.assessmentId, obsAssessments.id))
        .innerJoin(obsApplications, eq(obsAssessments.applicationId, obsApplications.id))
        .where(and(eq(obsPenTests.id, req.params.id), eq(obsPenTests.tenantDomain, ctx.tenantDomain)));
      if (!row) return res.status(404).json({ message: "Pen test not found" });
      const findings = await db
        .select({ ext: obsPenTestFindings, finding: obsFindings })
        .from(obsPenTestFindings)
        .innerJoin(obsFindings, eq(obsPenTestFindings.findingId, obsFindings.id))
        .where(eq(obsPenTestFindings.penTestId, row.penTest.id))
        .orderBy(desc(obsPenTestFindings.cvssScore));
      res.json({
        ...row.penTest,
        assessment: { id: row.assessment.id, title: row.assessment.title, status: row.assessment.status },
        application: { id: row.application.id, name: row.application.name },
        findings: findings.map((f) => ({ ...f.ext, finding: f.finding })),
      });
    } catch (err) {
      handleError(res, err, "pen test");
    }
  });

  app.patch("/api/observatory/pen-tests/:id", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const data = penTestBodySchema.partial().parse(req.body);
      if (!validatePenTestEnums(data, res)) return;
      delete (data as any).assessmentId;
      const [updated] = await db
        .update(obsPenTests)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(obsPenTests.id, req.params.id), eq(obsPenTests.tenantDomain, ctx.tenantDomain)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Pen test not found" });
      await audit(ctx, "pen_test", updated.id, "update", `Updated pen test "${updated.testName}"`, { fields: Object.keys(data) });
      res.json(updated);
    } catch (err) {
      handleError(res, err, "pen test");
    }
  });

  app.delete("/api/observatory/pen-tests/:id", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canDelete(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const [deleted] = await db
        .delete(obsPenTests)
        .where(and(eq(obsPenTests.id, req.params.id), eq(obsPenTests.tenantDomain, ctx.tenantDomain)))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Pen test not found" });
      await audit(ctx, "pen_test", deleted.id, "delete", `Deleted pen test "${deleted.testName}" (findings remain in the shared register)`);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err, "pen test");
    }
  });

  // ── Pen-test findings (create a shared finding + pen-test extension) ──────

  const penTestFindingBodySchema = z.object({
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    severity: z.enum(OBS_FINDING_SEVERITIES).optional(),
    recommendation: z.string().nullable().optional(),
    affectedComponent: z.string().nullable().optional(),
    stepsToReproduce: z.string().nullable().optional(),
    cweId: z.string().nullable().optional(),
    cvssScore: z.number().min(0).max(10).nullable().optional(),
    cvssVector: z.string().nullable().optional(),
    exploitability: z.enum(OBS_EXPLOITABILITY_LEVELS).nullable().optional(),
    validationStatus: z.enum(OBS_VALIDATION_STATUSES).optional(),
  });

  app.post("/api/observatory/pen-tests/:id/findings", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const body = penTestFindingBodySchema.parse(req.body);
      const [penTest] = await db
        .select()
        .from(obsPenTests)
        .where(and(eq(obsPenTests.id, req.params.id), eq(obsPenTests.tenantDomain, ctx.tenantDomain)));
      if (!penTest) return res.status(404).json({ message: "Pen test not found" });
      const assessment = await getTenantAssessment(ctx, penTest.assessmentId);
      if (!assessment) return res.status(404).json({ message: "Assessment not found" });

      const severity = body.severity ?? (body.cvssScore != null ? severityFromCvss(body.cvssScore) : "Medium");
      const result = await db.transaction(async (tx) => {
        const [finding] = await tx
          .insert(obsFindings)
          .values({
            tenantDomain: ctx.tenantDomain,
            assessmentId: assessment.id,
            applicationId: assessment.applicationId,
            versionId: assessment.versionId,
            title: body.title,
            description: body.description ?? null,
            severity,
            domain: "security",
            status: "open",
            recommendation: body.recommendation ?? null,
            affectedComponent: body.affectedComponent ?? null,
            stepsToReproduce: body.stepsToReproduce ?? null,
            cweId: body.cweId ?? null,
            createdBy: ctx.userId,
          })
          .returning();
        const [ext] = await tx
          .insert(obsPenTestFindings)
          .values({
            tenantDomain: ctx.tenantDomain,
            penTestId: penTest.id,
            findingId: finding.id,
            cvssScore: body.cvssScore ?? null,
            cvssVector: body.cvssVector ?? null,
            exploitability: body.exploitability ?? null,
            validationStatus: body.validationStatus ?? "Not Started",
          })
          .returning();
        return { ...ext, finding };
      });
      await audit(ctx, "finding", result.finding.id, "create", `Pen test finding "${result.finding.title}" (CVSS ${result.cvssScore ?? "—"})`);
      res.status(201).json(result);
    } catch (err) {
      handleError(res, err, "pen test finding");
    }
  });

  /** Update pen-test-specific fields (CVSS, exploitability, validation). Shared finding fields are edited via the findings routes. */
  app.patch("/api/observatory/pen-test-findings/:id", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const data = z
        .object({
          cvssScore: z.number().min(0).max(10).nullable().optional(),
          cvssVector: z.string().nullable().optional(),
          exploitability: z.enum(OBS_EXPLOITABILITY_LEVELS).nullable().optional(),
          validationStatus: z.enum(OBS_VALIDATION_STATUSES).optional(),
          validatedBy: z.string().nullable().optional(),
          validatedAt: dateish,
        })
        .parse(req.body);
      const [existing] = await db
        .select()
        .from(obsPenTestFindings)
        .where(and(eq(obsPenTestFindings.id, req.params.id), eq(obsPenTestFindings.tenantDomain, ctx.tenantDomain)));
      if (!existing) return res.status(404).json({ message: "Pen test finding not found" });
      const set: Record<string, unknown> = { ...data, updatedAt: new Date() };
      if (data.validationStatus && ["Validated", "Failed Validation"].includes(data.validationStatus)) {
        if (data.validatedAt === undefined) set.validatedAt = new Date();
      }
      const updatedRows = await db.transaction(async (tx) => {
        const [updated] = await tx.update(obsPenTestFindings).set(set).where(eq(obsPenTestFindings.id, existing.id)).returning();
        // Keep the shared finding's severity aligned when CVSS changes and no manual severity override is requested.
        if (data.cvssScore != null) {
          await tx
            .update(obsFindings)
            .set({ severity: severityFromCvss(data.cvssScore), updatedAt: new Date() })
            .where(and(eq(obsFindings.id, existing.findingId), eq(obsFindings.tenantDomain, ctx.tenantDomain)));
        }
        return updated;
      });
      await audit(ctx, "pen_test_finding", existing.id, "update", `Updated pen test finding tracking`, { fields: Object.keys(data) });
      res.json(updatedRows);
    } catch (err) {
      handleError(res, err, "pen test finding");
    }
  });

  /** Remove a pen-test finding: deletes the extension row AND the underlying shared finding (created together). */
  app.delete("/api/observatory/pen-test-findings/:id", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canDelete(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const [existing] = await db
        .select()
        .from(obsPenTestFindings)
        .where(and(eq(obsPenTestFindings.id, req.params.id), eq(obsPenTestFindings.tenantDomain, ctx.tenantDomain)));
      if (!existing) return res.status(404).json({ message: "Pen test finding not found" });
      await db
        .delete(obsFindings)
        .where(and(eq(obsFindings.id, existing.findingId), eq(obsFindings.tenantDomain, ctx.tenantDomain)));
      // obs_pen_test_findings row cascades with the finding delete.
      await audit(ctx, "pen_test_finding", existing.id, "delete", "Deleted pen test finding (incl. shared finding)");
      res.json({ success: true });
    } catch (err) {
      handleError(res, err, "pen test finding");
    }
  });

  // ══ AI assist — draft finding description/recommendation from notes ═══════

  app.post("/api/observatory/ai/draft-finding", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const body = z
        .object({
          notes: z.string().min(1),
          module: z.string().optional(),
          category: z.string().optional(),
          applicationName: z.string().optional(),
        })
        .parse(req.body);

      const moduleLabel = (body.module ?? "").replace(/_/g, " ");
      const prompt = `You are an application assurance analyst writing a formal finding for an assessment report.

Context:
- Review area: ${moduleLabel || "general"}${body.category ? ` — ${body.category}` : ""}
- Application: ${body.applicationName ?? "(unnamed application)"}

Reviewer's raw notes:
"""
${body.notes.slice(0, 4000)}
"""

Turn the notes into a structured finding. Respond with ONLY a JSON object (no markdown fences) with exactly these keys:
{
  "title": "concise finding title (max 100 chars)",
  "description": "2-4 sentence formal description of the issue and its impact",
  "recommendation": "2-3 sentence actionable remediation guidance",
  "severity": "one of: Critical, High, Medium, Low, Informational"
}`;

      const result = await completeForFeature(AI_FEATURES.OBSERVATORY_ASSIST, prompt, {
        temperature: 0.3,
        maxTokens: 800,
        tenantDomain: ctx.tenantDomain,
      });
      await logAiUsage(
        ctx,
        "observatory_draft_finding",
        result.provider,
        result.model,
        { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens },
        result.durationMs,
        { module: body.module, category: body.category },
      );

      let parsed: { title?: string; description?: string; recommendation?: string; severity?: string };
      try {
        const cleaned = result.text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        return res.status(502).json({ message: "AI response could not be parsed — please try again." });
      }
      const severity = (OBS_FINDING_SEVERITIES as readonly string[]).includes(parsed.severity ?? "")
        ? parsed.severity
        : "Medium";
      res.json({
        title: String(parsed.title ?? "").slice(0, 200),
        description: String(parsed.description ?? ""),
        recommendation: String(parsed.recommendation ?? ""),
        severity,
      });
    } catch (err) {
      handleError(res, err, "AI finding draft");
    }
  });
}
