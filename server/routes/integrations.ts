/**
 * Integration / webhook routes.
 *
 * Tenant-scoped Slack & Teams webhook configuration. Webhook URLs are
 * encrypted at rest and never returned by the API once saved.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { storage } from "../storage";
import { hasAdminAccess } from "./helpers";
import { encryptSecret } from "../utils/encryption";
import { isFeatureEnabledAsync } from "../services/plan-policy";
import { notifications } from "../services/notifications";
import {
  INTEGRATION_KINDS,
  WEBHOOK_EVENT_CATEGORIES,
  type IntegrationConfig,
  type InsertIntegrationConfig,
} from "@shared/schema";

// Slack accepts hooks.slack.com; Teams accepts outlook.office.com,
// <tenant>.webhook.office.com, prod-*.westus.logic.azure.com (workflows),
// and <tenant>.workflows.... We validate by host instead of by full
// regex so we don't reject legitimate variants.
const SLACK_HOSTS = ["hooks.slack.com"];
const TEAMS_HOST_SUFFIXES = [
  ".webhook.office.com",
  ".webhook.office365.com",
  ".logic.azure.com",
  ".workflows.azure.com",
  "outlook.office.com",
  "outlook.office365.com",
];

function validateWebhookUrl(kind: "slack" | "teams", rawUrl: string): { ok: true; url: string; host: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: "Webhook URL is not a valid URL" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "Webhook URL must use HTTPS" };
  }
  const host = parsed.host.toLowerCase();
  if (kind === "slack") {
    if (!SLACK_HOSTS.includes(host)) {
      return { ok: false, error: "Slack webhook URL must point to hooks.slack.com" };
    }
  } else {
    const ok = TEAMS_HOST_SUFFIXES.some((s) => host === s || host.endsWith(s));
    if (!ok) {
      return { ok: false, error: "Teams webhook URL must point to a Microsoft webhook host" };
    }
  }
  return { ok: true, url: parsed.toString(), host };
}

const createSchema = z.object({
  kind: z.enum(INTEGRATION_KINDS),
  name: z.string().trim().min(1, "Name is required").max(120),
  webhookUrl: z.string().min(1, "Webhook URL is required"),
  eventCategories: z
    .array(z.enum(WEBHOOK_EVENT_CATEGORIES))
    .min(1, "Select at least one event category"),
  enabled: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  webhookUrl: z.string().min(1).optional(),
  eventCategories: z.array(z.enum(WEBHOOK_EVENT_CATEGORIES)).min(1).optional(),
  enabled: z.boolean().optional(),
});

function publicView(c: IntegrationConfig) {
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    eventCategories: c.eventCategories,
    enabled: c.enabled,
    webhookHostHint: c.webhookHostHint,
    lastUsedAt: c.lastUsedAt,
    lastError: c.lastError,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

async function loadAdminContext(
  req: Request,
  res: Response,
): Promise<{ tenantDomain: string; userId: string } | null> {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  const user = await storage.getUser(req.session.userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return null;
  }
  if (!hasAdminAccess(user.role)) {
    res.status(403).json({ error: "Access denied - Admin only" });
    return null;
  }
  const tenantDomain = user.email.split("@")[1];
  const tenant = await storage.getTenantByDomain(tenantDomain);
  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return null;
  }
  const allowed = await isFeatureEnabledAsync(tenant.plan, "webhookIntegrations");
  if (!allowed) {
    res.status(403).json({
      error: "Webhook integrations require an Enterprise or Unlimited plan.",
      upgradeRequired: true,
    });
    return null;
  }
  return { tenantDomain, userId: user.id };
}

type WebhookUpdateDTO = Partial<Pick<InsertIntegrationConfig,
  "name" | "eventCategories" | "enabled" | "encryptedWebhookUrl" | "webhookHostHint"
>>;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerIntegrationRoutes(app: Express) {
  // List webhooks for the current tenant (URLs never returned).
  app.get("/api/integrations/webhooks", async (req: Request, res: Response) => {
    try {
      const ctx = await loadAdminContext(req, res);
      if (!ctx) return;
      const rows = await storage.getIntegrationConfigsByTenant(ctx.tenantDomain);
      res.json(rows.map(publicView));
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.post("/api/integrations/webhooks", async (req: Request, res: Response) => {
    try {
      const ctx = await loadAdminContext(req, res);
      if (!ctx) return;

      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const v = validateWebhookUrl(parsed.data.kind, parsed.data.webhookUrl);
      if (!v.ok) return res.status(400).json({ error: v.error });

      const created = await storage.createIntegrationConfig({
        tenantDomain: ctx.tenantDomain,
        kind: parsed.data.kind,
        name: parsed.data.name,
        encryptedWebhookUrl: encryptSecret(v.url),
        webhookHostHint: v.host,
        eventCategories: parsed.data.eventCategories,
        enabled: parsed.data.enabled ?? true,
        createdBy: ctx.userId,
      });
      res.status(201).json(publicView(created));
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.patch("/api/integrations/webhooks/:id", async (req: Request, res: Response) => {
    try {
      const ctx = await loadAdminContext(req, res);
      if (!ctx) return;

      const existing = await storage.getIntegrationConfig(req.params.id);
      if (!existing || existing.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Webhook not found" });
      }

      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const updates: WebhookUpdateDTO = {};
      if (parsed.data.name !== undefined) updates.name = parsed.data.name;
      if (parsed.data.eventCategories !== undefined) updates.eventCategories = parsed.data.eventCategories;
      if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;
      if (parsed.data.webhookUrl !== undefined && parsed.data.webhookUrl.trim().length > 0) {
        const v = validateWebhookUrl(existing.kind as "slack" | "teams", parsed.data.webhookUrl);
        if (!v.ok) return res.status(400).json({ error: v.error });
        updates.encryptedWebhookUrl = encryptSecret(v.url);
        updates.webhookHostHint = v.host;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      const updated = await storage.updateIntegrationConfig(existing.id, updates);
      res.json(publicView(updated));
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.delete("/api/integrations/webhooks/:id", async (req: Request, res: Response) => {
    try {
      const ctx = await loadAdminContext(req, res);
      if (!ctx) return;
      const existing = await storage.getIntegrationConfig(req.params.id);
      if (!existing || existing.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      await storage.deleteIntegrationConfig(existing.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.post("/api/integrations/webhooks/:id/test", async (req: Request, res: Response) => {
    try {
      const ctx = await loadAdminContext(req, res);
      if (!ctx) return;
      const existing = await storage.getIntegrationConfig(req.params.id);
      if (!existing || existing.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      const user = await storage.getUser(ctx.userId);
      const result = await notifications.test(existing.id, user?.name || user?.email || "an admin");
      if (result.ok) return res.json({ success: true });
      res.status(502).json({ error: result.error || "Webhook delivery failed" });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });
}
