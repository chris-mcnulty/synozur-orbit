import type { Express } from "express";
import { storage } from "../storage";
import { getRequestContext, ContextError } from "../context";
import { toContextFilter, validateResourceContext } from "./helpers";
import { insertActivitySchema } from "@shared/schema";
import { fromError } from "zod-validation-error";
import {
  getNotificationsForUser,
  getUnreadCount,
  markNotificationRead,
  markAllRead,
  deleteNotification,
  clearAllNotifications,
} from "../services/notification-service";

export function registerNotificationsActivityRoutes(app: Express) {
  // ==================== NOTIFICATION CENTRE ROUTES ====================

  // GET /api/notifications — list notifications for the current user
  app.get("/api/notifications", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const unreadOnly = req.query.unread === "true";
      const [notifs, unread] = await Promise.all([
        getNotificationsForUser(req.session.userId, { unreadOnly }),
        getUnreadCount(req.session.userId),
      ]);
      res.json({ notifications: notifs, unreadCount: unread });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/notifications/unread-count — lightweight badge poll
  app.get("/api/notifications/unread-count", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const count = await getUnreadCount(req.session.userId);
      res.json({ count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/notifications/:id/read — mark one notification as read
  app.patch("/api/notifications/:id/read", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      await markNotificationRead(req.params.id, req.session.userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/notifications/mark-all-read — mark all unread as read
  app.post("/api/notifications/mark-all-read", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      await markAllRead(req.session.userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/notifications/:id — remove a single notification
  app.delete("/api/notifications/:id", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      await deleteNotification(req.params.id, req.session.userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/notifications — clear all notifications for current user
  app.delete("/api/notifications", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      await clearAllNotifications(req.session.userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== ACTIVITY ROUTES ====================

  app.get("/api/activity", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const activities = await storage.getActivityByContext(toContextFilter(ctx));
      res.json(activities);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/activity", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const parsed = insertActivitySchema.safeParse({
        ...req.body,
        userId: ctx.userId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const newActivity = await storage.createActivity(parsed.data);
      res.json(newActivity);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/activity/by-company-profile/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const rawLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
      const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 10 : rawLimit), 50);
      const activities = await storage.getActivityByCompanyProfile(req.params.id, limit);
      res.json(activities);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/activity/by-product/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const rawLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
      const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 10 : rawLimit), 50);
      const activities = await storage.getActivityByProduct(req.params.id, limit);
      res.json(activities);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== CONSOLIDATED ACTION ITEMS ====================

  app.get("/api/action-items", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const contextFilter = toContextFilter(ctx);

      const [recommendations, featureRecs, latestAnalysis, allProducts, gapDismissalsList] = await Promise.all([
        storage.getRecommendationsByContext(contextFilter),
        storage.getFeatureRecommendationsByContext(contextFilter),
        storage.getLatestAnalysisByContext(contextFilter),
        storage.getProductsByContext(contextFilter),
        storage.getGapDismissalsByContext(contextFilter),
      ]);

      const productMap = new Map(allProducts.map(p => [p.id, p.name]));
      const dismissedGapKeys = new Set(gapDismissalsList.filter(d => d.status === "dismissed").map(d => d.dedupeKey));
      const acceptedGapKeys = new Map(gapDismissalsList.filter(d => d.status === "accepted").map(d => [d.dedupeKey, d]));

      const actionItems: any[] = [];

      for (const rec of recommendations) {
        actionItems.push({
          id: rec.id,
          type: "recommendation",
          title: rec.title,
          description: rec.description,
          area: rec.area,
          impact: rec.impact,
          status: rec.status,
          isPriority: rec.isPriority,
          thumbsUp: rec.thumbsUp,
          thumbsDown: rec.thumbsDown,
          source: "Competitive Intelligence",
          sourceId: rec.competitorId || null,
          productName: rec.productId ? productMap.get(rec.productId) || null : null,
          assignedTo: rec.assignedTo,
          createdAt: rec.createdAt,
        });
      }

      for (const fr of featureRecs) {
        actionItems.push({
          id: fr.id,
          type: "feature_recommendation",
          title: fr.title,
          description: fr.explanation,
          area: fr.type,
          impact: fr.suggestedPriority === "high" ? "High" : fr.suggestedPriority === "medium" ? "Medium" : "Low",
          status: fr.status,
          isPriority: fr.suggestedPriority === "high",
          thumbsUp: 0,
          thumbsDown: 0,
          source: "Product Roadmap",
          sourceId: fr.productId,
          productName: productMap.get(fr.productId) || null,
          suggestedQuarter: fr.suggestedQuarter,
          assignedTo: null,
          createdAt: fr.createdAt,
        });
      }

      const gaps = Array.isArray(latestAnalysis?.gaps) ? latestAnalysis.gaps : [];
      for (const gap of gaps as any[]) {
        if (gap.status === "dismissed") continue;
        const gapId = gap.id || `gap-${gap.area || gap.title || "unknown"}`;
        const gapTitle = gap.area || gap.title || gap.name || "Gap Identified";
        const dedupeKey = `${gapTitle.toLowerCase().replace(/[^a-z0-9]/g, "")}_gap`;
        if (dismissedGapKeys.has(dedupeKey)) {
          actionItems.push({
            id: gapId,
            type: "gap",
            title: gapTitle,
            description: gap.observation || gap.description || gap.details || "",
            area: "Gap Analysis",
            impact: gap.impact || "Medium",
            status: "dismissed",
            isPriority: gap.impact === "High",
            thumbsUp: 0,
            thumbsDown: 0,
            source: "Gap Analysis",
            sourceId: null,
            productName: null,
            opportunity: gap.opportunity || gap.recommendation || "",
            assignedTo: null,
            createdAt: latestAnalysis?.createdAt || null,
          });
          continue;
        }
        const acceptedEntry = acceptedGapKeys.get(dedupeKey);
        actionItems.push({
          id: gapId,
          type: "gap",
          title: gapTitle,
          description: gap.observation || gap.description || gap.details || "",
          area: "Gap Analysis",
          impact: gap.impact || "Medium",
          status: acceptedEntry ? "accepted" : (gap.status || "pending"),
          isPriority: gap.impact === "High",
          thumbsUp: 0,
          thumbsDown: 0,
          source: "Gap Analysis",
          sourceId: null,
          productName: null,
          opportunity: gap.opportunity || gap.recommendation || "",
          assignedTo: null,
          createdAt: latestAnalysis?.createdAt || null,
        });
      }

      actionItems.sort((a, b) => {
        if (a.isPriority && !b.isPriority) return -1;
        if (!a.isPriority && b.isPriority) return 1;
        const impactOrder: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
        const aImpact = impactOrder[a.impact] ?? 2;
        const bImpact = impactOrder[b.impact] ?? 2;
        if (aImpact !== bImpact) return aImpact - bImpact;
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      });

      res.json(actionItems);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/gap-items/:id/dismiss", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const contextFilter = toContextFilter(ctx);
      const { reason } = req.body || {};
      const gapIdentifier = req.params.id;
      const { title } = req.body || {};
      const gapTitle = title || gapIdentifier;
      const dedupeKey = `${gapTitle.toLowerCase().replace(/[^a-z0-9]/g, "")}_gap`;

      const existing = await storage.getGapDismissalByDedupeKey(dedupeKey, ctx.tenantDomain, contextFilter.marketId);
      if (existing) {
        const updated = await storage.updateGapDismissal(existing.id, {
          status: "dismissed",
          reason: reason || "not_relevant",
        });
        return res.json(updated);
      }

      const dismissal = await storage.createGapDismissal({
        gapIdentifier,
        dedupeKey,
        status: "dismissed",
        reason: reason || "not_relevant",
        tenantDomain: ctx.tenantDomain,
        marketId: contextFilter.marketId || null,
        dismissedBy: ctx.userId,
      });
      res.json(dismissal);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/gap-items/:id/accept", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const contextFilter = toContextFilter(ctx);
      const gapIdentifier = req.params.id;
      const { title } = req.body || {};
      const gapTitle = title || gapIdentifier;
      const dedupeKey = `${gapTitle.toLowerCase().replace(/[^a-z0-9]/g, "")}_gap`;

      const existing = await storage.getGapDismissalByDedupeKey(dedupeKey, ctx.tenantDomain, contextFilter.marketId);
      if (existing) {
        const updated = await storage.updateGapDismissal(existing.id, {
          status: "accepted",
        });
        return res.json(updated);
      }

      const record = await storage.createGapDismissal({
        gapIdentifier,
        dedupeKey,
        status: "accepted",
        reason: null,
        tenantDomain: ctx.tenantDomain,
        marketId: contextFilter.marketId || null,
        dismissedBy: ctx.userId,
      });
      res.json(record);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/action-items/bulk-update", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const contextFilter = toContextFilter(ctx);
      const { items, action } = req.body;
      if (!Array.isArray(items) || !["accept", "dismiss"].includes(action)) {
        return res.status(400).json({ error: "Invalid request: items array and action (accept/dismiss) required" });
      }

      const reason = req.body.reason || "not_relevant";
      const results: any[] = [];

      for (const item of items) {
        const { id, type, title, sourceId } = item;
        try {
          if (type === "recommendation") {
            const rec = await storage.getRecommendation(id);
            if (!rec || (rec.tenantDomain !== ctx.tenantDomain)) {
              results.push({ id, success: false, error: "Not found or access denied" });
              continue;
            }
            if (action === "dismiss") {
              const dedupeKey = `${rec.title.toLowerCase().replace(/[^a-z0-9]/g, "")}_${rec.area.toLowerCase()}`;
              await storage.updateRecommendation(id, {
                status: "dismissed",
                dismissedAt: new Date(),
                dismissedReason: reason,
                dismissedBy: ctx.userId,
                dedupeKey,
              });
            } else {
              await storage.updateRecommendation(id, { status: "accepted", acceptedAt: new Date() });
            }
            results.push({ id, success: true });
          } else if (type === "feature_recommendation" && sourceId) {
            const rec = await storage.getFeatureRecommendation(id);
            if (!rec || rec.tenantDomain !== ctx.tenantDomain) {
              results.push({ id, success: false, error: "Not found or access denied" });
              continue;
            }
            await storage.updateFeatureRecommendation(id, { status: action === "dismiss" ? "dismissed" : "accepted" });
            results.push({ id, success: true });
          } else if (type === "gap") {
            const gapTitle = title || id;
            const dedupeKey = `${gapTitle.toLowerCase().replace(/[^a-z0-9]/g, "")}_gap`;
            const existing = await storage.getGapDismissalByDedupeKey(dedupeKey, ctx.tenantDomain, contextFilter.marketId);
            if (existing) {
              await storage.updateGapDismissal(existing.id, {
                status: action === "dismiss" ? "dismissed" : "accepted",
                reason: action === "dismiss" ? reason : null,
              });
            } else {
              await storage.createGapDismissal({
                gapIdentifier: id,
                dedupeKey,
                status: action === "dismiss" ? "dismissed" : "accepted",
                reason: action === "dismiss" ? reason : null,
                tenantDomain: ctx.tenantDomain,
                marketId: contextFilter.marketId || null,
                dismissedBy: ctx.userId,
              });
            }
            results.push({ id, success: true });
          }
        } catch (err: any) {
          results.push({ id, success: false, error: err.message });
        }
      }

      res.json({ results, updated: results.filter(r => r.success).length });
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });


}
