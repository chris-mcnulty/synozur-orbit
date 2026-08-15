/**
 * Market Segments Routes — Strategic Intelligence Stack (Task #543)
 *
 * CRUD for strategic market segments (personas promoted to quantified segments)
 * plus the three AI actions: sizing (TAM/SAM), needs-map, and priority scoring.
 *
 *   GET    /api/market-segments               list (ranked by priority) for tenant+market
 *   POST   /api/market-segments               create
 *   GET    /api/market-segments/:id           get one
 *   PATCH  /api/market-segments/:id           update (incl. user overrides)
 *   DELETE /api/market-segments/:id           delete
 *   POST   /api/market-segments/:id/size      AI TAM/SAM sizing  (metered: runMarketSizing)
 *   POST   /api/market-segments/:id/needs-map AI Needs Map
 *   POST   /api/market-segments/:id/priority  AI priority score
 *   GET    /api/market-segments/:id/sources   provenance citations
 *   POST   /api/market-segments/backfill      seed segments from existing personas
 *
 * All routes gated by the `marketSegments` feature flag and scoped to
 * tenantDomain + marketId. NOT to be confused with /api/marketing-segments
 * (operational contact segmentation for email lists).
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { marketSegments, marketIntelligenceSources, personas } from "@shared/schema";
import { getRequestContext, ContextError } from "../context";
import { guardFeature, guardManualAction, denyReadOnly } from "./helpers";
import { getMarketModelProvider } from "../services/market-model/market-model-provider";
import { replaceSources, getSources } from "../services/market-intelligence-sources";
import {
  type Firmographics,
  type NeedsMap,
  clampPriorityScore,
  emptyNeedsMap,
} from "@shared/market-intelligence";

// ─── helpers ────────────────────────────────────────────────────────────────

/** Load a tenant+market-scoped segment or send 404. Returns null when not found. */
async function loadScopedSegment(id: string, tenantDomain: string, marketId: string) {
  // Scope directly by market so a NULL marketId row (left by ON DELETE SET NULL)
  // is never accessible from an arbitrary active market.
  const [seg] = await db
    .select()
    .from(marketSegments)
    .where(
      and(
        eq(marketSegments.id, id),
        eq(marketSegments.tenantDomain, tenantDomain),
        eq(marketSegments.marketId, marketId),
      ),
    );
  return seg ?? null;
}

function firmographicsOf(seg: { firmographics: unknown }): Firmographics {
  return (seg.firmographics as Firmographics) ?? {};
}

function sendContextError(res: Response, err: unknown): void {
  if (err instanceof ContextError) {
    res.status(err.status).json({ error: err.message });
  } else {
    console.error("[market-segments] error:", (err as any)?.message ?? err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ─── registration ─────────────────────────────────────────────────────────────

export function registerMarketSegmentsRoutes(app: Express): void {
  // ── LIST ──────────────────────────────────────────────────────────────────
  app.get("/api/market-segments", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "marketSegments"))) return;
    try {
      const ctx = await getRequestContext(req);
      const rows = await db
        .select()
        .from(marketSegments)
        .where(
          and(
            eq(marketSegments.tenantDomain, ctx.tenantDomain),
            eq(marketSegments.marketId, ctx.marketId),
          ),
        )
        .orderBy(desc(marketSegments.priorityScore), desc(marketSegments.createdAt));
      res.json(rows);
    } catch (err) {
      sendContextError(res, err);
    }
  });

  // ── CREATE ────────────────────────────────────────────────────────────────
  app.post("/api/market-segments", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "marketSegments"))) return;
    try {
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;
      const { name, description, firmographics, personaId } = req.body ?? {};
      if (!name?.trim()) return res.status(400).json({ error: "name is required" });

      // Validate personaId belongs to this tenant + market before linking (the DB
      // FK alone would accept a persona from another tenant/market).
      const cleanPersonaId = personaId?.trim() || null;
      if (cleanPersonaId) {
        const [persona] = await db
          .select({ id: personas.id })
          .from(personas)
          .where(and(eq(personas.id, cleanPersonaId), eq(personas.tenantDomain, ctx.tenantDomain), eq(personas.marketId, ctx.marketId)));
        if (!persona) return res.status(400).json({ error: "personaId does not reference a persona in this market" });
      }

      const [created] = await db
        .insert(marketSegments)
        .values({
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          personaId: cleanPersonaId,
          name: name.trim(),
          description: description?.trim() ?? null,
          firmographics: (firmographics as Firmographics) ?? {},
          needsMap: emptyNeedsMap(),
          createdBy: ctx.userId,
        })
        .returning();
      res.status(201).json(created);
    } catch (err) {
      sendContextError(res, err);
    }
  });

  // ── GET ONE ───────────────────────────────────────────────────────────────
  app.get("/api/market-segments/:id", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "marketSegments"))) return;
    try {
      const ctx = await getRequestContext(req);
      const seg = await loadScopedSegment(req.params.id, ctx.tenantDomain, ctx.marketId);
      if (!seg) return res.status(404).json({ error: "Segment not found" });
      res.json(seg);
    } catch (err) {
      sendContextError(res, err);
    }
  });

  // ── UPDATE (incl. user overrides) ──────────────────────────────────────────
  app.patch("/api/market-segments/:id", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "marketSegments"))) return;
    try {
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;
      const seg = await loadScopedSegment(req.params.id, ctx.tenantDomain, ctx.marketId);
      if (!seg) return res.status(404).json({ error: "Segment not found" });

      const b = req.body ?? {};
      const updates: Record<string, any> = { updatedAt: new Date() };
      if (b.name !== undefined) {
        const trimmed = String(b.name).trim();
        if (!trimmed) return res.status(400).json({ error: "name cannot be empty" });
        updates.name = trimmed;
      }
      if (b.description !== undefined) updates.description = b.description?.trim() ?? null;
      if (b.firmographics !== undefined) updates.firmographics = b.firmographics as Firmographics;
      if (b.status !== undefined) updates.status = b.status === "archived" ? "archived" : "active";
      // Needs Map — a manual edit marks the source as user-authored.
      if (b.needsMap !== undefined) {
        updates.needsMap = b.needsMap as NeedsMap;
        updates.needsMapSource = "user";
      }
      // Priority — a manual score wins over the AI suggestion.
      if (b.priorityScore !== undefined) {
        updates.priorityScore = clampPriorityScore(Number(b.priorityScore));
        updates.priorityScoreSource = "user";
        if (b.priorityRationale !== undefined) updates.priorityRationale = b.priorityRationale ?? null;
      }
      // Sizing overrides — stored alongside the AI estimate, never overwriting it.
      if (b.tamUserOverride !== undefined) updates.tamUserOverride = toBigintOrNull(b.tamUserOverride);
      if (b.samUserOverride !== undefined) updates.samUserOverride = toBigintOrNull(b.samUserOverride);

      const [updated] = await db
        .update(marketSegments)
        .set(updates)
        .where(eq(marketSegments.id, seg.id))
        .returning();
      res.json(updated);
    } catch (err) {
      sendContextError(res, err);
    }
  });

  // ── DELETE ────────────────────────────────────────────────────────────────
  app.delete("/api/market-segments/:id", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "marketSegments"))) return;
    try {
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;
      const seg = await loadScopedSegment(req.params.id, ctx.tenantDomain, ctx.marketId);
      if (!seg) return res.status(404).json({ error: "Segment not found" });
      // Matrix cells cascade via FK; provenance sources are polymorphic (no FK),
      // so remove them here to avoid orphaned rows.
      await db.transaction(async (tx) => {
        await tx
          .delete(marketIntelligenceSources)
          .where(and(eq(marketIntelligenceSources.tenantDomain, ctx.tenantDomain), eq(marketIntelligenceSources.scopeId, seg.id)));
        await tx.delete(marketSegments).where(eq(marketSegments.id, seg.id));
      });
      res.status(204).send();
    } catch (err) {
      sendContextError(res, err);
    }
  });

  // ── AI: SIZING (TAM/SAM) — metered ─────────────────────────────────────────
  app.post("/api/market-segments/:id/size", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "marketSegments"))) return;
    try {
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;
      const seg = await loadScopedSegment(req.params.id, ctx.tenantDomain, ctx.marketId);
      if (!seg) return res.status(404).json({ error: "Segment not found" });

      // Reserve quota only after ownership is confirmed; auto-commits on 2xx.
      if (!(await guardManualAction(req, res, "runMarketSizing"))) return;

      const acv = toNumberOrUndefined(req.body?.acv);
      const currency = typeof req.body?.currency === "string" ? req.body.currency : undefined;

      const { sizing, sources } = await getMarketModelProvider().estimateSizing({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        userId: ctx.userId,
        segmentName: seg.name,
        description: seg.description ?? undefined,
        firmographics: firmographicsOf(seg),
        acv,
        currency,
      });

      const [updated] = await db
        .update(marketSegments)
        .set({
          tamLow: sizing.tam.low,
          tamMid: sizing.tam.mid,
          tamHigh: sizing.tam.high,
          samLow: sizing.sam.low,
          samMid: sizing.sam.mid,
          samHigh: sizing.sam.high,
          sizingCurrency: sizing.tam.currency,
          sizingMethod: sizing.method,
          sizingConfidence: sizing.confidence,
          sizingRationale: sizing.rationale,
          lastEstimatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(marketSegments.id, seg.id))
        .returning();

      // Replace (not append) so a re-estimate never accumulates stale citations.
      await replaceSources({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        scopeType: "segment_sizing",
        scopeId: seg.id,
        sources,
      });

      res.json({ segment: updated, sources });
    } catch (err: any) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      // A degraded-inputs failure is a 422 (actionable), not a 500.
      const msg = err?.message ?? "Sizing failed";
      const status = /Unable to size segment/.test(msg) ? 422 : 500;
      console.error("[market-segments] sizing error:", msg);
      res.status(status).json({ error: msg });
    }
  });

  // ── AI: NEEDS MAP ──────────────────────────────────────────────────────────
  app.post("/api/market-segments/:id/needs-map", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "marketSegments"))) return;
    try {
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;
      const seg = await loadScopedSegment(req.params.id, ctx.tenantDomain, ctx.marketId);
      if (!seg) return res.status(404).json({ error: "Segment not found" });

      const { needsMap } = await getMarketModelProvider().buildNeedsMap({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        userId: ctx.userId,
        segmentName: seg.name,
        description: seg.description ?? undefined,
        firmographics: firmographicsOf(seg),
        existing: seg.needsMap as NeedsMap,
      });

      const [updated] = await db
        .update(marketSegments)
        .set({ needsMap, needsMapSource: "ai", updatedAt: new Date() })
        .where(eq(marketSegments.id, seg.id))
        .returning();
      res.json(updated);
    } catch (err) {
      sendContextError(res, err);
    }
  });

  // ── AI: PRIORITY ────────────────────────────────────────────────────────────
  app.post("/api/market-segments/:id/priority", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "marketSegments"))) return;
    try {
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;
      const seg = await loadScopedSegment(req.params.id, ctx.tenantDomain, ctx.marketId);
      if (!seg) return res.status(404).json({ error: "Segment not found" });

      const { score, rationale } = await getMarketModelProvider().scoreSegmentPriority({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        userId: ctx.userId,
        segmentName: seg.name,
        samMid: seg.samMid ?? undefined,
        needsMap: seg.needsMap as NeedsMap,
      });

      const [updated] = await db
        .update(marketSegments)
        .set({
          priorityScore: score,
          priorityScoreSource: "ai",
          priorityRationale: rationale,
          updatedAt: new Date(),
        })
        .where(eq(marketSegments.id, seg.id))
        .returning();
      res.json(updated);
    } catch (err) {
      sendContextError(res, err);
    }
  });

  // ── PROVENANCE ──────────────────────────────────────────────────────────────
  app.get("/api/market-segments/:id/sources", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "marketSegments"))) return;
    try {
      const ctx = await getRequestContext(req);
      const seg = await loadScopedSegment(req.params.id, ctx.tenantDomain, ctx.marketId);
      if (!seg) return res.status(404).json({ error: "Segment not found" });
      const sources = await getSources(ctx.tenantDomain, "segment_sizing", seg.id);
      res.json(sources);
    } catch (err) {
      sendContextError(res, err);
    }
  });

  // ── BACKFILL FROM PERSONAS ──────────────────────────────────────────────────
  // Seeds a market_segment from each persona in this market that doesn't already
  // have one, so existing tenants land in #543 with data instead of an empty view.
  app.post("/api/market-segments/backfill", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "marketSegments"))) return;
    try {
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;

      const personaRows = await db
        .select()
        .from(personas)
        .where(and(eq(personas.tenantDomain, ctx.tenantDomain), eq(personas.marketId, ctx.marketId)));

      const linkedRows = await db
        .select({ personaId: marketSegments.personaId })
        .from(marketSegments)
        .where(
          and(
            eq(marketSegments.tenantDomain, ctx.tenantDomain),
            eq(marketSegments.marketId, ctx.marketId),
            isNotNull(marketSegments.personaId),
          ),
        );
      const alreadyLinked = new Set(linkedRows.map((r) => r.personaId));

      const toCreate = personaRows.filter((p) => !alreadyLinked.has(p.id));
      if (toCreate.length === 0) return res.json({ created: 0 });

      const inserted = await db
        .insert(marketSegments)
        .values(
          toCreate.map((p) => ({
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId,
            personaId: p.id,
            name: p.name,
            description: p.notes ?? ([p.role, p.industry].filter(Boolean).join(" · ") || null),
            firmographics: {
              industry: p.industry ?? undefined,
              companySize: p.companySize ?? undefined,
            } as Firmographics,
            // Seed the Needs Map from the persona's structured fields (editable / AI-refinable).
            needsMap: {
              pains: p.painPoints ?? [],
              triggers: [],
              barriers: p.objections ?? [],
              buyingCriteria: p.goals ?? [],
            } as NeedsMap,
            needsMapSource: "mixed",
            createdBy: ctx.userId,
          })),
        )
        .returning({ id: marketSegments.id });

      res.status(201).json({ created: inserted.length });
    } catch (err) {
      sendContextError(res, err);
    }
  });
}

// ─── local coercion helpers ─────────────────────────────────────────────────

function toNumberOrUndefined(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function toBigintOrNull(v: unknown): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}
