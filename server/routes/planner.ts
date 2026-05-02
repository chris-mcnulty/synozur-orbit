/**
 * Microsoft Planner integration routes.
 *
 * Lifecycle:
 *   1. User clicks "Connect to Microsoft Planner" → GET /api/planner/auth/url
 *      returns a Microsoft consent URL with `Tasks.ReadWrite Group.Read.All
 *      offline_access` scopes.
 *   2. After consent, Microsoft redirects to /api/planner/auth/callback with
 *      ?code=...; we exchange for tokens and store them on the user.
 *   3. Client uses /api/planner/groups, /api/planner/groups/:id/plans, and
 *      /api/planner/plans/:id/buckets to populate selectors.
 *   4. Client POSTs to /api/marketing-plans/:id/planner/connect to set the
 *      target group/plan/bucket on the marketing plan.
 *   5. Client POSTs to /api/marketing-plans/:id/planner/sync to push tasks.
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
  GraphHttpError,
  PLANNER_SCOPES,
} from "../services/planner-graph-client";
import { syncMarketingPlanToPlanner } from "../services/planner-service";
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
      // Encode the user id and an optional return path in `state` so the
      // callback can re-associate the consent with the right session.
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
      // Require the session user to match the state user (prevents cross-user replay)
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
      // Prevent open-redirect: use URL constructor to confirm the path stays on
      // the same origin and within /app/. Any value that doesn't parse as a
      // same-origin /app/ path falls back to the default.
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
      } as any);
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
      } as any, toContextFilter(ctx));

      res.json(updated);
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
      } as any, toContextFilter(ctx));
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
      const result = await syncMarketingPlanToPlanner(plan.id, toContextFilter(ctx));
      res.json(result);
    } catch (err: any) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      handleGraphError(res, err);
    }
  });
}
