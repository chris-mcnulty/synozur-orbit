import type { Express } from "express";
import { db } from "../db";
import {
  marketingPerformanceReports,
  recommendations,
  marketingContactEvents,
  marketingContacts,
  marketingLinks,
  emailSends,
  generatedEmails,
  campaigns,
} from "@shared/schema";
import { and, asc, desc, eq, gte, lte, inArray, or, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getRequestContext } from "../context";
import { guardFeature } from "./helpers";
import { computePerformanceReport } from "../services/performance-service";
import {
  type AttributionModel,
  ATTRIBUTION_MODELS,
  allocateCredit,
  aggregateByCampaign,
  deriveChannel,
  isConversionEvent,
  type Touchpoint,
} from "../services/attribution-service";

export function registerMarketingPerformanceRoutes(app: Express) {
  // Generate a performance report for a period (default: last 30 days). Persists
  // the report and emits the analyst's recommendations as `recommendations`
  // rows so they surface in the recommendations feed and ground the next
  // editorial-calendar generation — closing the loop.
  app.post("/api/marketing/performance-report", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "marketingPerformance"))) return;
      const ctx = await getRequestContext(req);

      const now = new Date();
      const periodEnd = req.body?.periodEnd ? new Date(req.body.periodEnd) : now;
      const periodStart = req.body?.periodStart
        ? new Date(req.body.periodStart)
        : new Date(periodEnd.getTime() - 30 * 86_400_000);

      const { metrics, summary, recommendations: recs } = await computePerformanceReport({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        isDefaultMarket: ctx.isDefaultMarket,
        periodStart,
        periodEnd,
      });

      const result = await db.transaction(async (tx) => {
        let emitted: typeof recommendations.$inferSelect[] = [];
        if (recs.length > 0) {
          emitted = await tx
            .insert(recommendations)
            .values(
              recs.map((r) => ({
                id: randomUUID(),
                title: r.title,
                description: r.description,
                area: "Marketing",
                impact: r.impact,
                status: "pending",
                tenantDomain: ctx.tenantDomain,
                marketId: ctx.marketId || null,
              })),
            )
            .returning();
        }

        const [report] = await tx
          .insert(marketingPerformanceReports)
          .values({
            id: randomUUID(),
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || null,
            periodStart,
            periodEnd,
            summary,
            metrics,
            recommendationsEmitted: emitted.length,
            createdBy: ctx.userId,
          })
          .returning();

        return { report, emitted };
      });

      res.status(201).json({ report: result.report, recommendations: result.emitted });
    } catch (err: any) {
      console.error("[performance-report generate]", err);
      res.status(500).json({ error: err.message || "Failed to generate performance report" });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // MULTI-TOUCH ATTRIBUTION — campaign credit rollup
  //
  // GET /api/marketing/attribution?model=linear&days=30
  //
  // Walks the marketing_contact_events timeline for the tenant, finds contacts
  // who experienced a conversion event (form_submit or lifecycle → mql/sql)
  // within the requested window, gathers the touchpoints that preceded each
  // conversion, allocates credit using the requested model, then aggregates
  // credit by campaign.
  // ──────────────────────────────────────────────────────────────────────────
  app.get("/api/marketing/attribution", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "marketingPerformance"))) return;
      const ctx = await getRequestContext(req);

      const modelParam = (req.query.model as string) || "last-touch";
      const model: AttributionModel = (ATTRIBUTION_MODELS as string[]).includes(modelParam)
        ? (modelParam as AttributionModel)
        : "last-touch";

      const days = Math.min(Math.max(parseInt((req.query.days as string) || "30", 10) || 30, 7), 90);
      const periodEnd = new Date();
      const periodStart = new Date(periodEnd.getTime() - days * 86_400_000);

      // 1. Find all contacts for this tenant that have at least one event in window
      const contactRows = await db
        .select({ id: marketingContacts.id })
        .from(marketingContacts)
        .where(eq(marketingContacts.tenantDomain, ctx.tenantDomain));

      const contactIds = contactRows.map((c) => c.id);
      if (contactIds.length === 0) {
        return res.json({ model, days, byCampaign: [], conversions: 0, touchpointCount: 0 });
      }

      // 2. Load all events for these contacts in the window (and a 90-day lookback
      //    for pre-conversion touchpoints). We load a wider window so we can include
      //    touchpoints that occurred before the conversion window opened.
      const lookbackStart = new Date(periodStart.getTime() - 90 * 86_400_000);

      const allEvents = await db
        .select()
        .from(marketingContactEvents)
        .where(
          and(
            inArray(marketingContactEvents.contactId, contactIds),
            gte(marketingContactEvents.occurredAt, lookbackStart),
            lte(marketingContactEvents.occurredAt, periodEnd),
          ),
        )
        .orderBy(
          marketingContactEvents.contactId,
          asc(marketingContactEvents.occurredAt),
        );

      // 3. Build campaign-resolution lookup tables from two sources:
      //    a) marketing_links: slug → campaignId (for link_click events)
      //    b) email_sends → generated_emails: sendId → campaignId (for email events
      //       whose metadata stores { sendId } set by the contact backfill worker)
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

      // Load campaign names for all referenced campaign ids
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

      // 4. Group events by contact and run per-contact attribution
      const byContact = new Map<string, typeof allEvents>();
      for (const ev of allEvents) {
        let list = byContact.get(ev.contactId);
        if (!list) { list = []; byContact.set(ev.contactId, list); }
        list.push(ev);
      }

      // Aggregate credited touchpoints across all contacts
      const campaignCreditAccum = new Map<
        string,
        { campaignId: string | null; campaignName: string | null; credit: number; touchpoints: number }
      >();
      let totalConversions = 0;
      let totalTouchpoints = 0;

      for (const [, events] of byContact) {
        // Find conversion events within the requested period
        const conversionEvents = events.filter(
          (ev) =>
            isConversionEvent(ev.eventType, ev.metadata as Record<string, unknown> | null) &&
            ev.occurredAt >= periodStart &&
            ev.occurredAt <= periodEnd,
        );

        for (const conv of conversionEvents) {
          totalConversions += 1;

          // Touchpoints = all non-conversion events before this conversion
          const preTouchpoints = events.filter(
            (ev) => ev.occurredAt < conv.occurredAt && !isConversionEvent(ev.eventType, ev.metadata as any),
          );

          if (preTouchpoints.length === 0) {
            // No prior touchpoints — credit the conversion event itself
            preTouchpoints.push(conv);
          }

          // Map events to Touchpoint shape, resolving campaign via three paths:
          //   1. metadata.campaignId — explicitly stored on the event
          //   2. metadata.sendId    — email events; resolved via email_sends → generated_emails
          //   3. metadata.slug      — link-click events; resolved via marketing_links
          const touchpoints: Touchpoint[] = preTouchpoints.map((ev) => {
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
          });

          totalTouchpoints += touchpoints.length;
          const credited = allocateCredit(touchpoints, model);
          const byCampaign = aggregateByCampaign(credited);

          for (const cc of byCampaign) {
            const key = cc.campaignId ?? "__none__";
            const existing = campaignCreditAccum.get(key);
            if (existing) {
              existing.credit += cc.credit;
              existing.touchpoints += cc.touchpoints;
            } else {
              campaignCreditAccum.set(key, { ...cc });
            }
          }
        }
      }

      // Normalise credit totals to sum to conversions (each conversion = 1 unit)
      const byCampaign = Array.from(campaignCreditAccum.values())
        .map((cc) => ({
          campaignId: cc.campaignId,
          campaignName: cc.campaignName ?? (cc.campaignId ? "Unknown campaign" : "Direct / Unknown"),
          creditedConversions: parseFloat(cc.credit.toFixed(3)),
          touchpoints: cc.touchpoints,
        }))
        .sort((a, b) => b.creditedConversions - a.creditedConversions);

      res.json({ model, days, byCampaign, conversions: totalConversions, touchpointCount: totalTouchpoints });
    } catch (err: any) {
      console.error("[attribution rollup]", err);
      res.status(500).json({ error: err.message || "Attribution rollup failed" });
    }
  });

  // List reports for the active tenant/market.
  app.get("/api/marketing/performance-reports", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "marketingPerformance"))) return;
      const ctx = await getRequestContext(req);
      const rows = await db
        .select()
        .from(marketingPerformanceReports)
        .where(
          and(
            eq(marketingPerformanceReports.tenantDomain, ctx.tenantDomain),
            eq(marketingPerformanceReports.marketId, ctx.marketId),
          ),
        )
        .orderBy(desc(marketingPerformanceReports.createdAt));
      res.json(rows);
    } catch (err: any) {
      console.error("[performance-report list]", err);
      res.status(500).json({ error: err.message || "Failed to list performance reports" });
    }
  });
}
