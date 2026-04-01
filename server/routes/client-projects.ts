import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { getRequestContext, ContextError } from "../context";
import { toContextFilter, validateResourceContext, guardFeature } from "./helpers";
import { contentAssets, products as productsTable } from "@shared/schema";

export function registerClientProjectRoutes(app: Express) {
  // ==================== CLIENT PROJECTS (Pro/Enterprise only) ====================
  
  // Get all client projects for current tenant
  app.get("/api/projects", async (req, res) => {
    if (!await guardFeature(req, res, "clientProjects")) return;
    try {
      const ctx = await getRequestContext(req);

      const projects = await storage.getClientProjectsByContext(toContextFilter(ctx));
      
      const enrichedProjects = await Promise.all(
        projects.map(async (project) => {
          const projectProducts = await storage.getProjectProducts(project.id);
          const baselineProduct = projectProducts.find((pp: { role: string }) => pp.role === "baseline");
          let productType: string | null = null;
          if (baselineProduct?.productId) {
            const [prod] = await db.select({ productType: productsTable.productType }).from(productsTable).where(eq(productsTable.id, baselineProduct.productId));
            productType = prod?.productType || null;
          }
          return {
            ...project,
            baselineProductId: baselineProduct?.productId || null,
            productType: productType || "product",
          };
        })
      );
      
      res.json(enrichedProjects);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get single client project with its competitors
  app.get("/api/projects/:id", async (req, res) => {
    if (!await guardFeature(req, res, "clientProjects")) return;
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Get associated competitors
      const projectCompetitors = await storage.getCompetitorsByProject(project.id);

      res.json({ ...project, competitors: projectCompetitors });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Create client project
  app.post("/api/projects", async (req, res) => {
    if (!await guardFeature(req, res, "clientProjects")) return;
    try {
      const ctx = await getRequestContext(req);

      const { name, clientName, clientDomain, description, analysisType, notifyOnUpdates, productUrl, sourceContentAssetId, productType } = req.body;
      
      if (!name || !clientName) {
        return res.status(400).json({ error: "Project name and client name are required" });
      }

      const project = await storage.createClientProject({
        name: name.trim(),
        clientName: clientName.trim(),
        clientDomain: clientDomain?.trim().toLowerCase() || null,
        description: description?.trim() || null,
        analysisType: analysisType && ["company", "product"].includes(analysisType) ? analysisType : "product",
        notifyOnUpdates: notifyOnUpdates === true,
        status: "active",
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        ownerUserId: ctx.userId,
      });

      // Validate sourceContentAssetId belongs to current tenant/market if provided
      let validatedAssetId: string | undefined;
      if (sourceContentAssetId) {
        const assetConditions = [
          eq(contentAssets.id, sourceContentAssetId),
          eq(contentAssets.tenantDomain, ctx.tenantDomain),
        ];
        if (ctx.marketId) {
          assetConditions.push(eq(contentAssets.marketId, ctx.marketId));
        }
        const [asset] = await db.select({ id: contentAssets.id }).from(contentAssets)
          .where(and(...assetConditions));
        if (asset) {
          validatedAssetId = asset.id;
        }
      }

      // If productUrl provided or creating from content asset, automatically create the baseline product
      if ((productUrl && typeof productUrl === "string" && productUrl.trim()) || validatedAssetId) {
        try {
          const validProductTypes = ["product", "software", "service", "platform", "solution", "tool", "framework", "api"];
          const product = await storage.createProduct({
            name: name.trim(),
            description: description?.trim() || null,
            productType: productType && validProductTypes.includes(productType) ? productType : "product",
            url: productUrl?.trim() || null,
            companyName: clientName.trim(),
            createdBy: ctx.userId,
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId,
            ...(validatedAssetId ? { sourceContentAssetId: validatedAssetId } : {}),
          });

          // Link it to the project as baseline
          await storage.addProductToProject({
            projectId: project.id,
            productId: product.id,
            role: "baseline",
          });
        } catch (productError: any) {
          // Don't fail the whole request if product creation fails
          console.error("[projects] Failed to create baseline product:", productError.message);
        }
      }

      res.status(201).json(project);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Update client project
  app.patch("/api/projects/:id", async (req, res) => {
    if (!await guardFeature(req, res, "clientProjects")) return;
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { name, clientName, clientDomain, description, status, notifyOnUpdates, analysisType, baselineProduct, productType } = req.body;
      
      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name.trim();
      if (clientName !== undefined) updates.clientName = clientName.trim();
      if (clientDomain !== undefined) updates.clientDomain = clientDomain?.trim().toLowerCase() || null;
      if (description !== undefined) updates.description = description?.trim() || null;
      if (status !== undefined && ["active", "completed", "archived"].includes(status)) {
        updates.status = status;
      }
      if (notifyOnUpdates !== undefined) updates.notifyOnUpdates = notifyOnUpdates === true;
      if (analysisType !== undefined && ["company", "product"].includes(analysisType)) {
        updates.analysisType = analysisType;
      }

      const updated = await storage.updateClientProject(req.params.id, updates);

      if (baselineProduct || productType) {
        const projectProducts = await storage.getProjectProducts(req.params.id);
        const baselineEntry = projectProducts.find((pp: { role: string }) => pp.role === "baseline");
        if (baselineEntry) {
          const bp = await storage.getProduct(baselineEntry.productId);
          if (bp && validateResourceContext(bp, ctx)) {
            const bpUpdates: Record<string, string | null> = {};
            if (baselineProduct?.url !== undefined) bpUpdates.url = baselineProduct.url;
            if (baselineProduct?.linkedInUrl !== undefined) bpUpdates.linkedInUrl = baselineProduct.linkedInUrl;
            if (baselineProduct?.instagramUrl !== undefined) bpUpdates.instagramUrl = baselineProduct.instagramUrl;
            if (baselineProduct?.twitterUrl !== undefined) bpUpdates.twitterUrl = baselineProduct.twitterUrl;
            const validProductTypes = ["product", "software", "service", "platform", "solution", "tool", "framework", "api"];
            if (productType && validProductTypes.includes(productType)) {
              (bpUpdates as any).productType = productType;
            }
            if (Object.keys(bpUpdates).length > 0) {
              await storage.updateProduct(baselineEntry.productId, bpUpdates);
            }
          }
        }
      }

      res.json(updated);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Delete client project (cascades to unlink competitors)
  app.delete("/api/projects/:id", async (req, res) => {
    if (!await guardFeature(req, res, "clientProjects")) return;
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Only owner or admin can delete
      if (project.ownerUserId !== ctx.userId && ctx.userRole !== "Domain Admin" && ctx.userRole !== "Global Admin") {
        return res.status(403).json({ error: "Only project owner or admin can delete" });
      }

      await storage.deleteClientProject(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Assign competitor to project
  app.post("/api/projects/:projectId/competitors/:competitorId", async (req, res) => {
    if (!await guardFeature(req, res, "clientProjects")) return;
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const competitor = await storage.getCompetitor(req.params.competitorId);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }
      
      // Validate competitor belongs to current context
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied - competitor not in your context" });
      }

      // Update competitor with project ID
      const updated = await storage.updateCompetitor(req.params.competitorId, {
        projectId: req.params.projectId,
      });

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Remove competitor from project
  app.delete("/api/projects/:projectId/competitors/:competitorId", async (req, res) => {
    if (!await guardFeature(req, res, "clientProjects")) return;
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Unlink competitor from project
      await storage.updateCompetitor(req.params.competitorId, { projectId: null });
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });


}
