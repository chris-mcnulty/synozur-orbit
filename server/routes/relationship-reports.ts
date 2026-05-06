import type { Express } from "express";
import { storage } from "../storage";
import { getRequestContext, ContextError } from "../context";
import {
  toContextFilter,
  validateResourceContext,
  logAiUsage,
  computeLatestSourceDataTimestamp,
  guardFeature,
  guardManualAction,
  hasAdminAccess,
  hasContentAccess,
} from "./helpers";
import { generateRelationshipReport } from "../services/relationship-report-service";
import { RELATIONSHIP_POSTURES } from "@shared/schema";

export function registerRelationshipReportRoutes(app: Express) {
  // List all relationship reports for the current tenant + market
  app.get("/api/relationship-reports", async (req, res) => {
    if (!await guardFeature(req, res, "relationshipReports")) return;
    try {
      const ctx = await getRequestContext(req);
      const reports = await storage.getRelationshipReportsByContext(toContextFilter(ctx));
      res.json(reports);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // List all company profiles across all markets for the active tenant
  // (used by the frontend to populate the cross-market target picker).
  // MUST be registered before /:id to prevent "company-profiles" matching as an id.
  app.get("/api/relationship-reports/company-profiles", async (req, res) => {
    if (!await guardFeature(req, res, "relationshipReports")) return;
    try {
      const ctx = await getRequestContext(req);
      // Fetch all profiles for this tenant, then exclude the active market's
      // own baseline so users can't generate a self-targeted report.
      const [allProfiles, activeProfile] = await Promise.all([
        storage.getCompanyProfilesByTenantDomain(ctx.tenantDomain),
        storage.getCompanyProfileByContext(toContextFilter(ctx)),
      ]);
      const crossMarket = activeProfile
        ? allProfiles.filter(p => p.id !== activeProfile.id)
        : allProfiles;

      // Enrich each profile with its market name + isDefault flag so the
      // picker can render "Acme · EMEA Market" while suppressing the label
      // for the tenant's default market (which would just be noise).
      const marketIds = Array.from(new Set(crossMarket.map(p => p.marketId).filter(Boolean))) as string[];
      const markets = await Promise.all(marketIds.map(id => storage.getMarket(id).catch(() => null)));
      const marketById = new Map(markets.filter(Boolean).map(m => [m!.id, m!]));
      const enriched = crossMarket.map(p => {
        const market = p.marketId ? marketById.get(p.marketId) : null;
        return {
          ...p,
          marketName: market?.name ?? null,
          marketIsDefault: market?.isDefault ?? false,
        };
      });
      res.json(enriched);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Fetch a single relationship report by id
  app.get("/api/relationship-reports/:id", async (req, res) => {
    if (!await guardFeature(req, res, "relationshipReports")) return;
    try {
      const ctx = await getRequestContext(req);
      const report = await storage.getRelationshipReport(req.params.id);
      if (!report) return res.status(404).json({ error: "Report not found" });
      if (!validateResourceContext(report, ctx)) return res.status(403).json({ error: "Access denied" });
      res.json(report);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Fetch the latest relationship report for a competitor
  app.get("/api/competitors/:competitorId/relationship-report", async (req, res) => {
    if (!await guardFeature(req, res, "relationshipReports")) return;
    try {
      const ctx = await getRequestContext(req);
      const competitor = await storage.getCompetitor(req.params.competitorId);
      if (!competitor) return res.status(404).json({ error: "Competitor not found" });
      if (!validateResourceContext(competitor, ctx)) return res.status(403).json({ error: "Access denied" });

      const report = await storage.getRelationshipReportByCompetitor(req.params.competitorId, toContextFilter(ctx));
      if (!report) {
        return res.json({
          status: "not_generated",
          competitorId: req.params.competitorId,
          targetName: competitor.name,
          targetUrl: competitor.url,
          content: null,
          savedPrompts: null,
          lastGeneratedAt: null,
        });
      }
      res.json(report);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Background processor — runs AI generation off the request thread so
  // long-running calls (~3 minutes) don't block the HTTP response. Updates
  // the existing report row when done. Errors are caught and surfaced via
  // the row's status field so the frontend can show a useful message.
  async function runRelationshipReportGeneration(
    reportId: string,
    ctx: { tenantDomain: string; marketId: string | null; userId: string },
    input: {
      competitor?: any;
      targetProfile?: any;
      baseline: any;
      customGuidance?: string;
      posture?: string;
      focus?: string[];
      isB2C: boolean;
      previousContent: string | null;
      previousVersions: any[];
      previousGeneratedBy: string | null;
      previousUpdatedAt: Date | null;
      savedPromptsBase: any;
    },
  ) {
    const filter = { tenantDomain: ctx.tenantDomain, marketId: ctx.marketId };
    const started = Date.now();
    try {
      const result = await generateRelationshipReport({
        ctx: filter,
        competitor: input.competitor,
        targetProfile: input.targetProfile,
        baseline: input.baseline,
        customGuidance: input.customGuidance,
        posture: input.posture,
        focus: input.focus,
        isB2C: input.isB2C,
      });
      const durationMs = Date.now() - started;

      await logAiUsage(
        ctx as any,
        "generate_relationship_report",
        result.provider || "anthropic",
        result.model || "claude-sonnet-4-5",
        result.usage,
        durationMs,
      );

      const sourceDataAsOf = await computeLatestSourceDataTimestamp(filter);

      const previousVersions = [...input.previousVersions];
      if (input.previousContent && input.previousContent !== result.content) {
        previousVersions.push({
          content: input.previousContent,
          savedAt: input.previousUpdatedAt || new Date(),
          savedBy: input.previousGeneratedBy || ctx.userId,
        });
        if (previousVersions.length > 10) previousVersions.splice(0, previousVersions.length - 10);
      }

      await storage.updateRelationshipReport(reportId, {
        content: result.content,
        status: "generated",
        lastGeneratedAt: new Date(),
        generatedFromDataAsOf: sourceDataAsOf,
        generatedBy: ctx.userId,
        savedPrompts: { ...input.savedPromptsBase, versionHistory: previousVersions },
      });

      // Fire-and-forget: render the PDF and archive it to SharePoint
      // Embedded so a copy lands in the tenant's container on every
      // generation, without requiring the user to click "Download PDF".
      // Reuses the same enqueuePdf path as the download route so a
      // concurrent download is deduped against this generation job.
      void archiveRelationshipReportPdfToSpe(reportId, ctx).catch((err) => {
        console.error(`[SPE] Failed to archive relationship report PDF for ${reportId}:`, err);
      });
    } catch (error: any) {
      console.error(`[relationship-report] Background generation failed for ${reportId}:`, error);
      await storage.updateRelationshipReport(reportId, {
        status: "failed",
        savedPrompts: {
          ...input.savedPromptsBase,
          versionHistory: input.previousVersions,
          lastError: (error?.message || "Generation failed").slice(0, 500),
        },
      }).catch(updateErr => {
        console.error(`[relationship-report] Failed to mark ${reportId} as failed:`, updateErr);
      });
    }
  }

  // Render the just-generated relationship report as a PDF and push it to
  // the tenant's SharePoint Embedded container. Silently no-ops when SPE is
  // disabled for the tenant or the global container env var is missing.
  async function archiveRelationshipReportPdfToSpe(
    reportId: string,
    ctx: { tenantDomain: string; marketId: string | null; userId: string },
  ) {
    const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
    if (!tenant?.speStorageEnabled) return;

    const report = await storage.getRelationshipReport(reportId);
    if (!report || report.status !== "generated" || !report.content) return;

    const { generateRelationshipReportPdf } = await import("../services/pdf-generator");
    const { enqueuePdf } = await import("../services/job-queue");
    const { pdfBuffer } = await enqueuePdf(
      `relationship-report-pdf:${report.id}`,
      (_signal, reportProgress) =>
        generateRelationshipReportPdf(report.id, ctx.tenantDomain, ctx.userId, reportProgress),
      undefined,
      { tenantDomain: ctx.tenantDomain, targetName: report.targetName },
    );

    const safeName = (report.name || "Relationship_Report").replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `${safeName}_${new Date().toISOString().split("T")[0]}.pdf`;

    const { sharepointFileStorage } = await import("../services/sharepoint-file-storage.js");
    await sharepointFileStorage.storeFile(
      pdfBuffer,
      filename,
      "application/pdf",
      {
        documentType: "report",
        scope: "tenant",
        tenantDomain: ctx.tenantDomain,
        marketId: report.marketId || undefined,
        createdByUserId: ctx.userId,
        fileType: "pdf",
        originalFileName: filename,
        reportType: "relationship_report",
      },
      ctx.userId,
      report.id,
      tenant.id,
    );
    console.log(`[SPE] Archived relationship report PDF for ${report.id} (${filename})`);
  }

  // Generate or regenerate a relationship report for a competitor.
  // Returns the report row immediately with status="generating"; the AI
  // call runs in the background and updates the row when complete. The
  // frontend polls /api/relationship-reports while any row is generating.
  app.post("/api/competitors/:competitorId/relationship-report/generate", async (req, res) => {
    if (!await guardFeature(req, res, "relationshipReports")) return;
    if (!await guardManualAction(req, res, "aiResearch")) return;
    try {
      const ctx = await getRequestContext(req);

      const competitor = await storage.getCompetitor(req.params.competitorId);
      if (!competitor) return res.status(404).json({ error: "Competitor not found" });
      if (!validateResourceContext(competitor, ctx)) return res.status(403).json({ error: "Access denied" });

      const { customGuidance, posture, focus } = req.body || {};
      if (posture && !RELATIONSHIP_POSTURES.includes(posture)) {
        return res.status(400).json({ error: `Invalid posture. Must be one of: ${RELATIONSHIP_POSTURES.join(", ")}` });
      }
      if (focus && !Array.isArray(focus)) {
        return res.status(400).json({ error: "focus must be an array of strings" });
      }

      const baseline = (await storage.getCompanyProfileByContext(toContextFilter(ctx))) || null;

      let isB2C = false;
      if (ctx.marketId) {
        const market = await storage.getMarket(ctx.marketId);
        if (market?.businessType === "b2c") isB2C = true;
      }

      const savedPromptsBase = { customGuidance: customGuidance || "", posture: posture || null, focus: focus || [] };
      const existing = await storage.getRelationshipReportByCompetitor(competitor.id, toContextFilter(ctx));

      // Guard against concurrent regenerations: if a job is already in
      // flight for this report, return 409 instead of kicking off a second
      // background task that would race the first on the version history.
      if (existing?.status === "generating") {
        return res.status(409).json({
          error: "A relationship plan is already generating for this competitor. Please wait for it to finish.",
          report: existing,
        });
      }

      let stub;
      let previousContent: string | null = null;
      let previousVersions: any[] = [];
      let previousGeneratedBy: string | null = null;
      let previousUpdatedAt: Date | null = null;

      if (existing) {
        previousContent = existing.content;
        previousVersions = ((existing.savedPrompts as any)?.versionHistory || []) as any[];
        previousGeneratedBy = existing.generatedBy || null;
        previousUpdatedAt = existing.updatedAt || existing.lastGeneratedAt || null;
        stub = await storage.updateRelationshipReport(existing.id, {
          status: "generating",
          targetName: competitor.name,
          targetUrl: competitor.url || existing.targetUrl,
          savedPrompts: { ...savedPromptsBase, versionHistory: previousVersions },
        });
      } else {
        stub = await storage.createRelationshipReport({
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          companyProfileId: baseline?.id || null,
          competitorId: competitor.id,
          targetName: competitor.name,
          targetUrl: competitor.url,
          name: `Relationship Plan: ${competitor.name}`,
          content: null,
          savedPrompts: savedPromptsBase,
          status: "generating",
          generatedBy: ctx.userId,
          createdBy: ctx.userId,
        });
      }

      // Kick off background generation. Capture context so it survives the
      // response cycle. Errors inside are handled by the helper.
      setImmediate(() => {
        void runRelationshipReportGeneration(stub.id, {
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          userId: ctx.userId,
        }, {
          competitor,
          baseline,
          customGuidance,
          posture,
          focus,
          isB2C,
          previousContent,
          previousVersions,
          previousGeneratedBy,
          previousUpdatedAt,
          savedPromptsBase,
        });
      });

      res.status(202).json(stub);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      console.error("Relationship report generation error:", error);
      res.status(500).json({ error: error.message || "Failed to generate relationship report" });
    }
  });

  // Fetch the latest relationship report for a company-profile target (cross-market)
  app.get("/api/company-profiles/:profileId/relationship-report", async (req, res) => {
    if (!await guardFeature(req, res, "relationshipReports")) return;
    try {
      const ctx = await getRequestContext(req);
      const profile = await storage.getCompanyProfile(req.params.profileId);
      if (!profile) return res.status(404).json({ error: "Company profile not found" });
      if (profile.tenantDomain !== ctx.tenantDomain) return res.status(403).json({ error: "Access denied" });

      const report = await storage.getRelationshipReportByTargetProfile(req.params.profileId, toContextFilter(ctx));
      if (!report) {
        return res.json({
          status: "not_generated",
          targetCompanyProfileId: req.params.profileId,
          targetName: profile.companyName,
          targetUrl: profile.websiteUrl,
          content: null,
          savedPrompts: null,
          lastGeneratedAt: null,
        });
      }
      res.json(report);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Generate or regenerate a relationship report for a cross-market company profile target
  app.post("/api/company-profiles/:profileId/relationship-report/generate", async (req, res) => {
    if (!await guardFeature(req, res, "relationshipReports")) return;
    if (!await guardManualAction(req, res, "aiResearch")) return;
    try {
      const ctx = await getRequestContext(req);

      const targetProfile = await storage.getCompanyProfile(req.params.profileId);
      if (!targetProfile) return res.status(404).json({ error: "Company profile not found" });
      if (targetProfile.tenantDomain !== ctx.tenantDomain) return res.status(403).json({ error: "Access denied" });

      const { customGuidance, posture, focus } = req.body || {};
      if (posture && !RELATIONSHIP_POSTURES.includes(posture)) {
        return res.status(400).json({ error: `Invalid posture. Must be one of: ${RELATIONSHIP_POSTURES.join(", ")}` });
      }
      if (focus && !Array.isArray(focus)) {
        return res.status(400).json({ error: "focus must be an array of strings" });
      }

      const baseline = (await storage.getCompanyProfileByContext(toContextFilter(ctx))) || null;

      // Guard against generating a self-report (source and target are the same profile)
      if (baseline && baseline.id === targetProfile.id) {
        return res.status(400).json({ error: "Cannot generate a relationship report with yourself as the target. Choose a different market's baseline company." });
      }

      let isB2C = false;
      if (ctx.marketId) {
        const market = await storage.getMarket(ctx.marketId);
        if (market?.businessType === "b2c") isB2C = true;
      }

      const savedPromptsBase = { customGuidance: customGuidance || "", posture: posture || null, focus: focus || [] };
      const existing = await storage.getRelationshipReportByTargetProfile(targetProfile.id, toContextFilter(ctx));

      // See competitor route for rationale: prevent overlapping background jobs.
      if (existing?.status === "generating") {
        return res.status(409).json({
          error: "A relationship plan is already generating for this target. Please wait for it to finish.",
          report: existing,
        });
      }

      let stub;
      let previousContent: string | null = null;
      let previousVersions: any[] = [];
      let previousGeneratedBy: string | null = null;
      let previousUpdatedAt: Date | null = null;

      if (existing) {
        previousContent = existing.content;
        previousVersions = ((existing.savedPrompts as any)?.versionHistory || []) as any[];
        previousGeneratedBy = existing.generatedBy || null;
        previousUpdatedAt = existing.updatedAt || existing.lastGeneratedAt || null;
        stub = await storage.updateRelationshipReport(existing.id, {
          status: "generating",
          targetName: targetProfile.companyName,
          targetUrl: targetProfile.websiteUrl || existing.targetUrl,
          savedPrompts: { ...savedPromptsBase, versionHistory: previousVersions },
        });
      } else {
        stub = await storage.createRelationshipReport({
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          companyProfileId: baseline?.id || null,
          targetCompanyProfileId: targetProfile.id,
          targetName: targetProfile.companyName,
          targetUrl: targetProfile.websiteUrl,
          name: `Relationship Plan: ${targetProfile.companyName}`,
          content: null,
          savedPrompts: savedPromptsBase,
          status: "generating",
          generatedBy: ctx.userId,
          createdBy: ctx.userId,
        });
      }

      setImmediate(() => {
        void runRelationshipReportGeneration(stub.id, {
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          userId: ctx.userId,
        }, {
          targetProfile,
          baseline,
          customGuidance,
          posture,
          focus,
          isB2C,
          previousContent,
          previousVersions,
          previousGeneratedBy,
          previousUpdatedAt,
          savedPromptsBase,
        });
      });

      res.status(202).json(stub);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      console.error("Relationship report generation error:", error);
      res.status(500).json({ error: error.message || "Failed to generate relationship report" });
    }
  });

  // Manual edit of a relationship report's content
  app.patch("/api/relationship-reports/:id/content", async (req, res) => {
    if (!await guardFeature(req, res, "relationshipReports")) return;
    try {
      const ctx = await getRequestContext(req);
      const { content } = req.body || {};
      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "Content is required" });
      }
      const report = await storage.getRelationshipReport(req.params.id);
      if (!report) return res.status(404).json({ error: "Report not found" });
      if (!validateResourceContext(report, ctx)) return res.status(403).json({ error: "Access denied" });

      const previousVersions = ((report.savedPrompts as any)?.versionHistory || []) as any[];
      if (report.content && report.content !== content) {
        previousVersions.push({
          content: report.content,
          savedAt: report.updatedAt || report.lastGeneratedAt || new Date(),
          savedBy: report.generatedBy || ctx.userId,
        });
        if (previousVersions.length > 10) previousVersions.splice(0, previousVersions.length - 10);
      }

      const updated = await storage.updateRelationshipReport(req.params.id, {
        content,
        savedPrompts: {
          ...((report.savedPrompts as any) || {}),
          versionHistory: previousVersions,
          lastManualEdit: new Date().toISOString(),
          lastEditedBy: ctx.userId,
        },
      });
      res.json(updated);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a relationship report (admin only)
  app.delete("/api/relationship-reports/:id", async (req, res) => {
    if (!await guardFeature(req, res, "relationshipReports")) return;
    try {
      const ctx = await getRequestContext(req);
      const user = await storage.getUser(ctx.userId);
      if (!user || !hasContentAccess(user.role)) {
        return res.status(403).json({ error: "Admin access required to delete reports" });
      }
      const report = await storage.getRelationshipReport(req.params.id);
      if (!report) return res.status(404).json({ error: "Report not found" });
      if (report.tenantDomain !== ctx.tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }
      await storage.deleteRelationshipReport(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Branded PDF download
  app.get("/api/relationship-reports/:id/download/pdf", async (req, res) => {
    if (!await guardFeature(req, res, "relationshipReports")) return;
    try {
      const ctx = await getRequestContext(req);
      const report = await storage.getRelationshipReport(req.params.id);
      if (!report) return res.status(404).json({ error: "Report not found" });
      if (!validateResourceContext(report, ctx)) return res.status(403).json({ error: "Access denied" });

      const { generateRelationshipReportPdf } = await import("../services/pdf-generator");
      const { enqueuePdf } = await import("../services/job-queue");
      const { pdfBuffer } = await enqueuePdf(
        `relationship-report-pdf:${report.id}`,
        (_signal, reportProgress) =>
          generateRelationshipReportPdf(report.id, ctx.tenantDomain, ctx.userId, reportProgress),
        undefined,
        { tenantDomain: ctx.tenantDomain, targetName: report.targetName },
      );

      const safeName = (report.name || "Relationship_Report").replace(/[^a-zA-Z0-9]/g, "_");
      const filename = `${safeName}_${new Date().toISOString().split("T")[0]}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(pdfBuffer);

      // Store to SPE (fire-and-forget)
      Promise.resolve().then(async () => {
        const t = await storage.getTenantByDomain(ctx.tenantDomain);
        if (!t?.speStorageEnabled) return;
        const { sharepointFileStorage } = await import("../services/sharepoint-file-storage.js");
        return sharepointFileStorage.storeFile(pdfBuffer, filename, "application/pdf", {
          documentType: "report",
          scope: "tenant",
          tenantDomain: ctx.tenantDomain,
          marketId: report.marketId || undefined,
          createdByUserId: ctx.userId,
          fileType: "pdf",
          originalFileName: filename,
          reportType: "relationship_report",
        }, ctx.userId, report.id, t.id);
      }).catch((err) => console.error("[SPE] Failed to store relationship report PDF:", err));
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      console.error("Relationship report PDF generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Markdown download
  app.get("/api/relationship-reports/:id/download/markdown", async (req, res) => {
    if (!await guardFeature(req, res, "relationshipReports")) return;
    try {
      const ctx = await getRequestContext(req);
      const report = await storage.getRelationshipReport(req.params.id);
      if (!report) return res.status(404).json({ error: "Report not found" });
      if (!validateResourceContext(report, ctx)) return res.status(403).json({ error: "Access denied" });

      const safeName = (report.name || "Relationship_Plan").replace(/[^a-zA-Z0-9]/g, "_");
      const filename = `${safeName}_${new Date().toISOString().split("T")[0]}.md`;
      res.setHeader("Content-Type", "text/markdown");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(report.content || "");
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Word (HTML-as-DOC) download — same lightweight approach used by long-form recs
  app.get("/api/relationship-reports/:id/download/docx", async (req, res) => {
    if (!await guardFeature(req, res, "relationshipReports")) return;
    try {
      const ctx = await getRequestContext(req);
      const report = await storage.getRelationshipReport(req.params.id);
      if (!report) return res.status(404).json({ error: "Report not found" });
      if (!validateResourceContext(report, ctx)) return res.status(403).json({ error: "Access denied" });

      const content = report.content || "";
      const html = content
        .replace(/^### (.*$)/gim, "<h3>$1</h3>")
        .replace(/^## (.*$)/gim, "<h2>$1</h2>")
        .replace(/^# (.*$)/gim, "<h1>$1</h1>")
        .replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>")
        .replace(/\*(.*?)\*/gim, "<em>$1</em>")
        .replace(/^- (.*$)/gim, "<li>$1</li>")
        .replace(/\n/gim, "<br/>");

      const docContent = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body { font-family: Arial, sans-serif; line-height: 1.6; margin: 40px; }
h1 { color: #333; border-bottom: 2px solid #810FFB; padding-bottom: 10px; }
h2 { color: #555; margin-top: 30px; }
h3 { color: #666; }
li { margin: 5px 0; }
</style></head><body>${html}</body></html>`;

      const safeName = (report.name || "Relationship_Plan").replace(/[^a-zA-Z0-9]/g, "_");
      const filename = `${safeName}_${new Date().toISOString().split("T")[0]}.doc`;
      res.setHeader("Content-Type", "application/msword");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(docContent);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });
}
