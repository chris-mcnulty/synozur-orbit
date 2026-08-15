/**
 * Market Study Wizard Routes — Task #547
 *
 *   POST  /api/market-studies             start a study (brief/URL + depth); metered
 *   GET   /api/market-studies             list studies (recent first) for tenant+market
 *   GET   /api/market-studies/:id         full study row (summary, stages, result refs)
 *   GET   /api/market-studies/:id/status  lightweight polling payload
 *   POST  /api/market-studies/:id/refresh re-run a study (drift), linked via parentStudyId
 *
 * Gated by the `marketStudyWizard` feature flag; scoped to tenantDomain + marketId.
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { and, desc, eq } from "drizzle-orm";
import { marketStudies } from "@shared/schema";
import { getRequestContext, ContextError } from "../context";
import { guardFeature, guardManualAction, denyReadOnly } from "./helpers";
import { startMarketStudy } from "../services/market-model/market-study-service";
import { STUDY_DEPTHS, type StudyDepth } from "@shared/market-intelligence";

const VALID_DEPTHS = new Set(STUDY_DEPTHS.map((d) => d.key));

function sendErr(res: Response, err: unknown): void {
  if (err instanceof ContextError) res.status(err.status).json({ error: err.message });
  else {
    console.error("[market-study] route error:", (err as any)?.message ?? err);
    res.status(500).json({ error: "Internal server error" });
  }
}

async function loadScopedStudy(id: string, tenantDomain: string, marketId: string) {
  const [row] = await db
    .select()
    .from(marketStudies)
    .where(
      and(
        eq(marketStudies.id, id),
        eq(marketStudies.tenantDomain, tenantDomain),
        eq(marketStudies.marketId, marketId),
      ),
    );
  return row ?? null;
}

export function registerMarketStudyRoutes(app: Express): void {
  // ── START (metered) ─────────────────────────────────────────────────────────
  app.post("/api/market-studies", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "marketStudyWizard"))) return;
    try {
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;
      const inputType = req.body?.inputType === "url" ? "url" : "brief";
      const inputValue = String(req.body?.inputValue ?? "").trim();
      const depth: StudyDepth = VALID_DEPTHS.has(req.body?.depth) ? req.body.depth : "focus";
      if (!inputValue) return res.status(400).json({ error: "A brief or URL is required." });
      if (!(await guardManualAction(req, res, "runMarketStudy"))) return;

      const studyId = await startMarketStudy(
        { tenantDomain: ctx.tenantDomain, marketId: ctx.marketId, userId: ctx.userId },
        { inputType, inputValue, depth },
      );
      res.status(201).json({ studyId });
    } catch (err) {
      sendErr(res, err);
    }
  });

  // ── LIST ──────────────────────────────────────────────────────────────────
  app.get("/api/market-studies", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "marketStudyWizard"))) return;
    try {
      const ctx = await getRequestContext(req);
      const rows = await db
        .select()
        .from(marketStudies)
        .where(and(eq(marketStudies.tenantDomain, ctx.tenantDomain), eq(marketStudies.marketId, ctx.marketId)))
        .orderBy(desc(marketStudies.createdAt))
        .limit(50);
      res.json(rows);
    } catch (err) {
      sendErr(res, err);
    }
  });

  // ── DETAIL ────────────────────────────────────────────────────────────────
  app.get("/api/market-studies/:id", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "marketStudyWizard"))) return;
    try {
      const ctx = await getRequestContext(req);
      const row = await loadScopedStudy(req.params.id, ctx.tenantDomain, ctx.marketId);
      if (!row) return res.status(404).json({ error: "Study not found" });
      res.json(row);
    } catch (err) {
      sendErr(res, err);
    }
  });

  // ── STATUS (polling) ────────────────────────────────────────────────────────
  app.get("/api/market-studies/:id/status", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "marketStudyWizard"))) return;
    try {
      const ctx = await getRequestContext(req);
      const row = await loadScopedStudy(req.params.id, ctx.tenantDomain, ctx.marketId);
      if (!row) return res.status(404).json({ error: "Study not found" });
      res.json({ id: row.id, status: row.status, currentStage: row.currentStage, stages: row.stages, error: row.error });
    } catch (err) {
      sendErr(res, err);
    }
  });

  // ── REFRESH (re-run, linked) ──────────────────────────────────────────────────
  app.post("/api/market-studies/:id/refresh", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "marketStudyWizard"))) return;
    try {
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;
      const parent = await loadScopedStudy(req.params.id, ctx.tenantDomain, ctx.marketId);
      if (!parent) return res.status(404).json({ error: "Study not found" });

      if (!(await guardManualAction(req, res, "runMarketStudy"))) return;
      const studyId = await startMarketStudy(
        { tenantDomain: ctx.tenantDomain, marketId: ctx.marketId, userId: ctx.userId },
        {
          inputType: parent.inputType === "url" ? "url" : "brief",
          inputValue: parent.inputValue ?? undefined,
          depth: (VALID_DEPTHS.has(parent.depth as StudyDepth) ? parent.depth : "focus") as StudyDepth,
          parentStudyId: parent.id,
        },
      );
      res.status(201).json({ studyId });
    } catch (err) {
      sendErr(res, err);
    }
  });
}
