import type { Express } from "express";
import { randomUUID } from "crypto";
import { db } from "../db";
import { contentAssets, contentBriefs, editorialCalendars } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { getRequestContext } from "../context";

/**
 * Test-only seeding routes — only registered outside production.
 * These endpoints let E2E specs create and clean up isolated test data
 * without involving AI generation or needing direct DB access from the spec.
 */
export function registerTestHelperRoutes(app: Express) {
  if (process.env.NODE_ENV === "production") return;

  /**
   * POST /api/_test/seed-blog-brief
   * Creates a minimal editorial calendar + content_asset + content_brief
   * (blog_post format, with content_asset already linked) in the caller's
   * tenant/market context.
   *
   * The draft asset is given a stable public leadImageUrl so it appears in
   * the media picker's Asset Library grid (the picker filters to assets that
   * have leadImageUrl or fileUrl).
   *
   * Returns { briefId, assetId, calendarId, assetLeadImageUrl }.
   */
  app.post("/api/_test/seed-blog-brief", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const label: string = req.body?.label ?? "e2e-test";

      const calendarId = randomUUID();
      const assetId = randomUUID();
      const briefId = randomUUID();

      // A stable, always-accessible 1×1 pixel PNG data URL — no external
      // dependency and guaranteed to be served even in an offline test runner.
      const testLeadImageUrl =
        "https://picsum.photos/seed/e2etest/200/150";

      await db.insert(editorialCalendars).values({
        id: calendarId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId || null,
        name: `${label} — test calendar`,
        status: "active",
        createdBy: ctx.userId,
      });

      await db.insert(contentAssets).values({
        id: assetId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        title: `${label} — test asset`,
        content: "<p>E2E test blog post content.</p>",
        leadImageUrl: testLeadImageUrl,
        status: "active",
        createdBy: ctx.userId,
        assetType: "other",
        capturedViaExtension: false,
        isExternal: false,
      } as any);

      await db.insert(contentBriefs).values({
        id: briefId,
        calendarId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        title: `${label} — E2E Media Picker Test`,
        format: "blog_post",
        status: "approved",
        contentAssetId: assetId,
      } as any);

      res.json({ briefId, assetId, calendarId, assetLeadImageUrl: testLeadImageUrl });
    } catch (err: any) {
      console.error("[test-seed] error", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/_test/seed-blog-brief/:briefId
   * Removes the brief, its linked asset, and the test calendar created above.
   * Best-effort — always returns 200 so cleanup never fails a test.
   */
  app.delete("/api/_test/seed-blog-brief/:briefId", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const [brief] = await db
        .select()
        .from(contentBriefs)
        .where(
          and(
            eq(contentBriefs.id, req.params.briefId),
            eq(contentBriefs.tenantDomain, ctx.tenantDomain),
          ),
        );

      if (brief) {
        if (brief.contentAssetId) {
          await db
            .delete(contentAssets)
            .where(eq(contentAssets.id, brief.contentAssetId));
        }
        await db.delete(contentBriefs).where(eq(contentBriefs.id, brief.id));
        if (brief.calendarId) {
          await db
            .delete(editorialCalendars)
            .where(eq(editorialCalendars.id, brief.calendarId));
        }
      }

      res.json({ ok: true });
    } catch (err: any) {
      console.error("[test-cleanup] error", err);
      res.json({ ok: false, error: err.message });
    }
  });
}
