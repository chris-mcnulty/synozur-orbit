/**
 * Observatory — readiness engine, executive dashboard, reporting engine, and
 * VPAT assistant routes.
 *
 * Readiness: weighted per-version scores with hard blockers (see
 * server/services/observatory-readiness.ts). Reports: async HTML generation
 * through the job queue (202-and-poll) with PDF export via the shared
 * Puppeteer pool. VPAT: per-criterion conformance worksheet backed by the
 * WCAG 2.2 / Section 508 controls in the standards library.
 */
import type { Express, Request, Response } from "express";
import { db } from "../db";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { getRequestContext, ContextError, type RequestContext } from "../context";
import { hasAdminAccess, hasContentAccess } from "./helpers";
import {
  obsApplications,
  obsVersions,
  obsAssessments,
  obsFindings,
  obsPenTests,
  obsReadinessScores,
  obsReports,
  obsVpatEntries,
  obsControls,
  obsFrameworks,
  obsFindingControls,
  obsFindingEvidence,
  obsEvidence,
  obsAuditLogs,
  OBS_REPORT_TYPES,
  OBS_REPORT_TYPE_LABELS,
  OBS_VPAT_CONFORMANCE,
  OBS_VPAT_DISCLAIMER,
  AI_FEATURES,
  type ObsReportType,
  type ObsReadinessBlocker,
} from "@shared/schema";
import { z } from "zod";
import {
  computeReadiness,
  snapshotReadiness,
  computePortfolioReadiness,
} from "../services/observatory-readiness";
import { generateReportAsync, renderReportPdf, renderAccessibilityVpat, loadReportData } from "../services/observatory-report-service";
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
) {
  try {
    await db.insert(obsAuditLogs).values({
      tenantDomain: ctx.tenantDomain,
      userId: ctx.userId,
      entityType,
      entityId,
      action,
      summary: summary ?? null,
    });
  } catch (err) {
    console.error("[observatory-insights] audit log write failed:", err);
  }
}

function handleError(res: Response, err: unknown, what: string) {
  if (err instanceof z.ZodError) {
    return res.status(400).json({ message: `Invalid ${what}`, errors: err.errors });
  }
  console.error(`[observatory-insights] ${what} error:`, err);
  return res.status(500).json({ message: `Failed to process ${what}` });
}

async function getTenantVersion(ctx: RequestContext, versionId: string) {
  const [version] = await db
    .select()
    .from(obsVersions)
    .where(and(eq(obsVersions.id, versionId), eq(obsVersions.tenantDomain, ctx.tenantDomain)));
  if (!version) return null;
  const [application] = await db
    .select()
    .from(obsApplications)
    .where(and(eq(obsApplications.id, version.applicationId), eq(obsApplications.tenantDomain, ctx.tenantDomain)));
  if (!application) return null;
  return { version, application };
}

// ── route registration ──────────────────────────────────────────────────────

export function registerObservatoryInsightRoutes(app: Express) {
  // ── Readiness ─────────────────────────────────────────────────────────────

  // Live readiness computation for a version (no snapshot written).
  app.get("/api/observatory/versions/:id/readiness", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    try {
      const found = await getTenantVersion(ctx, req.params.id);
      if (!found) return res.status(404).json({ message: "Version not found" });
      const result = await computeReadiness(ctx.tenantDomain, found.version, found.application);
      const [lastSnapshot] = await db
        .select({ id: obsReadinessScores.id, computedAt: obsReadinessScores.computedAt })
        .from(obsReadinessScores)
        .where(eq(obsReadinessScores.versionId, found.version.id))
        .orderBy(desc(obsReadinessScores.computedAt))
        .limit(1);
      res.json({ ...result, versionNumber: found.version.versionNumber, applicationName: found.application.name, lastSnapshotAt: lastSnapshot?.computedAt ?? null });
    } catch (err) {
      handleError(res, err, "readiness");
    }
  });

  // Compute and persist a readiness snapshot.
  app.post("/api/observatory/versions/:id/readiness", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const found = await getTenantVersion(ctx, req.params.id);
      if (!found) return res.status(404).json({ message: "Version not found" });
      const snap = await snapshotReadiness(ctx.tenantDomain, found.version, found.application, ctx.userId);
      await audit(ctx, "readiness_score", snap.id, "create", `Computed readiness ${snap.overallScore}/100 (${snap.band}) for ${found.application.name} ${found.version.versionNumber}`);
      res.status(201).json(snap);
    } catch (err) {
      handleError(res, err, "readiness snapshot");
    }
  });

  // Snapshot history for a version.
  app.get("/api/observatory/versions/:id/readiness/history", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    try {
      const rows = await db
        .select()
        .from(obsReadinessScores)
        .where(and(eq(obsReadinessScores.tenantDomain, ctx.tenantDomain), eq(obsReadinessScores.versionId, req.params.id)))
        .orderBy(desc(obsReadinessScores.computedAt))
        .limit(50);
      res.json(rows);
    } catch (err) {
      handleError(res, err, "readiness history");
    }
  });

  // Portfolio readiness trend history (one entry per application/version with snapshots).
  app.get("/api/observatory/readiness-trends", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    try {
      const t = ctx.tenantDomain;
      const apps = await db
        .select()
        .from(obsApplications)
        .where(and(eq(obsApplications.tenantDomain, t), eq(obsApplications.status, "active")));
      if (apps.length === 0) return res.json([]);

      const versions = await db
        .select()
        .from(obsVersions)
        .where(and(eq(obsVersions.tenantDomain, t), inArray(obsVersions.applicationId, apps.map((a) => a.id))));

      // For each app, use the most-recent non-retired version.
      const appById = new Map(apps.map((a) => [a.id, a]));
      const latestVersionPerApp = new Map<string, (typeof versions)[number]>();
      for (const v of versions) {
        if (v.assessmentStatus === "Retired") continue;
        const cur = latestVersionPerApp.get(v.applicationId);
        if (!cur || new Date(v.createdAt) > new Date(cur.createdAt)) {
          latestVersionPerApp.set(v.applicationId, v);
        }
      }

      const versionIds = [...latestVersionPerApp.values()].map((v) => v.id);
      if (versionIds.length === 0) return res.json([]);

      const snapshots = await db
        .select({
          id: obsReadinessScores.id,
          versionId: obsReadinessScores.versionId,
          overallScore: obsReadinessScores.overallScore,
          band: obsReadinessScores.band,
          blocked: obsReadinessScores.blocked,
          computedAt: obsReadinessScores.computedAt,
        })
        .from(obsReadinessScores)
        .where(and(eq(obsReadinessScores.tenantDomain, t), inArray(obsReadinessScores.versionId, versionIds)))
        .orderBy(asc(obsReadinessScores.computedAt));

      const byVersion = new Map<string, typeof snapshots>();
      for (const s of snapshots) {
        const arr = byVersion.get(s.versionId) ?? [];
        arr.push(s);
        byVersion.set(s.versionId, arr);
      }

      const result = [];
      for (const [appId, version] of latestVersionPerApp) {
        const app = appById.get(appId);
        if (!app) continue;
        result.push({
          applicationId: appId,
          applicationName: app.name,
          versionId: version.id,
          versionNumber: version.versionNumber,
          history: (byVersion.get(version.id) ?? []).slice(-30), // last 30 snapshots
        });
      }
      // Sort by application name for stable ordering
      result.sort((a, b) => a.applicationName.localeCompare(b.applicationName));
      res.json(result);
    } catch (err) {
      handleError(res, err, "readiness trends");
    }
  });

  // Snapshot readiness for all active versions at once (idempotent — safe to call repeatedly).
  app.post("/api/observatory/readiness-snapshot-all", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const t = ctx.tenantDomain;
      const apps = await db
        .select()
        .from(obsApplications)
        .where(and(eq(obsApplications.tenantDomain, t), eq(obsApplications.status, "active")));
      if (apps.length === 0) return res.json({ snapshotted: 0 });

      const versions = await db
        .select()
        .from(obsVersions)
        .where(and(eq(obsVersions.tenantDomain, t), inArray(obsVersions.applicationId, apps.map((a) => a.id))));

      const appById = new Map(apps.map((a) => [a.id, a]));
      const latestVersionPerApp = new Map<string, (typeof versions)[number]>();
      for (const v of versions) {
        if (v.assessmentStatus === "Retired") continue;
        const cur = latestVersionPerApp.get(v.applicationId);
        if (!cur || new Date(v.createdAt) > new Date(cur.createdAt)) {
          latestVersionPerApp.set(v.applicationId, v);
        }
      }

      let snapshotted = 0;
      const errors: string[] = [];
      for (const [appId, version] of latestVersionPerApp) {
        const app = appById.get(appId);
        if (!app) continue;
        try {
          const snap = await snapshotReadiness(t, version, app, ctx.userId);
          await audit(ctx, "readiness_score", snap.id, "create", `Auto-snapshot readiness ${snap.overallScore}/100 (${snap.band}) for ${app.name} ${version.versionNumber}`);
          snapshotted++;
        } catch (err) {
          errors.push(`${app.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      res.json({ snapshotted, errors: errors.length ? errors : undefined });
    } catch (err) {
      handleError(res, err, "readiness snapshot-all");
    }
  });

  // ── Executive dashboard ──────────────────────────────────────────────────
  app.get("/api/observatory/exec-dashboard", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    try {
      const t = ctx.tenantDomain;
      const [apps, assessments, findings, penTests] = await Promise.all([
        db.select().from(obsApplications).where(and(eq(obsApplications.tenantDomain, t), eq(obsApplications.status, "active"))),
        db.select().from(obsAssessments).where(eq(obsAssessments.tenantDomain, t)),
        db.select().from(obsFindings).where(eq(obsFindings.tenantDomain, t)),
        db.select({ id: obsPenTests.id }).from(obsPenTests).where(eq(obsPenTests.tenantDomain, t)),
      ]);

      const portfolio = await computePortfolioReadiness(t);

      const open = findings.filter((f) => ["open", "in_progress"].includes(f.status));
      const openCritical = open.filter((f) => f.severity === "Critical");
      const now = new Date();
      const overdue = open.filter((f) => f.dueDate && new Date(f.dueDate) < now);

      const countBy = <T,>(rows: T[], key: (r: T) => string) => {
        const m = new Map<string, number>();
        for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
        return [...m.entries()].map(([k, count]) => ({ key: k, count }));
      };

      const kpis = {
        applications: apps.length,
        activeAssessments: assessments.filter((a) => ["planned", "in_progress"].includes(a.status)).length,
        openFindings: open.length,
        openCriticalFindings: openCritical.length,
        accessibilityReviews: assessments.filter((a) => a.type === "accessibility").length,
        penTests: penTests.length,
        redApplications: portfolio.filter((p) => p.band === "Not Ready" || p.blocked).length,
        greenApplications: portfolio.filter((p) => p.band === "Ready" && !p.blocked).length,
      };

      // Alerts panel
      const alerts: { type: string; severity: "critical" | "warning" | "info"; message: string; applicationName?: string; href?: string }[] = [];
      for (const p of portfolio) {
        for (const b of p.blockers as ObsReadinessBlocker[]) {
          alerts.push({
            type: "certification_blocker",
            severity: "critical",
            message: `${p.applicationName} ${p.versionNumber}: ${b.reason}`,
            applicationName: p.applicationName,
            href: `/app/observatory/applications/${p.applicationId}`,
          });
        }
      }
      if (openCritical.length > 0) {
        alerts.push({
          type: "critical_findings",
          severity: "critical",
          message: `${openCritical.length} open Critical finding${openCritical.length === 1 ? "" : "s"} across the portfolio.`,
          href: "/app/observatory/findings",
        });
      }
      if (overdue.length > 0) {
        alerts.push({
          type: "overdue_findings",
          severity: "warning",
          message: `${overdue.length} open finding${overdue.length === 1 ? " is" : "s are"} past due date.`,
          href: "/app/observatory/findings",
        });
      }
      const staleInProgress = assessments.filter((a) => a.status === "in_progress" && a.endDate && new Date(a.endDate) < now);
      if (staleInProgress.length > 0) {
        alerts.push({
          type: "incomplete_assessments",
          severity: "warning",
          message: `${staleInProgress.length} in-progress assessment${staleInProgress.length === 1 ? " is" : "s are"} past the planned end date.`,
          href: "/app/observatory/assessments",
        });
      }
      const unassessed = portfolio.filter((p) => (p.domainScores as { assessed: boolean; applicable: boolean }[]).filter((d) => d.applicable && !d.assessed).length >= 3);
      if (unassessed.length > 0) {
        alerts.push({
          type: "coverage_gap",
          severity: "info",
          message: `${unassessed.length} application${unassessed.length === 1 ? " has" : "s have"} three or more unassessed readiness domains.`,
          href: "/app/observatory/assessments",
        });
      }

      res.json({
        kpis,
        readinessByApplication: portfolio.map((p) => ({
          applicationId: p.applicationId,
          applicationName: p.applicationName,
          versionId: p.versionId,
          versionNumber: p.versionNumber,
          score: p.overallScore,
          band: p.band,
          blocked: p.blocked,
          domainScores: p.domainScores,
          blockers: p.blockers,
        })),
        findingsBySeverity: countBy(open, (f) => f.severity),
        findingsByDomain: countBy(open, (f) => f.domain),
        assessmentStatus: countBy(assessments, (a) => a.status),
        remediationStatus: countBy(findings, (f) => f.status),
        alerts,
      });
    } catch (err) {
      handleError(res, err, "executive dashboard");
    }
  });

  // ── Reports (async generation, 202-and-poll) ─────────────────────────────
  const createReportSchema = z.object({
    reportType: z.enum(OBS_REPORT_TYPES),
    applicationId: z.string().min(1),
    versionId: z.string().nullable().optional(),
    includeAiSummary: z.boolean().optional().default(false),
  });

  app.post("/api/observatory/reports", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const body = createReportSchema.parse(req.body);
      const [application] = await db
        .select()
        .from(obsApplications)
        .where(and(eq(obsApplications.id, body.applicationId), eq(obsApplications.tenantDomain, ctx.tenantDomain)));
      if (!application) return res.status(404).json({ message: "Application not found" });
      let versionId: string | null = body.versionId ?? null;
      if (versionId) {
        const found = await getTenantVersion(ctx, versionId);
        if (!found || found.application.id !== application.id) return res.status(404).json({ message: "Version not found" });
      }
      const title = `${OBS_REPORT_TYPE_LABELS[body.reportType]} — ${application.name}`;
      const [report] = await db
        .insert(obsReports)
        .values({
          tenantDomain: ctx.tenantDomain,
          applicationId: application.id,
          versionId,
          reportType: body.reportType,
          title,
          status: "generating",
          includeAiSummary: body.includeAiSummary,
          createdBy: ctx.userId,
        })
        .returning();
      await audit(ctx, "report", report.id, "create", `Queued ${OBS_REPORT_TYPE_LABELS[body.reportType]} for ${application.name}`);
      void generateReportAsync(report.id);
      res.status(202).json(report);
    } catch (err) {
      handleError(res, err, "report");
    }
  });

  app.get("/api/observatory/reports", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    try {
      const rows = await db
        .select({
          id: obsReports.id,
          applicationId: obsReports.applicationId,
          versionId: obsReports.versionId,
          reportType: obsReports.reportType,
          title: obsReports.title,
          status: obsReports.status,
          includeAiSummary: obsReports.includeAiSummary,
          error: obsReports.error,
          generatedAt: obsReports.generatedAt,
          createdAt: obsReports.createdAt,
          applicationName: obsApplications.name,
          versionNumber: obsVersions.versionNumber,
        })
        .from(obsReports)
        .leftJoin(obsApplications, eq(obsReports.applicationId, obsApplications.id))
        .leftJoin(obsVersions, eq(obsReports.versionId, obsVersions.id))
        .where(eq(obsReports.tenantDomain, ctx.tenantDomain))
        .orderBy(desc(obsReports.createdAt))
        .limit(100);
      res.json(rows);
    } catch (err) {
      handleError(res, err, "reports");
    }
  });

  app.get("/api/observatory/reports/:id", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    try {
      const [report] = await db
        .select()
        .from(obsReports)
        .where(and(eq(obsReports.id, req.params.id), eq(obsReports.tenantDomain, ctx.tenantDomain)));
      if (!report) return res.status(404).json({ message: "Report not found" });
      res.json(report);
    } catch (err) {
      handleError(res, err, "report");
    }
  });

  app.get("/api/observatory/reports/:id/html", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    try {
      const [report] = await db
        .select()
        .from(obsReports)
        .where(and(eq(obsReports.id, req.params.id), eq(obsReports.tenantDomain, ctx.tenantDomain)));
      if (!report) return res.status(404).json({ message: "Report not found" });
      if (report.status !== "generated" || !report.html) {
        return res.status(409).json({ message: `Report is ${report.status}` });
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(report.html);
    } catch (err) {
      handleError(res, err, "report html");
    }
  });

  app.get("/api/observatory/reports/:id/pdf", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    try {
      const [report] = await db
        .select()
        .from(obsReports)
        .where(and(eq(obsReports.id, req.params.id), eq(obsReports.tenantDomain, ctx.tenantDomain)));
      if (!report) return res.status(404).json({ message: "Report not found" });
      if (report.status !== "generated" || !report.html) {
        return res.status(409).json({ message: `Report is ${report.status}` });
      }
      const pdf = await renderReportPdf(report.html, `Observatory PDF ${report.id}`);
      const filename = `${report.title.replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "_")}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(pdf);
    } catch (err) {
      handleError(res, err, "report pdf");
    }
  });

  app.delete("/api/observatory/reports/:id", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canDelete(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const [deleted] = await db
        .delete(obsReports)
        .where(and(eq(obsReports.id, req.params.id), eq(obsReports.tenantDomain, ctx.tenantDomain)))
        .returning({ id: obsReports.id, title: obsReports.title });
      if (!deleted) return res.status(404).json({ message: "Report not found" });
      await audit(ctx, "report", deleted.id, "delete", `Deleted report "${deleted.title}"`);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err, "report deletion");
    }
  });

  // ── VPAT assistant ────────────────────────────────────────────────────────

  /** Frameworks included in the VPAT worksheet. */
  const VPAT_FRAMEWORK_CODES = ["WCAG22", "SECTION_508"];

  // Initialize (or top up) the VPAT worksheet for a version.
  app.post("/api/observatory/versions/:id/vpat/init", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const found = await getTenantVersion(ctx, req.params.id);
      if (!found) return res.status(404).json({ message: "Version not found" });
      const frameworks = await db.select().from(obsFrameworks).where(inArray(obsFrameworks.code, VPAT_FRAMEWORK_CODES));
      if (!frameworks.length) return res.status(500).json({ message: "Standards catalog not seeded" });
      const controls = await db
        .select()
        .from(obsControls)
        .where(inArray(obsControls.frameworkId, frameworks.map((f) => f.id)));
      const existing = await db
        .select({ controlRef: obsVpatEntries.controlRef })
        .from(obsVpatEntries)
        .where(and(eq(obsVpatEntries.tenantDomain, ctx.tenantDomain), eq(obsVpatEntries.versionId, found.version.id)));
      const have = new Set(existing.map((e) => e.controlRef));
      const missing = controls.filter((c) => !have.has(c.id));
      if (missing.length) {
        await db.insert(obsVpatEntries).values(
          missing.map((c) => ({
            tenantDomain: ctx.tenantDomain,
            versionId: found.version.id,
            applicationId: found.application.id,
            controlRef: c.id,
            createdBy: undefined,
          })),
        );
        await audit(ctx, "vpat", found.version.id, "create", `Initialized VPAT worksheet (+${missing.length} criteria) for ${found.application.name} ${found.version.versionNumber}`);
      }
      res.json({ created: missing.length, total: controls.length, disclaimer: OBS_VPAT_DISCLAIMER });
    } catch (err) {
      handleError(res, err, "VPAT initialization");
    }
  });

  // Full worksheet for a version, with linked findings/evidence per criterion.
  app.get("/api/observatory/versions/:id/vpat", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    try {
      const found = await getTenantVersion(ctx, req.params.id);
      if (!found) return res.status(404).json({ message: "Version not found" });
      const rows = await db
        .select({
          entry: obsVpatEntries,
          control: obsControls,
          frameworkCode: obsFrameworks.code,
          frameworkName: obsFrameworks.name,
        })
        .from(obsVpatEntries)
        .innerJoin(obsControls, eq(obsVpatEntries.controlRef, obsControls.id))
        .innerJoin(obsFrameworks, eq(obsControls.frameworkId, obsFrameworks.id))
        .where(and(eq(obsVpatEntries.tenantDomain, ctx.tenantDomain), eq(obsVpatEntries.versionId, found.version.id)))
        .orderBy(asc(obsFrameworks.sortOrder), asc(obsControls.sortOrder), asc(obsControls.controlId));

      // Related findings for this version's application: matched either by
      // explicit control link (obs_finding_controls) or by wcagCriterion text.
      const appFindings = await db
        .select()
        .from(obsFindings)
        .where(and(eq(obsFindings.tenantDomain, ctx.tenantDomain), eq(obsFindings.applicationId, found.application.id)));
      const findingIds = appFindings.map((f) => f.id);
      const controlLinks = findingIds.length
        ? await db.select().from(obsFindingControls).where(inArray(obsFindingControls.findingId, findingIds))
        : [];
      const evidenceLinks = findingIds.length
        ? await db
            .select({ findingId: obsFindingEvidence.findingId, id: obsEvidence.id, title: obsEvidence.title })
            .from(obsFindingEvidence)
            .innerJoin(obsEvidence, eq(obsFindingEvidence.evidenceId, obsEvidence.id))
            .where(inArray(obsFindingEvidence.findingId, findingIds))
        : [];
      const evidenceByFinding = new Map<string, { id: string; title: string }[]>();
      for (const e of evidenceLinks) {
        const list = evidenceByFinding.get(e.findingId) ?? [];
        list.push({ id: e.id, title: e.title });
        evidenceByFinding.set(e.findingId, list);
      }
      const findingsByControl = new Map<string, typeof appFindings>();
      for (const link of controlLinks) {
        const f = appFindings.find((x) => x.id === link.findingId);
        if (!f) continue;
        const list = findingsByControl.get(link.controlId) ?? [];
        list.push(f);
        findingsByControl.set(link.controlId, list);
      }

      const result = rows.map((r) => {
        const byLink = findingsByControl.get(r.control.id) ?? [];
        const byCriterion = appFindings.filter(
          (f) => f.wcagCriterion && f.wcagCriterion.trim() === r.control.controlId && !byLink.some((x) => x.id === f.id),
        );
        const related = [...byLink, ...byCriterion].map((f) => ({
          id: f.id,
          title: f.title,
          severity: f.severity,
          status: f.status,
          evidence: evidenceByFinding.get(f.id) ?? [],
        }));
        return {
          ...r.entry,
          control: {
            id: r.control.id,
            controlId: r.control.controlId,
            title: r.control.title,
            description: r.control.description,
            category: r.control.category,
            level: r.control.level,
          },
          frameworkCode: r.frameworkCode,
          frameworkName: r.frameworkName,
          relatedFindings: related,
        };
      });

      res.json({
        version: found.version,
        application: found.application,
        disclaimer: OBS_VPAT_DISCLAIMER,
        conformanceOptions: OBS_VPAT_CONFORMANCE,
        entries: result,
      });
    } catch (err) {
      handleError(res, err, "VPAT worksheet");
    }
  });

  const updateVpatSchema = z.object({
    conformance: z.enum(OBS_VPAT_CONFORMANCE).optional(),
    remarks: z.string().nullable().optional(),
    reviewerNotes: z.string().nullable().optional(),
    aiDrafted: z.boolean().optional(),
  });

  app.patch("/api/observatory/vpat/:id", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const body = updateVpatSchema.parse(req.body);
      const [updated] = await db
        .update(obsVpatEntries)
        .set({ ...body, updatedBy: ctx.userId, updatedAt: new Date() })
        .where(and(eq(obsVpatEntries.id, req.params.id), eq(obsVpatEntries.tenantDomain, ctx.tenantDomain)))
        .returning();
      if (!updated) return res.status(404).json({ message: "VPAT entry not found" });
      res.json(updated);
    } catch (err) {
      handleError(res, err, "VPAT entry");
    }
  });

  // Synchronous VPAT PDF export — renders on demand and streams back the file.
  app.get("/api/observatory/versions/:id/vpat/export/pdf", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    try {
      const found = await getTenantVersion(ctx, req.params.id);
      if (!found) return res.status(404).json({ message: "Version not found" });
      const data = await loadReportData(ctx.tenantDomain, found.application.id, found.version.id);
      const html = await renderAccessibilityVpat(ctx.tenantDomain, data, null);
      const pdf = await renderReportPdf(html, `VPAT export ${found.application.name} ${found.version.versionNumber}`);
      const filename = `VPAT_${found.application.name}_v${found.version.versionNumber}`
        .replace(/[^a-zA-Z0-9 _-]/g, "")
        .replace(/\s+/g, "_");
      await audit(ctx, "vpat", found.version.id, "export", `Exported VPAT PDF for ${found.application.name} ${found.version.versionNumber}`);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
      res.send(pdf);
    } catch (err) {
      handleError(res, err, "VPAT PDF export");
    }
  });

  // AI-drafted remarks for a criterion, grounded in its linked findings.
  app.post("/api/observatory/vpat/:id/ai-draft", async (req, res) => {
    const ctx = await ctxOr401(req, res);
    if (!ctx) return;
    if (!canWrite(ctx)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const [row] = await db
        .select({ entry: obsVpatEntries, control: obsControls })
        .from(obsVpatEntries)
        .innerJoin(obsControls, eq(obsVpatEntries.controlRef, obsControls.id))
        .where(and(eq(obsVpatEntries.id, req.params.id), eq(obsVpatEntries.tenantDomain, ctx.tenantDomain)));
      if (!row) return res.status(404).json({ message: "VPAT entry not found" });

      const links = await db.select().from(obsFindingControls).where(eq(obsFindingControls.controlId, row.control.id));
      const linkedIds = links.map((l) => l.findingId);
      const findings = await db
        .select()
        .from(obsFindings)
        .where(
          and(
            eq(obsFindings.tenantDomain, ctx.tenantDomain),
            eq(obsFindings.applicationId, row.entry.applicationId),
            linkedIds.length
              ? or(inArray(obsFindings.id, linkedIds), eq(obsFindings.wcagCriterion, row.control.controlId))
              : eq(obsFindings.wcagCriterion, row.control.controlId),
          ),
        );

      const findingsText = findings.length
        ? findings
            .map((f) => `- [${f.severity} · ${f.status}] ${f.title}${f.description ? `: ${f.description.slice(0, 300)}` : ""}`)
            .join("\n")
        : "(no findings are linked to this criterion — the application has no recorded issues for it)";

      const prompt = `Draft the "Remarks and Explanations" text for one row of a VPAT (Voluntary Product Accessibility Template) worksheet.

Criterion: ${row.control.controlId} — ${row.control.title}${row.control.level ? ` (Level ${row.control.level})` : ""}
Criterion description: ${row.control.description ?? "n/a"}
Current conformance selection: ${row.entry.conformance}

Findings recorded against this criterion:
${findingsText}

Write 1–3 sentences of factual, neutral VPAT-style remarks describing how the product performs against this criterion, referencing the findings when present. Do not invent behavior that is not in the findings. Output only the remarks text, no preamble.`;

      const result = await completeForFeature(AI_FEATURES.OBSERVATORY_REPORT, prompt, {
        systemPrompt:
          "You draft VPAT support content for accessibility conformance reports. Be factual and concise. This is draft content requiring human review — never overstate conformance.",
        maxTokens: 400,
        tenantDomain: ctx.tenantDomain,
      });

      res.json({ draft: result.text.trim(), disclaimer: OBS_VPAT_DISCLAIMER });
    } catch (err) {
      handleError(res, err, "VPAT AI draft");
    }
  });
}
