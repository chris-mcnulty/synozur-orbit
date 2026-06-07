import type { Express } from "express";
import { db } from "../db";
import { tenantFonts } from "@shared/schema";
import { eq, and, asc } from "drizzle-orm";
import { getRequestContext } from "../context";
import { randomUUID } from "crypto";

function requireAdmin(userRole: string): boolean {
  return userRole === "Domain Admin" || userRole === "Global Admin";
}

export function registerTenantFontRoutes(app: Express) {
  app.get("/api/tenant/fonts", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const rows = await db
        .select()
        .from(tenantFonts)
        .where(eq(tenantFonts.tenantDomain, ctx.tenantDomain))
        .orderBy(asc(tenantFonts.sortOrder), asc(tenantFonts.createdAt));
      res.json(rows);
    } catch (err: any) {
      console.error("[tenant-fonts GET]", err);
      res.status(500).json({ error: err.message || "Failed to fetch fonts" });
    }
  });

  app.post("/api/tenant/fonts", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      if (!requireAdmin(ctx.userRole)) return res.status(403).json({ error: "Admin only" });

      const { name, fontFamily, fontWeight, fontStyle, fontUsage, fileUrl, fileType, fileSize, sortOrder } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "name is required" });
      if (!fileUrl?.trim()) return res.status(400).json({ error: "fileUrl is required" });
      if (!fontUsage?.trim()) return res.status(400).json({ error: "fontUsage is required" });

      const VALID_USAGES = ["heading", "body", "accent", "display", "mono"];
      if (!VALID_USAGES.includes(fontUsage)) {
        return res.status(400).json({ error: "fontUsage must be one of: " + VALID_USAGES.join(", ") });
      }

      const [row] = await db.insert(tenantFonts).values({
        id: randomUUID(),
        tenantDomain: ctx.tenantDomain,
        name: name.trim(),
        fontFamily: fontFamily?.trim() || null,
        fontWeight: fontWeight?.trim() || null,
        fontStyle: fontStyle?.trim() || null,
        fontUsage,
        fileUrl: fileUrl.trim(),
        fileType: fileType || null,
        fileSize: fileSize ? Number(fileSize) : null,
        sortOrder: sortOrder ?? 0,
        createdBy: ctx.userId,
      }).returning();

      res.status(201).json(row);
    } catch (err: any) {
      console.error("[tenant-fonts POST]", err);
      res.status(500).json({ error: err.message || "Failed to create font" });
    }
  });

  app.patch("/api/tenant/fonts/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      if (!requireAdmin(ctx.userRole)) return res.status(403).json({ error: "Admin only" });

      const { name, fontFamily, fontWeight, fontStyle, fontUsage, fileUrl, fileType, fileSize, sortOrder } = req.body;
      const updates: Record<string, any> = {};
      if (name !== undefined) updates.name = name;
      if (fontFamily !== undefined) updates.fontFamily = fontFamily || null;
      if (fontWeight !== undefined) updates.fontWeight = fontWeight || null;
      if (fontStyle !== undefined) updates.fontStyle = fontStyle || null;
      if (fontUsage !== undefined) updates.fontUsage = fontUsage;
      if (fileUrl !== undefined) updates.fileUrl = fileUrl;
      if (fileType !== undefined) updates.fileType = fileType || null;
      if (fileSize !== undefined) updates.fileSize = fileSize ? Number(fileSize) : null;
      if (sortOrder !== undefined) updates.sortOrder = sortOrder;

      const [row] = await db
        .update(tenantFonts)
        .set(updates)
        .where(and(eq(tenantFonts.id, req.params.id), eq(tenantFonts.tenantDomain, ctx.tenantDomain)))
        .returning();

      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (err: any) {
      console.error("[tenant-fonts PATCH]", err);
      res.status(500).json({ error: err.message || "Failed to update font" });
    }
  });

  app.delete("/api/tenant/fonts/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      if (!requireAdmin(ctx.userRole)) return res.status(403).json({ error: "Admin only" });

      const [deleted] = await db
        .delete(tenantFonts)
        .where(and(eq(tenantFonts.id, req.params.id), eq(tenantFonts.tenantDomain, ctx.tenantDomain)))
        .returning({ id: tenantFonts.id });

      if (!deleted) return res.status(404).json({ error: "Not found" });
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[tenant-fonts DELETE]", err);
      res.status(500).json({ error: err.message || "Failed to delete font" });
    }
  });
}
