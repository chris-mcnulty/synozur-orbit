import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, count } from "drizzle-orm";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getRequestContext, ContextError } from "../context";
import { toContextFilter, validateResourceContext, hasAdminAccess, guardFeature } from "./helpers";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, competitors, companyProfiles } from "@shared/schema";
import { fromError } from "zod-validation-error";
import { z } from "zod";

export function registerPlatformRoutes(app: Express) {
  // ==================== PODCAST & SUBSCRIPTION ROUTES ====================

  app.post("/api/intelligence-briefings/:id/podcast", async (req, res) => {
    if (!await guardFeature(req, res, "podcastBriefings")) return;
    try {
      const ctx = await getRequestContext(req);
      const briefing = await storage.getIntelligenceBriefing(req.params.id);
      if (!briefing) {
        return res.status(404).json({ error: "Briefing not found" });
      }
      if (briefing.tenantDomain !== ctx.tenantDomain) {
        return res.status(403).json({ error: "Access denied" });
      }
      if (briefing.status !== "published" || !briefing.briefingData) {
        return res.status(400).json({ error: "Briefing must be published before generating podcast" });
      }
      const currentStatus = briefing.podcastStatus;
      if (currentStatus === "generating") {
        return res.status(409).json({ error: "Podcast is already being generated" });
      }

      res.json({ status: "generating", briefingId: briefing.id });

      (async () => {
        try {
          const { generatePodcastAudio } = await import("../services/podcast-audio-generator");
          await generatePodcastAudio(briefing.id, briefing.briefingData as import("../services/intelligence-briefing-service").BriefingData);
          console.log(`[Podcast] Generation complete for briefing ${briefing.id}`);
        } catch (error: any) {
          console.error(`[Podcast] Background generation failed for briefing ${briefing.id}:`, error);
        }
      })();
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/intelligence-briefings/:id/podcast-status", async (req, res) => {
    if (!await guardFeature(req, res, "podcastBriefings")) return;
    try {
      const ctx = await getRequestContext(req);
      const briefing = await storage.getIntelligenceBriefing(req.params.id);
      if (!briefing) {
        return res.status(404).json({ error: "Briefing not found" });
      }
      if (briefing.tenantDomain !== ctx.tenantDomain) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json({
        podcastStatus: briefing.podcastStatus || "none",
        podcastAudioUrl: briefing.podcastAudioUrl || null,
      });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/intelligence-briefings/:id/podcast-audio", async (req, res) => {
    if (!await guardFeature(req, res, "podcastBriefings")) return;
    try {
      const ctx = await getRequestContext(req);
      const briefing = await storage.getIntelligenceBriefing(req.params.id);
      if (!briefing) {
        return res.status(404).json({ error: "Briefing not found" });
      }
      if (briefing.tenantDomain !== ctx.tenantDomain) {
        return res.status(403).json({ error: "Access denied" });
      }
      if (briefing.podcastStatus !== "ready") {
        return res.status(404).json({ error: "Podcast audio not available" });
      }

      const { getPodcastAudioBuffer } = await import("../services/podcast-audio-generator");
      const buffer = await getPodcastAudioBuffer(briefing.id);
      if (!buffer) {
        return res.status(404).json({ error: "Audio file not found" });
      }

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.send(buffer);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/briefing-subscriptions", async (req, res) => {
    if (!await guardFeature(req, res, "scheduledBriefingUpdates")) return;
    try {
      const ctx = await getRequestContext(req);
      const subscription = await storage.getBriefingSubscription(ctx.userId, ctx.tenantDomain, ctx.marketId);
      res.json(subscription || { enabled: false, frequency: "weekly" });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/briefing-subscriptions", async (req, res) => {
    if (!await guardFeature(req, res, "scheduledBriefingUpdates")) return;
    try {
      const ctx = await getRequestContext(req);
      const { enabled, frequency } = req.body;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "enabled must be a boolean" });
      }
      const validFrequencies = ["weekly"];
      const freq = validFrequencies.includes(frequency) ? frequency : "weekly";

      const subscription = await storage.upsertBriefingSubscription({
        tenantDomain: ctx.tenantDomain,
        userId: ctx.userId,
        marketId: ctx.marketId,
        enabled,
        frequency: freq,
      });
      res.json(subscription);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/scheduled-briefing-config", async (req, res) => {
    if (!await guardFeature(req, res, "scheduledBriefingUpdates")) return;
    try {
      const ctx = await getRequestContext(req);
      const config = await storage.getScheduledBriefingConfig(ctx.tenantDomain, ctx.marketId);
      res.json(config || { enabled: false, frequency: "weekly" });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/scheduled-briefing-config", async (req, res) => {
    if (!await guardFeature(req, res, "scheduledBriefingUpdates")) return;
    try {
      const ctx = await getRequestContext(req);
      if (!hasAdminAccess(ctx.userRole)) {
        return res.status(403).json({ error: "Admin access required to configure scheduled briefings" });
      }
      const { enabled, frequency } = req.body;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "enabled must be a boolean" });
      }
      const validFrequencies = ["weekly"];
      const freq = validFrequencies.includes(frequency) ? frequency : "weekly";

      const config = await storage.upsertScheduledBriefingConfig({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        enabled,
        frequency: freq,
      });
      res.json(config);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== ADMIN: JOB QUEUE STATUS ====================

  app.get("/api/admin/queue-status", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Global Admin access required" });
      }
      const { getQueueStatus } = await import("../services/job-queue");
      res.json(getQueueStatus());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/queue-pause", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Global Admin access required" });
      }
      const { pauseQueue } = await import("../services/job-queue");
      pauseQueue();
      res.json({ success: true, message: "Queue paused" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/queue-resume", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Global Admin access required" });
      }
      const { resumeQueue } = await import("../services/job-queue");
      resumeQueue();
      res.json({ success: true, message: "Queue resumed" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== GLOBAL ADMIN: ORGANIZATION MANAGEMENT ====================

  app.get("/api/admin/organizations", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const status = (req.query.status as string) || "all";

      let orgs;
      if (status === "active") {
        orgs = await storage.getActiveOrganizations();
      } else if (status === "archived") {
        orgs = await storage.getArchivedOrganizations();
      } else {
        orgs = await storage.getAllOrganizations();
      }

      res.json(orgs);
    } catch (error: any) {
      console.error("[Admin Organizations] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/admin/organizations/:id/reactivate", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const { id } = req.params;
      const org = await storage.getOrganization(id);
      if (!org) {
        return res.status(404).json({ error: "Organization not found" });
      }

      if (org.status !== "archived") {
        return res.status(400).json({ error: "Organization is not archived" });
      }

      const competitorRefs = await db.select({ count: count() }).from(competitors).where(eq(competitors.organizationId, id));
      const profileRefs = await db.select({ count: count() }).from(companyProfiles).where(eq(companyProfiles.organizationId, id));
      const actualRefCount = (competitorRefs[0]?.count || 0) + (profileRefs[0]?.count || 0);

      const updated = await storage.updateOrganization(id, {
        status: "active",
        archivedAt: null,
        activeReferenceCount: actualRefCount,
      } as any);

      res.json(updated);
    } catch (error: any) {
      console.error("[Admin Organizations Reactivate] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/admin/organizations/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const { id } = req.params;
      const org = await storage.getOrganization(id);
      if (!org) {
        return res.status(404).json({ error: "Organization not found" });
      }

      if (org.activeReferenceCount > 0) {
        return res.status(400).json({ error: `Cannot delete organization with ${org.activeReferenceCount} active references. Remove all competitors and profiles referencing this organization first.` });
      }

      await storage.permanentlyDeleteOrganization(id);
      res.json({ success: true, message: "Organization permanently deleted" });
    } catch (error: any) {
      console.error("[Admin Organizations Delete] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== SHAREPOINT EMBEDDED (SPE) ADMIN ROUTES ====================
  // All SPE routes require Global Admin or Domain Admin role.
  // These routes manage containers and orphaned file cleanup.

  // GET /api/admin/spe/status — check SPE container accessibility for the current tenant
  app.get("/api/admin/spe/status", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || !["Global Admin", "Domain Admin"].includes(user.role)) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const { sharepointFileStorage } = await import("../services/sharepoint-file-storage.js");
      const ctx = await getRequestContext(req);
      const tenantRow = await storage.getTenantByDomain(ctx.tenantDomain);
      const { containerId, azureTenantId } = await sharepointFileStorage.getContainerForTenant(tenantRow?.id);

      if (!containerId) {
        return res.json({ configured: false, message: "No SPE container configured. Set ORBIT_SPE_CONTAINER_ID_DEV / ORBIT_SPE_CONTAINER_ID_PROD." });
      }

      const { containerCreator } = await import("../services/sharepoint-container-creator.js");
      const info = await containerCreator.getContainerInfo(containerId, azureTenantId);
      res.json({ configured: true, containerId: containerId.substring(0, 20) + "…", ...info });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/spe/container — create a new SPE container for a tenant
  // Domain Admins can create a container for their own tenant; Global Admins can specify a tenantId
  app.post("/api/admin/spe/container", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || !["Global Admin", "Domain Admin"].includes(user.role)) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const { containerName, description, azureTenantId, tenantId } = req.body as {
        containerName?: string;
        description?: string;
        azureTenantId?: string;
        tenantId?: string;
      };

      if (!containerName) return res.status(400).json({ error: "containerName is required" });

      const ctx = await getRequestContext(req);
      const callerTenant = await storage.getTenantByDomain(ctx.tenantDomain);
      if (!callerTenant) return res.status(404).json({ error: "Tenant not found" });

      const targetTenantId = user.role === "Global Admin" && tenantId ? tenantId : callerTenant.id;
      if (user.role === "Domain Admin" && tenantId && tenantId !== callerTenant.id) {
        return res.status(403).json({ error: "Domain Admins can only create containers for their own tenant" });
      }

      const targetTenant = tenantId && tenantId !== callerTenant.id
        ? await storage.getTenant(targetTenantId)
        : callerTenant;
      if (!targetTenant) return res.status(404).json({ error: "Target tenant not found" });

      const resolvedAzureTenantId = azureTenantId || targetTenant.entraTenantId || undefined;

      const { containerCreator } = await import("../services/sharepoint-container-creator.js");
      const result = await containerCreator.createContainer(containerName, description, resolvedAzureTenantId, user.email);

      if (result.success && result.containerId) {
        const isProduction = process.env.REPLIT_DEPLOYMENT === "1" || process.env.NODE_ENV === "production";
        await storage.updateTenantSpeConfig(targetTenantId, {
          ...(isProduction
            ? { speContainerIdProd: result.containerId }
            : { speContainerIdDev: result.containerId }),
          speStorageEnabled: true,
        });
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/spe/register-container-type — register Orbit's SPE container type in a tenant
  app.post("/api/admin/spe/register-container-type", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Global Admin access required" });
      }

      const { azureTenantId } = req.body as { azureTenantId?: string };
      if (!azureTenantId) return res.status(400).json({ error: "azureTenantId is required" });

      const { containerCreator } = await import("../services/sharepoint-container-creator.js");
      const result = await containerCreator.registerContainerTypeForTenant(azureTenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/spe/tenants — list all tenants' SPE container status (Global Admin only)
  app.get("/api/admin/spe/tenants", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Global Admin access required" });
      }

      const allTenants = await storage.getAllTenants();
      const isProduction = process.env.REPLIT_DEPLOYMENT === "1" || process.env.NODE_ENV === "production";
      const tenantSpeList = allTenants.map((t: any) => ({
        id: t.id,
        domain: t.domain,
        name: t.name,
        plan: t.plan,
        status: t.status,
        speStorageEnabled: t.speStorageEnabled || false,
        hasContainer: isProduction
          ? !!(t.speContainerIdProd)
          : !!(t.speContainerIdDev),
        containerId: isProduction
          ? (t.speContainerIdProd ? t.speContainerIdProd.substring(0, 20) + "..." : null)
          : (t.speContainerIdDev ? t.speContainerIdDev.substring(0, 20) + "..." : null),
        entraTenantId: t.entraTenantId || null,
      }));
      res.json(tenantSpeList);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/spe/stats — storage statistics for the current tenant's SPE container
  app.get("/api/admin/spe/stats", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || !["Global Admin", "Domain Admin"].includes(user.role)) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const ctx = await getRequestContext(req);
      const tenantRow = await storage.getTenantByDomain(ctx.tenantDomain);
      const { sharepointFileStorage } = await import("../services/sharepoint-file-storage.js");
      const stats = await sharepointFileStorage.getStorageStats(tenantRow?.id);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/spe/orphans — scan for orphaned files (dry-run report)
  app.get("/api/admin/spe/orphans", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || !["Global Admin", "Domain Admin"].includes(user.role)) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const ctx = await getRequestContext(req);
      const tenantRow = await storage.getTenantByDomain(ctx.tenantDomain);
      const { orphanedFileManager } = await import("../services/sharepoint-orphan-cleaner.js");
      const report = await orphanedFileManager.getOrphanReport(tenantRow?.id);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/spe/orphans/scan — detailed orphan scan with full file listing
  app.post("/api/admin/spe/orphans/scan", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || !["Global Admin", "Domain Admin"].includes(user.role)) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const ctx = await getRequestContext(req);
      const tenantRow = await storage.getTenantByDomain(ctx.tenantDomain);
      const { orphanedFileManager } = await import("../services/sharepoint-orphan-cleaner.js");
      const result = await orphanedFileManager.scanForOrphans(tenantRow?.id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/spe/orphans/cleanup — delete orphaned files
  // Body: { dryRun?: boolean, maxDelete?: number }
  // dryRun defaults to TRUE for safety — pass dryRun: false to actually delete
  app.post("/api/admin/spe/orphans/cleanup", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Global Admin access required for orphan deletion" });
      }

      const { dryRun = true, maxDelete = 100 } = req.body as { dryRun?: boolean; maxDelete?: number };

      const ctx = await getRequestContext(req);
      const tenantRow = await storage.getTenantByDomain(ctx.tenantDomain);
      const { orphanedFileManager } = await import("../services/sharepoint-orphan-cleaner.js");
      const result = await orphanedFileManager.runOrphanCleanup({ dryRun, tenantId: tenantRow?.id, maxDelete });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/spe/orphans/delete — delete a specific list of known orphan IDs
  // Body: { speFileIds: string[] }
  app.post("/api/admin/spe/orphans/delete", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Global Admin access required" });
      }

      const { speFileIds } = req.body as { speFileIds?: string[] };
      if (!Array.isArray(speFileIds) || speFileIds.length === 0) {
        return res.status(400).json({ error: "speFileIds array is required" });
      }

      const ctx = await getRequestContext(req);
      const tenantRow = await storage.getTenantByDomain(ctx.tenantDomain);
      const { orphanedFileManager } = await import("../services/sharepoint-orphan-cleaner.js");
      const result = await orphanedFileManager.deleteOrphans(speFileIds, tenantRow?.id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/spe/file/:speFileId/content — serve a file stored in SPE
  app.get("/api/admin/spe/file/:speFileId/content", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || !["Global Admin", "Domain Admin"].includes(user.role)) {
        return res.status(403).json({ error: "Global Admin or Domain Admin access required" });
      }
      const ctx = await getRequestContext(req);
      const tenantRow = await storage.getTenantByDomain(ctx.tenantDomain);

      const { sharepointFileStorage } = await import("../services/sharepoint-file-storage.js");
      const result = await sharepointFileStorage.getFileContent(req.params.speFileId, tenantRow?.id);

      if (!result) return res.status(404).json({ error: "File not found in SPE container" });

      res.set({
        "Content-Type": result.metadata.contentType,
        "Content-Length": String(result.buffer.length),
        "Content-Disposition": `inline; filename="${result.metadata.originalName}"`,
        "Cache-Control": "private, max-age=3600",
      });
      res.send(result.buffer);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== SUPPORT TICKET ROUTES ====================

  app.post("/api/support/tickets", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const ctx = await getRequestContext(req);

      const createTicketSchema = z.object({
        subject: z.string().min(1, "Subject is required").max(500),
        description: z.string().min(1, "Description is required").max(10000),
        category: z.enum(TICKET_CATEGORIES).default("question"),
        priority: z.enum(TICKET_PRIORITIES).default("medium"),
      });

      const parsed = createTicketSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const ticket = await storage.createSupportTicket({
        userId: user.id,
        tenantDomain: ctx.tenantDomain,
        subject: parsed.data.subject,
        description: parsed.data.description,
        category: parsed.data.category,
        priority: parsed.data.priority,
        status: "open",
      });

      try {
        const { sendSupportTicketNotification, sendSupportTicketConfirmation } = await import("../services/email-service");
        sendSupportTicketNotification(ticket, user).catch(err => console.error("[Support Email] Notification failed:", err));
        sendSupportTicketConfirmation(ticket, user).catch(err => console.error("[Support Email] Confirmation failed:", err));
      } catch (err) {
        console.error("[Support Email] Import failed:", err);
      }

      res.json(ticket);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/support/tickets", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const tickets = await storage.getSupportTicketsByUser(req.session.userId);
      res.json(tickets);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/support/tickets/:id", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const ticket = await storage.getSupportTicket(req.params.id);
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });

      if (ticket.userId !== user.id && !hasAdminAccess(user.role)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const replies = await storage.getSupportTicketReplies(ticket.id);
      const userIds = new Set([ticket.userId, ...replies.map(r => r.userId)]);
      if (ticket.assignedTo) userIds.add(ticket.assignedTo);

      const userMap: Record<string, { name: string; email: string; role: string }> = {};
      for (const uid of userIds) {
        const u = await storage.getUser(uid);
        if (u) userMap[uid] = { name: u.name, email: u.email, role: u.role };
      }

      const filteredReplies = hasAdminAccess(user.role) 
        ? replies 
        : replies.filter(r => !r.isInternal);

      res.json({ ...ticket, replies: filteredReplies, users: userMap });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/support/tickets/:id", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const ticket = await storage.getSupportTicket(req.params.id);
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });

      const isAdmin = hasAdminAccess(user.role);
      const isOwner = ticket.userId === user.id;

      if (!isAdmin && !isOwner) {
        return res.status(403).json({ error: "Access denied" });
      }

      const updateTicketSchema = z.object({
        status: z.enum(TICKET_STATUSES).optional(),
        priority: z.enum(TICKET_PRIORITIES).optional(),
        category: z.enum(TICKET_CATEGORIES).optional(),
        subject: z.string().min(1).max(500).optional(),
        description: z.string().min(1).max(10000).optional(),
        assignedTo: z.string().nullable().optional(),
      }).strict();

      const parsed = updateTicketSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const adminFields = new Set(["status", "priority", "assignedTo", "category"]);
      const ownerFields = new Set(["subject", "description", "status", "priority", "category"]);

      const updateData: Record<string, any> = {};
      for (const [key, value] of Object.entries(parsed.data)) {
        if (value === undefined) continue;
        if (isAdmin && adminFields.has(key)) {
          updateData[key] = value;
        } else if (isOwner && ticket.status === "open" && ownerFields.has(key)) {
          updateData[key] = value;
        }
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      const updated = await storage.updateSupportTicket(ticket.id, updateData);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/support/tickets/:id/replies", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const ticket = await storage.getSupportTicket(req.params.id);
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });

      const isAdmin = hasAdminAccess(user.role);
      if (ticket.userId !== user.id && !isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }

      const replySchema = z.object({
        message: z.string().min(1, "Message is required").max(10000),
        isInternal: z.boolean().default(false),
      });

      const parsed = replySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const reply = await storage.createSupportTicketReply({
        ticketId: ticket.id,
        userId: user.id,
        message: parsed.data.message,
        isInternal: isAdmin ? parsed.data.isInternal : false,
      });

      res.json(reply);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/support/tickets", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || !hasAdminAccess(user.role)) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const tickets = user.role === "Global Admin"
        ? await storage.getAllSupportTickets()
        : await storage.getSupportTicketsByTenant(user.company);

      const userIds = new Set(tickets.map(t => t.userId));
      tickets.forEach(t => { if (t.assignedTo) userIds.add(t.assignedTo); });
      
      const userMap: Record<string, { name: string; email: string; role: string }> = {};
      for (const uid of userIds) {
        const u = await storage.getUser(uid);
        if (u) userMap[uid] = { name: u.name, email: u.email, role: u.role };
      }

      const domainUsers = await storage.getUsersByDomain(user.company);
      const adminUsers = domainUsers
        .filter(u => u.role === "Global Admin" || u.role === "Domain Admin")
        .map(u => ({ id: u.id, name: u.name, email: u.email }));

      res.json({ tickets, users: userMap, adminUsers });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== WHAT'S NEW / CHANGELOG API ====================

  app.get("/api/changelog/whats-new", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const { CURRENT_APP_VERSION, WHATS_NEW_SUMMARY, WHATS_NEW_HIGHLIGHTS } = await import("@shared/schema");
      
      const showModal = !user.lastDismissedChangelogVersion || user.lastDismissedChangelogVersion !== CURRENT_APP_VERSION;

      res.json({
        showModal,
        version: CURRENT_APP_VERSION,
        summary: WHATS_NEW_SUMMARY,
        highlights: WHATS_NEW_HIGHLIGHTS,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/changelog/dismiss", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      
      const { CURRENT_APP_VERSION } = await import("@shared/schema");
      await storage.updateUser(req.session.userId, { lastDismissedChangelogVersion: CURRENT_APP_VERSION });
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

}
