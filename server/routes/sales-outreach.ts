import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  outreachSettings,
  outreachCampaigns,
  prospects,
  outreachTouches,
  outreachSendLedger,
  socialAccountVoiceProfiles,
  type InsertOutreachSettings,
  type OutreachChannel,
} from "@shared/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { randomBytes } from "crypto";
import { getRequestContext } from "../context";
import { storage } from "../storage";
import { guardFeature, guardManualAction, logAiUsage } from "./helpers";
import { assessSalesOutreachReadiness } from "../services/sales-outreach-readiness";
import { createCampaignFromInterview, getCampaign } from "../services/outreach-interview-service";
import { researchProspect } from "../services/prospector-service";
import { enrichProspectContact, EnrichError } from "../services/prospect-enrich-service";
import { isLinkedInFormat, isOutreachIntent, isValidLinkedInProfileUrl } from "@shared/linkedin-outreach";
import {
  discoverProspects,
  importDiscoveredProspects,
  getDiscoveryBackends,
} from "../services/discovery-service";
import type { DiscoveryCandidate } from "../services/discovery-provider-core";
import { composeTouch, loadComplianceContext } from "../services/outreach-composer-service";
import { scanCompliance } from "../services/compliance-core";
import { createOutlookDraft, OutlookDraftError } from "../services/outlook-draft-service";
import { buildPlannerConsentUrl, MAIL_SCOPES } from "../services/planner-graph-client";
import { getRedirectUri } from "./planner";
import { listContacts, upsertContact, logContactNote } from "../services/hubspot-integration";
import { extractOutboundVoice, getPersonalVoiceProfile, VoiceExtractError } from "../services/outbound-voice-service";
import { assertApprovalAllowed, getOutreachSummary, tickCadence, detectMailboxActivity } from "../services/cadence-service";
import { getLinkedInCapabilities, sendLinkedInMessage } from "../services/linkedin-provider";
import { getCampaignPerformance } from "../services/outreach-performance-service";

function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : null;
}

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

      // Default to the creator's personal voice profile so drafts sound like them.
      let voiceProfileId = body.voiceProfileId ?? null;
      if (!voiceProfileId) {
        const personal = await getPersonalVoiceProfile(ctx.userId);
        voiceProfileId = personal?.id ?? null;
      }

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
        voiceProfileId,
      });
      res.status(201).json(result);
    } catch (err: any) {
      console.error("[sales-outreach-campaigns:create]", err);
      res.status(500).json({ error: err.message || "Failed to create campaign" });
    }
  });

  app.get("/api/sales-outreach/campaigns", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
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
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);
      const campaign = await getCampaign(ctx.tenantDomain, req.params.id);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      res.json(campaign);
    } catch (err: any) {
      console.error("[sales-outreach-campaigns:get]", err);
      res.status(500).json({ error: err.message || "Failed to load campaign" });
    }
  });

  const patchCampaignSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    goalType: z.enum(["meeting", "event_invite", "intro", "nurture"]).optional(),
    salesGoal: z.string().max(1000).nullable().optional(),
    productId: z.string().uuid().nullable().optional(),
    targetPersonaIds: z.array(z.string()).nullable().optional(),
    channels: z.array(z.enum(["email", "linkedin"])).nullable().optional(),
    targetingFilter: z.object({
      geographies: z.array(z.string()).optional(),
      industries: z.array(z.string()).optional(),
      segments: z.array(z.string()).optional(),
      namedAccounts: z.array(z.string()).optional(),
      targetRoles: z.array(z.string()).optional(),
    }).optional(),
  });

  // Update editable campaign fields (goal, targeting, name, etc.).
  // Scoped to the active tenant; only admins or the campaign creator may edit.
  app.patch("/api/sales-outreach/campaigns/:id", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);
      const campaign = await getCampaign(ctx.tenantDomain, req.params.id);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      // Only the campaign creator or an admin may edit.
      const isAdmin = ctx.userRole === "Domain Admin" || ctx.userRole === "Global Admin";
      if (!isAdmin && campaign.createdBy !== ctx.userId) {
        return res.status(403).json({ error: "Only the campaign owner or an admin can edit this campaign." });
      }

      const parsed = patchCampaignSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      }
      const body = parsed.data;

      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (body.name !== undefined) update.name = body.name.trim();
      if (body.goalType !== undefined) update.goalType = body.goalType;
      if (body.salesGoal !== undefined) update.salesGoal = body.salesGoal?.trim() || null;
      if (body.productId !== undefined) update.productId = body.productId;
      if (body.targetPersonaIds !== undefined) update.targetPersonaIds = body.targetPersonaIds;
      if (body.channels !== undefined) {
        update.channels = body.channels && body.channels.length > 0 ? body.channels : null;
      }
      if (body.targetingFilter !== undefined) {
        update.targetingFilter = body.targetingFilter;
      }

      const [updated] = await db
        .update(outreachCampaigns)
        .set(update)
        .where(eq(outreachCampaigns.id, campaign.id))
        .returning();
      res.json(updated);
    } catch (err: any) {
      console.error("[sales-outreach-campaigns:patch]", err);
      res.status(500).json({ error: err.message || "Failed to update campaign" });
    }
  });

  // ── Prospects ──────────────────────────────────────────────────────────────

  app.get("/api/sales-outreach/campaigns/:id/prospects", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
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

  // Which discovery backends are available (web is free; Sales Navigator is
  // gated on the LinkedIn MCP). Informational — drives the discovery UI.
  app.get("/api/sales-outreach/discovery/status", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      res.json({ backends: getDiscoveryBackends() });
    } catch (err: any) {
      console.error("[sales-outreach-discovery:status]", err);
      res.status(500).json({ error: err.message || "Failed to read discovery status" });
    }
  });

  // Outbound discovery: find net-new ICP-matching prospects from public sources.
  // Returns scored, deduped candidates for review — nothing is imported here.
  // Metered (AI web search). The seller imports selected candidates separately.
  app.post("/api/sales-outreach/campaigns/:id/discover", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);
      const campaign = await getCampaign(ctx.tenantDomain, req.params.id);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      if (!(await guardManualAction(req, res, "discoverProspects"))) return;

      const body = req.body ?? {};
      const result = await discoverProspects(ctx.tenantDomain, campaign.id, {
        backend: body.backend === "salesnav" ? "salesnav" : undefined,
        limit: body.limit,
      });

      if (result.provider && result.model) {
        await logAiUsage(
          { tenantDomain: ctx.tenantDomain, marketId: ctx.marketId, userId: ctx.userId },
          "discoverProspects",
          result.provider,
          result.model,
          { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
          undefined,
          { searchCount: result.searchCount, backend: result.backend },
        );
      }
      res.json(result);
    } catch (err: any) {
      console.error("[sales-outreach-discovery:search]", err);
      res.status(500).json({ error: err.message || "Failed to discover prospects" });
    }
  });

  // Import selected discovered candidates as prospects (manual gate — the seller
  // reviews ICP fit first). Each lands as a `new` prospect for research.
  app.post("/api/sales-outreach/campaigns/:id/discover/import", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);
      const campaign = await getCampaign(ctx.tenantDomain, req.params.id);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      const raw = req.body?.candidates;
      if (!Array.isArray(raw) || raw.length === 0) {
        return res.status(400).json({ error: "No candidates to import" });
      }
      // Only accept the candidate fields we control; never trust client status/score.
      // Sanitize URL fields to http/https only — they are persisted and rendered as links.
      function safeImportUrl(v: unknown): string | null {
        if (typeof v !== "string" || !v.trim()) return null;
        try {
          const u = new URL(v.trim());
          return u.protocol === "http:" || u.protocol === "https:" ? v.trim() : null;
        } catch { return null; }
      }
      const candidates: DiscoveryCandidate[] = raw
        .filter((c: any) => c && typeof c.name === "string" && c.name.trim())
        .map((c: any) => ({
          name: String(c.name).trim(),
          title: c.title ?? null,
          companyName: c.companyName ?? null,
          email: c.email ?? null,
          linkedinUrl: safeImportUrl(c.linkedinUrl),
          geography: c.geography ?? null,
          industry: c.industry ?? null,
          segment: c.segment ?? null,
          sourceUrl: safeImportUrl(c.sourceUrl),
          source: c.source === "salesnav" ? "salesnav" : "web",
        }));
      if (candidates.length === 0) {
        return res.status(400).json({ error: "No valid candidates to import" });
      }

      const result = await importDiscoveredProspects(ctx.tenantDomain, campaign.id, candidates, {
        ownerUserId: ctx.userId,
        marketId: ctx.marketId || null,
      });
      res.status(201).json({ imported: result.imported.length, skipped: result.skipped, prospects: result.imported });
    } catch (err: any) {
      console.error("[sales-outreach-discovery:import]", err);
      res.status(500).json({ error: err.message || "Failed to import prospects" });
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

  // Enrich a prospect's missing contact details (LinkedIn URL and/or email)
  // from the public web. Only fills blanks; metered. Returns what was found so
  // the UI can light up the LinkedIn deep-link / paste flow.
  app.post("/api/sales-outreach/prospects/:id/enrich", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "prospectResearch"))) return;
      const ctx = await getRequestContext(req);

      const [prospect] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
      if (!prospect || prospect.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Prospect not found" });
      }
      if (prospect.linkedinUrl && prospect.email) {
        return res.status(409).json({ error: "This prospect already has a LinkedIn profile and an email.", code: "nothing_missing" });
      }
      if (!(await guardManualAction(req, res, "enrichProspectContact"))) return;

      const result = await enrichProspectContact(ctx.tenantDomain, req.params.id);
      await logAiUsage(
        { tenantDomain: ctx.tenantDomain, marketId: ctx.marketId, userId: ctx.userId },
        "enrichProspectContact",
        result.provider,
        result.model,
        { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
        undefined,
        { searchCount: result.searchCount, found: result.found },
      );
      res.json({ prospect: result.prospect, found: result.found, notes: result.lookup.notes });
    } catch (err: any) {
      if (err instanceof EnrichError) {
        const status = err.code === "web_search_unavailable" ? 503 : err.code === "nothing_missing" ? 409 : 404;
        return res.status(status).json({ error: err.message, code: err.code });
      }
      console.error("[sales-outreach:enrich]", err);
      res.status(500).json({ error: err.message || "Failed to enrich prospect" });
    }
  });

  // ── Composing & touches ──────────────────────────────────────────────────

  // Compose a draft touch (email or LinkedIn) for a prospect. Metered + scanned.
  app.post("/api/sales-outreach/prospects/:id/compose", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "outreachComposer"))) return;
      const ctx = await getRequestContext(req);

      const [prospect] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
      if (!prospect || prospect.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Prospect not found" });
      }
      if (!(await guardManualAction(req, res, "generateOutreachDraft"))) return;

      const channel: OutreachChannel | undefined =
        req.body?.channel === "linkedin" || req.body?.channel === "email" ? req.body.channel : undefined;
      const stepNumber = Number.isInteger(req.body?.stepNumber) ? req.body.stepNumber : undefined;
      const linkedinFormat = isLinkedInFormat(req.body?.linkedinFormat) ? req.body.linkedinFormat : undefined;
      const intent = isOutreachIntent(req.body?.intent) ? req.body.intent : undefined;

      const result = await composeTouch(ctx.tenantDomain, req.params.id, {
        channel,
        stepNumber,
        linkedinFormat,
        intent,
        isDefaultMarket: ctx.isDefaultMarket,
      });
      await logAiUsage(
        { tenantDomain: ctx.tenantDomain, marketId: ctx.marketId, userId: ctx.userId },
        "generateOutreachDraft",
        result.provider,
        result.model,
        { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
      );
      res.status(201).json(result);
    } catch (err: any) {
      console.error("[sales-outreach:compose]", err);
      res.status(500).json({ error: err.message || "Failed to compose draft" });
    }
  });

  app.get("/api/sales-outreach/prospects/:id/touches", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);
      const [prospect] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
      if (!prospect || prospect.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Prospect not found" });
      }
      const rows = await db
        .select()
        .from(outreachTouches)
        .where(eq(outreachTouches.prospectId, prospect.id))
        .orderBy(outreachTouches.stepNumber);
      res.json(rows);
    } catch (err: any) {
      console.error("[sales-outreach:touches]", err);
      res.status(500).json({ error: err.message || "Failed to list touches" });
    }
  });

  // Edit a draft (subject/body) and re-run the compliance scan.
  app.patch("/api/sales-outreach/touches/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const [touch] = await db.select().from(outreachTouches).where(eq(outreachTouches.id, req.params.id));
      if (!touch || touch.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Touch not found" });
      }
      if (touch.status !== "draft_pending_approval") {
        return res.status(409).json({ error: "Only pending drafts can be edited." });
      }

      const subject = typeof req.body?.subject === "string" ? req.body.subject : touch.subject;
      const body = typeof req.body?.body === "string" ? req.body.body : touch.body;

      const [prospect] = await db.select().from(prospects).where(eq(prospects.id, touch.prospectId));
      const cc = await loadComplianceContext(ctx.tenantDomain, touch.voiceProfileId);
      const compliance = scanCompliance({
        channel: touch.channel as OutreachChannel,
        subject,
        body: body ?? "",
        recipientEmail: prospect?.email,
        suppressedEmails: cc.suppressedEmails,
        ownDomains: cc.ownDomains,
        forbiddenPhrases: cc.forbidden,
      });

      const [updated] = await db
        .update(outreachTouches)
        .set({ subject, body, complianceFlags: compliance })
        .where(eq(outreachTouches.id, touch.id))
        .returning();
      res.json({ touch: updated, compliance });
    } catch (err: any) {
      console.error("[sales-outreach:touch-edit]", err);
      res.status(500).json({ error: err.message || "Failed to update draft" });
    }
  });

  // Approve a draft → create it in the seller's Outlook Drafts (human sends).
  // LinkedIn has no send API yet, so it's marked approved as copy-assist.
  app.post("/api/sales-outreach/touches/:id/approve", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);

      const [touch] = await db.select().from(outreachTouches).where(eq(outreachTouches.id, req.params.id));
      if (!touch || touch.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Touch not found" });
      }
      if (touch.status !== "draft_pending_approval") {
        return res.status(409).json({ error: "Draft is not pending approval." });
      }

      // Compliance hard blockers (suppression / self-email) cannot be approved.
      const flags = touch.complianceFlags;
      if (flags && flags.pass === false) {
        return res.status(422).json({ error: "Resolve compliance blockers before approving.", flags });
      }

      const [prospect] = await db.select().from(prospects).where(eq(prospects.id, touch.prospectId));

      // Circuit breakers: master + per-channel + per-domain caps + global pause,
      // counted from the durable send ledger. Fails closed.
      const decision = await assertApprovalAllowed(
        ctx.tenantDomain,
        touch.channel as OutreachChannel,
        domainOf(prospect?.email),
      );
      if (!decision.allowed) {
        return res.status(423).json({ error: decision.reason, code: "cap_reached" });
      }

      let outlookDraftId: string | null = null;
      let linkedinThreadRef: string | null = null;
      let webLink: string | undefined;
      let deliveryNote: string | undefined;
      if (touch.channel === "email") {
        try {
          const draft = await createOutlookDraft({
            userId: ctx.userId,
            subject: touch.subject ?? "(no subject)",
            body: touch.body ?? "",
            toEmail: prospect?.email,
            contentType: "Text",
          });
          outlookDraftId = draft.draftId;
          webLink = draft.webLink;
        } catch (err) {
          if (err instanceof OutlookDraftError) {
            return res.status(409).json({ error: err.message, code: err.code });
          }
          throw err;
        }
      } else if (touch.channel === "linkedin") {
        // Send via the LinkedIn MCP backend when available; otherwise this is
        // copy-assist — the draft is approved and the seller sends it manually.
        const caps = getLinkedInCapabilities();
        if (caps.canMessage && prospect?.linkedinUrl) {
          try {
            const r = await sendLinkedInMessage(ctx.tenantDomain, { recipientUrl: prospect.linkedinUrl, body: touch.body ?? "" });
            linkedinThreadRef = r.threadRef;
          } catch {
            deliveryNote = "LinkedIn send unavailable — copy the draft and send it manually.";
          }
        } else {
          deliveryNote = caps.reason;
        }
      }

      const [updated] = await db
        .update(outreachTouches)
        .set({ status: "approved", outlookDraftId, linkedinThreadRef, approvedBy: ctx.userId })
        .where(eq(outreachTouches.id, touch.id))
        .returning();

      // Advance the prospect to awaiting_reply on approval. This is the
      // deliberate v1 "optimistic" model: the seller sends the Outlook draft
      // themselves, and requiring confirmed-send would stall cadence whenever
      // mailbox detection is unavailable (no consent, or LinkedIn copy-assist).
      // Graph send-detection later stamps the touch `sent` for accurate records.
      if (prospect && prospect.status === "draft_pending_approval") {
        await db
          .update(prospects)
          .set({ status: "awaiting_reply", updatedAt: new Date() })
          .where(eq(prospects.id, prospect.id));
      }

      // Record in the send ledger (authoritative source for the breakers).
      await db.insert(outreachSendLedger).values({
        tenantDomain: ctx.tenantDomain,
        touchId: touch.id,
        channel: touch.channel,
        recipientDomain: domainOf(prospect?.email),
        ownerUserId: ctx.userId,
      });

      // Best-effort HubSpot logging: ensure the contact exists and log the
      // approved outreach as a note. Never fail the approval on a CRM hiccup.
      if (prospect) {
        try {
          const conn = await storage.getHubspotConnection(ctx.tenantDomain);
          if (conn) {
            const [first, ...rest] = (prospect.name || "").split(" ");
            const contactId =
              prospect.hubspotContactId ||
              (await pushProspectToHubspot(ctx.tenantDomain, prospect, first, rest.join(" ")));
            if (!prospect.hubspotContactId) {
              await db.update(prospects).set({ hubspotContactId: contactId }).where(eq(prospects.id, prospect.id));
            }
            const summary = `<p><strong>Outreach approved via Orbit</strong> (${touch.channel}, step ${touch.stepNumber})</p>${touch.subject ? `<p>Subject: ${touch.subject}</p>` : ""}`;
            await logContactNote(ctx.tenantDomain, contactId, summary);
          }
        } catch (hsErr: any) {
          console.warn("[sales-outreach:approve] HubSpot logging skipped:", hsErr?.message);
        }
      }

      res.json({ touch: updated, webLink, deliveryNote });
    } catch (err: any) {
      console.error("[sales-outreach:approve]", err);
      res.status(500).json({ error: err.message || "Failed to approve draft" });
    }
  });

  // LinkedIn capability status (which backend serves posting/messaging).
  app.get("/api/sales-outreach/linkedin/capabilities", async (_req, res) => {
    res.json(getLinkedInCapabilities());
  });

  // Conversion-first performance report for a campaign (feeds ICP targeting).
  app.get("/api/sales-outreach/campaigns/:id/performance", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);
      const report = await getCampaignPerformance(ctx.tenantDomain, req.params.id);
      res.json(report);
    } catch (err: any) {
      if (/not found/i.test(err?.message || "")) return res.status(404).json({ error: err.message });
      console.error("[sales-outreach:performance]", err);
      res.status(500).json({ error: err.message || "Failed to load performance" });
    }
  });

  // ── Mailbox consent (per-seller delegated Graph for Outlook drafts) ─────────

  app.get("/api/sales-outreach/mailbox/status", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const user = await storage.getUser(ctx.userId);
      const scopes = (user?.graphScopes || "").toLowerCase();
      res.json({
        connected: !!user?.graphRefreshToken,
        canDraft: !!user?.graphRefreshToken && scopes.includes("mail."),
        scopes: (user?.graphScopes || "").split(/\s+/).filter(Boolean),
      });
    } catch (err: any) {
      console.error("[sales-outreach:mailbox-status]", err);
      res.status(500).json({ error: err.message || "Failed to load mailbox status" });
    }
  });

  // Build the consent URL for Mail.ReadWrite. We request the UNION of the user's
  // already-granted scopes and the mail scopes so connecting the mailbox never
  // drops Planner. Reuses the shared Planner OAuth callback.
  app.get("/api/sales-outreach/mailbox/consent-url", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      if (!process.env.ENTRA_CLIENT_ID || !process.env.ENTRA_CLIENT_SECRET) {
        return res.status(503).json({ error: "Microsoft Entra is not configured on this server." });
      }
      const user = await storage.getUser(req.session.userId);
      const existing = (user?.graphScopes || "").split(/\s+/).filter(Boolean);
      const union = Array.from(new Set([...existing, ...MAIL_SCOPES]));

      const returnTo = (req.query.returnTo as string) || "/app/sales/outreach/settings";
      const state = Buffer.from(
        JSON.stringify({ userId: req.session.userId, returnTo, nonce: randomBytes(16).toString("hex") }),
      ).toString("base64url");
      const url = buildPlannerConsentUrl({ state, redirectUri: getRedirectUri(req), scopes: union });
      if (!url) return res.status(503).json({ error: "Failed to build consent URL" });
      res.json({ url });
    } catch (err: any) {
      console.error("[sales-outreach:mailbox-consent]", err);
      res.status(500).json({ error: err.message || "Failed to build consent URL" });
    }
  });

  // ── Outbound voice (personal voice DNA from Sent Items) ─────────────────────

  app.get("/api/sales-outreach/voice", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const profile = await getPersonalVoiceProfile(ctx.userId);
      res.json(profile ?? null);
    } catch (err: any) {
      console.error("[sales-outreach:voice-get]", err);
      res.status(500).json({ error: err.message || "Failed to load voice profile" });
    }
  });

  app.patch("/api/sales-outreach/voice", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const existing = await getPersonalVoiceProfile(ctx.userId);
      const { soundLikeMeInstructions } = req.body ?? {};
      const value = soundLikeMeInstructions === null ? null
        : typeof soundLikeMeInstructions === "string" ? soundLikeMeInstructions.slice(0, 8000)
        : existing?.soundLikeMeInstructions ?? null;
      if (!existing) {
        const [created] = await db
          .insert(socialAccountVoiceProfiles)
          .values({
            tenantDomain: ctx.tenantDomain,
            ownerUserId: ctx.userId,
            createdBy: ctx.userId,
            socialAccountId: null,
            person: "first",
            authorPerspective: "individual",
            soundLikeMeInstructions: value,
          })
          .returning();
        return res.json(created);
      }
      const [updated] = await db
        .update(socialAccountVoiceProfiles)
        .set({ soundLikeMeInstructions: value, updatedAt: new Date() })
        .where(and(eq(socialAccountVoiceProfiles.id, existing.id), isNull(socialAccountVoiceProfiles.socialAccountId)))
        .returning();
      res.json(updated);
    } catch (err: any) {
      console.error("[sales-outreach:voice-patch]", err);
      res.status(500).json({ error: err.message || "Failed to update voice profile" });
    }
  });

  app.post("/api/sales-outreach/voice/extract", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);
      const result = await extractOutboundVoice(ctx.userId, ctx.tenantDomain);
      await logAiUsage(
        { tenantDomain: ctx.tenantDomain, marketId: ctx.marketId, userId: ctx.userId },
        "extractOutboundVoice",
        result.provider,
        result.model,
        { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
      );
      res.json({ profile: result.profile, sampleCount: result.sampleCount });
    } catch (err: any) {
      if (err instanceof VoiceExtractError) {
        return res.status(err.code === "insufficient_samples" ? 422 : 409).json({ error: err.message, code: err.code });
      }
      console.error("[sales-outreach:voice-extract]", err);
      res.status(500).json({ error: err.message || "Failed to extract voice" });
    }
  });

  // ── HubSpot two-way ─────────────────────────────────────────────────────────

  // Search HubSpot contacts without importing — for the preview dialog.
  // Returns contacts with a `alreadyOnCampaign` flag so the UI can grey them out.
  app.post("/api/sales-outreach/campaigns/:id/preview-hubspot", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);
      const campaign = await getCampaign(ctx.tenantDomain, req.params.id);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      const conn = await storage.getHubspotConnection(ctx.tenantDomain);
      if (!conn) return res.status(409).json({ error: "HubSpot isn't connected. Connect it in Settings → Connections.", code: "no_hubspot" });

      const query = typeof req.body?.query === "string" ? req.body.query : undefined;
      const limit = Number.isInteger(req.body?.limit) ? req.body.limit : 50;
      const contacts = await listContacts(ctx.tenantDomain, { query, limit });

      // Flag contacts already on this campaign so the UI can show them greyed out.
      const existing = await db
        .select({ hsId: prospects.hubspotContactId, email: prospects.email })
        .from(prospects)
        .where(eq(prospects.campaignId, campaign.id));
      const haveIds = new Set(existing.map((e) => e.hsId).filter(Boolean) as string[]);
      const haveEmails = new Set(existing.map((e) => (e.email || "").toLowerCase()).filter(Boolean));

      const results = contacts.map((c) => ({
        ...c,
        alreadyOnCampaign:
          haveIds.has(c.hubspotContactId) ||
          !!(c.email && haveEmails.has(c.email.toLowerCase())),
      }));

      res.json({ contacts: results });
    } catch (err: any) {
      console.error("[sales-outreach:preview-hubspot]", err);
      res.status(500).json({ error: err.message || "Failed to search HubSpot" });
    }
  });

  // Import selected HubSpot contacts into a campaign as prospects (dedupes).
  // Accepts optional `contactIds` array — only those contacts are imported.
  // If omitted, falls back to fetching by query (legacy behaviour).
  app.post("/api/sales-outreach/campaigns/:id/import-hubspot", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);
      const campaign = await getCampaign(ctx.tenantDomain, req.params.id);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      const conn = await storage.getHubspotConnection(ctx.tenantDomain);
      if (!conn) return res.status(409).json({ error: "HubSpot isn't connected. Connect it in Settings → Connections.", code: "no_hubspot" });

      // contactIds = selective import from the preview dialog.
      // contacts = raw contact objects forwarded from the dialog (avoids a second API call).
      const contactIds: string[] | undefined = Array.isArray(req.body?.contactIds) ? req.body.contactIds : undefined;
      const rawContacts: Array<{ hubspotContactId: string; name: string; jobTitle?: string | null; company?: string | null; email?: string | null; linkedinUrl?: string | null }> | undefined =
        Array.isArray(req.body?.contacts) ? req.body.contacts : undefined;

      let contacts;
      if (rawContacts && rawContacts.length > 0) {
        // Caller forwarded the preview rows — filter to the selected IDs.
        const idSet = new Set(contactIds ?? rawContacts.map((c) => c.hubspotContactId));
        contacts = rawContacts.filter((c) => idSet.has(c.hubspotContactId));
      } else {
        const query = typeof req.body?.query === "string" ? req.body.query : undefined;
        const limit = Number.isInteger(req.body?.limit) ? req.body.limit : 50;
        contacts = await listContacts(ctx.tenantDomain, { query, limit });
        if (contactIds) contacts = contacts.filter((c) => contactIds.includes(c.hubspotContactId));
      }

      // Dedupe against prospects already on this campaign.
      const existing = await db
        .select({ hsId: prospects.hubspotContactId, email: prospects.email })
        .from(prospects)
        .where(eq(prospects.campaignId, campaign.id));
      const haveIds = new Set(existing.map((e) => e.hsId).filter(Boolean) as string[]);
      const haveEmails = new Set(existing.map((e) => (e.email || "").toLowerCase()).filter(Boolean));

      const toInsert = contacts.filter(
        (c) => !haveIds.has(c.hubspotContactId) && !(c.email && haveEmails.has(c.email.toLowerCase())),
      );
      if (toInsert.length > 0) {
        await db.insert(prospects).values(
          toInsert.map((c) => ({
            campaignId: campaign.id,
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || null,
            name: c.name,
            title: (c as any).jobTitle ?? null,
            companyName: (c as any).company ?? null,
            email: c.email ?? null,
            linkedinUrl: isValidLinkedInProfileUrl((c as any).linkedinUrl) ? (c as any).linkedinUrl : null,
            hubspotContactId: c.hubspotContactId,
            source: "hubspot",
            ownerUserId: ctx.userId,
            status: "new" as const,
          })),
        );
      }
      res.json({ imported: toInsert.length, skipped: contacts.length - toInsert.length, fetched: contacts.length });
    } catch (err: any) {
      console.error("[sales-outreach:import-hubspot]", err);
      res.status(500).json({ error: err.message || "Failed to import from HubSpot" });
    }
  });

  // Push a prospect into HubSpot (create/update the contact). Returns the id.
  app.post("/api/sales-outreach/prospects/:id/sync-hubspot", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);
      const [prospect] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
      if (!prospect || prospect.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Prospect not found" });
      }
      const conn = await storage.getHubspotConnection(ctx.tenantDomain);
      if (!conn) return res.status(409).json({ error: "HubSpot isn't connected. Connect it in Settings → Connections.", code: "no_hubspot" });

      const [first, ...rest] = (prospect.name || "").split(" ");
      const hubspotContactId = await pushProspectToHubspot(ctx.tenantDomain, prospect, first, rest.join(" "));
      const [updated] = await db
        .update(prospects)
        .set({ hubspotContactId, updatedAt: new Date() })
        .where(eq(prospects.id, prospect.id))
        .returning();
      res.json({ prospect: updated, hubspotContactId });
    } catch (err: any) {
      console.error("[sales-outreach:sync-hubspot]", err);
      res.status(500).json({ error: err.message || "Failed to sync to HubSpot" });
    }
  });

  // ── Cadence + Active Outreach summary ───────────────────────────────────────

  // Active Outreach rollup for the Sales home widget.
  app.get("/api/sales-outreach/summary", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);
      res.json(await getOutreachSummary(ctx.tenantDomain));
    } catch (err: any) {
      console.error("[sales-outreach:summary]", err);
      res.status(500).json({ error: err.message || "Failed to load outreach summary" });
    }
  });

  // Advance due cadence steps + apply the reply-rate floor. Safe to call on a
  // schedule; also exposed for a manual "refresh cadence" action.
  app.post("/api/sales-outreach/cadence/tick", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "outreachCadence"))) return;
      const ctx = await getRequestContext(req);
      const tick = await tickCadence(ctx.tenantDomain);
      // Also read the current seller's mailbox for sends/replies (best-effort).
      const activity = await detectMailboxActivity(ctx.userId, ctx.tenantDomain).catch(() => ({ touchesConfirmedSent: 0, repliesDetected: 0 }));
      res.json({ ...tick, ...activity });
    } catch (err: any) {
      console.error("[sales-outreach:tick]", err);
      res.status(500).json({ error: err.message || "Failed to run cadence tick" });
    }
  });

  // Mark a prospect as having replied (until Graph reply auto-detection lands).
  app.post("/api/sales-outreach/prospects/:id/mark-replied", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "outreachCadence"))) return;
      const ctx = await getRequestContext(req);
      const [prospect] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
      if (!prospect || prospect.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Prospect not found" });
      }
      const [updated] = await db
        .update(prospects)
        .set({ status: "replied", nextActionAt: null, updatedAt: new Date() })
        .where(eq(prospects.id, prospect.id))
        .returning();
      res.json(updated);
    } catch (err: any) {
      console.error("[sales-outreach:mark-replied]", err);
      res.status(500).json({ error: err.message || "Failed to mark replied" });
    }
  });

  // Remove a prospect from a campaign entirely.
  app.delete("/api/sales-outreach/prospects/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const [prospect] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
      if (!prospect || prospect.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Prospect not found" });
      }
      await db.delete(prospects).where(eq(prospects.id, prospect.id));
      res.status(204).end();
    } catch (err: any) {
      console.error("[sales-outreach:prospect-delete]", err);
      res.status(500).json({ error: err.message || "Failed to delete prospect" });
    }
  });
}

/** Create/update a prospect's HubSpot contact. Shared by manual sync + approve. */
async function pushProspectToHubspot(
  tenantDomain: string,
  prospect: { name: string; email: string | null; title: string | null; companyName: string | null },
  firstName: string,
  lastName: string,
): Promise<string> {
  return upsertContact(tenantDomain, {
    email: prospect.email,
    firstName: firstName || null,
    lastName: lastName || null,
    jobTitle: prospect.title,
    company: prospect.companyName,
  });
}
