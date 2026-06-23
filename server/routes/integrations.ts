/**
 * Integration / webhook routes.
 *
 * Tenant-scoped Slack & Teams webhook configuration. Webhook URLs are
 * encrypted at rest and never returned by the API once saved.
 */

import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { storage } from "../storage";
import { hasAdminAccess } from "./helpers";
import { encryptSecret } from "../utils/encryption";
import { isFeatureEnabledAsync } from "../services/plan-policy";
import { notifications } from "../services/notifications";
import * as hubspot from "../services/hubspot-integration";
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

  // ───────────────────────────────────────────────────────────────────────
  // HubSpot CRM integration (Task #100)
  // ───────────────────────────────────────────────────────────────────────

  // Connection state lookup keyed by random `state` param. Stays in memory
  // because the OAuth round-trip completes within minutes; on process
  // restart any in-flight flows simply need to reconnect.
  const hubspotOauthStates = new Map<string, { tenantDomain: string; userId: string; expiresAt: number; redirectUri: string }>();

  function pruneOauthStates() {
    const now = Date.now();
    hubspotOauthStates.forEach((v, k) => {
      if (v.expiresAt < now) hubspotOauthStates.delete(k);
    });
  }

  function buildHubspotRedirectUri(req: Request): string {
    if (process.env.PUBLIC_APP_URL) {
      const base = process.env.PUBLIC_APP_URL.replace(/\/+$/, "");
      return `${base}/api/integrations/hubspot/callback`;
    }
    const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol;
    const host = req.headers["x-forwarded-host"] as string || req.headers.host;
    return `${proto}://${host}/api/integrations/hubspot/callback`;
  }

  async function loadHubspotContext(req: Request, res: Response, opts: { requireOutbound?: boolean } = {}) {
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
    const allowed = await isFeatureEnabledAsync(tenant.plan, "hubspotIntegration");
    if (!allowed) {
      res.status(403).json({
        error: "HubSpot integration requires a Pro plan or higher.",
        upgradeRequired: true,
      });
      return null;
    }
    if (opts.requireOutbound && !hubspot.isHubspotOutboundAllowed(tenant.plan)) {
      res.status(403).json({
        error: "Pushing to HubSpot (Notes / Tasks) requires Enterprise or Unlimited.",
        upgradeRequired: true,
      });
      return null;
    }
    return { tenantDomain, userId: user.id, plan: tenant.plan };
  }

  function publicConnectionView(c: import("@shared/schema").HubspotConnection) {
    return {
      tenantDomain: c.tenantDomain,
      hubspotPortalId: c.hubspotPortalId,
      hubspotPortalName: c.hubspotPortalName,
      scopes: c.scopes,
      autoPushEnabled: c.autoPushEnabled,
      autoCreateHubspotContacts: c.autoCreateHubspotContacts,
      defaultSubscriptionId: c.defaultSubscriptionId,
      defaultOwnerId: c.defaultOwnerId,
      activeProspectSuppressionDefault: c.activeProspectSuppressionDefault,
      connectedByUserId: c.connectedByUserId,
      connectedAt: c.connectedAt,
      lastSyncAt: c.lastSyncAt,
      lastSyncError: c.lastSyncError,
      lastSyncStats: c.lastSyncStats,
      // Marketing-email sync (Phase 0+): true once the connection has been
      // authorized with the timeline + communication-preferences scopes. When
      // false on an otherwise-connected portal, the UI shows a re-authorize
      // banner — the scopes were added after this tenant last connected.
      emailSyncReady: hubspot.hasHubspotEmailScopes(c),
    };
  }

  // GET status — does this tenant have a HubSpot connection?
  app.get("/api/integrations/hubspot/status", async (req: Request, res: Response) => {
    try {
      const ctx = await loadHubspotContext(req, res);
      if (!ctx) return;
      const conn = await storage.getHubspotConnection(ctx.tenantDomain);
      res.json({
        connected: !!conn,
        oauthConfigured: hubspot.isHubspotOauthConfigured(),
        outboundAllowed: hubspot.isHubspotOutboundAllowed(ctx.plan),
        // True when a connection exists but predates the marketing-email
        // scopes — the tenant must re-authorize before sync activates.
        needsReauth: conn ? !hubspot.hasHubspotEmailScopes(conn) : false,
        connection: conn ? publicConnectionView(conn) : null,
      });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // GET /connect — kick off OAuth (admin issues authorize URL)
  app.get("/api/integrations/hubspot/connect", async (req: Request, res: Response) => {
    try {
      const ctx = await loadHubspotContext(req, res);
      if (!ctx) return;
      if (!hubspot.isHubspotOauthConfigured()) {
        return res.status(503).json({
          error: "HubSpot OAuth is not configured on this Orbit instance. Contact your administrator to set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET.",
        });
      }
      pruneOauthStates();
      const state = crypto.randomBytes(24).toString("hex");
      const redirectUri = buildHubspotRedirectUri(req);
      hubspotOauthStates.set(state, {
        tenantDomain: ctx.tenantDomain,
        userId: ctx.userId,
        redirectUri,
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
      res.json({ authorizeUrl: hubspot.getAuthorizeUrl(state, redirectUri) });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // GET /callback — HubSpot redirects here after the user authorises.
  app.get("/api/integrations/hubspot/callback", async (req: Request, res: Response) => {
    const { code, state, error: oauthError } = req.query as Record<string, string | undefined>;
    pruneOauthStates();
    if (oauthError) {
      return res.redirect(`/app/settings?hubspot=error&reason=${encodeURIComponent(oauthError)}`);
    }
    if (!code || !state) {
      return res.redirect(`/app/settings?hubspot=error&reason=missing_code`);
    }
    const stash = hubspotOauthStates.get(state);
    if (!stash) {
      return res.redirect(`/app/settings?hubspot=error&reason=invalid_state`);
    }
    hubspotOauthStates.delete(state);
    try {
      const { tokens, info } = await hubspot.exchangeCode(code, stash.redirectUri);
      const expiresAt = new Date(Date.now() + (tokens.expires_in - 60) * 1000);
      const existing = await storage.getHubspotConnection(stash.tenantDomain);
      const data: import("@shared/schema").InsertHubspotConnection = {
        tenantDomain: stash.tenantDomain,
        hubspotPortalId: info.hub_id?.toString() ?? null,
        hubspotPortalName: info.hub_domain ?? null,
        encryptedAccessToken: encryptSecret(tokens.access_token),
        encryptedRefreshToken: encryptSecret(tokens.refresh_token),
        expiresAt,
        scopes: info.scopes ?? [],
        autoPushEnabled: existing?.autoPushEnabled ?? false,
        defaultOwnerId: existing?.defaultOwnerId ?? null,
        connectedByUserId: stash.userId,
        lastSyncAt: existing?.lastSyncAt ?? null,
        lastSyncError: null,
        lastSyncStats: existing?.lastSyncStats ?? null,
      };
      if (existing) {
        await storage.updateHubspotConnection(stash.tenantDomain, data);
      } else {
        await storage.createHubspotConnection(data);
      }
      console.log(`[HubSpot] Tenant ${stash.tenantDomain} connected portal=${info.hub_id} by user=${stash.userId}`);
      res.redirect(`/app/settings?hubspot=connected`);
    } catch (err) {
      console.error("[HubSpot] OAuth callback failed:", err);
      res.redirect(`/app/settings?hubspot=error&reason=${encodeURIComponent(errorMessage(err)).slice(0, 200)}`);
    }
  });

  // Disconnect — both DELETE /api/integrations/hubspot and the explicit
  // POST /api/integrations/hubspot/disconnect route shape from the spec.
  const disconnectHandler = async (req: Request, res: Response) => {
    try {
      const ctx = await loadHubspotContext(req, res);
      if (!ctx) return;
      await hubspot.disconnectTenant(ctx.tenantDomain);
      console.log(`[HubSpot] Tenant ${ctx.tenantDomain} disconnected by user=${ctx.userId}`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  };
  app.delete("/api/integrations/hubspot", disconnectHandler);
  app.post("/api/integrations/hubspot/disconnect", disconnectHandler);

  // Spec alias for /connect — same handler, exposes /start.
  app.get("/api/integrations/hubspot/start", async (req: Request, res: Response) => {
    try {
      const ctx = await loadHubspotContext(req, res);
      if (!ctx) return;
      if (!hubspot.isHubspotOauthConfigured()) {
        return res.status(503).json({
          error: "HubSpot OAuth is not configured on this Orbit instance. Contact your administrator to set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET.",
        });
      }
      pruneOauthStates();
      const state = crypto.randomBytes(24).toString("hex");
      const redirectUri = buildHubspotRedirectUri(req);
      hubspotOauthStates.set(state, {
        tenantDomain: ctx.tenantDomain,
        userId: ctx.userId,
        redirectUri,
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
      res.json({ authorizeUrl: hubspot.getAuthorizeUrl(state, redirectUri) });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // Update preferences (auto-push, default owner)
  const hubspotPrefsSchema = z.object({
    autoPushEnabled: z.boolean().optional(),
    autoCreateHubspotContacts: z.boolean().optional(),
    defaultSubscriptionId: z.string().nullable().optional(),
    defaultOwnerId: z.string().nullable().optional(),
    activeProspectSuppressionDefault: z.enum(["warn", "always_exclude"]).optional(),
  });

  app.patch("/api/integrations/hubspot", async (req: Request, res: Response) => {
    try {
      const ctx = await loadHubspotContext(req, res, { requireOutbound: true });
      if (!ctx) return;
      const conn = await storage.getHubspotConnection(ctx.tenantDomain);
      if (!conn) return res.status(404).json({ error: "HubSpot is not connected." });
      const parsed = hubspotPrefsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: fromError(parsed.error).toString() });
      const updates: Partial<import("@shared/schema").InsertHubspotConnection> = {};
      if (parsed.data.autoPushEnabled !== undefined) updates.autoPushEnabled = parsed.data.autoPushEnabled;
      if (parsed.data.autoCreateHubspotContacts !== undefined) updates.autoCreateHubspotContacts = parsed.data.autoCreateHubspotContacts;
      if (parsed.data.defaultSubscriptionId !== undefined) updates.defaultSubscriptionId = parsed.data.defaultSubscriptionId;
      if (parsed.data.defaultOwnerId !== undefined) updates.defaultOwnerId = parsed.data.defaultOwnerId;
      if (parsed.data.activeProspectSuppressionDefault !== undefined) updates.activeProspectSuppressionDefault = parsed.data.activeProspectSuppressionDefault;
      const updated = await storage.updateHubspotConnection(ctx.tenantDomain, updates);
      res.json(publicConnectionView(updated));
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // Manual sync now
  app.post("/api/integrations/hubspot/sync", async (req: Request, res: Response) => {
    try {
      const ctx = await loadHubspotContext(req, res);
      if (!ctx) return;
      const stats = await hubspot.syncTenant(ctx.tenantDomain);
      console.log(`[HubSpot] Manual sync ${ctx.tenantDomain} by user=${ctx.userId} stats=${JSON.stringify(stats)}`);
      res.json({ success: true, stats });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // Suggested competitors from CRM
  app.get("/api/integrations/hubspot/suggested-competitors", async (req: Request, res: Response) => {
    try {
      const ctx = await loadHubspotContext(req, res);
      if (!ctx) return;
      const items = await hubspot.listSuggestedCompetitors(ctx.tenantDomain);
      res.json({ items });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // List HubSpot owners (for the default-owner picker)
  app.get("/api/integrations/hubspot/owners", async (req: Request, res: Response) => {
    try {
      const ctx = await loadHubspotContext(req, res, { requireOutbound: true });
      if (!ctx) return;
      const owners = await hubspot.listOwners(ctx.tenantDomain);
      res.json({ owners });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // Push battlecard (or arbitrary HTML body) as a Note on a Competitor's HubSpot Company
  const pushNoteSchema = z.object({
    competitorId: z.string().min(1),
    kind: z.enum(["battlecard", "briefing"]),
    title: z.string().min(1).max(500),
    bodyHtml: z.string().min(1).max(50000).optional(),
    summary: z.string().max(20000).optional(),
    deepLink: z.string().url(),
    strengths: z.array(z.string()).optional(),
    weaknesses: z.array(z.string()).optional(),
    ourAdvantages: z.array(z.string()).optional(),
  });

  app.post("/api/integrations/hubspot/push-note", async (req: Request, res: Response) => {
    try {
      const ctx = await loadHubspotContext(req, res, { requireOutbound: true });
      if (!ctx) return;
      const parsed = pushNoteSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: fromError(parsed.error).toString() });

      const competitor = await storage.getCompetitor(parsed.data.competitorId);
      if (!competitor || competitor.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Competitor not found." });
      }
      if (!competitor.hubspotCompanyId) {
        return res.status(400).json({
          error: "This competitor is not linked to a HubSpot Company. Run sync first or set the company in HubSpot.",
        });
      }
      const html = parsed.data.bodyHtml
        ?? (parsed.data.kind === "battlecard"
              ? hubspot.buildBattlecardNoteHtml({
                  competitorName: competitor.name,
                  strengths: parsed.data.strengths,
                  weaknesses: parsed.data.weaknesses,
                  ourAdvantages: parsed.data.ourAdvantages,
                  deepLink: parsed.data.deepLink,
                })
              : hubspot.buildBriefingNoteHtml({
                  title: parsed.data.title,
                  summary: parsed.data.summary || "",
                  deepLink: parsed.data.deepLink,
                }));
      const result = await hubspot.pushNoteToCompany(ctx.tenantDomain, competitor.hubspotCompanyId, html);
      console.log(`[HubSpot] Note pushed tenant=${ctx.tenantDomain} competitor=${competitor.id} kind=${parsed.data.kind} note=${result.noteId}`);
      res.json({ success: true, noteId: result.noteId });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // Push action item / task to HubSpot
  const pushTaskSchema = z.object({
    competitorId: z.string().optional(),
    subject: z.string().min(1).max(500),
    body: z.string().min(1).max(20000),
    ownerId: z.string().nullable().optional(),
    dueAt: z.string().datetime().optional(),
  });

  app.post("/api/integrations/hubspot/push-task", async (req: Request, res: Response) => {
    try {
      const ctx = await loadHubspotContext(req, res, { requireOutbound: true });
      if (!ctx) return;
      const parsed = pushTaskSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: fromError(parsed.error).toString() });

      let companyId: string | null = null;
      if (parsed.data.competitorId) {
        const competitor = await storage.getCompetitor(parsed.data.competitorId);
        if (!competitor || competitor.tenantDomain !== ctx.tenantDomain) {
          return res.status(404).json({ error: "Competitor not found." });
        }
        companyId = competitor.hubspotCompanyId ?? null;
      }
      const result = await hubspot.pushTask(ctx.tenantDomain, {
        hubspotCompanyId: companyId,
        ownerId: parsed.data.ownerId ?? null,
        subject: parsed.data.subject,
        body: parsed.data.body,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      });
      console.log(`[HubSpot] Task pushed tenant=${ctx.tenantDomain} competitor=${parsed.data.competitorId ?? "none"} task=${result.taskId}`);
      res.json({ success: true, taskId: result.taskId });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // Manual push of an existing intelligence briefing to HubSpot.
  // Fans out to every related competitor's matched company, plus pushes
  // each action item as a Task (mirrors the auto-push pipeline).
  app.post("/api/integrations/hubspot/push-briefing", async (req: Request, res: Response) => {
    try {
      const ctx = await loadHubspotContext(req, res, { requireOutbound: true });
      if (!ctx) return;
      const briefingId = String(req.body?.briefingId || "");
      if (!briefingId) return res.status(400).json({ error: "briefingId required" });
      const briefing = await storage.getIntelligenceBriefing(briefingId);
      if (!briefing || briefing.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Briefing not found" });
      }
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      const data: any = (briefing as any).briefingData || {};
      const competitorIds: string[] = Array.isArray(data?.competitorIds) ? data.competitorIds : [];
      const actionItems: Array<{ title: string; description?: string; competitorId?: string }> =
        Array.isArray(data?.actionItems) ? data.actionItems : [];
      const result = await hubspot.autoPushBriefing({
        tenantDomain: ctx.tenantDomain,
        briefingId: briefing.id,
        title: (briefing as { periodLabel?: string }).periodLabel || "Intelligence briefing",
        executiveSummary: data?.executiveSummary || "",
        competitorIds,
        actionItems,
        planName: tenant?.plan || "",
        force: true,
      });
      console.log(`[HubSpot] Manual briefing push tenant=${ctx.tenantDomain} briefing=${briefing.id} result=${JSON.stringify(result)}`);
      if (result.reason && result.pushed === 0 && result.tasksPushed === 0) {
        return res.status(400).json({ error: `HubSpot push skipped: ${result.reason}`, result });
      }
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // Spec-shaped per-resource manual push routes.
  // POST /api/competitors/:id/hubspot/push-battlecard — pushes the
  // most recent battlecard for the competitor as a HubSpot Note,
  // bypassing the autoPushEnabled toggle (manual user action).
  app.post("/api/competitors/:id/hubspot/push-battlecard", async (req: Request, res: Response) => {
    try {
      const ctx = await loadHubspotContext(req, res, { requireOutbound: true });
      if (!ctx) return;
      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor || competitor.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Competitor not found." });
      }
      if (!competitor.hubspotCompanyId) {
        return res.status(400).json({ error: "This competitor is not linked to a HubSpot Company. Run sync first." });
      }
      const battlecardId: string | undefined = typeof req.body?.battlecardId === "string" ? req.body.battlecardId : undefined;
      const battlecard = battlecardId
        ? await storage.getBattlecard(battlecardId)
        : await storage.getBattlecardByCompetitor(competitor.id);
      if (!battlecard || battlecard.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Battlecard not found." });
      }
      const result = await hubspot.autoPushBattlecard({
        tenantDomain: ctx.tenantDomain,
        competitorId: competitor.id,
        competitorName: competitor.name,
        battlecardId: battlecard.id,
        strengths: battlecard.strengths as string[] | null | undefined,
        weaknesses: battlecard.weaknesses as string[] | null | undefined,
        ourAdvantages: battlecard.ourAdvantages as string[] | null | undefined,
        planName: ctx.plan,
        force: true,
      });
      if (!result.pushed) {
        return res.status(400).json({ error: `HubSpot push failed: ${result.reason || "unknown"}`, result });
      }
      console.log(`[HubSpot] Manual battlecard push tenant=${ctx.tenantDomain} competitor=${competitor.id} note=${result.noteId}`);
      res.json({ success: true, noteId: result.noteId });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // POST /api/briefings/:id/hubspot/push-summary — alias for the
  // briefing summary push, manual + bypasses auto_push toggle.
  app.post("/api/briefings/:id/hubspot/push-summary", async (req: Request, res: Response) => {
    try {
      const ctx = await loadHubspotContext(req, res, { requireOutbound: true });
      if (!ctx) return;
      const briefing = await storage.getIntelligenceBriefing(req.params.id);
      if (!briefing || briefing.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Briefing not found" });
      }
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      const data: { competitorIds?: unknown; actionItems?: unknown; executiveSummary?: string } =
        ((briefing as { briefingData?: unknown }).briefingData as Record<string, unknown>) || {};
      const competitorIds = Array.isArray(data.competitorIds)
        ? (data.competitorIds as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const actionItems = Array.isArray(data.actionItems)
        ? (data.actionItems as Array<{ title: string; description?: string; competitorId?: string }>)
        : [];
      const result = await hubspot.autoPushBriefing({
        tenantDomain: ctx.tenantDomain,
        briefingId: briefing.id,
        title: (briefing as { periodLabel?: string }).periodLabel || "Intelligence briefing",
        executiveSummary: typeof data.executiveSummary === "string" ? data.executiveSummary : "",
        competitorIds,
        actionItems,
        planName: tenant?.plan || "",
        force: true,
      });
      console.log(`[HubSpot] Manual briefing push (alias) tenant=${ctx.tenantDomain} briefing=${briefing.id} result=${JSON.stringify(result)}`);
      if (result.reason && result.pushed === 0 && result.tasksPushed === 0) {
        return res.status(400).json({ error: `HubSpot push skipped: ${result.reason}`, result });
      }
      res.json({ success: true, result });
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
