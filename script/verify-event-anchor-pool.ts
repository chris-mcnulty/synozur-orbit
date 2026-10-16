/**
 * Development-only production-bundle smoke check.
 * Bundle as CJS with NODE_ENV="production" (same as script/build.ts), then run
 * with --development-fixtures. Uses isolated disposable rows, real Sharp/fonts,
 * real object storage, and the actual anonymous /public-objects HTTP handler.
 * Never run against production. Does not generate copy or publish social posts.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db, pool, crawlPool } from "../server/db";
import { users, tenants, markets, brandAssets, conferences, conferenceImages, conferenceBackgrounds } from "../shared/schema";
import { saveConferenceImageBuffer, renderConferenceImage } from "../server/services/conference-promotion-service";
import { ObjectStorageService } from "../server/replit_integrations/object_storage/objectStorage";
import { registerObjectStorageRoutes } from "../server/replit_integrations/object_storage/routes";

async function main() {
  if (!process.argv.includes("--development-fixtures") || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("This verification requires --development-fixtures in a development workspace, never a deployment.");
  }
  const id = randomUUID();
  const domain = `anchor-verification-${id}.invalid`;
  const stored: string[] = [];
  const storage = new ObjectStorageService();
  const app = express();
  registerObjectStorageRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const publicCheck = async (url: string) => {
    // A local ephemeral harness, not a second application workflow.
    const response = await fetch(`http://127.0.0.1:${address.port}${url}`);
    assert.equal(response.status, 200, "anonymous public image retrieval");
    assert.match(response.headers.get("content-type") || "", /image\/png/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal((await sharp(bytes).metadata()).format, "png");
    return bytes;
  };
  const save = async (bytes: Buffer, type = "image/png", ext = "png") => {
    const result = await saveConferenceImageBuffer(bytes, type, ext);
    stored.push(result.fileUrl);
    return result.fileUrl;
  };
  let userId: string | undefined;
  let tenantId: string | undefined;
  let marketId: string | undefined;
  let conferenceId: string | undefined;
  try {
    const photo = await sharp({ create: { width: 1200, height: 675, channels: 3, background: "#196080" } }).png().toBuffer();
    const sourceUrl = await save(photo);
    const logoUrl = await save(await readFile("server/services/__tests__/fixtures/conference-company-logo.svg"), "image/svg+xml", "svg");
    const fontUrl = await save(await readFile("client/public/fonts/MetroNovaBold.ttf"), "font/ttf", "ttf");
    const [user] = await db.insert(users).values({
      email: `check@${domain}`, password: randomUUID(), name: "Disposable verification",
      company: "Disposable verification", role: "Domain Admin", avatar: "",
    }).returning();
    userId = user.id;
    const [tenant] = await db.insert(tenants).values({ domain, name: "Disposable verification",
      logoUrl, primaryColor: "#2468AC" }).returning();
    tenantId = tenant.id;
    const [market] = await db.insert(markets).values({ tenantId, name: "Disposable verification", createdBy: userId }).returning();
    marketId = market.id;
    const [asset] = await db.insert(brandAssets).values({
      tenantDomain: domain, marketId, name: "Preloaded verification photo", fileUrl: sourceUrl,
      fileType: "image/png", createdBy: userId,
    }).returning();
    await db.insert(brandAssets).values({
      tenantDomain: domain, marketId, name: "Verification heading font", fileUrl: fontUrl,
      fileType: "font/ttf", assetType: "font", fontFamily: "Metro Nova", fontUsage: "heading", createdBy: userId,
    });
    const [conf] = await db.insert(conferences).values({
      tenantDomain: domain, marketId, name: "Collaboration Webinar", location: "Online",
      website: "https://example.com/register", createdBy: userId,
    }).returning();
    conferenceId = conf.id;
    const [background] = await db.insert(conferenceBackgrounds).values({
      conferenceId, tenantDomain: domain, name: "Preloaded verification background", fileUrl: sourceUrl,
    }).returning();
    const outputs: string[] = [];
    for (const selected of [{ templateAssetId: asset.id }, { backgroundId: background.id }]) {
      const [image] = await db.insert(conferenceImages).values({
        conferenceId, tenantDomain: domain, role: "anchor", source: "logo_composite",
        overlayHeadline: "Register for Collaboration Webinar", overlaySupportingText: "Online · Practical techniques",
        renderDirty: true, sourceRequired: true, createdBy: userId, ...selected,
      }).returning();
      const url = await renderConferenceImage(image, conf);
      assert.ok(url);
      stored.push(url);
      outputs.push(url);
      assert.notDeepEqual(await publicCheck(url), photo);
      const [reloaded] = await db.select().from(conferenceImages).where(eq(conferenceImages.id, image.id));
      assert.equal(reloaded.fileUrl, url);
      assert.equal(reloaded.renderDirty, false);
      assert.equal(reloaded.overlayHeadline, image.overlayHeadline);
      assert.equal(reloaded.templateAssetId, image.templateAssetId);
      assert.equal(reloaded.backgroundId, image.backgroundId);
      const broken = { ...reloaded, renderDirty: true, templateAssetId: "unavailable", backgroundId: null };
      await assert.rejects(renderConferenceImage(broken, conf), /not available/);
      const [afterFailure] = await db.select().from(conferenceImages).where(eq(conferenceImages.id, image.id));
      assert.equal(afterFailure.fileUrl, url);
    }
    assert.equal(outputs.length, 2);
    assert.equal((await publicCheck(sourceUrl)).equals(photo), true, "original retained");
    console.log("PASS: production CJS build rendered preloaded Brand Library and event background webinar anchors without event logo; saved overlays/reload, failure recovery, originals and anonymous public PNG retrieval verified.");
  } finally {
    if (conferenceId) await db.delete(conferences).where(eq(conferences.id, conferenceId));
    await db.delete(brandAssets).where(eq(brandAssets.tenantDomain, domain));
    if (marketId) await db.delete(markets).where(eq(markets.id, marketId));
    if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    for (const url of stored) {
      const file = await storage.searchPublicObject(url.replace("/public-objects/", ""));
      if (file) await file.delete();
    }
    server.close();
    await pool.end();
    await crawlPool.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
