/**
 * Marketing Contacts Routes
 *
 * Endpoints:
 *   POST   /api/marketing-contacts/ingest-event   (HMAC-signed webhook for synozur-webbase)
 *   GET    /api/marketing-contacts                 list contacts (paginated, search, lifecycle filter)
 *   GET    /api/marketing-contacts/:id             single contact
 *   GET    /api/marketing-contacts/:id/events      timeline events
 *   POST   /api/admin/marketing-contacts/backfill  admin-only one-shot backfill
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { eq, and, desc, asc, ilike, or, count, inArray } from "drizzle-orm";
import {
  marketingContacts,
  marketingContactEvents,
  tenants,
  marketingLinks,
  emailSends,
  generatedEmails,
  campaigns,
} from "@shared/schema";
import { getRequestContext } from "../context";
import { checkFeatureAccessAsync } from "../services/plan-policy";
import { storage } from "../storage";
import { verifyWebhookSignature } from "../services/marketing-contact-webhook-auth";
import {
  ingestEvent,
  backfillContactTimeline,
  backfillContactOptOuts,
  type ContactEventType,
} from "../services/marketing-contact-service";
import { parsePaginationParams } from "../utils/pagination";
import {
  type AttributionModel,
  ATTRIBUTION_MODELS,
  allocateCredit,
  deriveChannel,
  isConversionEvent,
  type Touchpoint,
} from "../services/attribution-service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getTenantPlan(tenantDomain: string): Promise<string> {
  const tenant = await storage.getTenantByDomain(tenantDomain);
  return tenant?.plan ?? "free";
}

async function guardContacts(req: Request, res: Response): Promise<boolean> {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  try {
    const ctx = await getRequestContext(req);
    const plan = await getTenantPlan(ctx.tenantDomain);
    const gate = await checkFeatureAccessAsync(plan, "marketingContacts");
    if (!gate.allowed) {
      res.status(403).json({
        error: gate.reason,
        upgradeRequired: gate.upgradeRequired,
        requiredPlan: gate.requiredPlan,
      });
      return false;
    }
    return true;
  } catch (err: any) {
    const status = err?.status === 401 ? 401 : err?.status === 403 ? 403 : 500;
    res.status(status).json({
      error:
        status === 401 ? "Not authenticated" : status === 403 ? "Forbidden" : "Request failed",
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Register routes
// ---------------------------------------------------------------------------

export function registerMarketingContactsRoutes(app: Express) {
  // ──────────────────────────────────────────────────────────
  // PUBLIC INGEST WEBHOOK (called by synozur-webbase)
  //
  // Security model:
  //   1. Extract tenantDomain from body first (needed to compute the HMAC).
  //   2. Verify HMAC — the signing payload is "tenantDomain:rawBody" so a
  //      signature for tenant A cannot be replayed against tenant B.
  //   3. Confirm the tenant exists in the DB and has the marketingContacts
  //      feature, so a valid secret alone cannot write to arbitrary tenants.
  // ──────────────────────────────────────────────────────────
  app.post("/api/marketing-contacts/ingest-event", async (req: Request, res: Response) => {
    const rawBody: Buffer =
      (req as any).rawBody ||
      Buffer.from(JSON.stringify(req.body || {}));

    // Step 1 — parse tenantDomain before anything else (needed for HMAC).
    const { tenantDomain, email, firstName, lastName, company, jobTitle,
            eventType, source, occurredAt, metadata } = req.body ?? {};

    if (!tenantDomain || typeof tenantDomain !== "string") {
      return res.status(400).json({ error: "tenantDomain is required" });
    }

    // Step 2 — verify tenant-bound HMAC.
    const sig = req.headers["x-orbit-signature"] as string | undefined;
    if (!verifyWebhookSignature(tenantDomain, rawBody, sig)) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }

    // Step 3 — validate tenant exists and has the marketingContacts feature.
    // This prevents the global secret from being used to write to arbitrary
    // tenants that have never enrolled.
    const [tenant] = await db
      .select({ plan: tenants.plan, status: tenants.status })
      .from(tenants)
      .where(eq(tenants.domain, tenantDomain))
      .limit(1);
    if (!tenant || tenant.status !== "active") {
      return res.status(403).json({ error: "Tenant not found or inactive" });
    }
    const featureGate = await checkFeatureAccessAsync(tenant.plan, "marketingContacts");
    if (!featureGate.allowed) {
      return res.status(403).json({ error: "marketingContacts feature not enabled for this tenant" });
    }

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ error: "A valid email is required" });
    }

    const allowedEventTypes: ContactEventType[] = [
      "form_submit", "page_view", "email_sent", "email_open",
      "email_click", "link_click", "social_engage", "unsubscribe",
    ];
    if (!eventType || !allowedEventTypes.includes(eventType as ContactEventType)) {
      return res.status(400).json({
        error: `eventType must be one of: ${allowedEventTypes.join(", ")}`,
      });
    }

    try {
      const { contact, eventId } = await ingestEvent({
        tenantDomain,
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        company: company || null,
        jobTitle: jobTitle || null,
        eventType: eventType as ContactEventType,
        source: source || "webbase",
        occurredAt: occurredAt ? new Date(occurredAt) : null,
        metadata: metadata || null,
      });
      res.status(200).json({ ok: true, contactId: contact.id, eventId });
    } catch (err: any) {
      console.error("[marketing-contacts] ingest-event failed:", err.message);
      res.status(500).json({ error: "Ingest failed" });
    }
  });

  // ──────────────────────────────────────────────────────────
  // LIST CONTACTS
  // ──────────────────────────────────────────────────────────
  app.get("/api/marketing-contacts", async (req: Request, res: Response) => {
    if (!await guardContacts(req, res)) return;
    const ctx = await getRequestContext(req);

    const pagination = parsePaginationParams(req);
    const page = Math.max(1, pagination.page ?? 1);
    const pageSize = Math.min(Math.max(pagination.pageSize ?? 25, 1), 100);
    const offset = (page - 1) * pageSize;

    const lifecycle = typeof req.query.lifecycle === "string" ? req.query.lifecycle : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;

    const conditions: any[] = [eq(marketingContacts.tenantDomain, ctx.tenantDomain)];
    if (lifecycle) conditions.push(eq(marketingContacts.lifecycleStage, lifecycle));
    if (q) {
      const pattern = `%${q.replace(/%/g, "\\%")}%`;
      conditions.push(
        or(
          ilike(marketingContacts.email, pattern),
          ilike(marketingContacts.firstName, pattern),
          ilike(marketingContacts.lastName, pattern),
          ilike(marketingContacts.company, pattern),
        ),
      );
    }

    const [totalRow] = await db
      .select({ total: count() })
      .from(marketingContacts)
      .where(and(...conditions));
    const total = Number(totalRow?.total ?? 0);

    const rows = await db
      .select()
      .from(marketingContacts)
      .where(and(...conditions))
      .orderBy(desc(marketingContacts.lastEventAt))
      .limit(pageSize)
      .offset(offset);

    res.json({
      data: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  });

  // ──────────────────────────────────────────────────────────
  // SINGLE CONTACT
  // ──────────────────────────────────────────────────────────
  app.get("/api/marketing-contacts/:id", async (req: Request, res: Response) => {
    if (!await guardContacts(req, res)) return;
    const ctx = await getRequestContext(req);

    const [contact] = await db
      .select()
      .from(marketingContacts)
      .where(
        and(
          eq(marketingContacts.id, req.params.id),
          eq(marketingContacts.tenantDomain, ctx.tenantDomain),
        ),
      )
      .limit(1);

    if (!contact) return res.status(404).json({ error: "Contact not found" });
    res.json(contact);
  });

  // ──────────────────────────────────────────────────────────
  // CONTACT TIMELINE
  // ──────────────────────────────────────────────────────────
  app.get("/api/marketing-contacts/:id/events", async (req: Request, res: Response) => {
    if (!await guardContacts(req, res)) return;
    const ctx = await getRequestContext(req);

    const [contact] = await db
      .select({ id: marketingContacts.id })
      .from(marketingContacts)
      .where(
        and(
          eq(marketingContacts.id, req.params.id),
          eq(marketingContacts.tenantDomain, ctx.tenantDomain),
        ),
      )
      .limit(1);

    if (!contact) return res.status(404).json({ error: "Contact not found" });

    const limit = Math.min(
      Math.max(parseInt(req.query.limit as string || "100", 10) || 100, 1),
      500,
    );

    const events = await db
      .select()
      .from(marketingContactEvents)
      .where(eq(marketingContactEvents.contactId, contact.id))
      .orderBy(desc(marketingContactEvents.occurredAt))
      .limit(limit);

    res.json(events);
  });

  // ──────────────────────────────────────────────────────────
  // CUSTOMER JOURNEY — ordered touchpoints with credit shares
  //
  // GET /api/marketing-contacts/:id/journey?model=linear
  //
  // Returns the contact's touchpoint sequence leading up to
  // each conversion event, with credit allocated per the
  // requested attribution model. Includes ALL touchpoints
  // (not just pre-conversion ones) for display purposes.
  // ──────────────────────────────────────────────────────────
  app.get("/api/marketing-contacts/:id/journey", async (req: Request, res: Response) => {
    if (!await guardContacts(req, res)) return;
    const ctx = await getRequestContext(req);

    const [contact] = await db
      .select()
      .from(marketingContacts)
      .where(
        and(
          eq(marketingContacts.id, req.params.id),
          eq(marketingContacts.tenantDomain, ctx.tenantDomain),
        ),
      )
      .limit(1);

    if (!contact) return res.status(404).json({ error: "Contact not found" });

    const modelParam = (req.query.model as string) || "last-touch";
    const model: AttributionModel = (ATTRIBUTION_MODELS as string[]).includes(modelParam)
      ? (modelParam as AttributionModel)
      : "last-touch";

    // Load all events for this contact (ascending — oldest first)
    const events = await db
      .select()
      .from(marketingContactEvents)
      .where(eq(marketingContactEvents.contactId, contact.id))
      .orderBy(asc(marketingContactEvents.occurredAt))
      .limit(500);

    // Build campaign-resolution lookup tables from two sources:
    //   a) marketing_links: slug → campaignId (for link_click events)
    //   b) email_sends → generated_emails: sendId → campaignId (for email
    //      events whose metadata contains { sendId } set by the backfill worker)
    const [linkRows, sendRows] = await Promise.all([
      db
        .select({ slug: marketingLinks.slug, campaignId: marketingLinks.campaignId })
        .from(marketingLinks)
        .where(eq(marketingLinks.tenantDomain, ctx.tenantDomain)),
      db
        .select({ sendId: emailSends.id, campaignId: generatedEmails.campaignId })
        .from(emailSends)
        .innerJoin(generatedEmails, eq(emailSends.generatedEmailId, generatedEmails.id))
        .where(eq(emailSends.tenantDomain, ctx.tenantDomain)),
    ]);

    const slugToCampaign = new Map<string, string | null>(
      linkRows.map((l) => [l.slug, l.campaignId]),
    );
    const sendIdToCampaign = new Map<string, string | null>(
      sendRows.map((s) => [s.sendId, s.campaignId]),
    );

    const campaignIds = Array.from(
      new Set(
        [...linkRows.map((l) => l.campaignId), ...sendRows.map((s) => s.campaignId)]
          .filter((id): id is string => !!id),
      ),
    );
    const campaignNameById = new Map<string, string>();
    if (campaignIds.length > 0) {
      const camps = await db
        .select({ id: campaigns.id, name: campaigns.name })
        .from(campaigns)
        .where(
          and(
            eq(campaigns.tenantDomain, ctx.tenantDomain),
            inArray(campaigns.id, campaignIds),
          ),
        );
      for (const c of camps) campaignNameById.set(c.id, c.name);
    }

    // Identify conversion events to determine credit windows
    const conversionIndices = events
      .map((ev, i) => ({ ev, i }))
      .filter(({ ev }) => isConversionEvent(ev.eventType, ev.metadata as any))
      .map(({ i }) => i);

    // Build touchpoints for attribution — use the last conversion as the reference
    // (or use all events if no conversion found, showing journey without conversion)
    const lastConvIdx = conversionIndices.length > 0 ? conversionIndices[conversionIndices.length - 1] : -1;

    // Resolve campaign via three paths (in priority order):
    //   1. metadata.campaignId — explicitly stored
    //   2. metadata.sendId    — email events resolved via email_sends → generated_emails
    //   3. metadata.slug      — link-click events resolved via marketing_links
    const toTouchpoint = (ev: (typeof events)[0]): Touchpoint => {
      const meta = ev.metadata as Record<string, unknown> | null;
      const directCampaignId = meta?.campaignId as string | null | undefined;
      const sendId = meta?.sendId as string | undefined;
      const slug = meta?.slug as string | undefined;
      const resolvedCampaignId = directCampaignId
        ?? (sendId ? (sendIdToCampaign.get(sendId) ?? null) : null)
        ?? (slug ? (slugToCampaign.get(slug) ?? null) : null);
      return {
        id: ev.id,
        occurredAt: ev.occurredAt,
        eventType: ev.eventType,
        channel: deriveChannel(ev.eventType, ev.source),
        campaignId: resolvedCampaignId ?? null,
        campaignName: resolvedCampaignId ? (campaignNameById.get(resolvedCampaignId) ?? null) : null,
        metadata: meta,
      };
    };

    // Credit only pre-conversion touchpoints; mark conversion events separately
    let creditMap = new Map<string, number>();
    if (lastConvIdx > 0) {
      const preTouchpoints = events.slice(0, lastConvIdx).filter(
        (ev) => !isConversionEvent(ev.eventType, ev.metadata as any),
      );
      if (preTouchpoints.length > 0) {
        const credited = allocateCredit(preTouchpoints.map(toTouchpoint), model);
        for (const c of credited) creditMap.set(c.id, c.credit);
      }
    }

    const journey = events.map((ev) => {
      const tp = toTouchpoint(ev);
      const isConversion = isConversionEvent(ev.eventType, ev.metadata as any);
      const credit = creditMap.get(ev.id) ?? null;
      return {
        ...tp,
        isConversion,
        credit,
        creditPct: credit != null ? `${(credit * 100).toFixed(1)}%` : null,
        occurredAt: ev.occurredAt.toISOString(),
        source: ev.source,
      };
    });

    res.json({
      contact,
      model,
      journey,
      hasConversion: lastConvIdx >= 0,
      conversionCount: conversionIndices.length,
    });
  });

  // ──────────────────────────────────────────────────────────
  // ADMIN BACKFILL (protected — Domain Admin or Global Admin)
  // ──────────────────────────────────────────────────────────
  app.post("/api/admin/marketing-contacts/backfill", async (req: Request, res: Response) => {
    if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });

    try {
      const ctx = await getRequestContext(req);
      const user = await storage.getUser(ctx.userId);
      if (!user || !["Domain Admin", "Global Admin"].includes(user.role)) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const summary = await backfillContactTimeline(ctx.tenantDomain);
      const optOutSummary = await backfillContactOptOuts(ctx.tenantDomain);
      res.json({ ok: true, ...summary, optOutsFromSendGrid: optOutSummary.fromSendGrid, optOutsFromHubSpot: optOutSummary.fromHubSpot });
    } catch (err: any) {
      console.error("[marketing-contacts] backfill failed:", err.message);
      res.status(500).json({ error: err.message || "Backfill failed" });
    }
  });

  // ──────────────────────────────────────────────────────────
  // ADMIN HUBSPOT ENRICHMENT — manually trigger per-tenant
  // HubSpot contact enrichment using the tenant's connected
  // OAuth portal. Requires Domain Admin or Global Admin.
  // ──────────────────────────────────────────────────────────
  app.post("/api/admin/marketing-contacts/enrich-hubspot", async (req: Request, res: Response) => {
    if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });

    try {
      const ctx = await getRequestContext(req);
      const user = await storage.getUser(ctx.userId);
      if (!user || !["Domain Admin", "Global Admin"].includes(user.role)) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const plan = await getTenantPlan(ctx.tenantDomain);
      const gate = await checkFeatureAccessAsync(plan, "marketingContacts");
      if (!gate.allowed) {
        return res.status(403).json({ error: gate.reason, upgradeRequired: gate.upgradeRequired });
      }

      const { syncHubSpotContactEnrichment } = await import(
        "../services/hubspot-service"
      );
      const forceAll = req.body?.forceAll === true;
      const limit = typeof req.body?.limit === "number" ? Math.min(req.body.limit, 1000) : 200;

      const result = await syncHubSpotContactEnrichment({
        tenantDomain: ctx.tenantDomain,
        limit,
        forceAll,
      });
      res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("[marketing-contacts] HubSpot enrichment failed:", err.message);
      res.status(500).json({ error: err.message || "Enrichment failed" });
    }
  });
}
