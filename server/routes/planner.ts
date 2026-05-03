/**
 * Microsoft Planner integration routes (Task #98 + Task #104).
 *
 * Phase 1 (Task #98) — OAuth + browse + connect/disconnect/sync.
 * Phase 2 (Task #104) — multi-bucket-per-category mappings, change-notification
 * subscriptions (subscribe/resubscribe/status), and per-plan sync log.
 */

import type { Express, Request } from "express";
import { randomBytes } from "crypto";
import { storage } from "../storage";
import { getRequestContext, ContextError } from "../context";
import { toContextFilter, hasAdminAccess, guardFeature } from "./helpers";
import {
  buildPlannerConsentUrl,
  exchangeCodeForGraphTokens,
  getValidGraphToken,
  listUserGroups,
  listGroupPlans,
  listPlanBuckets,
  createBucket,
  createGraphSubscription,
  renewGraphSubscription,
  deleteGraphSubscription,
  GraphHttpError,
  PLANNER_SCOPES,
} from "../services/planner-graph-client";
import { queuePlannerSyncForPlan } from "../services/planner-service";
import { buildVegaExportBundle } from "../services/vega-export";
import {
  getVegaConnectionStatus,
  setVegaCredentials,
  clearVegaCredentials,
  verifyVegaCredentials,
  pushPlanToVega,
} from "../services/vega-launchpad";
import { z } from "zod";
import { fromError } from "zod-validation-error";

function getRedirectUri(req: Request): string {
  if (process.env.PRODUCTION_URL) {
    return `${process.env.PRODUCTION_URL}/api/planner/auth/callback`;
  }
  if (process.env.REPLIT_DEPLOYMENT_URL) {
    return `https://${process.env.REPLIT_DEPLOYMENT_URL}/api/planner/auth/callback`;
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}/api/planner/auth/callback`;
  }
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000";
  return `${protocol}://${host}/api/planner/auth/callback`;
}

function getPublicBaseUrl(req: Request): string {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.PRODUCTION_URL) return process.env.PRODUCTION_URL.replace(/\/$/, "");
  if (process.env.REPLIT_DEPLOYMENT_URL) return `https://${process.env.REPLIT_DEPLOYMENT_URL}`;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000";
  return `${protocol}://${host}`;
}

function getWebhookUrl(req: Request): string {
  return `${getPublicBaseUrl(req)}/api/webhooks/graph-planner`;
}

function buildPlannerDeepLink(plannerPlanId: string, tenantDomain: string): string {
  return `https://tasks.office.com/${encodeURIComponent(tenantDomain)}/Home/Planner/#/plantaskboard?planId=${encodeURIComponent(plannerPlanId)}`;
}

function handleGraphError(res: any, err: any) {
  if (err instanceof GraphHttpError) {
    if (err.status === 401) {
      return res.status(401).json({ error: "Planner consent expired or invalid. Please reconnect." });
    }
    if (err.status === 403) {
      return res.status(403).json({ error: "Permission denied by Microsoft Graph. Verify Planner permissions." });
    }
    return res.status(err.status).json({ error: err.message, body: err.body });
  }
  console.error("[Planner] Unexpected error:", err);
  return res.status(500).json({ error: err.message || "Planner request failed" });
}

async function ensurePlannerSubscription(opts: {
  planId: string;
  plannerPlanId: string;
  connectedByUserId: string;
  webhookUrl: string;
}): Promise<{ ok: boolean; subscriptionId?: string; expiresAt?: Date; error?: string }> {
  const token = await getValidGraphToken(opts.connectedByUserId);
  if (!token) return { ok: false, error: "Planner consent unavailable" };
  const clientState = randomBytes(24).toString("hex");
  const resource = `/planner/plans/${opts.plannerPlanId}/tasks`;
  try {
    const sub = await createGraphSubscription(token, {
      resource,
      notificationUrl: opts.webhookUrl,
      clientState,
    });
    const expiresAt = new Date(sub.expirationDateTime);
    await storage.upsertPlannerSubscription({
      planId: opts.planId,
      subscriptionId: sub.id,
      resource,
      clientState,
      expiresAt,
      lastRenewedAt: new Date(),
      lastError: null,
    });
    return { ok: true, subscriptionId: sub.id, expiresAt };
  } catch (err: any) {
    const msg = err instanceof GraphHttpError ? `${err.message} (${JSON.stringify(err.body)})` : err.message;
    console.error("[Planner] Subscription create failed:", msg);
    // Track failure on the subscription record (if one exists) so the banner can surface it
    const existing = await storage.getPlannerSubscriptionByPlan(opts.planId);
    if (existing) {
      await storage.updatePlannerSubscription(opts.planId, { lastError: msg });
    }
    return { ok: false, error: msg };
  }
}

export function registerPlannerRoutes(app: Express) {
  // ----- Consent / auth status -----

  app.get("/api/planner/auth/status", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user) return res.status(401).json({ error: "User not found" });
      const scopes = (user.graphScopes || "").split(/\s+/).filter(Boolean);
      const requiredScopes = PLANNER_SCOPES.filter(s => s !== "offline_access");
      const hasAllScopes = requiredScopes.every(s => scopes.some(g => g.toLowerCase() === s.toLowerCase()));
      const connected = !!user.graphRefreshToken && hasAllScopes;
      res.json({
        connected,
        scopes,
        expiresAt: user.graphTokenExpiresAt || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/planner/auth/url", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      if (!process.env.ENTRA_CLIENT_ID || !process.env.ENTRA_CLIENT_SECRET) {
        return res.status(503).json({ error: "Microsoft Entra is not configured on this server." });
      }
      const redirectUri = getRedirectUri(req);
      const returnTo = (req.query.returnTo as string) || "/app/marketing-planner";
      const state = Buffer.from(JSON.stringify({
        userId: req.session.userId,
        returnTo,
        nonce: randomBytes(16).toString("hex"),
      })).toString("base64url");
      const url = buildPlannerConsentUrl({ state, redirectUri });
      if (!url) return res.status(503).json({ error: "Failed to build consent URL" });
      res.json({ url });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/planner/auth/callback", async (req, res) => {
    try {
      const code = req.query.code as string | undefined;
      const stateRaw = req.query.state as string | undefined;
      const error = req.query.error as string | undefined;
      const errorDesc = req.query.error_description as string | undefined;

      if (error) {
        console.error("[Planner] Consent error:", error, errorDesc);
        return res.redirect(`/app/marketing-planner?planner_error=${encodeURIComponent(error)}`);
      }
      if (!code || !stateRaw) {
        return res.redirect("/app/marketing-planner?planner_error=missing_code");
      }

      let state: { userId?: string; returnTo?: string };
      try {
        state = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf-8"));
      } catch {
        return res.redirect("/app/marketing-planner?planner_error=bad_state");
      }
      if (!state.userId || state.userId !== req.session.userId) {
        return res.redirect("/app/marketing-planner?planner_error=session_mismatch");
      }

      const ok = await exchangeCodeForGraphTokens({
        userId: state.userId,
        code,
        redirectUri: getRedirectUri(req),
      });
      if (!ok) {
        return res.redirect("/app/marketing-planner?planner_error=token_exchange_failed");
      }
      const returnTo = state.returnTo || "/app/marketing-planner";
      let safeReturnTo = "/app/marketing-planner";
      try {
        if (!returnTo.includes("://") && !returnTo.startsWith("//") && !returnTo.includes("\\")) {
          const parsed = new URL(returnTo, "https://localhost");
          if (parsed.origin === "https://localhost" && parsed.pathname.startsWith("/app/")) {
            safeReturnTo = parsed.pathname + (parsed.search || "");
          }
        }
      } catch {
        // Unparseable — keep the fallback
      }
      res.redirect(`${safeReturnTo}?planner_connected=1`);
    } catch (err: any) {
      console.error("[Planner] Callback exception:", err);
      res.redirect("/app/marketing-planner?planner_error=callback_exception");
    }
  });

  app.post("/api/planner/auth/disconnect", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      await storage.updateUser(req.session.userId, {
        graphAccessToken: null,
        graphRefreshToken: null,
        graphTokenExpiresAt: null,
        graphScopes: null,
      });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ----- Browse groups / plans / buckets -----

  app.get("/api/planner/groups", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const token = await getValidGraphToken(req.session.userId);
      if (!token) return res.status(401).json({ error: "Planner not connected", needsConsent: true });
      const groups = await listUserGroups(token);
      res.json(groups);
    } catch (err: any) {
      handleGraphError(res, err);
    }
  });

  app.get("/api/planner/groups/:groupId/plans", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const token = await getValidGraphToken(req.session.userId);
      if (!token) return res.status(401).json({ error: "Planner not connected", needsConsent: true });
      const plans = await listGroupPlans(token, req.params.groupId);
      res.json(plans);
    } catch (err: any) {
      handleGraphError(res, err);
    }
  });

  app.get("/api/planner/plans/:planId/buckets", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const token = await getValidGraphToken(req.session.userId);
      if (!token) return res.status(401).json({ error: "Planner not connected", needsConsent: true });
      const buckets = await listPlanBuckets(token, req.params.planId);
      res.json(buckets);
    } catch (err: any) {
      handleGraphError(res, err);
    }
  });

  app.post("/api/planner/plans/:planId/buckets", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const token = await getValidGraphToken(req.session.userId);
      if (!token) return res.status(401).json({ error: "Planner not connected", needsConsent: true });
      const schema = z.object({ name: z.string().min(1).max(100) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: fromError(parsed.error).toString() });
      const bucket = await createBucket(token, req.params.planId, parsed.data.name);
      res.json(bucket);
    } catch (err: any) {
      handleGraphError(res, err);
    }
  });

  // ----- Marketing plan connect / sync -----

  app.post("/api/marketing-plans/:id/planner/connect", async (req, res) => {
    if (!await guardFeature(req, res, "marketingPlanner")) return;
    try {
      const ctx = await getRequestContext(req);
      const plan = await storage.getMarketingPlan(req.params.id, toContextFilter(ctx));
      if (!plan) return res.status(404).json({ error: "Marketing plan not found" });

      const schema = z.object({
        groupId: z.string().min(1),
        groupName: z.string().min(1),
        planId: z.string().min(1),
        planName: z.string().min(1),
        bucketId: z.string().min(1).nullable(),
        bucketName: z.string().min(1).nullable(),
        // Phase 2: optional per-category bucket mappings
        categoryMappings: z.array(z.object({
          activityCategory: z.string().min(1),
          bucketId: z.string().min(1),
          bucketName: z.string().min(1),
        })).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: fromError(parsed.error).toString() });

      const updated = await storage.updateMarketingPlan(plan.id, {
        plannerGroupId: parsed.data.groupId,
        plannerGroupName: parsed.data.groupName,
        plannerPlanId: parsed.data.planId,
        plannerPlanName: parsed.data.planName,
        plannerBucketId: parsed.data.bucketId,
        plannerBucketName: parsed.data.bucketName,
        plannerConnectedBy: ctx.userId,
        plannerSyncEnabled: true,
        plannerLastSyncError: null,
      }, toContextFilter(ctx));

      if (parsed.data.categoryMappings) {
        await storage.setMarketingPlanBucketMappings(plan.id, parsed.data.categoryMappings);
      }

      // Best-effort: register a Graph change-notification subscription so
      // Planner edits flow back into Orbit in near real-time.
      const subResult = await ensurePlannerSubscription({
        planId: plan.id,
        plannerPlanId: parsed.data.planId,
        connectedByUserId: ctx.userId,
        webhookUrl: getWebhookUrl(req),
      });
      if (!subResult.ok) {
        console.warn(`[Planner] Subscription not created for plan ${plan.id}:`, subResult.error);
      }

      res.json({ ...updated, plannerSubscription: subResult });
    } catch (err: any) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/marketing-plans/:id/planner/disconnect", async (req, res) => {
    if (!await guardFeature(req, res, "marketingPlanner")) return;
    try {
      const ctx = await getRequestContext(req);
      const plan = await storage.getMarketingPlan(req.params.id, toContextFilter(ctx));
      if (!plan) return res.status(404).json({ error: "Marketing plan not found" });

      // Tear down any change-notification subscription
      const sub = await storage.getPlannerSubscriptionByPlan(plan.id);
      if (sub && plan.plannerConnectedBy) {
        try {
          const token = await getValidGraphToken(plan.plannerConnectedBy);
          if (token) await deleteGraphSubscription(token, sub.subscriptionId);
        } catch (subErr: any) {
          console.warn("[Planner] Subscription teardown failed (continuing):", subErr.message);
        }
        await storage.deletePlannerSubscription(plan.id);
      }
      await storage.deleteMarketingPlanBucketMappings(plan.id);

      const updated = await storage.updateMarketingPlan(plan.id, {
        plannerSyncEnabled: false,
        plannerGroupId: null,
        plannerGroupName: null,
        plannerPlanId: null,
        plannerPlanName: null,
        plannerBucketId: null,
        plannerBucketName: null,
        plannerConnectedBy: null,
        plannerLastSyncAt: null,
        plannerLastSyncError: null,
      }, toContextFilter(ctx));
      res.json(updated);
    } catch (err: any) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/marketing-plans/:id/planner/sync", async (req, res) => {
    if (!await guardFeature(req, res, "marketingPlanner")) return;
    try {
      const ctx = await getRequestContext(req);
      const plan = await storage.getMarketingPlan(req.params.id, toContextFilter(ctx));
      if (!plan) return res.status(404).json({ error: "Marketing plan not found" });
      if (!plan.plannerSyncEnabled || !plan.plannerPlanId) {
        return res.status(400).json({ error: "This plan is not connected to Microsoft Planner" });
      }
      // Sync runs through the background queue with retry/back-off + DLQ so
      // the HTTP request stays responsive even if Microsoft Graph is slow.
      const queued = queuePlannerSyncForPlan(plan.id, toContextFilter(ctx));
      res.status(202).json(queued);
    } catch (err: any) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      handleGraphError(res, err);
    }
  });

  // ----- Phase 2: status / mappings / resubscribe / sync log / vega export -----

  app.get("/api/marketing-plans/:id/planner/status", async (req, res) => {
    if (!await guardFeature(req, res, "marketingPlanner")) return;
    try {
      const ctx = await getRequestContext(req);
      const plan = await storage.getMarketingPlan(req.params.id, toContextFilter(ctx));
      if (!plan) return res.status(404).json({ error: "Marketing plan not found" });
      const subscription = await storage.getPlannerSubscriptionByPlan(plan.id);
      const mappings = await storage.getMarketingPlanBucketMappings(plan.id);
      const recentLog = await storage.getPlannerTaskSyncLog(plan.id, 25);
      const deepLink = plan.plannerPlanId
        ? buildPlannerDeepLink(plan.plannerPlanId, plan.tenantDomain)
        : null;
      // Per-task deep link template — clients substitute `{taskId}` to open
      // a single Planner card directly, matching Microsoft's task URL shape.
      const taskDeepLinkTemplate = plan.plannerPlanId
        ? `https://tasks.office.com/${encodeURIComponent(plan.tenantDomain)}/Home/Task/{taskId}?planId=${encodeURIComponent(plan.plannerPlanId)}`
        : null;
      res.json({
        connected: !!plan.plannerSyncEnabled && !!plan.plannerPlanId,
        plannerGroupId: plan.plannerGroupId,
        plannerGroupName: plan.plannerGroupName,
        plannerPlanId: plan.plannerPlanId,
        plannerPlanName: plan.plannerPlanName,
        plannerBucketId: plan.plannerBucketId,
        plannerBucketName: plan.plannerBucketName,
        plannerLastSyncAt: plan.plannerLastSyncAt,
        plannerLastSyncError: plan.plannerLastSyncError,
        deepLink,
        taskDeepLinkTemplate,
        subscription: subscription ? {
          subscriptionId: subscription.subscriptionId,
          expiresAt: subscription.expiresAt,
          lastRenewedAt: subscription.lastRenewedAt,
          lastError: subscription.lastError,
          healthy: !subscription.lastError && subscription.expiresAt.getTime() > Date.now(),
        } : null,
        categoryMappings: mappings.map(m => ({
          activityCategory: m.activityCategory,
          bucketId: m.bucketId,
          bucketName: m.bucketName,
        })),
        recentLog: recentLog.map(r => ({
          occurredAt: r.occurredAt,
          direction: r.direction,
          taskId: r.taskId,
          plannerTaskId: r.plannerTaskId,
          fields: r.fields,
          success: r.success,
          errorMessage: r.errorMessage,
        })),
      });
    } catch (err: any) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/marketing-plans/:id/planner/mappings", async (req, res) => {
    if (!await guardFeature(req, res, "marketingPlanner")) return;
    try {
      const ctx = await getRequestContext(req);
      const plan = await storage.getMarketingPlan(req.params.id, toContextFilter(ctx));
      if (!plan) return res.status(404).json({ error: "Marketing plan not found" });
      const schema = z.object({
        mappings: z.array(z.object({
          activityCategory: z.string().min(1),
          bucketId: z.string().min(1),
          bucketName: z.string().min(1),
        })),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: fromError(parsed.error).toString() });
      const saved = await storage.setMarketingPlanBucketMappings(plan.id, parsed.data.mappings);
      res.json({ mappings: saved });
    } catch (err: any) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/marketing-plans/:id/planner/resubscribe", async (req, res) => {
    if (!await guardFeature(req, res, "marketingPlanner")) return;
    try {
      const ctx = await getRequestContext(req);
      const plan = await storage.getMarketingPlan(req.params.id, toContextFilter(ctx));
      if (!plan) return res.status(404).json({ error: "Marketing plan not found" });
      if (!plan.plannerPlanId || !plan.plannerConnectedBy) {
        return res.status(400).json({ error: "Plan is not connected to Microsoft Planner" });
      }

      // Best-effort: try to delete any existing subscription before creating a new one.
      const existing = await storage.getPlannerSubscriptionByPlan(plan.id);
      if (existing) {
        try {
          const token = await getValidGraphToken(plan.plannerConnectedBy);
          if (token) await deleteGraphSubscription(token, existing.subscriptionId);
        } catch {
          // swallow — likely already expired
        }
      }
      const result = await ensurePlannerSubscription({
        planId: plan.id,
        plannerPlanId: plan.plannerPlanId,
        connectedByUserId: plan.plannerConnectedBy,
        webhookUrl: getWebhookUrl(req),
      });
      if (!result.ok) return res.status(502).json({ error: result.error || "Failed to resubscribe" });
      res.json({
        ok: true,
        subscriptionId: result.subscriptionId,
        expiresAt: result.expiresAt,
      });
    } catch (err: any) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      handleGraphError(res, err);
    }
  });

  // ----- Vega Launchpad export bundle -----

  // ----- Vega Launchpad direct push (Task #117) -----

  app.get("/api/vega/auth/status", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const status = await getVegaConnectionStatus(ctx.tenantDomain);
      res.json(status);
    } catch (err: any) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/vega/auth/config", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      if (!hasAdminAccess(ctx.userRole)) {
        return res.status(403).json({ error: "Admin access required" });
      }
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      const schema = z.object({
        url: z.string().url(),
        apiKey: z.string().min(8),
        workspaceId: z.string().min(1).optional().nullable(),
        skipVerification: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: fromError(parsed.error).toString() });

      if (!parsed.data.skipVerification) {
        const probe = await verifyVegaCredentials(parsed.data.url, parsed.data.apiKey);
        if (!probe.ok) {
          return res.status(400).json({ error: probe.error || "Failed to verify Vega credentials" });
        }
      }
      await setVegaCredentials(tenant.id, {
        url: parsed.data.url,
        apiKey: parsed.data.apiKey,
        workspaceId: parsed.data.workspaceId ?? null,
      });
      const status = await getVegaConnectionStatus(ctx.tenantDomain);
      res.json(status);
    } catch (err: any) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/vega/auth/config", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      if (!hasAdminAccess(ctx.userRole)) {
        return res.status(403).json({ error: "Admin access required" });
      }
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      await clearVegaCredentials(tenant.id);
      res.json({ ok: true });
    } catch (err: any) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/marketing-plans/:id/vega/push", async (req, res) => {
    if (!await guardFeature(req, res, "marketingPlanner")) return;
    try {
      const ctx = await getRequestContext(req);
      const result = await pushPlanToVega(req.params.id, toContextFilter(ctx), ctx.userId);
      const plan = await storage.getMarketingPlan(req.params.id, toContextFilter(ctx));
      if (!result.ok) {
        return res.status(502).json({
          ok: false,
          error: result.error,
          status: result.status,
          pushedAt: result.pushedAt,
          plan: plan ? {
            vegaLastPushAt: plan.vegaLastPushAt,
            vegaLastPushStatus: plan.vegaLastPushStatus,
            vegaLastPushError: plan.vegaLastPushError,
            vegaLastPushBundleId: plan.vegaLastPushBundleId,
          } : null,
        });
      }
      res.json({
        ok: true,
        bundleId: result.bundleId,
        pushedAt: result.pushedAt,
        plan: plan ? {
          vegaLastPushAt: plan.vegaLastPushAt,
          vegaLastPushStatus: plan.vegaLastPushStatus,
          vegaLastPushError: plan.vegaLastPushError,
          vegaLastPushBundleId: plan.vegaLastPushBundleId,
        } : null,
      });
    } catch (err: any) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
      res.status(status).json({ error: err.message || "Failed to push plan to Vega" });
    }
  });

  app.get("/api/marketing-plans/:id/vega-export", async (req, res) => {
    if (!await guardFeature(req, res, "marketingPlanner")) return;
    try {
      const ctx = await getRequestContext(req);
      const requested = String(req.query.format ?? "zip").toLowerCase();
      const format: "zip" | "json" = requested === "json" ? "json" : "zip";
      const bundle = await buildVegaExportBundle(req.params.id, toContextFilter(ctx), format);
      if (!bundle) return res.status(404).json({ error: "Marketing plan not found" });
      res.setHeader("Content-Type", bundle.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${bundle.filename}"`);
      res.setHeader("Content-Length", String(bundle.body.length));
      res.end(bundle.body);
    } catch (err: any) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      console.error("[Vega Export] Failed:", err);
      res.status(500).json({ error: err.message || "Failed to build Vega export" });
    }
  });
}
