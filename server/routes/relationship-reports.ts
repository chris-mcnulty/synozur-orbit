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

  // Generate or regenerate a relationship report for a competitor
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

      const started = Date.now();
      const result = await generateRelationshipReport({
        ctx: toContextFilter(ctx),
        competitor,
        baseline,
        customGuidance,
        posture,
        focus,
        isB2C,
      });
      const durationMs = Date.now() - started;

      await logAiUsage(
        ctx,
        "generate_relationship_report",
        "anthropic",
        "claude-sonnet-4-5",
        result.usage,
        durationMs,
      );

      const sourceDataAsOf = await computeLatestSourceDataTimestamp(ctx);
      const savedPrompts = { customGuidance: customGuidance || "", posture: posture || null, focus: focus || [] };

      const existing = await storage.getRelationshipReportByCompetitor(competitor.id, toContextFilter(ctx));

      if (existing) {
        const previousVersions = ((existing.savedPrompts as any)?.versionHistory || []) as any[];
        if (existing.content && existing.content !== result.content) {
          previousVersions.push({
            content: existing.content,
            savedAt: existing.updatedAt || existing.lastGeneratedAt || new Date(),
            savedBy: existing.generatedBy || ctx.userId,
          });
          if (previousVersions.length > 10) {
            previousVersions.splice(0, previousVersions.length - 10);
          }
        }
        const updated = await storage.updateRelationshipReport(existing.id, {
          content: result.content,
          status: "generated",
          targetName: competitor.name,
          targetUrl: competitor.url || existing.targetUrl,
          lastGeneratedAt: new Date(),
          generatedFromDataAsOf: sourceDataAsOf,
          generatedBy: ctx.userId,
          savedPrompts: { ...savedPrompts, versionHistory: previousVersions },
        });
        return res.json(updated);
      }

      const created = await storage.createRelationshipReport({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        companyProfileId: baseline?.id || null,
        competitorId: competitor.id,
        targetName: competitor.name,
        targetUrl: competitor.url,
        name: `Relationship Plan: ${competitor.name}`,
        content: result.content,
        savedPrompts,
        status: "generated",
        lastGeneratedAt: new Date(),
        generatedFromDataAsOf: sourceDataAsOf,
        generatedBy: ctx.userId,
        createdBy: ctx.userId,
      });
      res.json(created);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      console.error("Relationship report generation error:", error);
      res.status(500).json({ error: error.message || "Failed to generate relationship report" });
    }
  });

  // List all company profiles across all markets for the active tenant
  // (used by the frontend to populate the cross-market target picker)
  app.get("/api/relationship-reports/company-profiles", async (req, res) => {
    if (!await guardFeature(req, res, "relationshipReports")) return;
    try {
      const ctx = await getRequestContext(req);
      const profiles = await storage.getCompanyProfilesByTenantDomain(ctx.tenantDomain);
      res.json(profiles);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
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

      const started = Date.now();
      const result = await generateRelationshipReport({
        ctx: toContextFilter(ctx),
        targetProfile,
        baseline,
        customGuidance,
        posture,
        focus,
        isB2C,
      });
      const durationMs = Date.now() - started;

      await logAiUsage(
        ctx,
        "generate_relationship_report",
        "anthropic",
        "claude-sonnet-4-5",
        result.usage,
        durationMs,
      );

      const sourceDataAsOf = await computeLatestSourceDataTimestamp(ctx);
      const savedPrompts = { customGuidance: customGuidance || "", posture: posture || null, focus: focus || [] };

      const existing = await storage.getRelationshipReportByTargetProfile(targetProfile.id, toContextFilter(ctx));

      if (existing) {
        const previousVersions = ((existing.savedPrompts as any)?.versionHistory || []) as any[];
        if (existing.content && existing.content !== result.content) {
          previousVersions.push({
            content: existing.content,
            savedAt: existing.updatedAt || existing.lastGeneratedAt || new Date(),
            savedBy: existing.generatedBy || ctx.userId,
          });
          if (previousVersions.length > 10) previousVersions.splice(0, previousVersions.length - 10);
        }
        const updated = await storage.updateRelationshipReport(existing.id, {
          content: result.content,
          status: "generated",
          targetName: targetProfile.companyName,
          targetUrl: targetProfile.websiteUrl || existing.targetUrl,
          lastGeneratedAt: new Date(),
          generatedFromDataAsOf: sourceDataAsOf,
          generatedBy: ctx.userId,
          savedPrompts: { ...savedPrompts, versionHistory: previousVersions },
        });
        return res.json(updated);
      }

      const created = await storage.createRelationshipReport({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        companyProfileId: baseline?.id || null,
        targetCompanyProfileId: targetProfile.id,
        targetName: targetProfile.companyName,
        targetUrl: targetProfile.websiteUrl,
        name: `Relationship Plan: ${targetProfile.companyName}`,
        content: result.content,
        savedPrompts,
        status: "generated",
        lastGeneratedAt: new Date(),
        generatedFromDataAsOf: sourceDataAsOf,
        generatedBy: ctx.userId,
        createdBy: ctx.userId,
      });
      res.json(created);
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
