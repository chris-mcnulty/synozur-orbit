import type { Express } from "express";
import { storage } from "../storage";
import { getRequestContext, ContextError } from "../context";
import { toContextFilter, validateResourceContext, computeLatestSourceDataTimestamp, guardFeature } from "./helpers";
import { insertRecommendationSchema, insertReportSchema, insertAnalysisSchema } from "@shared/schema";
import { fromError } from "zod-validation-error";

export function registerReportsAnalysisRoutes(app: Express) {
  // ==================== RECOMMENDATION ROUTES ====================

  app.get("/api/recommendations", async (req, res) => {
    if (!await guardFeature(req, res, "recommendations")) return;
    try {
      const ctx = await getRequestContext(req);
      const recommendations = await storage.getRecommendationsByContext(toContextFilter(ctx));
      res.json(recommendations);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/recommendations", async (req, res) => {
    if (!await guardFeature(req, res, "recommendations")) return;
    try {
      const ctx = await getRequestContext(req);

      const parsed = insertRecommendationSchema.safeParse({
        ...req.body,
        userId: ctx.userId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const recommendation = await storage.createRecommendation(parsed.data);
      res.json(recommendation);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== REPORT ROUTES ====================

  app.get("/api/reports", async (req, res) => {
    if (!await guardFeature(req, res, "pdfReports")) return;
    try {
      const ctx = await getRequestContext(req);
      const reports = await storage.getReportsByContext(toContextFilter(ctx));
      res.json(reports);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/reports/generate", async (req, res) => {
    if (!await guardFeature(req, res, "pdfReports")) return;
    try {
      const ctx = await getRequestContext(req);
      const tenant = await storage.getTenant(ctx.tenantId);

      const { scope, projectId, name, includeStrategicPlans } = req.body;

      // Validate scope
      if (scope && !["baseline", "project"].includes(scope)) {
        return res.status(400).json({ error: "Invalid scope. Must be 'baseline' or 'project'" });
      }

      // If project scope, validate project access (owner or Global Admin only)
      if (scope === "project") {
        if (!projectId) {
          return res.status(400).json({ error: "Project ID is required for project scope" });
        }
        const project = await storage.getClientProject(projectId);
        if (!project) {
          return res.status(404).json({ error: "Project not found" });
        }
        
        // Validate project belongs to current context
        if (!validateResourceContext(project, ctx)) {
          return res.status(403).json({ error: "Access denied" });
        }
        
        const user = await storage.getUser(ctx.userId);
        const isOwner = project.ownerUserId === ctx.userId;
        const isGlobalAdmin = user?.role === "Global Admin";
        if (!isOwner && !isGlobalAdmin) {
          return res.status(403).json({ error: "Access denied. Only project owners can generate project reports." });
        }
      }

      const { generatePdfReport } = await import("../services/pdf-generator");
      const { enqueuePdf } = await import("../services/job-queue");
      const reportName = name || `Competitive Analysis - ${new Date().toLocaleDateString()}`;
      const { pdfBuffer, report } = await enqueuePdf("report-pdf", () => generatePdfReport(
        ctx.tenantDomain,
        ctx.userId,
        reportName,
        scope || "baseline",
        projectId,
        !!includeStrategicPlans,
        ctx.marketId || undefined
      ));

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${reportName.replace(/[^a-zA-Z0-9]/g, "_")}.pdf"`);
      res.setHeader("X-Report-Id", report.id);
      res.send(pdfBuffer);

      // Store to SPE (fire-and-forget)
      if (tenant?.speStorageEnabled) {
        const speReportType = includeStrategicPlans ? "full_analysis" : scope === "project" ? "project_report" : "competitive_analysis";
        const speFileName = `${reportName.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
        import("../services/sharepoint-file-storage.js").then(({ sharepointFileStorage }) =>
          sharepointFileStorage.storeFile(pdfBuffer, speFileName, "application/pdf", {
            documentType: "report",
            scope: "tenant",
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || undefined,
            createdByUserId: ctx.userId,
            fileType: "pdf",
            originalFileName: speFileName,
            reportType: speReportType,
          }, ctx.userId, report.id, tenant.id)
        ).catch((err) => console.error("[SPE] Failed to store report PDF:", err));
      }
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("PDF generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Full analysis PDF report (includes GTM Plan and Messaging Framework)
  app.get("/api/reports/full-analysis/pdf", async (req, res) => {
    if (!await guardFeature(req, res, "pdfReports")) return;
    try {
      const ctx = await getRequestContext(req);

      const { generatePdfReport } = await import("../services/pdf-generator");
      const { enqueuePdf } = await import("../services/job-queue");
      const reportName = `Full Analysis Report - ${new Date().toLocaleDateString()}`;
      
      const { pdfBuffer, report } = await enqueuePdf("full-analysis-pdf", () => generatePdfReport(
        ctx.tenantDomain,
        ctx.userId,
        reportName,
        "baseline",
        undefined,
        true,
        ctx.marketId || undefined
      ));

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Full_Analysis_Report_${new Date().toISOString().split('T')[0]}.pdf"`);
      res.setHeader("X-Report-Id", report.id);
      res.send(pdfBuffer);

      // Store to SPE (fire-and-forget)
      const speFileName = `Full_Analysis_Report_${new Date().toISOString().split('T')[0]}.pdf`;
      Promise.resolve().then(async () => {
        const t = await storage.getTenantByDomain(ctx.tenantDomain);
        if (!t?.speStorageEnabled) return;
        const { sharepointFileStorage } = await import("../services/sharepoint-file-storage.js");
        return sharepointFileStorage.storeFile(pdfBuffer, speFileName, "application/pdf", {
          documentType: "report",
          scope: "tenant",
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId || undefined,
          createdByUserId: ctx.userId,
          fileType: "pdf",
          originalFileName: speFileName,
          reportType: "full_analysis",
        }, ctx.userId, report.id, t.id);
      }).catch((err) => console.error("[SPE] Failed to store full analysis PDF:", err));
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Full analysis PDF generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Competitor-specific PDF report
  app.get("/api/competitors/:id/report/pdf", async (req, res) => {
    if (!await guardFeature(req, res, "pdfReports")) return;
    try {
      const ctx = await getRequestContext(req);
      const { id } = req.params;

      const competitor = await storage.getCompetitor(id);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { generateCompetitorPdfReport } = await import("../services/pdf-generator");
      const { enqueuePdf } = await import("../services/job-queue");
      const { pdfBuffer, report } = await enqueuePdf(`competitor-pdf:${id}`, () => generateCompetitorPdfReport(
        id,
        ctx.tenantDomain,
        ctx.userId,
        ctx.marketId || undefined
      ));

      const filename = `Competitor_Report_${competitor.name.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().split('T')[0]}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("X-Report-Id", report.id);
      res.send(pdfBuffer);

      // Store to SPE (fire-and-forget)
      Promise.resolve().then(async () => {
        const t = await storage.getTenantByDomain(ctx.tenantDomain);
        if (!t?.speStorageEnabled) return;
        const { sharepointFileStorage } = await import("../services/sharepoint-file-storage.js");
        return sharepointFileStorage.storeFile(pdfBuffer, filename, "application/pdf", {
          documentType: "report",
          scope: "competitor",
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId || undefined,
          competitorId: id,
          createdByUserId: ctx.userId,
          fileType: "pdf",
          originalFileName: filename,
          reportType: "competitor_intelligence",
        }, ctx.userId, report.id, t.id);
      }).catch((err) => console.error("[SPE] Failed to store competitor PDF:", err));
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Competitor PDF generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/reports", async (req, res) => {
    if (!await guardFeature(req, res, "pdfReports")) return;
    try {
      const ctx = await getRequestContext(req);
      const { scope, projectId, name } = req.body;

      // Validate scope
      if (scope && !["baseline", "project"].includes(scope)) {
        return res.status(400).json({ error: "Invalid scope. Must be 'baseline' or 'project'" });
      }

      // If project scope, validate project access (owner or Global Admin only)
      if (scope === "project") {
        if (!projectId) {
          return res.status(400).json({ error: "Project ID is required for project scope" });
        }
        const project = await storage.getClientProject(projectId);
        if (!project) {
          return res.status(404).json({ error: "Project not found" });
        }
        
        // Validate project belongs to current context
        if (!validateResourceContext(project, ctx)) {
          return res.status(403).json({ error: "Access denied" });
        }
        
        // Require project owner or Global Admin for project-scoped reports
        const user = await storage.getUser(ctx.userId);
        const isOwner = project.ownerUserId === ctx.userId;
        const isGlobalAdmin = user?.role === "Global Admin";
        if (!isOwner && !isGlobalAdmin) {
          return res.status(403).json({ error: "Access denied. Only project owners can generate project reports." });
        }
      }

      const user = await storage.getUser(ctx.userId);
      const sourceDataAsOf = await computeLatestSourceDataTimestamp(ctx);
      const reportData = {
        name: name || `Report - ${new Date().toLocaleDateString()}`,
        date: new Date().toLocaleDateString(),
        type: "PDF",
        size: "Generating...",
        author: user?.name || user?.email || "Unknown",
        status: "Generating",
        scope: scope || "baseline",
        projectId: scope === "project" ? projectId : null,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        createdBy: ctx.userId,
        generatedFromDataAsOf: sourceDataAsOf,
      };

      const parsed = insertReportSchema.safeParse(reportData);
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const report = await storage.createReport(parsed.data);
      res.json(report);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a report (Domain Admin or Global Admin only)
  app.delete("/api/reports/:id", async (req, res) => {
    if (!await guardFeature(req, res, "pdfReports")) return;
    try {
      const ctx = await getRequestContext(req);
      const user = await storage.getUser(ctx.userId);
      
      if (!user || (user.role !== "Domain Admin" && user.role !== "Global Admin")) {
        return res.status(403).json({ error: "Admin access required to delete reports" });
      }
      
      const report = await storage.getReport(req.params.id);
      if (!report) {
        return res.status(404).json({ error: "Report not found" });
      }
      
      if (report.tenantDomain !== ctx.tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }
      
      await storage.deleteReport(req.params.id);
      res.json({ success: true, message: "Report deleted" });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Delete report error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Clear all recommendations (Domain Admin or Global Admin only)
  app.delete("/api/recommendations/clear", async (req, res) => {
    if (!await guardFeature(req, res, "recommendations")) return;
    try {
      const ctx = await getRequestContext(req);
      const user = await storage.getUser(ctx.userId);
      
      if (!user || (user.role !== "Domain Admin" && user.role !== "Global Admin")) {
        return res.status(403).json({ error: "Admin access required to clear recommendations" });
      }
      
      const count = await storage.clearRecommendationsByContext(toContextFilter(ctx));
      res.json({ success: true, message: `${count} recommendations cleared` });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Clear recommendations error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== ANALYSIS ROUTES ====================

  app.get("/api/analysis", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const tenantAnalysis = await storage.getLatestAnalysisByContext(toContextFilter(ctx));
      res.json(tenantAnalysis || null);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/analysis", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const parsed = insertAnalysisSchema.safeParse({
        ...req.body,
        userId: ctx.userId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const analysis = await storage.createAnalysis(parsed.data);
      res.json(analysis);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });


}
