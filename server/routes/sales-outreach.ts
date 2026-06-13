import type { Express } from "express";
import { db } from "../db";
import {
  outreachSettings,
  outreachCampaigns,
  prospects,
  type InsertOutreachSettings,
} from "@shared/schema";
import { desc, eq } from "drizzle-orm";
import { getRequestContext } from "../context";
import { guardFeature, guardManualAction, logAiUsage } from "./helpers";
import { assessSalesOutreachReadiness } from "../services/sales-outreach-readiness";
import { createCampaignFromInterview, getCampaign } from "../services/outreach-interview-service";
import { researchProspect } from "../services/prospector-service";

/**
 * Sales Outreach routes (Phase 0 — foundation).
 *
 * Ships the readiness check (is this tenant + seller ready to run outreach?)
 * and the per-tenant circuit-breaker / cap settings. Prospecting, composing,
 * and cadence land in later phases. See docs/sales-outreach-campaign-plan.md.
 */

// Conservative defaults a tenant gets before any are saved (mirrors the schema
// table defaults so the UI shows real numbers before the first save).
const DEFAULT_SETTINGS = {
  globalPause: false,
  masterDailyCap: 100,
  emailDailyCap: 50,
  emailWeeklyCap: 200,
  linkedinDailyCap: 15,
  linkedinWeeklyCap: 50,
  weeklyPerDomainCap: 3,
  minReplyRateFloor: 0,
  defaultVoiceProfileId: null as string | null,
};

// Numeric cap fields, with sane bounds so config can't disable the breakers.
const NUMERIC_CAPS: { key: keyof typeof DEFAULT_SETTINGS; min: number; max: number }[] = [
  { key: "masterDailyCap", min: 0, max: 1000 },
  { key: "emailDailyCap", min: 0, max: 1000 },
  { key: "emailWeeklyCap", min: 0, max: 5000 },
  { key: "linkedinDailyCap", min: 0, max: 100 },
  { key: "linkedinWeeklyCap", min: 0, max: 500 },
  { key: "weeklyPerDomainCap", min: 0, max: 100 },
];

export function registerSalesOutreachRoutes(app: Express) {
  // Readiness — informational, ungated (matches /api/marketing/context-readiness).
  app.get("/api/sales-outreach/readiness", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const report = await assessSalesOutreachReadiness(
        ctx.tenantDomain,
        ctx.userId,
        ctx.marketId,
        ctx.isDefaultMarket,
      );
      res.json(report);
    } catch (err: any) {
      console.error("[sales-outreach-readiness]", err);
      res.status(500).json({ error: err.message || "Failed to assess sales outreach readiness" });
    }
  });

  // Circuit-breaker / cap settings for the tenant.
  app.get("/api/sales-outreach/settings", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const [row] = await db
        .select()
        .from(outreachSettings)
        .where(eq(outreachSettings.tenantDomain, ctx.tenantDomain));
      res.json(row ?? { tenantDomain: ctx.tenantDomain, ...DEFAULT_SETTINGS });
    } catch (err: any) {
      console.error("[sales-outreach-settings:get]", err);
      res.status(500).json({ error: err.message || "Failed to load outreach settings" });
    }
  });

  app.put("/api/sales-outreach/settings", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);
      const body = req.body ?? {};

      const update: Partial<InsertOutreachSettings> = { tenantDomain: ctx.tenantDomain };
      if (typeof body.globalPause === "boolean") update.globalPause = body.globalPause;
      for (const { key, min, max } of NUMERIC_CAPS) {
        const v = body[key];
        if (typeof v === "number" && Number.isFinite(v)) {
          update[key] = Math.min(max, Math.max(min, Math.round(v))) as never;
        }
      }
      if (typeof body.minReplyRateFloor === "number" && Number.isFinite(body.minReplyRateFloor)) {
        update.minReplyRateFloor = Math.min(1, Math.max(0, body.minReplyRateFloor));
      }
      if (typeof body.defaultVoiceProfileId === "string" || body.defaultVoiceProfileId === null) {
        update.defaultVoiceProfileId = body.defaultVoiceProfileId;
      }

      const [saved] = await db
        .insert(outreachSettings)
        .values({ ...DEFAULT_SETTINGS, ...update, tenantDomain: ctx.tenantDomain, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: outreachSettings.tenantDomain,
          set: { ...update, updatedAt: new Date() },
        })
        .returning();
      res.json(saved);
    } catch (err: any) {
      console.error("[sales-outreach-settings:put]", err);
      res.status(500).json({ error: err.message || "Failed to save outreach settings" });
    }
  });

  // ── Campaigns ──────────────────────────────────────────────────────────────

  // Create a campaign from the onboarding interview brief. The interview wizard
  // (UI) collects answers; this persists the campaign + a default cadence.
  app.post("/api/sales-outreach/campaigns", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);
      const body = req.body ?? {};
      const name = String(body.name ?? "").trim();
      if (!name) return res.status(400).json({ error: "Campaign name is required" });

      const result = await createCampaignFromInterview({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        createdBy: ctx.userId,
        name,
        answers: body.answers ?? {},
        productId: body.productId ?? null,
        targetPersonaIds: Array.isArray(body.targetPersonaIds) ? body.targetPersonaIds : null,
        conferenceId: body.conferenceId ?? null,
        eventDate: body.eventDate ? new Date(body.eventDate) : null,
        voiceProfileId: body.voiceProfileId ?? null,
      });
      res.status(201).json(result);
    } catch (err: any) {
      console.error("[sales-outreach-campaigns:create]", err);
      res.status(500).json({ error: err.message || "Failed to create campaign" });
    }
  });

  app.get("/api/sales-outreach/campaigns", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const rows = await db
        .select()
        .from(outreachCampaigns)
        .where(eq(outreachCampaigns.tenantDomain, ctx.tenantDomain))
        .orderBy(desc(outreachCampaigns.updatedAt));
      res.json(rows);
    } catch (err: any) {
      console.error("[sales-outreach-campaigns:list]", err);
      res.status(500).json({ error: err.message || "Failed to list campaigns" });
    }
  });

  app.get("/api/sales-outreach/campaigns/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const campaign = await getCampaign(ctx.tenantDomain, req.params.id);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      res.json(campaign);
    } catch (err: any) {
      console.error("[sales-outreach-campaigns:get]", err);
      res.status(500).json({ error: err.message || "Failed to load campaign" });
    }
  });

  // ── Prospects ──────────────────────────────────────────────────────────────

  app.get("/api/sales-outreach/campaigns/:id/prospects", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const campaign = await getCampaign(ctx.tenantDomain, req.params.id);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      const rows = await db
        .select()
        .from(prospects)
        .where(eq(prospects.campaignId, campaign.id))
        .orderBy(desc(prospects.icpScore));
      res.json(rows);
    } catch (err: any) {
      console.error("[sales-outreach-prospects:list]", err);
      res.status(500).json({ error: err.message || "Failed to list prospects" });
    }
  });

  // Add a prospect to a campaign (manual entry; HubSpot/LinkedIn import lands later).
  app.post("/api/sales-outreach/campaigns/:id/prospects", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);
      const campaign = await getCampaign(ctx.tenantDomain, req.params.id);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      const body = req.body ?? {};
      const name = String(body.name ?? "").trim();
      if (!name) return res.status(400).json({ error: "Prospect name is required" });

      const [created] = await db
        .insert(prospects)
        .values({
          campaignId: campaign.id,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId || null,
          name,
          title: body.title ?? null,
          companyName: body.companyName ?? null,
          email: body.email ?? null,
          linkedinUrl: body.linkedinUrl ?? null,
          hubspotContactId: body.hubspotContactId ?? null,
          hubspotCompanyId: body.hubspotCompanyId ?? null,
          source: body.source ?? "manual",
          signals: body.signals ?? null,
          ownerUserId: body.ownerUserId ?? ctx.userId,
          status: "new",
        })
        .returning();
      res.status(201).json(created);
    } catch (err: any) {
      console.error("[sales-outreach-prospects:create]", err);
      res.status(500).json({ error: err.message || "Failed to add prospect" });
    }
  });

  // Research + ICP-score a prospect (AI dossier). Metered.
  app.post("/api/sales-outreach/prospects/:id/research", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "prospectResearch"))) return;
      const ctx = await getRequestContext(req);

      // Validate ownership before metering for cleaner audit logs.
      const [prospect] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
      if (!prospect || prospect.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Prospect not found" });
      }
      if (!(await guardManualAction(req, res, "generateProspectDossier"))) return;

      const result = await researchProspect(ctx.tenantDomain, req.params.id, {
        isDefaultMarket: ctx.isDefaultMarket,
      });
      await logAiUsage(
        { tenantDomain: ctx.tenantDomain, marketId: ctx.marketId, userId: ctx.userId },
        "generateProspectDossier",
        result.provider,
        result.model,
        { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
      );
      res.json(result);
    } catch (err: any) {
      console.error("[sales-outreach-prospects:research]", err);
      res.status(500).json({ error: err.message || "Failed to research prospect" });
    }
  });
}
