/**
 * Admin endpoints for managing OAuth client apps + issued tokens (Task #96).
 *
 * All endpoints require:
 *   - Session auth (Global Admin or Domain Admin)
 *   - Tenant plan = Enterprise / Unlimited (`partnerApi` feature)
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import {
  oauthClients,
  oauthAccessTokens,
  oauthApiAudit,
  PARTNER_API_SCOPES,
  type InsertOauthClient,
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { getRequestContext } from "../context";
import { guardFeature } from "./helpers";
import { storage } from "../storage";
import {
  generateClientSecret,
  hashClientSecret,
  revokeAccessTokenById,
  listApiAudit,
} from "../services/oauth-service";

function isAdmin(role: string) {
  // OAuth client apps are global trust grants — only Global Admins may manage them.
  return role === "Global Admin";
}

const createClientSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  logoUrl: z.string().url().optional().or(z.literal("")),
  contactEmail: z.string().email().optional().or(z.literal("")),
  redirectUris: z.array(z.string().url()).min(1).max(10),
  allowedScopes: z.array(z.enum(PARTNER_API_SCOPES as unknown as [string, ...string[]])).min(1),
  isConfidential: z.boolean().optional().default(false),
});

const updateClientSchema = createClientSchema.partial().extend({
  status: z.enum(["active", "disabled"]).optional(),
});

export function registerAdminOAuthClientRoutes(app: Express) {
  // List all clients
  app.get("/api/admin/oauth/clients", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "partnerApi"))) return;
    const ctx = await getRequestContext(req);
    if (!isAdmin(ctx.userRole)) return res.status(403).json({ error: "Admin access required" });
    const rows = await db.select().from(oauthClients).orderBy(desc(oauthClients.createdAt));
    res.json(rows.map((r) => ({ ...r, clientSecretHash: undefined })));
  });

  // Create client
  app.post("/api/admin/oauth/clients", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "partnerApi"))) return;
    const ctx = await getRequestContext(req);
    if (!isAdmin(ctx.userRole)) return res.status(403).json({ error: "Admin access required" });

    const parsed = createClientSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }
    const data = parsed.data;
    let plaintextSecret: string | undefined;
    let secretHash: string | null = null;
    if (data.isConfidential) {
      plaintextSecret = generateClientSecret();
      secretHash = hashClientSecret(plaintextSecret);
    }
    const insertVals: InsertOauthClient = {
      name: data.name,
      description: data.description || null,
      logoUrl: data.logoUrl || null,
      contactEmail: data.contactEmail || null,
      redirectUris: data.redirectUris,
      allowedScopes: data.allowedScopes,
      clientSecretHash: secretHash,
      status: "active",
      createdBy: ctx.userId,
    };
    const [row] = await db.insert(oauthClients).values(insertVals).returning();
    res.status(201).json({
      ...row,
      clientSecretHash: undefined,
      // Return plaintext secret ONCE for confidential clients
      clientSecret: plaintextSecret,
    });
  });

  // Update client
  app.patch("/api/admin/oauth/clients/:id", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "partnerApi"))) return;
    const ctx = await getRequestContext(req);
    if (!isAdmin(ctx.userRole)) return res.status(403).json({ error: "Admin access required" });
    const parsed = updateClientSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }
    const data = parsed.data;
    const updates: Partial<InsertOauthClient> & { updatedAt: Date } = { updatedAt: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description || null;
    if (data.logoUrl !== undefined) updates.logoUrl = data.logoUrl || null;
    if (data.contactEmail !== undefined) updates.contactEmail = data.contactEmail || null;
    if (data.redirectUris !== undefined) updates.redirectUris = data.redirectUris;
    if (data.allowedScopes !== undefined) updates.allowedScopes = data.allowedScopes;
    if (data.status !== undefined) updates.status = data.status;
    const [row] = await db.update(oauthClients).set(updates).where(eq(oauthClients.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ ...row, clientSecretHash: undefined });
  });

  // Delete client
  app.delete("/api/admin/oauth/clients/:id", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "partnerApi"))) return;
    const ctx = await getRequestContext(req);
    if (!isAdmin(ctx.userRole)) return res.status(403).json({ error: "Admin access required" });
    await db.delete(oauthClients).where(eq(oauthClients.id, req.params.id));
    res.status(204).send();
  });

  // Rotate client secret
  app.post("/api/admin/oauth/clients/:id/rotate-secret", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "partnerApi"))) return;
    const ctx = await getRequestContext(req);
    if (!isAdmin(ctx.userRole)) return res.status(403).json({ error: "Admin access required" });
    const newSecret = generateClientSecret();
    const [row] = await db
      .update(oauthClients)
      .set({ clientSecretHash: hashClientSecret(newSecret), updatedAt: new Date() })
      .where(eq(oauthClients.id, req.params.id))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ id: row.id, clientSecret: newSecret });
  });

  // List issued tokens (across the tenant the admin operates in)
  app.get("/api/admin/oauth/tokens", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "partnerApi"))) return;
    const ctx = await getRequestContext(req);
    if (!isAdmin(ctx.userRole)) return res.status(403).json({ error: "Admin access required" });

    const rows = await db
      .select()
      .from(oauthAccessTokens)
      .where(eq(oauthAccessTokens.tenantDomain, ctx.tenantDomain))
      .orderBy(desc(oauthAccessTokens.createdAt))
      .limit(200);
    // Hide token hash; enrich with client name and user email
    const clientIds = Array.from(new Set(rows.map((r) => r.clientId)));
    const userIds = Array.from(new Set(rows.map((r) => r.userId)));
    const clientsList = clientIds.length
      ? await db.select().from(oauthClients).where(eq(oauthClients.id, clientIds[0]))
      : [];
    const clientsAll = clientIds.length
      ? await Promise.all(clientIds.map((id) => db.select().from(oauthClients).where(eq(oauthClients.id, id))))
      : [];
    const clientMap = new Map<string, string>();
    for (const arr of clientsAll) for (const c of arr) clientMap.set(c.id, c.name);
    const usersAll = await Promise.all(userIds.map((id) => storage.getUser(id)));
    const userMap = new Map<string, { name: string; email: string }>();
    for (const u of usersAll) if (u) userMap.set(u.id, { name: u.name, email: u.email });

    res.json(
      rows.map((r) => ({
        id: r.id,
        clientId: r.clientId,
        clientName: clientMap.get(r.clientId) || "(unknown)",
        userId: r.userId,
        userName: userMap.get(r.userId)?.name || null,
        userEmail: userMap.get(r.userId)?.email || null,
        tenantDomain: r.tenantDomain,
        scopes: r.scopes,
        expiresAt: r.expiresAt,
        revokedAt: r.revokedAt,
        lastUsedAt: r.lastUsedAt,
        createdAt: r.createdAt,
      }))
    );
  });

  // Revoke token
  app.post("/api/admin/oauth/tokens/:id/revoke", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "partnerApi"))) return;
    const ctx = await getRequestContext(req);
    if (!isAdmin(ctx.userRole)) return res.status(403).json({ error: "Admin access required" });
    // Tenant-scope guard: only allow revoking tokens that belong to this tenant
    const [tok] = await db.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.id, req.params.id));
    if (!tok) return res.status(404).json({ error: "Not found" });
    if (tok.tenantDomain !== ctx.tenantDomain && ctx.userRole !== "Global Admin") {
      return res.status(403).json({ error: "Cross-tenant revoke not allowed" });
    }
    await revokeAccessTokenById(req.params.id);
    res.json({ revoked: true });
  });

  // Audit log
  app.get("/api/admin/oauth/audit", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "partnerApi"))) return;
    const ctx = await getRequestContext(req);
    if (!isAdmin(ctx.userRole)) return res.status(403).json({ error: "Admin access required" });
    const rows = await listApiAudit(ctx.tenantDomain, 200);
    res.json(rows);
  });

  // Available scopes (for admin form)
  app.get("/api/admin/oauth/scopes", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "partnerApi"))) return;
    const { PARTNER_API_SCOPE_LABELS } = await import("@shared/schema");
    res.json(
      PARTNER_API_SCOPES.map((s) => ({ scope: s, label: (PARTNER_API_SCOPE_LABELS as Record<string, string>)[s] || s }))
    );
  });
}
