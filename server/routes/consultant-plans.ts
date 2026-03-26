import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { sql, eq, and, count } from "drizzle-orm";
import { getRequestContext, ContextError } from "../context";
import { hasAdminAccess, grantConsultantAccessSchema } from "./helpers";
import { invalidatePlanCache, FEATURE_REGISTRY, FEATURE_CATEGORIES } from "../services/plan-policy";
import { fromError } from "zod-validation-error";
import { getAllProviderStatuses, getAvailableModelsByProvider, invalidateAIConfigCache } from "../services/ai-provider";
import { AI_FEATURES, AI_MODELS, AI_MODEL_INFO, AI_FEATURE_LABELS, AI_PROVIDERS, AI_PROVIDER_LABELS, aiConfiguration, aiFeatureModelAssignments, aiUsageAlerts, type AIFeature } from "@shared/schema";

export function registerConsultantPlansRoutes(app: Express) {
  // ==================== CONSULTANT ACCESS MANAGEMENT ====================

  // Get consultant access grants for current tenant (admin only)
  app.get("/api/tenant-access", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      if (!hasAdminAccess(user.role)) {
        return res.status(403).json({ error: "Access denied - admin privileges required" });
      }

      const userDomain = user.email.split("@")[1];
      const userTenant = await storage.getTenantByDomain(userDomain);
      
      const targetTenantId = req.session.activeTenantId || userTenant?.id;
      if (!targetTenantId) {
        return res.status(400).json({ error: "No tenant context available" });
      }

      const grants = await storage.getConsultantAccessByTenant(targetTenantId);
      
      const enrichedGrants = await Promise.all(grants.map(async (grant) => {
        const consultant = await storage.getUser(grant.userId);
        const grantedByUser = await storage.getUser(grant.grantedBy);
        return {
          ...grant,
          consultantEmail: consultant?.email,
          consultantName: consultant?.name,
          grantedByName: grantedByUser?.name
        };
      }));

      res.json(enrichedGrants);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Grant consultant access to current tenant
  app.post("/api/tenant-access", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const parsed = grantConsultantAccessSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      if (!hasAdminAccess(user.role)) {
        return res.status(403).json({ error: "Access denied - admin privileges required" });
      }

      const { consultantUserId } = parsed.data;
      const consultant = await storage.getUser(consultantUserId);
      if (!consultant) {
        return res.status(404).json({ error: "Consultant user not found" });
      }

      if (consultant.role !== "Consultant") {
        return res.status(400).json({ error: "User is not a Consultant. Only users with Consultant role can be granted cross-tenant access." });
      }

      const userDomain = user.email.split("@")[1];
      const userTenant = await storage.getTenantByDomain(userDomain);
      
      if (user.role === "Domain Admin" && req.session.activeTenantId && req.session.activeTenantId !== userTenant?.id) {
        return res.status(403).json({ error: "Domain Admins can only grant access to their own tenant" });
      }

      const targetTenantId = (user.role === "Domain Admin") ? userTenant?.id : (req.session.activeTenantId || userTenant?.id);
      if (!targetTenantId) {
        return res.status(400).json({ error: "No tenant context available" });
      }

      const existingAccess = await storage.getActiveConsultantAccess(consultantUserId, targetTenantId);
      if (existingAccess) {
        return res.status(400).json({ error: "Consultant already has active access to this tenant" });
      }

      const access = await storage.createConsultantAccess({
        userId: consultantUserId,
        tenantId: targetTenantId,
        status: "active",
        grantedBy: user.id,
      });

      res.status(201).json(access);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Revoke consultant access
  app.delete("/api/tenant-access/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      if (!hasAdminAccess(user.role)) {
        return res.status(403).json({ error: "Access denied - admin privileges required" });
      }

      const access = await storage.getConsultantAccess(req.params.id);
      if (!access) {
        return res.status(404).json({ error: "Access grant not found" });
      }

      const userDomain = user.email.split("@")[1];
      const accessibleTenants = await storage.getAccessibleTenants(user.id, user.role, userDomain);
      if (!accessibleTenants.find(t => t.id === access.tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.revokeConsultantAccess(req.params.id);
      res.json({ message: "Access revoked successfully" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== DOMAIN BLOCKLIST (Global Admin) ====================

  // Get all blocked domains
  app.get("/api/admin/domain-blocklist", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const blocklist = await storage.getDomainBlocklist();
      res.json(blocklist);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Add domain to blocklist
  app.post("/api/admin/domain-blocklist", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const { domain, reason } = req.body;
      
      if (!domain || typeof domain !== "string") {
        return res.status(400).json({ error: "Domain is required" });
      }

      const normalizedDomain = domain.toLowerCase().trim();
      
      // Check if already blocked
      const isBlocked = await storage.isdomainBlocked(normalizedDomain);
      if (isBlocked) {
        return res.status(400).json({ error: "Domain is already blocked" });
      }

      const entry = await storage.addBlockedDomain({
        domain: normalizedDomain,
        reason: reason || null,
        createdBy: user.id,
      });

      res.status(201).json(entry);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Remove domain from blocklist
  app.delete("/api/admin/domain-blocklist/:domain", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const domain = req.params.domain.toLowerCase();
      await storage.removeBlockedDomain(domain);
      res.json({ success: true, message: `Domain ${domain} removed from blocklist` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== SERVICE PLANS (Global Admin only) ====================
  
  // Get all service plans
  app.get("/api/admin/service-plans", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const plans = await storage.getAllServicePlans();
      res.json(plans);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get active service plans (for dropdowns)
  app.get("/api/service-plans/active", async (req, res) => {
    try {
      const plans = await storage.getActiveServicePlans();
      res.json(plans);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single service plan
  app.get("/api/admin/service-plans/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const plan = await storage.getServicePlan(req.params.id);
      if (!plan) {
        return res.status(404).json({ error: "Service plan not found" });
      }
      res.json(plan);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create service plan
  app.post("/api/admin/service-plans", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const { name, displayName, description, ...limits } = req.body;
      
      if (!name || !displayName) {
        return res.status(400).json({ error: "Name and display name are required" });
      }

      // Check if plan name already exists
      const existing = await storage.getServicePlanByName(name);
      if (existing) {
        return res.status(400).json({ error: "A plan with this name already exists" });
      }

      const plan = await storage.createServicePlan({
        name: name.toLowerCase().replace(/\s+/g, "_"),
        displayName,
        description,
        ...limits
      });
      invalidatePlanCache();
      res.status(201).json(plan);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update service plan
  app.patch("/api/admin/service-plans/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const plan = await storage.getServicePlan(req.params.id);
      if (!plan) {
        return res.status(404).json({ error: "Service plan not found" });
      }

      // If changing name, check for conflicts
      if (req.body.name && req.body.name !== plan.name) {
        const existing = await storage.getServicePlanByName(req.body.name);
        if (existing) {
          return res.status(400).json({ error: "A plan with this name already exists" });
        }
      }

      const updated = await storage.updateServicePlan(req.params.id, req.body);
      invalidatePlanCache();
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete service plan
  app.delete("/api/admin/service-plans/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const plan = await storage.getServicePlan(req.params.id);
      if (!plan) {
        return res.status(404).json({ error: "Service plan not found" });
      }

      // Prevent deleting default plan
      if (plan.isDefault) {
        return res.status(400).json({ error: "Cannot delete the default plan. Set another plan as default first." });
      }

      await storage.deleteServicePlan(req.params.id);
      invalidatePlanCache();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/feature-registry", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }
      res.json({ features: FEATURE_REGISTRY, categories: FEATURE_CATEGORIES });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== AI USAGE TRACKING (Global Admin only) ====================
  
  app.get("/api/admin/ai/usage", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const stats = await storage.getAiUsageStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== AI MODEL CONFIGURATION (Global Admin only) ====================

  app.get("/api/admin/ai-config", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") return res.status(403).json({ error: "Access denied - Global Admin only" });

      const rows = await db.select().from(aiConfiguration).limit(1);
      if (rows.length === 0) {
        const [created] = await db.insert(aiConfiguration).values({}).returning();
        return res.json(created);
      }
      res.json(rows[0]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/admin/ai-config", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") return res.status(403).json({ error: "Access denied - Global Admin only" });

      const { defaultProvider, defaultModel, maxTokensPerRequest, monthlyTokenBudget, alertThresholds, alertEnabled } = req.body;

      if (defaultProvider !== undefined) {
        const validProviders = Object.values(AI_PROVIDERS);
        if (!validProviders.includes(defaultProvider)) return res.status(400).json({ error: `Invalid provider: ${defaultProvider}` });
      }
      if (defaultModel !== undefined && defaultProvider) {
        const providerModels = AI_MODELS[defaultProvider];
        if (!providerModels || !providerModels.includes(defaultModel)) {
          return res.status(400).json({ error: `Model ${defaultModel} is not available for provider ${defaultProvider}` });
        }
      }
      if (alertThresholds !== undefined && !Array.isArray(alertThresholds)) {
        return res.status(400).json({ error: "alertThresholds must be an array of numbers" });
      }

      const rows = await db.select().from(aiConfiguration).limit(1);
      let configId: string;
      if (rows.length === 0) {
        const [created] = await db.insert(aiConfiguration).values({}).returning();
        configId = created.id;
      } else {
        configId = rows[0].id;
      }

      const updates: Record<string, any> = { updatedBy: user.id, updatedAt: new Date() };
      if (defaultProvider !== undefined) updates.defaultProvider = defaultProvider;
      if (defaultModel !== undefined) updates.defaultModel = defaultModel;
      if (maxTokensPerRequest !== undefined) updates.maxTokensPerRequest = maxTokensPerRequest;
      if (monthlyTokenBudget !== undefined) updates.monthlyTokenBudget = monthlyTokenBudget;
      if (alertThresholds !== undefined) updates.alertThresholds = alertThresholds;
      if (alertEnabled !== undefined) updates.alertEnabled = alertEnabled;

      const [updated] = await db.update(aiConfiguration).set(updates).where(eq(aiConfiguration.id, configId)).returning();
      invalidateAIConfigCache();
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/ai-config/options", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") return res.status(403).json({ error: "Access denied - Global Admin only" });

      const providerStatuses = getAllProviderStatuses();
      const availableModelsByProvider = getAvailableModelsByProvider();
      res.json({
        providers: providerStatuses.map(p => ({
          ...p,
          label: AI_PROVIDER_LABELS[p.key] || p.name,
        })),
        models: AI_MODEL_INFO,
        features: Object.entries(AI_FEATURE_LABELS).map(([key, label]) => ({ key, label })),
        modelsByProvider: availableModelsByProvider,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/ai-config/feature-assignments", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") return res.status(403).json({ error: "Access denied - Global Admin only" });

      const assignments = await db.select().from(aiFeatureModelAssignments);
      res.json(assignments);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/admin/ai-config/feature-assignments", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") return res.status(403).json({ error: "Access denied - Global Admin only" });

      const { assignments } = req.body;
      if (!Array.isArray(assignments)) return res.status(400).json({ error: "assignments must be an array" });

      const validFeatures = Object.values(AI_FEATURES);
      const validProviders = Object.values(AI_PROVIDERS);

      for (const a of assignments) {
        if (!validFeatures.includes(a.feature)) return res.status(400).json({ error: `Invalid feature: ${a.feature}` });
        if (!validProviders.includes(a.provider)) return res.status(400).json({ error: `Invalid provider: ${a.provider}` });
        const providerModels = AI_MODELS[a.provider];
        if (!providerModels || !providerModels.includes(a.model)) {
          return res.status(400).json({ error: `Model ${a.model} is not available for provider ${a.provider}` });
        }
      }

      const assignedFeatures = new Set(assignments.map((a: any) => a.feature));
      const currentAssignments = await db.select().from(aiFeatureModelAssignments);
      for (const existing of currentAssignments) {
        if (!assignedFeatures.has(existing.feature)) {
          await db.delete(aiFeatureModelAssignments).where(eq(aiFeatureModelAssignments.feature, existing.feature));
        }
      }

      const results = [];
      for (const a of assignments) {
        if (!a.feature || !a.provider || !a.model) continue;

        const existing = await db.select().from(aiFeatureModelAssignments).where(eq(aiFeatureModelAssignments.feature, a.feature)).limit(1);

        if (existing.length > 0) {
          const [updated] = await db.update(aiFeatureModelAssignments)
            .set({ provider: a.provider, model: a.model, maxTokens: a.maxTokens ?? null, updatedBy: user.id, updatedAt: new Date() })
            .where(eq(aiFeatureModelAssignments.feature, a.feature))
            .returning();
          results.push(updated);
        } else {
          const [created] = await db.insert(aiFeatureModelAssignments)
            .values({ feature: a.feature, provider: a.provider, model: a.model, maxTokens: a.maxTokens ?? null, updatedBy: user.id })
            .returning();
          results.push(created);
        }
      }

      invalidateAIConfigCache();
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/admin/ai-config/feature-assignments/:feature", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") return res.status(403).json({ error: "Access denied - Global Admin only" });

      await db.delete(aiFeatureModelAssignments).where(eq(aiFeatureModelAssignments.feature, req.params.feature));
      invalidateAIConfigCache();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/ai-config/provider-status", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") return res.status(403).json({ error: "Access denied - Global Admin only" });

      const statuses = getAllProviderStatuses();
      res.json(statuses.map(s => ({
        ...s,
        label: AI_PROVIDER_LABELS[s.key] || s.name,
      })));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/flagged-crawls", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      if (!hasAdminAccess(user.role)) return res.status(403).json({ error: "Access denied - Admin only" });

      const [flaggedCompetitors, flaggedProducts] = await Promise.all([
        storage.getFlaggedCompetitors(),
        storage.getFlaggedProducts(),
      ]);

      const isGlobalAdmin = user.role === "Global Admin";
      res.json({
        competitors: flaggedCompetitors
          .filter(c => isGlobalAdmin || c.tenantDomain === user.tenantDomain)
          .map(c => ({
            id: c.id,
            name: c.name,
            url: c.url,
            consecutiveCrawlFailures: c.consecutiveCrawlFailures,
            crawlFlaggedAt: c.crawlFlaggedAt,
            excludeFromCrawl: c.excludeFromCrawl,
            tenantDomain: c.tenantDomain,
            marketId: c.marketId,
          })),
        products: flaggedProducts
          .filter(p => isGlobalAdmin || p.tenantDomain === user.tenantDomain)
          .map(p => ({
            id: p.id,
            name: p.name,
            url: p.url,
            consecutiveCrawlFailures: p.consecutiveCrawlFailures,
            crawlFlaggedAt: p.crawlFlaggedAt,
            excludeFromCrawl: p.excludeFromCrawl,
            tenantDomain: p.tenantDomain,
            marketId: p.marketId,
          })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/flagged-crawls/:type/:id/exclude", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      if (!hasAdminAccess(user.role)) return res.status(403).json({ error: "Access denied - Admin only" });

      const { type, id } = req.params;
      const isGlobalAdmin = user.role === "Global Admin";
      if (type === "competitor") {
        const competitor = await storage.getCompetitor(id);
        if (!competitor) return res.status(404).json({ error: "Competitor not found" });
        if (!isGlobalAdmin && competitor.tenantDomain !== user.tenantDomain) return res.status(403).json({ error: "Access denied" });
        const updated = await storage.updateCompetitor(id, { excludeFromCrawl: true });
        res.json(updated);
      } else if (type === "product") {
        const product = await storage.getProduct(id);
        if (!product) return res.status(404).json({ error: "Product not found" });
        if (!isGlobalAdmin && product.tenantDomain !== user.tenantDomain) return res.status(403).json({ error: "Access denied" });
        const updated = await storage.updateProduct(id, { excludeFromCrawl: true });
        res.json(updated);
      } else {
        res.status(400).json({ error: "Invalid type. Must be 'competitor' or 'product'" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/flagged-crawls/:type/:id/dismiss", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      if (!hasAdminAccess(user.role)) return res.status(403).json({ error: "Access denied - Admin only" });

      const { type, id } = req.params;
      const isGlobalAdmin = user.role === "Global Admin";
      if (type === "competitor") {
        const competitor = await storage.getCompetitor(id);
        if (!competitor) return res.status(404).json({ error: "Competitor not found" });
        if (!isGlobalAdmin && competitor.tenantDomain !== user.tenantDomain) return res.status(403).json({ error: "Access denied" });
        const updated = await storage.updateCompetitor(id, { crawlFlaggedAt: null, consecutiveCrawlFailures: 0 });
        res.json(updated);
      } else if (type === "product") {
        const product = await storage.getProduct(id);
        if (!product) return res.status(404).json({ error: "Product not found" });
        if (!isGlobalAdmin && product.tenantDomain !== user.tenantDomain) return res.status(403).json({ error: "Access denied" });
        const updated = await storage.updateProduct(id, { crawlFlaggedAt: null, consecutiveCrawlFailures: 0 });
        res.json(updated);
      } else {
        res.status(400).json({ error: "Invalid type. Must be 'competitor' or 'product'" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/ai-usage/stats", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") return res.status(403).json({ error: "Access denied - Global Admin only" });

      const days = parseInt(req.query.days as string) || 30;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const usageRows = await db.execute(sql`
        SELECT 
          provider,
          model,
          operation,
          DATE(created_at) as date,
          COUNT(*) as call_count,
          SUM(input_tokens) as total_input_tokens,
          SUM(output_tokens) as total_output_tokens,
          SUM(total_tokens) as total_tokens,
          SUM(CAST(estimated_cost AS DECIMAL)) as total_cost,
          SUM(CASE WHEN success = true THEN 1 ELSE 0 END) as success_count,
          SUM(CASE WHEN success = false THEN 1 ELSE 0 END) as error_count,
          AVG(duration_ms) as avg_duration_ms
        FROM ai_usage
        WHERE created_at >= ${since}
        GROUP BY provider, model, operation, DATE(created_at)
        ORDER BY DATE(created_at) DESC
      `);

      const totals = await db.execute(sql`
        SELECT 
          COUNT(*) as total_calls,
          SUM(total_tokens) as total_tokens,
          SUM(CAST(estimated_cost AS DECIMAL)) as total_cost,
          SUM(CASE WHEN success = false THEN 1 ELSE 0 END) as total_errors
        FROM ai_usage
        WHERE created_at >= ${since}
      `);

      const byProvider = await db.execute(sql`
        SELECT 
          provider,
          COUNT(*) as calls,
          SUM(total_tokens) as tokens,
          SUM(CAST(estimated_cost AS DECIMAL)) as cost
        FROM ai_usage
        WHERE created_at >= ${since}
        GROUP BY provider
      `);

      const byFeature = await db.execute(sql`
        SELECT 
          operation,
          COUNT(*) as calls,
          SUM(total_tokens) as tokens,
          SUM(CAST(estimated_cost AS DECIMAL)) as cost,
          AVG(duration_ms) as avg_duration_ms
        FROM ai_usage
        WHERE created_at >= ${since}
        GROUP BY operation
        ORDER BY calls DESC
      `);

      const byModel = await db.execute(sql`
        SELECT 
          model,
          provider,
          COUNT(*) as calls,
          SUM(total_tokens) as tokens,
          SUM(CAST(estimated_cost AS DECIMAL)) as cost
        FROM ai_usage
        WHERE created_at >= ${since}
        GROUP BY model, provider
        ORDER BY calls DESC
      `);

      const dailyTrend = await db.execute(sql`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as calls,
          SUM(total_tokens) as tokens,
          SUM(CAST(estimated_cost AS DECIMAL)) as cost
        FROM ai_usage
        WHERE created_at >= ${since}
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at) ASC
      `);

      res.json({
        period: { days, since: since.toISOString() },
        totals: totals.rows[0] || { total_calls: 0, total_tokens: 0, total_cost: 0, total_errors: 0 },
        byProvider: byProvider.rows,
        byFeature: byFeature.rows,
        byModel: byModel.rows,
        dailyTrend: dailyTrend.rows,
        detailed: usageRows.rows,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/ai-usage/logs", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") return res.status(403).json({ error: "Access denied - Global Admin only" });

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      const logs = await db.execute(sql`
        SELECT * FROM ai_usage
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const totalCount = await db.execute(sql`SELECT COUNT(*) as count FROM ai_usage`);

      res.json({
        logs: logs.rows,
        total: parseInt(totalCount.rows[0]?.count as string) || 0,
        limit,
        offset,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });


}
