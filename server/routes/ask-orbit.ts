import type { Express, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db";
import { getRequestContext, type RequestContext } from "../context";
import { storage } from "../storage";
import { checkFeatureAccessAsync, resolveEffectivePlan } from "../services/plan-policy";
import { ASK_ORBIT_CONFIG } from "../config/ask-orbit";
import { configuredAllowance, INSUFFICIENT, LIMITATION } from "../services/ask-orbit/grounding";
import { OrbitError, OrbitRepository } from "../services/ask-orbit/repository";
import { retrieveSources, type SourceAccess } from "../services/ask-orbit/retrieval";
import { generateAnswer } from "../services/ask-orbit/generation";

const idSchema = z.string().uuid();
const titleSchema = z.object({ title: z.string().trim().min(1).max(100) }).strict();
const questionSchema = z.object({
  requestId: idSchema,
  question: z.string().trim().min(1).max(2000),
}).strict();
const ROLES = new Set(["Standard User", "Analyst", "Domain Admin", "Consultant", "Global Admin"]);
const SOURCE_FEATURES = ["websiteMonitoring", "socialMonitoring", "intelligenceBriefings",
  "gtmPlan", "messagingFramework", "marketingPlanner", "productManagement"];

/** Exposed dependencies allow full HTTP lifecycle tests without paid AI calls. */
export function registerAskOrbitRoutes(app: Express, dependencies: Partial<{
  repository: OrbitRepository;
  authorize: (req: Request) => Promise<{ ctx: RequestContext; access: SourceAccess }>;
  retrieve: typeof retrieveSources;
  generate: typeof generateAnswer;
  timeoutMs: number;
}> = {}) {
  const repo = dependencies.repository ?? new OrbitRepository(pool);
  const retrieve = dependencies.retrieve ?? retrieveSources;
  const generate = dependencies.generate ?? generateAnswer;
  const running = new Map<string, AbortController>();

  async function authorize(req: Request) {
    // Session only; partner tokens are not an alternate Ask Orbit entry point.
    if (!req.session?.userId || req.headers.authorization) throw new OrbitError("Not authenticated.", 401);
    const ctx = await getRequestContext(req);
    if (!ROLES.has(ctx.userRole)) throw new OrbitError("Your role cannot access Ask Orbit.", 403);
    const tenant = await storage.getTenant(ctx.tenantId);
    if (!tenant) throw new OrbitError("Tenant not found.", 403);
    const plan = resolveEffectivePlan(tenant);
    if (!["enterprise", "unlimited"].includes(plan) || !(await checkFeatureAccessAsync(plan, "askOrbit")).allowed) {
      throw new OrbitError("Ask Orbit requires an Enterprise plan with Ask Orbit enabled.", 403);
    }
    configuredAllowance(ASK_ORBIT_CONFIG.monthlyAllowance);
    const flags = await Promise.all(SOURCE_FEATURES.map(async f => [f, (await checkFeatureAccessAsync(plan, f)).allowed] as const));
    return { ctx, access: Object.fromEntries(flags) };
  }
  const auth = dependencies.authorize ?? authorize;
  const fail = (res: Response, error: unknown) => {
    if (res.headersSent) return;
    const e = error as { status?: number; message?: string };
    const status = error instanceof z.ZodError ? 400 : e.status || 500;
    if (status === 500) console.error("[Ask Orbit] Request failed", error);
    res.status(status).json({ error: status === 500 ? "Ask Orbit is temporarily unavailable." :
      error instanceof z.ZodError ? "Invalid request." : e.message });
  };
  // These handlers are all registered under the same enforced access boundary.
  app.get("/api/ask-orbit", async (req, res) => {
    try {
      const { ctx } = await auth(req);
      const [usage, conversations] = await Promise.all([repo.usage(ctx), repo.list(ctx)]);
      res.setHeader("Cache-Control", "no-store");
      res.json({ context: { userId: ctx.userId, tenantId: ctx.tenantId, marketId: ctx.marketId }, usage, conversations });
    } catch (e) { fail(res, e); }
  });
  app.post("/api/ask-orbit/conversations", async (req, res) => {
    try {
      const { ctx } = await auth(req);
      const { title } = titleSchema.parse(req.body);
      res.status(201).json(await repo.create(ctx, title));
    } catch (e) { fail(res, e); }
  });
  app.get("/api/ask-orbit/conversations/:id", async (req, res) => {
    try {
      const { ctx } = await auth(req);
      res.setHeader("Cache-Control", "no-store");
      res.json(await repo.get(ctx, idSchema.parse(req.params.id)));
    } catch (e) { fail(res, e); }
  });
  app.patch("/api/ask-orbit/conversations/:id", async (req, res) => {
    try {
      const { ctx } = await auth(req);
      const { title } = titleSchema.parse(req.body);
      res.json(await repo.rename(ctx, idSchema.parse(req.params.id), title));
    } catch (e) { fail(res, e); }
  });
  app.delete("/api/ask-orbit/conversations/:id", async (req, res) => {
    try {
      const { ctx } = await auth(req);
      const id = idSchema.parse(req.params.id);
      await repo.delete(ctx, id);
      // IDs alone are never an access check; deletion above proved ownership.
      for (const [key, controller] of running) if (key.startsWith(`${id}:`)) controller.abort();
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  app.post("/api/ask-orbit/conversations/:id/turns/:turnId/stop", async (req, res) => {
    try {
      const { ctx } = await auth(req);
      const id = idSchema.parse(req.params.id), turnId = idSchema.parse(req.params.turnId);
      if (!(await repo.turn(ctx, id, turnId))) throw new OrbitError("Question not found.", 404);
      // Durable stop works even when a different server handles this request.
      await repo.finish(ctx, id, turnId, "cancelled", null, "Stopped. This attempt still counts toward the monthly allowance.");
      running.get(`${id}:${turnId}`)?.abort();
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  app.post("/api/ask-orbit/conversations/:id/turns", async (req, res) => {
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let id = "", turnId = "";
    let ctx: RequestContext | undefined;
    let reserved = false;
    let timeout = false;
    let checking = false;
    const emit = (data: unknown) => {
      if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    try {
      const authorized = await auth(req);
      ctx = authorized.ctx;
      id = idSchema.parse(req.params.id);
      const body = questionSchema.parse(req.body);
      turnId = body.requestId;
      const reservation = await repo.reserve(ctx, id, turnId, body.question);
      res.status(200).set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-store",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      emit({ type: "start", turnId });
      if (!reservation.created) {
        if (reservation.turn.status === "processing") {
          emit({ type: "status", message: "This question is already being prepared. Reopen the conversation to check its status." });
        } else if (reservation.turn.status !== "completed") {
          emit({ type: "error", message: reservation.turn.error || "This attempt did not finish.", turnId });
        }
        emit({ type: "done", turn: reservation.turn, usage: await repo.usage(ctx) });
        return;
      }
      reserved = true;
      controller = new AbortController();
      running.set(`${id}:${turnId}`, controller);
      const activeController = controller;
      res.once("close", () => { if (!res.writableEnded) activeController.abort(); });
      if (res.destroyed) controller.abort();
      timer = setTimeout(() => { timeout = true; activeController.abort(); }, dependencies.timeoutMs ?? ASK_ORBIT_CONFIG.timeoutMs);
      const currentCtx = ctx;
      poll = setInterval(() => {
        if (checking || activeController.signal.aborted) return;
        checking = true;
        void repo.turn(currentCtx, id, turnId).then(t => {
          if (!t || t.status !== "processing") activeController.abort();
          else emit({ type: "status", message: "Preparing and validating cited evidence…" });
        }).catch(() => activeController.abort()).finally(() => { checking = false; });
      }, 1000);

      emit({ type: "status", message: "Reading accessible records in this market…" });
      const conversation = await repo.get(ctx, id);
      const previous = conversation.turns.filter(t => t.id !== turnId && t.status === "completed").slice(-6);
      const sources = await retrieve(ctx, authorized.access, [...previous.slice(-2).map(t => t.question), body.question].join("\n"));
      // Revalidate old evidence against today's authorized source set before
      // using it to resolve "that plan"/"the second item" in a follow-up.
      const history = previous.map(t => `${t.question}\nPrior selected excerpts (reference resolution only): ${
        t.answer?.citations.filter(c => sources.some(s => s.sourceId === c.sourceId && s.text.includes(c.quote)))
          .map(c => c.quote).join("\n").slice(0, 1500) ?? ""}`);
      controller.signal.throwIfAborted();
      let answer;
      if (!sources.length) {
        answer = { text: INSUFFICIENT, citations: [], limitations: [LIMITATION] };
      } else {
        if (!(await repo.providerStarted(ctx, id, turnId))) controller.abort();
        controller.signal.throwIfAborted();
        emit({ type: "status", message: "Selecting evidence; no answer is released until its citations are validated…" });
        answer = await generate(ctx, body.question, history, sources, controller.signal, turnId);
      }
      controller.signal.throwIfAborted();
      const saved = await repo.finish(ctx, id, turnId, "completed", answer, null);
      if (saved) {
        // Buffer provider output until validated. Stream only validated prose.
        for (let offset = 0; offset < answer.text.length; offset += 240) {
          emit({ type: "delta", text: answer.text.slice(offset, offset + 240) });
        }
      }
      const turn = await repo.turn(ctx, id, turnId);
      if (turn) emit({ type: "done", turn, usage: await repo.usage(ctx) });
    } catch (error) {
      if (reserved && ctx) {
        const cancelled = controller?.signal.aborted && !timeout;
        const message = timeout ? "The answer timed out. This attempt counts toward the monthly allowance." :
          cancelled ? "Stopped. This attempt counts toward the monthly allowance." :
          "The answer could not be verified or generated. This attempt counts toward the monthly allowance.";
        try {
          await repo.finish(ctx, id, turnId, cancelled ? "cancelled" : "failed", null, message);
          emit({ type: "error", message, turnId });
          const turn = await repo.turn(ctx, id, turnId);
          if (turn) emit({ type: "done", turn, usage: await repo.usage(ctx) });
        } catch (persistError) {
          console.error("[Ask Orbit] Could not finalize attempt", persistError);
          emit({ type: "error", message: "Connection interrupted. Reopen this conversation to check the saved attempt; it will not be automatically retried.", turnId });
        }
      } else { fail(res, error); }
    } finally {
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      if (running.get(`${id}:${turnId}`) === controller) running.delete(`${id}:${turnId}`);
      if (res.headersSent && !res.writableEnded) res.end();
    }
  });
}
