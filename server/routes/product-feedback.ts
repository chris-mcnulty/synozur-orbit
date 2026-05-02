import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import crypto from "crypto";
import { getRequestContext, ContextError } from "../context";
import { toContextFilter, validateResourceContext, hasAdminAccess, guardFeature } from "./helpers";
import { products, productFeedback, productFeedbackVotes, productFeatures } from "@shared/schema";
import { z } from "zod";
import { completeForFeature } from "../services/ai-provider";
import { AI_FEATURES } from "@shared/schema";
import { checkFeatureAccessAsync } from "../services/plan-policy";

const FEEDBACK_STATUSES = ["new", "planned", "shipped", "declined"] as const;
const FEEDBACK_FEATURE_KEY = "customerFeedback";

// HMAC secret for signed CAPTCHA challenges. Derived from session secret so
// challenges cannot be forged by clients.
const CAPTCHA_SECRET = (process.env.SESSION_SECRET || "orbit-secret-key-change-in-production") + ":captcha-v1";
const CAPTCHA_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface SignedCaptcha {
  a: number;
  b: number;
  exp: number;
  nonce: string;
  question: string;
  token: string;
}

function signCaptchaPayload(a: number, b: number, exp: number, nonce: string): string {
  const h = crypto.createHmac("sha256", CAPTCHA_SECRET);
  h.update(`${a}|${b}|${exp}|${nonce}`);
  return h.digest("hex");
}

function issueCaptcha(): SignedCaptcha {
  const a = Math.floor(Math.random() * 9) + 1;
  const b = Math.floor(Math.random() * 9) + 1;
  const exp = Date.now() + CAPTCHA_TTL_MS;
  const nonce = crypto.randomBytes(8).toString("hex");
  const sig = signCaptchaPayload(a, b, exp, nonce);
  const tokenJson = JSON.stringify({ a, b, exp, nonce, sig });
  const token = Buffer.from(tokenJson, "utf8").toString("base64url");
  return { a, b, exp, nonce, question: `What is ${a} + ${b}?`, token };
}

function verifySignedCaptcha(token: string, answer: number): { ok: true } | { ok: false; reason: string } {
  if (typeof token !== "string" || !token) return { ok: false, reason: "Missing captcha challenge" };
  let payload: { a: number; b: number; exp: number; nonce: string; sig: string };
  try {
    payload = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "Invalid captcha challenge" };
  }
  if (typeof payload.a !== "number" || typeof payload.b !== "number" || typeof payload.exp !== "number" || typeof payload.nonce !== "string" || typeof payload.sig !== "string") {
    return { ok: false, reason: "Invalid captcha challenge" };
  }
  if (Date.now() > payload.exp) return { ok: false, reason: "Captcha expired, please refresh" };
  const expected = signCaptchaPayload(payload.a, payload.b, payload.exp, payload.nonce);
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(payload.sig, "hex");
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, reason: "Invalid captcha signature" };
  }
  if (Number.isNaN(answer) || payload.a + payload.b !== answer) {
    return { ok: false, reason: "Captcha answer is incorrect" };
  }
  return { ok: true };
}

async function ensurePublicFeedbackPlan(tenantDomain: string, res: Response): Promise<boolean> {
  const tenant = await storage.getTenantByDomain(tenantDomain);
  const plan = tenant?.plan || "free";
  const gate = await checkFeatureAccessAsync(plan, FEEDBACK_FEATURE_KEY);
  if (!gate.allowed) {
    res.status(404).json({ error: "Feedback board not found" });
    return false;
  }
  return true;
}

const submitSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  category: z.string().trim().max(60).optional().nullable(),
});

const updateSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  status: z.enum(FEEDBACK_STATUSES).optional(),
});

const publicSubmitSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  email: z.string().trim().email().max(200).optional().nullable(),
  name: z.string().trim().max(120).optional().nullable(),
  captchaToken: z.string().min(1),
  captchaAnswer: z.number().int(),
  honeypot: z.string().max(0).optional().nullable(),
});

const publicVoteSchema = z.object({
  email: z.string().trim().email().max(200).optional().nullable(),
  captchaToken: z.string().min(1),
  captchaAnswer: z.number().int(),
  honeypot: z.string().max(0).optional().nullable(),
});

function getClientIp(req: Request): string {
  const fwd = (req.headers["x-forwarded-for"] || "") as string;
  return fwd.split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

function hashKey(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

const publicRateBuckets = new Map<string, { count: number; resetAt: number }>();
const PUBLIC_RATE_WINDOW_MS = 60_000;
const PUBLIC_RATE_MAX = 10;

function rateLimitPublic(req: Request, res: Response): boolean {
  const ip = getClientIp(req);
  const key = `${ip}:${req.path}`;
  const now = Date.now();
  const bucket = publicRateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    publicRateBuckets.set(key, { count: 1, resetAt: now + PUBLIC_RATE_WINDOW_MS });
    return true;
  }
  if (bucket.count >= PUBLIC_RATE_MAX) {
    res.status(429).json({ error: "Too many requests. Please slow down." });
    return false;
  }
  bucket.count += 1;
  return true;
}

function verifyHoneypot(payload: { honeypot?: string | null }): boolean {
  return !payload.honeypot || payload.honeypot.length === 0;
}

async function loadProductByToken(token: string) {
  if (!token || token.length < 16) return null;
  const [product] = await db.select().from(products).where(eq(products.publicFeedbackToken, token));
  if (!product || !product.publicFeedbackEnabled) return null;
  return product;
}

export function registerProductFeedbackRoutes(app: Express) {
  // ==================== INTERNAL FEEDBACK ROUTES ====================

  app.get("/api/products/:productId/feedback", async (req, res) => {
    if (!await guardFeature(req, res, FEEDBACK_FEATURE_KEY)) return;
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });

      const feedback = await storage.getProductFeedbackByProduct(req.params.productId);
      const votes = await storage.getFeedbackVotesByProduct(req.params.productId);
      const userKey = `user:${ctx.userId}`;
      const myVotes = new Set(votes.filter(v => v.voterKey === userKey).map(v => v.feedbackId));

      const promotedIds = feedback.map(f => f.promotedFeatureId).filter((id): id is string => !!id);
      const promotedFeatures = promotedIds.length
        ? await db.select({ id: productFeatures.id, name: productFeatures.name, status: productFeatures.status })
            .from(productFeatures)
            .where(and(eq(productFeatures.tenantDomain, ctx.tenantDomain), eq(productFeatures.productId, product.id)))
        : [];
      const featureMap = new Map(promotedFeatures.map(f => [f.id, f]));

      const enriched = feedback.map(f => ({
        ...f,
        hasVoted: myVotes.has(f.id),
        promotedFeature: f.promotedFeatureId
          ? (featureMap.get(f.promotedFeatureId) ?? null)
          : null,
      }));
      res.json({
        items: enriched,
        publicEnabled: !!product.publicFeedbackEnabled,
        publicToken: product.publicFeedbackEnabled ? product.publicFeedbackToken : null,
      });
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/products/:productId/feedback", async (req, res) => {
    if (!await guardFeature(req, res, FEEDBACK_FEATURE_KEY)) return;
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });

      const parsed = submitSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

      const me = await storage.getUser(ctx.userId);
      const created = await storage.createProductFeedback({
        productId: product.id,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        category: parsed.data.category ?? null,
        status: "new",
        source: "internal",
        submitterUserId: ctx.userId,
        submitterEmail: me?.email ?? null,
        submitterName: me?.name ?? null,
        submitterIp: getClientIp(req),
      });
      res.status(201).json(created);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/products/:productId/feedback/:feedbackId", async (req, res) => {
    if (!await guardFeature(req, res, FEEDBACK_FEATURE_KEY)) return;
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });

      const fb = await storage.getProductFeedback(req.params.feedbackId);
      if (!fb || fb.productId !== product.id) return res.status(404).json({ error: "Feedback not found" });
      if (!validateResourceContext(fb, ctx)) return res.status(403).json({ error: "Access denied" });

      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

      const me = await storage.getUser(ctx.userId);
      const isAdmin = hasAdminAccess(me?.role || "");
      const isOwner = fb.submitterUserId === ctx.userId;

      if (parsed.data.status && !isAdmin) {
        return res.status(403).json({ error: "Only admins can change status" });
      }
      if ((parsed.data.title || parsed.data.description !== undefined || parsed.data.category !== undefined) && !isAdmin && !isOwner) {
        return res.status(403).json({ error: "Only the submitter or an admin can edit this item" });
      }

      const updated = await storage.updateProductFeedback(fb.id, parsed.data);
      res.json(updated);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/products/:productId/feedback/:feedbackId", async (req, res) => {
    if (!await guardFeature(req, res, FEEDBACK_FEATURE_KEY)) return;
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });

      const fb = await storage.getProductFeedback(req.params.feedbackId);
      if (!fb || fb.productId !== product.id) return res.status(404).json({ error: "Feedback not found" });
      if (!validateResourceContext(fb, ctx)) return res.status(403).json({ error: "Access denied" });

      const me = await storage.getUser(ctx.userId);
      const isAdmin = hasAdminAccess(me?.role || "");
      const isOwner = fb.submitterUserId === ctx.userId;
      if (!isAdmin && !isOwner) {
        return res.status(403).json({ error: "Only the submitter or an admin can delete this item" });
      }

      await storage.deleteProductFeedback(fb.id);
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/products/:productId/feedback/:feedbackId/vote", async (req, res) => {
    if (!await guardFeature(req, res, FEEDBACK_FEATURE_KEY)) return;
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });

      const fb = await storage.getProductFeedback(req.params.feedbackId);
      if (!fb || fb.productId !== product.id) return res.status(404).json({ error: "Feedback not found" });
      if (!validateResourceContext(fb, ctx)) return res.status(403).json({ error: "Access denied" });

      const result = await storage.toggleFeedbackVote({
        feedbackId: fb.id,
        productId: product.id,
        tenantDomain: ctx.tenantDomain,
        voterUserId: ctx.userId,
        voterEmail: null,
        voterIp: getClientIp(req),
        voterKey: `user:${ctx.userId}`,
      });
      res.json(result);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/products/:productId/feedback/:feedbackId/promote", async (req, res) => {
    if (!await guardFeature(req, res, FEEDBACK_FEATURE_KEY)) return;
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });

      const me = await storage.getUser(ctx.userId);
      if (!hasAdminAccess(me?.role || "")) {
        return res.status(403).json({ error: "Only admins can promote feedback to features" });
      }

      const fb = await storage.getProductFeedback(req.params.feedbackId);
      if (!fb || fb.productId !== product.id) return res.status(404).json({ error: "Feedback not found" });
      if (!validateResourceContext(fb, ctx)) return res.status(403).json({ error: "Access denied" });

      if (fb.promotedFeatureId) {
        return res.status(400).json({ error: "This feedback has already been promoted to a feature" });
      }

      const priority = req.body?.priority === "high" || req.body?.priority === "low" ? req.body.priority : "medium";
      const status = req.body?.status === "in_progress" ? "in_progress" : "planned";
      const quarter = typeof req.body?.quarter === "string" && /^Q[1-4]$/.test(req.body.quarter) ? req.body.quarter : null;
      const year = Number.isInteger(req.body?.year) ? req.body.year : null;
      const effort = ["xs", "s", "m", "l", "xl"].includes(req.body?.effort) ? req.body.effort : null;

      const result = await storage.promoteFeedbackToFeature(
        fb.id,
        {
          productId: product.id,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          name: fb.title,
          description: fb.description ?? null,
          category: fb.category ?? "Customer Request",
          status,
          priority,
          targetQuarter: quarter,
          targetYear: year,
          sourceType: "manual",
        },
        { quarter, year, effort, status: status === "in_progress" ? "in_progress" : "planned" },
      );
      res.json(result);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/products/:productId/feedback/group-similar", async (req, res) => {
    if (!await guardFeature(req, res, FEEDBACK_FEATURE_KEY)) return;
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });

      const me = await storage.getUser(ctx.userId);
      if (!hasAdminAccess(me?.role || "")) {
        return res.status(403).json({ error: "Only admins can run AI grouping" });
      }

      const items = await storage.getProductFeedbackByProduct(product.id);
      if (items.length < 2) return res.json({ groups: [] });

      const condensed = items.slice(0, 80).map(f => ({
        id: f.id,
        title: f.title,
        description: (f.description || "").slice(0, 300),
      }));

      const prompt = `You analyze user-submitted product feedback for "${product.name}" and group items that describe the same underlying request or duplicate ideas.

Return ONLY valid JSON in this exact shape:
{
  "groups": [
    { "label": "short theme", "feedbackIds": ["id1","id2"] }
  ]
}

Rules:
- Only include groups with 2+ items.
- Do not invent ids; use only ids from the list below.
- Items unrelated to any duplicate group should be omitted entirely.
- Limit to at most 10 groups.

Feedback items:
${JSON.stringify(condensed, null, 2)}`;

      const groupSchema = z.object({
        groups: z.array(z.object({
          label: z.string().optional(),
          feedbackIds: z.array(z.string()),
        })).optional(),
      });

      let groups: { label: string; feedbackIds: string[] }[] = [];
      try {
        const result = await completeForFeature(AI_FEATURES.FEATURE_EXTRACTION, prompt, { maxTokens: 1500, temperature: 0.2 });
        const text = result.text || "";
        const jsonStart = text.indexOf("{");
        const jsonEnd = text.lastIndexOf("}");
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          const parsed = groupSchema.safeParse(JSON.parse(text.slice(jsonStart, jsonEnd + 1)));
          if (parsed.success && parsed.data.groups) {
            const validIds = new Set(items.map(i => i.id));
            groups = parsed.data.groups
              .map(g => ({
                label: typeof g.label === "string" && g.label.length > 0 ? g.label.slice(0, 80) : "Similar items",
                feedbackIds: g.feedbackIds.filter(id => validIds.has(id)),
              }))
              .filter(g => g.feedbackIds.length >= 2)
              .slice(0, 10);
          }
        }
      } catch (err) {
        console.error("[feedback group-similar] AI failure:", err);
        return res.status(502).json({ error: "AI grouping failed. Please try again." });
      }

      res.json({ groups });
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Public share token settings: enable/disable + rotate
  app.post("/api/products/:productId/feedback/share-token", async (req, res) => {
    if (!await guardFeature(req, res, FEEDBACK_FEATURE_KEY)) return;
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });

      const me = await storage.getUser(ctx.userId);
      if (!hasAdminAccess(me?.role || "")) {
        return res.status(403).json({ error: "Only admins can manage public links" });
      }

      const action = req.body?.action;
      if (action !== "enable" && action !== "disable" && action !== "rotate") {
        return res.status(400).json({ error: "action must be enable, disable, or rotate" });
      }

      let enabled = product.publicFeedbackEnabled;
      let token = product.publicFeedbackToken;
      if (action === "disable") {
        enabled = false;
      } else if (action === "enable") {
        enabled = true;
        if (!token) token = crypto.randomBytes(24).toString("hex");
      } else {
        enabled = true;
        token = crypto.randomBytes(24).toString("hex");
      }

      const updated = await storage.updateProduct(product.id, {
        publicFeedbackEnabled: enabled,
        publicFeedbackToken: token,
      });
      res.json({
        publicEnabled: !!updated.publicFeedbackEnabled,
        publicToken: updated.publicFeedbackEnabled ? updated.publicFeedbackToken : null,
      });
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== PUBLIC ROUTES ====================

  app.get("/api/public/feedback/:token", async (req, res) => {
    if (!rateLimitPublic(req, res)) return;
    try {
      const product = await loadProductByToken(req.params.token);
      if (!product) return res.status(404).json({ error: "Feedback board not found" });
      if (!await ensurePublicFeedbackPlan(product.tenantDomain, res)) return;

      const items = await storage.getProductFeedbackByProduct(product.id);
      const captcha = issueCaptcha();
      res.json({
        productName: product.name,
        productDescription: product.description,
        items: items.map(f => ({
          id: f.id,
          title: f.title,
          description: f.description,
          status: f.status,
          category: f.category,
          voteCount: f.voteCount,
          createdAt: f.createdAt,
        })),
        captcha: { question: captcha.question, token: captcha.token },
      });
    } catch (error: any) {
      console.error("[public feedback] list error:", error);
      res.status(500).json({ error: "Failed to load feedback" });
    }
  });

  app.post("/api/public/feedback/:token/submit", async (req, res) => {
    if (!rateLimitPublic(req, res)) return;
    try {
      const product = await loadProductByToken(req.params.token);
      if (!product) return res.status(404).json({ error: "Feedback board not found" });
      if (!await ensurePublicFeedbackPlan(product.tenantDomain, res)) return;

      const parsed = publicSubmitSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      if (!verifyHoneypot(parsed.data)) return res.status(400).json({ error: "Spam protection triggered" });
      const cap = verifySignedCaptcha(parsed.data.captchaToken, parsed.data.captchaAnswer);
      if (!cap.ok) return res.status(400).json({ error: cap.reason });

      const ip = getClientIp(req);
      const created = await storage.createProductFeedback({
        productId: product.id,
        tenantDomain: product.tenantDomain,
        marketId: product.marketId ?? null,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        category: null,
        status: "new",
        source: "public",
        submitterUserId: null,
        submitterEmail: parsed.data.email ?? null,
        submitterName: parsed.data.name ?? null,
        submitterIp: ip,
      });
      const next = issueCaptcha();
      res.status(201).json({ id: created.id, captcha: { question: next.question, token: next.token } });
    } catch (error: any) {
      console.error("[public feedback] submit error:", error);
      res.status(500).json({ error: "Failed to submit feedback" });
    }
  });

  app.post("/api/public/feedback/:token/vote/:feedbackId", async (req, res) => {
    if (!rateLimitPublic(req, res)) return;
    try {
      const product = await loadProductByToken(req.params.token);
      if (!product) return res.status(404).json({ error: "Feedback board not found" });
      if (!await ensurePublicFeedbackPlan(product.tenantDomain, res)) return;

      const fb = await storage.getProductFeedback(req.params.feedbackId);
      if (!fb || fb.productId !== product.id) return res.status(404).json({ error: "Feedback item not found" });

      const parsed = publicVoteSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      if (!verifyHoneypot(parsed.data)) return res.status(400).json({ error: "Spam protection triggered" });
      const cap = verifySignedCaptcha(parsed.data.captchaToken, parsed.data.captchaAnswer);
      if (!cap.ok) return res.status(400).json({ error: cap.reason });

      const ip = getClientIp(req);
      const voterKey = parsed.data.email
        ? `email:${hashKey(parsed.data.email.toLowerCase())}`
        : `ip:${hashKey(ip)}`;

      const result = await storage.toggleFeedbackVote({
        feedbackId: fb.id,
        productId: product.id,
        tenantDomain: product.tenantDomain,
        voterUserId: null,
        voterEmail: parsed.data.email ?? null,
        voterIp: ip,
        voterKey,
      });
      const next = issueCaptcha();
      res.json({ ...result, captcha: { question: next.question, token: next.token } });
    } catch (error: any) {
      console.error("[public feedback] vote error:", error);
      res.status(500).json({ error: "Failed to record vote" });
    }
  });
}
