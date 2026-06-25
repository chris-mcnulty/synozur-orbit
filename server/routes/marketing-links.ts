/**
 * Marketing Links — UTM builder, click tracking, and analytics endpoints.
 *
 * Endpoints:
 *  - GET    /r/:slug                                   public redirect (records click)
 *  - GET    /api/marketing-links                       list links (tenant-scoped, optional ?campaignId)
 *  - POST   /api/marketing-links                       create a link (with UTM params)
 *  - PATCH  /api/marketing-links/:id                   update label / UTMs / status
 *  - DELETE /api/marketing-links/:id                   archive a link (soft delete)
 *  - GET    /api/marketing-links/analytics             tenant-wide rollup (sparklines)
 *  - GET    /api/marketing-links/:id/clicks            click log for a single link
 *  - GET    /api/marketing-links/export.csv            CSV export of all link performance
 *
 * Slug → link lookup is tenant-blind because the redirect must work for
 * unauthenticated visitors. All other endpoints are tenant-scoped via
 * getRequestContext + a guardFeature("campaigns") check.
 */

import type { Express } from "express";
import { db } from "../db";
import { eq, and, desc, sql, inArray, gte, ne, notInArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  marketingLinks,
  marketingLinkClicks,
  campaigns,
  generatedPosts,
  type InsertMarketingLink,
} from "@shared/schema";
import { getRequestContext } from "../context";
import { checkFeatureAccessAsync } from "../services/plan-policy";
import { storage } from "../storage";
import {
  generateUniqueSlug,
  applyUtmParams,
  isLikelyBot,
  hashIp,
  clientIp,
  buildRedirectUrl,
  slugifyForUtm,
} from "../services/marketing-links-helpers";

async function getTenantPlan(tenantDomain: string): Promise<string> {
  const tenant = await storage.getTenantByDomain(tenantDomain);
  return tenant?.plan ?? "free";
}

async function guardCampaigns(req: any, res: any): Promise<boolean> {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  try {
    const ctx = await getRequestContext(req);
    const plan = await getTenantPlan(ctx.tenantDomain);
    const gate = await checkFeatureAccessAsync(plan, "campaigns");
    if (!gate.allowed) {
      res.status(403).json({ error: gate.reason, upgradeRequired: gate.upgradeRequired, requiredPlan: gate.requiredPlan });
      return false;
    }
    return true;
  } catch (err: any) {
    const status = err?.status === 401 ? 401 : err?.status === 403 ? 403 : 500;
    res.status(status).json({ error: status === 401 ? "Not authenticated" : status === 403 ? "Forbidden" : "Request failed" });
    return false;
  }
}

export function registerMarketingLinksRoutes(app: Express) {
  // ──────────────────────────────────────────────────────────
  // PUBLIC REDIRECT — must be unauthenticated, must run before
  // the Vite/static catch-all. Records the click async so the
  // redirect itself stays fast.
  // ──────────────────────────────────────────────────────────
  app.get("/r/:slug", async (req, res) => {
    const slug = req.params.slug;
    if (!slug || slug.length < 4 || slug.length > 32) {
      return res.status(404).type("text/plain").send("Link not found");
    }

    try {
      const [link] = await db.select().from(marketingLinks)
        .where(eq(marketingLinks.slug, slug))
        .limit(1);

      if (!link || link.status !== "active") {
        return res.status(404).type("text/plain").send("Link not found");
      }

      const ua = (req.headers["user-agent"] as string) || "";
      const referrer = (req.headers.referer || req.headers.referrer) as string | undefined;
      const isBot = isLikelyBot(ua) || req.method === "HEAD";
      const ipH = hashIp(clientIp(req as any));

      // Insert click + bump counter. We don't await this — the redirect
      // should not block on logging. Errors are swallowed and logged so a
      // tracking failure never breaks the user's redirect.
      (async () => {
        try {
          await db.insert(marketingLinkClicks).values({
            id: randomUUID(),
            linkId: link.id,
            tenantDomain: link.tenantDomain,
            referrer: referrer ? String(referrer).slice(0, 1024) : null,
            userAgent: ua ? ua.slice(0, 512) : null,
            ipHash: ipH,
            isBot,
          });
          if (!isBot) {
            await db.update(marketingLinks)
              .set({
                clickCount: sql`${marketingLinks.clickCount} + 1`,
                lastClickedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(marketingLinks.id, link.id));
          }
        } catch (err: any) {
          console.warn(`[MarketingLinks] click logging failed for slug=${slug}:`, err.message);
        }
      })();

      res.redirect(302, link.destinationUrl);
    } catch (err: any) {
      console.error(`[MarketingLinks] redirect failed for slug=${slug}:`, err.message);
      res.status(500).type("text/plain").send("Redirect failed");
    }
  });

  // ──────────────────────────────────────────────────────────
  // CRUD
  // ──────────────────────────────────────────────────────────
  app.get("/api/marketing-links", async (req, res) => {
    if (!await guardCampaigns(req, res)) return;
    const ctx = await getRequestContext(req);
    const campaignId = typeof req.query.campaignId === "string" ? req.query.campaignId : undefined;
    const filters = [
      eq(marketingLinks.tenantDomain, ctx.tenantDomain),
      eq(marketingLinks.marketId, ctx.marketId),
    ];
    if (campaignId) filters.push(eq(marketingLinks.campaignId, campaignId));

    const rows = await db.select().from(marketingLinks)
      .where(and(...filters))
      .orderBy(desc(marketingLinks.createdAt));
    res.json(rows);
  });

  app.post("/api/marketing-links", async (req, res) => {
    if (!await guardCampaigns(req, res)) return;
    const ctx = await getRequestContext(req);
    const {
      destinationUrl,
      label,
      campaignId,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      utmTerm,
      applyUtmsToDestination,
    } = req.body ?? {};

    if (!destinationUrl || typeof destinationUrl !== "string") {
      return res.status(400).json({ error: "destinationUrl is required" });
    }
    try {
      // Reject obviously malformed URLs early; redirect handler trusts the value.
      const u = new URL(destinationUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return res.status(400).json({ error: "destinationUrl must be http or https" });
      }
    } catch {
      return res.status(400).json({ error: "destinationUrl is not a valid URL" });
    }

    if (campaignId) {
      const [campaign] = await db.select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantDomain, ctx.tenantDomain)))
        .limit(1);
      if (!campaign) return res.status(400).json({ error: "Campaign not found" });
    }

    const finalDestination = applyUtmsToDestination
      ? applyUtmParams(destinationUrl, {
          source: utmSource,
          medium: utmMedium,
          campaign: utmCampaign,
          content: utmContent,
          term: utmTerm,
        })
      : destinationUrl;

    const slug = await generateUniqueSlug();

    const insertRow: InsertMarketingLink = {
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      campaignId: campaignId ?? null,
      slug,
      destinationUrl: finalDestination,
      label: label?.trim() || null,
      utmSource: utmSource?.trim() || null,
      utmMedium: utmMedium?.trim() || null,
      utmCampaign: utmCampaign?.trim() || null,
      utmContent: utmContent?.trim() || null,
      utmTerm: utmTerm?.trim() || null,
      status: "active",
      source: "manual",
      createdBy: ctx.userId,
    };

    const [row] = await db.insert(marketingLinks).values(insertRow).returning();
    res.status(201).json({
      ...row,
      shortUrl: buildRedirectUrl(row.slug, { protocol: req.protocol, host: req.get("host") || undefined }),
    });
  });

  app.patch("/api/marketing-links/:id", async (req, res) => {
    if (!await guardCampaigns(req, res)) return;
    const ctx = await getRequestContext(req);
    const updates: Record<string, any> = { updatedAt: new Date() };
    const { label, status, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, destinationUrl } = req.body ?? {};
    if (label !== undefined) updates.label = label?.trim() || null;
    if (status !== undefined && (status === "active" || status === "archived")) updates.status = status;
    if (utmSource !== undefined) updates.utmSource = utmSource?.trim() || null;
    if (utmMedium !== undefined) updates.utmMedium = utmMedium?.trim() || null;
    if (utmCampaign !== undefined) updates.utmCampaign = utmCampaign?.trim() || null;
    if (utmContent !== undefined) updates.utmContent = utmContent?.trim() || null;
    if (utmTerm !== undefined) updates.utmTerm = utmTerm?.trim() || null;
    if (destinationUrl !== undefined) {
      try {
        const u = new URL(destinationUrl);
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
        updates.destinationUrl = destinationUrl;
      } catch {
        return res.status(400).json({ error: "destinationUrl is not a valid URL" });
      }
    }

    const [row] = await db.update(marketingLinks)
      .set(updates)
      .where(and(
        eq(marketingLinks.id, req.params.id),
        eq(marketingLinks.tenantDomain, ctx.tenantDomain),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: "Link not found" });
    res.json(row);
  });

  app.delete("/api/marketing-links/:id", async (req, res) => {
    if (!await guardCampaigns(req, res)) return;
    const ctx = await getRequestContext(req);
    // Soft-delete (archive) so the redirect 404s but the click history is
    // preserved for analytics history.
    const [row] = await db.update(marketingLinks)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(
        eq(marketingLinks.id, req.params.id),
        eq(marketingLinks.tenantDomain, ctx.tenantDomain),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: "Link not found" });
    res.status(204).send();
  });

  // Archive post-wrap links that no longer have an active post referencing
  // their slug in that campaign. Handles links orphaned before the automatic
  // per-rejection cleanup was added.
  app.post("/api/campaigns/:campaignId/marketing-links/cleanup-post-wrap", async (req, res) => {
    if (!await guardCampaigns(req, res)) return;
    try {
      const ctx = await getRequestContext(req);
      const { campaignId } = req.params;
      const [campaign] = await db.select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantDomain, ctx.tenantDomain)))
        .limit(1);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      // All active post-wrap links for this campaign
      const postWrapLinks = await db.select({ id: marketingLinks.id, slug: marketingLinks.slug })
        .from(marketingLinks)
        .where(and(
          eq(marketingLinks.campaignId, campaignId),
          eq(marketingLinks.source, "post-wrap"),
          eq(marketingLinks.status, "active"),
        ));
      if (postWrapLinks.length === 0) return res.json({ archived: 0 });

      // Slugs still referenced by active posts in this campaign
      const activePosts = await db.select({ content: generatedPosts.content })
        .from(generatedPosts)
        .where(and(
          eq(generatedPosts.campaignId, campaignId),
          notInArray(generatedPosts.status, ["deleted", "rejected", "archived"]),
        ));
      const referencedSlugs = new Set<string>();
      for (const p of activePosts) {
        if (!p.content) continue;
        for (const m of p.content.matchAll(/\/r\/([a-z0-9]+)/gi)) referencedSlugs.add(m[1]);
      }

      // Archive any links whose slug is no longer referenced
      const orphanedIds = postWrapLinks.filter(l => !referencedSlugs.has(l.slug)).map(l => l.id);
      if (orphanedIds.length === 0) return res.json({ archived: 0 });

      await db.update(marketingLinks)
        .set({ status: "archived", updatedAt: new Date() })
        .where(inArray(marketingLinks.id, orphanedIds));

      res.json({ archived: orphanedIds.length });
    } catch (err: any) {
      console.error("[marketing-links cleanup-post-wrap]", err.message);
      res.status(500).json({ error: err.message || "Cleanup failed" });
    }
  });

  // ──────────────────────────────────────────────────────────
  // ANALYTICS
  // ──────────────────────────────────────────────────────────
  app.get("/api/marketing-links/analytics", async (req, res) => {
    if (!await guardCampaigns(req, res)) return;
    const ctx = await getRequestContext(req);

    const days = Math.min(Math.max(parseInt((req.query.days as string) || "30", 10) || 30, 7), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const links = await db.select().from(marketingLinks)
      .where(and(
        eq(marketingLinks.tenantDomain, ctx.tenantDomain),
        eq(marketingLinks.marketId, ctx.marketId),
      ))
      .orderBy(desc(marketingLinks.clickCount));

    const linkIds = links.map(l => l.id);
    let perDayByLink: Record<string, Record<string, number>> = {};
    if (linkIds.length > 0) {
      const rows = await db.select({
        linkId: marketingLinkClicks.linkId,
        day: sql<string>`to_char(${marketingLinkClicks.clickedAt}, 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
        .from(marketingLinkClicks)
        .where(and(
          eq(marketingLinkClicks.tenantDomain, ctx.tenantDomain),
          inArray(marketingLinkClicks.linkId, linkIds),
          gte(marketingLinkClicks.clickedAt, since),
          eq(marketingLinkClicks.isBot, false),
        ))
        .groupBy(marketingLinkClicks.linkId, sql`to_char(${marketingLinkClicks.clickedAt}, 'YYYY-MM-DD')`);

      for (const r of rows) {
        if (!perDayByLink[r.linkId]) perDayByLink[r.linkId] = {};
        perDayByLink[r.linkId][r.day] = Number(r.count);
      }
    }

    // Build a normalized day list so every sparkline has the same length on
    // the client (one int per day, zero-filled).
    const dayKeys: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      dayKeys.push(d.toISOString().slice(0, 10));
    }

    // Campaign names for the "clicks by campaign" leaderboard, fetched once
    // for the campaigns referenced by these links.
    const campaignIds = Array.from(new Set(links.map(l => l.campaignId).filter((x): x is string => !!x)));
    const campaignNameById: Record<string, string> = {};
    if (campaignIds.length > 0) {
      const camps = await db.select({ id: campaigns.id, name: campaigns.name })
        .from(campaigns)
        .where(and(
          eq(campaigns.tenantDomain, ctx.tenantDomain),
          eq(campaigns.marketId, ctx.marketId),
          inArray(campaigns.id, campaignIds),
        ));
      for (const c of camps) campaignNameById[c.id] = c.name;
    }

    const result = links.map(link => {
      const daily = perDayByLink[link.id] || {};
      const sparkline = dayKeys.map(d => daily[d] ?? 0);
      const recentClicks = sparkline.reduce((a, b) => a + b, 0);
      return {
        id: link.id,
        slug: link.slug,
        label: link.label,
        destinationUrl: link.destinationUrl,
        campaignId: link.campaignId,
        campaignName: link.campaignId ? (campaignNameById[link.campaignId] ?? null) : null,
        utmSource: link.utmSource,
        utmMedium: link.utmMedium,
        utmCampaign: link.utmCampaign,
        utmContent: link.utmContent,
        utmTerm: link.utmTerm,
        clickCount: link.clickCount,
        recentClicks,
        lastClickedAt: link.lastClickedAt,
        status: link.status,
        source: link.source,
        createdAt: link.createdAt,
        sparkline,
        shortUrl: buildRedirectUrl(link.slug, { protocol: req.protocol, host: req.get("host") || undefined }),
      };
    });

    res.json({
      days,
      dayKeys,
      links: result,
      totals: {
        linkCount: links.length,
        totalClicks: links.reduce((s, l) => s + l.clickCount, 0),
        recentClicks: result.reduce((s, l) => s + l.recentClicks, 0),
      },
    });
  });

  app.get("/api/marketing-links/:id/clicks", async (req, res) => {
    if (!await guardCampaigns(req, res)) return;
    const ctx = await getRequestContext(req);
    const [link] = await db.select().from(marketingLinks)
      .where(and(
        eq(marketingLinks.id, req.params.id),
        eq(marketingLinks.tenantDomain, ctx.tenantDomain),
      ))
      .limit(1);
    if (!link) return res.status(404).json({ error: "Link not found" });

    const clicks = await db.select().from(marketingLinkClicks)
      .where(eq(marketingLinkClicks.linkId, link.id))
      .orderBy(desc(marketingLinkClicks.clickedAt))
      .limit(500);

    res.json({ link, clicks });
  });

  // ──────────────────────────────────────────────────────────
  // CSV EXPORT
  // ──────────────────────────────────────────────────────────
  app.get("/api/marketing-links/export.csv", async (req, res) => {
    if (!await guardCampaigns(req, res)) return;
    const ctx = await getRequestContext(req);
    const links = await db.select().from(marketingLinks)
      .where(and(
        eq(marketingLinks.tenantDomain, ctx.tenantDomain),
        eq(marketingLinks.marketId, ctx.marketId),
      ))
      .orderBy(desc(marketingLinks.clickCount));

    const escCsv = (v: any): string => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const header = "Slug,Label,Short URL,Destination URL,Campaign ID,UTM Source,UTM Medium,UTM Campaign,UTM Content,UTM Term,Status,Source,Click Count,Last Clicked,Created";
    const lines = [header];
    for (const link of links) {
      const shortUrl = buildRedirectUrl(link.slug, { protocol: req.protocol, host: req.get("host") || undefined });
      lines.push([
        link.slug,
        link.label || "",
        shortUrl,
        link.destinationUrl,
        link.campaignId || "",
        link.utmSource || "",
        link.utmMedium || "",
        link.utmCampaign || "",
        link.utmContent || "",
        link.utmTerm || "",
        link.status,
        link.source,
        link.clickCount,
        link.lastClickedAt ? new Date(link.lastClickedAt).toISOString() : "",
        new Date(link.createdAt).toISOString(),
      ].map(escCsv).join(","));
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="marketing-links-${Date.now()}.csv"`);
    res.send(lines.join("\n"));
  });

  // ──────────────────────────────────────────────────────────
  // CSV IMPORT
  // ──────────────────────────────────────────────────────────
  // Accepts a plain-text CSV body (Content-Type: text/plain or text/csv).
  // Recognised columns (case-insensitive): Destination URL, Label,
  // UTM Source, UTM Medium, UTM Campaign, UTM Content, UTM Term.
  // Each valid row generates a new tracked link with a fresh slug.
  // Returns { imported, failed, errors[] }.
  app.post("/api/marketing-links/import.csv", async (req, res) => {
    if (!await guardCampaigns(req, res)) return;
    const ctx = await getRequestContext(req);

    // Accept text/csv, text/plain, or application/octet-stream
    const rawBody: string = await new Promise((resolve, reject) => {
      let data = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => { data += chunk; });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });

    if (!rawBody.trim()) {
      return res.status(400).json({ error: "Empty CSV body" });
    }

    const lines = rawBody.split(/\r?\n/);
    if (lines.length < 2) {
      return res.status(400).json({ error: "CSV must have a header row and at least one data row" });
    }

    // Parse header — normalise to lowercase, trim whitespace
    const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim().toLowerCase());

    const col = (row: string[], name: string): string => {
      const idx = headers.indexOf(name);
      if (idx === -1) return "";
      const v = row[idx] ?? "";
      return v.replace(/^"|"$/g, "").trim();
    };

    let imported = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Naive CSV split — handles quoted fields containing commas
      const row: string[] = [];
      let cur = "";
      let inQuote = false;
      for (const ch of line) {
        if (ch === '"') { inQuote = !inQuote; continue; }
        if (ch === "," && !inQuote) { row.push(cur); cur = ""; continue; }
        cur += ch;
      }
      row.push(cur);

      const destinationUrl = col(row, "destination url");
      if (!destinationUrl) {
        failed++;
        errors.push(`Row ${i}: missing Destination URL`);
        continue;
      }

      try {
        const u = new URL(destinationUrl);
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("protocol");
      } catch {
        failed++;
        errors.push(`Row ${i}: invalid URL — ${destinationUrl}`);
        continue;
      }

      const utmSource   = col(row, "utm source");
      const utmMedium   = col(row, "utm medium");
      const utmCampaign = col(row, "utm campaign");
      const utmContent  = col(row, "utm content");
      const utmTerm     = col(row, "utm term");

      const finalDestination = (utmSource || utmMedium || utmCampaign)
        ? applyUtmParams(destinationUrl, {
            source: utmSource || undefined,
            medium: utmMedium || undefined,
            campaign: utmCampaign || undefined,
            content: utmContent || undefined,
            term: utmTerm || undefined,
          })
        : destinationUrl;

      try {
        const slug = await generateUniqueSlug();
        const label = col(row, "label") || null;
        await db.insert(marketingLinks).values({
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          campaignId: null,
          slug,
          destinationUrl: finalDestination,
          label,
          utmSource: utmSource || null,
          utmMedium: utmMedium || null,
          utmCampaign: utmCampaign || null,
          utmContent: utmContent || null,
          utmTerm: utmTerm || null,
          status: "active",
          source: "manual",
          createdBy: ctx.userId,
        } satisfies InsertMarketingLink);
        imported++;
      } catch (err: any) {
        failed++;
        errors.push(`Row ${i}: ${err.message}`);
      }
    }

    res.json({ imported, failed, errors: errors.slice(0, 20) });
  });

  // ──────────────────────────────────────────────────────────
  // BULK UTM SUGGESTION HELPER — used by the campaign Link Builder UI to
  // pre-fill UTM defaults from the campaign name.
  // ──────────────────────────────────────────────────────────
  app.get("/api/campaigns/:id/utm-defaults", async (req, res) => {
    if (!await guardCampaigns(req, res)) return;
    const ctx = await getRequestContext(req);
    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantDomain, ctx.tenantDomain)))
      .limit(1);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    res.json({
      utmCampaign: slugifyForUtm(campaign.name, "campaign"),
      utmMedium: "",
      utmSource: "",
      utmContent: "",
      utmTerm: "",
    });
  });
}
