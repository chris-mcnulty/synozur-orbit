import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { archiveEventPoolImage } from "../../../client/src/lib/conference-image-pool";

const io = vi.hoisted(() => ({
  rows: [] as any[][], filters: [] as any[], patches: [] as any[], inserts: [] as any[],
  render: vi.fn(), publish: vi.fn(), onUpdate: vi.fn(),
  conf: { id: "event", tenantDomain: "tenant.example", marketId: "market", status: "active" },
  image: { id: "image", conferenceId: "event", tenantDomain: "tenant.example", role: "anchor", status: "active",
    source: "logo_composite", fileUrl: "/public-objects/last.png", renderDirty: false, renderError: null,
    renderRevision: 0, templateAssetId: null, backgroundId: null, sourceImageId: null,
    overlayHeadline: null, overlaySupportingText: null },
}));
vi.mock("../../db", () => {
  const db: any = {
    select: () => ({ from: () => ({ where: (filter: any) => {
      io.filters.push(filter);
      const rows = io.rows.shift() ?? [];
      return Object.assign(Promise.resolve(rows), { orderBy: () => Promise.resolve(rows), limit: () => Promise.resolve(rows) });
    } }) }),
    update: () => ({ set: (patch: any) => {
      io.patches.push(patch);
      return { where: (filter: any) => {
        io.filters.push(filter);
        io.onUpdate(patch);
        const updated = { ...io.image, ...patch };
        return Object.assign(Promise.resolve({ rowCount: 1 }), { returning: async () => [updated] });
      } };
    } }),
    insert: () => ({ values: (values: any) => {
      io.inserts.push(values);
      return { returning: async () => [{ ...io.image, ...values }] };
    } }),
    execute: vi.fn(),
    transaction: async (fn: any) => fn(db),
  };
  return { db };
});
vi.mock("../../context", () => ({ getRequestContext: async () =>
  ({ tenantDomain: "tenant.example", marketId: "market", userId: "editor" }) }));
vi.mock("../../routes/helpers", () => ({ guardFeature: async () => true, guardManualAction: async () => true }));
vi.mock("../job-queue", () => ({ enqueue: vi.fn() }));
vi.mock("../conference-promotion-service", async importOriginal => {
  const real = await importOriginal<typeof import("../conference-promotion-service")>();
  return { ...real, renderConferenceImage: io.render, publishConferenceSource: io.publish };
});
import { registerConferencePromotionRoutes } from "../../routes/conference-promotion";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).session = { imageUploadGrants: [{ path: "/objects/uploads/mine", tenantDomain: "tenant.example",
    marketId: "market", issuedAt: Date.now() }] };
  next();
});
registerConferencePromotionRoutes(app);
const params = () => io.filters.flatMap(f => new PgDialect().sqlToQuery(f).params);

describe("event image pool API", () => {
  beforeEach(() => {
    io.rows.length = io.filters.length = io.patches.length = io.inserts.length = 0;
    vi.clearAllMocks();
    io.onUpdate.mockReset();
    io.render.mockResolvedValue("/public-objects/new.png");
    io.publish.mockResolvedValue({ fileUrl: "/public-objects/copied.png", fileSize: 123 });
  });

  it.each(["reject", "unapprove", "approve", "csv_only"])(
    "protects published history and in-flight sends during bulk %s",
    async action => {
      io.rows.push([io.conf]);
      const response = await request(app).post("/api/conferences/event/posts/approve").send({
        action, postIds: ["post"],
      });
      expect(response.status).toBe(200);
      const query = new PgDialect().sqlToQuery(io.filters.at(-1));
      expect(query.params).toEqual(expect.arrayContaining(["event", "tenant.example", "posted", "published", "post"]));
      expect(query.sql).toContain('"published_at" is null');
      expect(query.sql).toContain('"publish_claim_token" is null');
    },
  );

  it("does not return CSV posts to automatic delivery when approving or resetting drafts", async () => {
    for (const action of ["approve", "unapprove", "unreject"]) {
      io.rows.push([io.conf]);
      const response = await request(app).post("/api/conferences/event/posts/approve").send({ action, postIds: ["csv-post"] });
      expect(response.status).toBe(200);
      expect(io.patches.at(-1)).not.toHaveProperty("deliveryMode");
    }
  });

  it("approves CSV-only posts for export without enabling automatic sending", async () => {
    io.rows.push([io.conf]);
    const response = await request(app).post("/api/conferences/event/posts/approve").send({ action: "csv_only", postIds: ["draft"] });
    expect(response.status).toBe(200);
    expect(io.patches.at(-1)).toMatchObject({ status: "approved", deliveryMode: "csv" });
  });

  it("retains a Brand Library selection through anchor normalization and reload", async () => {
    const asset = { id: "brand", fileUrl: "/public-objects/brand.png", fileType: "image/png", marketId: "market" };
    io.rows.push([io.conf], [asset], [asset], [{ n: 4 }]);
    const response = await request(app).post("/api/conferences/event/images").send({
      role: "anchor", source: "template_composite", templateAssetId: "brand",
      overlayHeadline: "Main webinar", overlaySupportingText: "Online · Register today",
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ source: "logo_composite", templateAssetId: "brand",
      overlayHeadline: "Main webinar", overlaySupportingText: "Online · Register today", renderDirty: true });
    io.rows.push([io.conf], [], [response.body]);
    const reload = await request(app).get("/api/conferences/event");
    expect(reload.body.images[0]).toMatchObject({ templateAssetId: "brand", overlayHeadline: "Main webinar" });
  });

  it("enforces 20 active anchors server-side, not a three-slot ceiling", async () => {
    io.rows.push([io.conf], [{ n: 20 }]);
    const response = await request(app).post("/api/conferences/event/images").send({ role: "anchor" });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("pool_limit");
    expect(io.inserts).toHaveLength(0);
  });

  it("selects an existing Visual Asset as an original without uploading or copying it", async () => {
    const asset = { id: "library-image", fileUrl: "/public-objects/library.png", fileType: "image/png", fileSize: 15 };
    io.rows.push([io.conf], [asset], [{ n: 0 }]);
    const response = await request(app).post("/api/conferences/event/images").send({
      role: "anchor", source: "uploaded", brandAssetId: asset.id,
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ brandAssetId: asset.id, fileUrl: asset.fileUrl, renderDirty: false });
    expect(io.publish).not.toHaveBeenCalled();
    expect(io.inserts).toHaveLength(1);
    expect(io.patches.some(patch => patch.tags)).toBe(true);
    expect(params()).toEqual(expect.arrayContaining(["tenant.example", "market", "active", asset.id]));
  });

  it("rejects a missing, archived, or foreign-market Visual Asset without falling back", async () => {
    io.rows.push([io.conf], []);
    const response = await request(app).post("/api/conferences/event/images").send({
      role: "anchor", source: "uploaded", brandAssetId: "foreign",
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("source_invalid");
    expect(io.inserts).toHaveLength(0);
    expect(io.publish).not.toHaveBeenCalled();
  });

  it("rejects non-image library files", async () => {
    io.rows.push([io.conf], [{ id: "pdf", fileUrl: "/objects/report.pdf", fileType: "application/pdf" }]);
    const response = await request(app).post("/api/conferences/event/images").send({
      role: "anchor", source: "uploaded", brandAssetId: "pdf",
    });
    expect(response.status).toBe(400);
    expect(io.inserts).toHaveLength(0);
  });

  it("rejects ambiguous library-plus-upload requests", async () => {
    io.rows.push([io.conf]);
    const response = await request(app).post("/api/conferences/event/images").send({
      role: "anchor", source: "uploaded", brandAssetId: "library", fileUrl: "/objects/uploads/mine",
    });
    expect(response.status).toBe(400);
    expect(io.publish).not.toHaveBeenCalled();
    expect(io.inserts).toHaveLength(0);
  });

  it("replaces a pool original with a library image while retaining its event-image identity", async () => {
    const original = { ...io.image, source: "uploaded" };
    const asset = { id: "replacement", fileUrl: "/public-objects/replacement.png", fileType: "image/png", fileSize: 50 };
    io.rows.push([original], [io.conf], [asset]);
    const response = await request(app).patch("/api/conference-images/image").send({
      source: "uploaded", brandAssetId: asset.id, fileUrl: null,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: "image", brandAssetId: asset.id });
    expect(io.patches).toContainEqual(expect.objectContaining({ fileUrl: asset.fileUrl, renderDirty: false }));
    expect(io.publish).not.toHaveBeenCalled();
  });

  it("creates a distinct variant without replacing its original", async () => {
    io.rows.push([io.conf], [io.image], [{ n: 1 }]);
    const response = await request(app).post("/api/conferences/event/images").send({
      role: "anchor", sourceImageId: io.image.id, overlayHeadline: "Another headline",
    });
    expect(response.status).toBe(201);
    expect(response.body.id).not.toBe(io.image.id);
    expect(response.body.sourceImageId).toBe(io.image.id);
    expect(response.body.fileUrl).toBeNull();
    expect(io.patches).toHaveLength(0);
  });

  it("saves overlays while retaining the last successful output but marking it stale", async () => {
    io.rows.push([io.image], [io.conf]);
    const response = await request(app).patch("/api/conference-images/image").send({
      overlayHeadline: "Updated webinar title", overlaySupportingText: "Online, October 23",
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ fileUrl: io.image.fileUrl, renderDirty: true, renderRevision: 1,
      overlayHeadline: "Updated webinar title" });
    expect(io.patches[0]).not.toHaveProperty("fileUrl");
  });

  it("returns safe actionable font errors without erasing a previous render", async () => {
    io.rows.push([io.image], [io.conf]);
    io.render.mockRejectedValue(new Error('Configured brand font "private-storage-token" cannot render missing glyph'));
    const response = await request(app).post("/api/conference-images/image/render");
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("brand_font_invalid");
    expect(response.body.error).not.toContain("private-storage-token");
    expect(io.patches[0]).toMatchObject({ renderDirty: true });
    expect(io.patches[0]).not.toHaveProperty("fileUrl");
  });

  it.each(["/render", "/archive", ""])("requires the event's active market for image mutation %s", async suffix => {
    io.rows.push([io.image], []);
    const method = suffix ? "post" : "patch";
    const response = await request(app)[method](`/api/conference-images/image${suffix}`).send({ name: "foreign" });
    expect(response.status).toBe(404);
    expect(params()).toContain("market");
    expect(params()).toContain("tenant.example");
    expect(io.patches).toHaveLength(0);
    expect(io.render).not.toHaveBeenCalled();
  });

  it("rejects foreign-market and unusable Brand Library assets", async () => {
    io.rows.push([io.conf], [{ fileUrl: "/public-objects/x.png", fileType: "image/png", marketId: "foreign" }]);
    const response = await request(app).post("/api/conferences/event/images").send({ templateAssetId: "foreign" });
    expect(response.status).toBe(400);
    expect(io.inserts).toHaveLength(0);
  });

  it("publishes an editor-owned upload before storing it as a ready pool image", async () => {
    io.rows.push([io.conf], [{ n: 0 }]);
    const response = await request(app).post("/api/conferences/event/images").send({
      role: "anchor", source: "uploaded", fileUrl: "/objects/uploads/mine",
    });
    expect(response.status).toBe(201);
    expect(io.publish).toHaveBeenCalledWith("/objects/uploads/mine");
    expect(io.inserts).toContainEqual(expect.objectContaining({
      assetType: "image", tenantDomain: "tenant.example", marketId: "market",
      fileUrl: "/public-objects/copied.png",
    }));
    expect(response.body).toMatchObject({ fileUrl: "/public-objects/copied.png", renderDirty: false, fileType: "image/png" });
  });

  it.each(["/objects/uploads/foreign", "https://elsewhere.example/public-objects/foreign.png",
    "https://storage.googleapis.com/bucket/private.png", "/public-objects/../secret"])("rejects an unowned internal reference %s", async url => {
    io.rows.push([io.conf], [], []);
    const response = await request(app).post("/api/conferences/event/images").send({ source: "uploaded", fileUrl: url });
    expect(response.status).toBe(400);
    expect(io.publish).not.toHaveBeenCalled();
    expect(io.inserts).toHaveLength(0);
  });

  it("does not retain an inaccessible external link as a successful social image", async () => {
    const { ConferenceGraphicError } = await import("../conference-promotion-service");
    io.rows.push([io.conf]);
    io.publish.mockRejectedValue(new ConferenceGraphicError("source_invalid", "Selected image is inaccessible. Upload a valid image."));
    const response = await request(app).post("/api/conferences/event/images").send({
      source: "uploaded", fileUrl: "https://cdn.example/image.png",
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("source_invalid");
    expect(io.inserts).toHaveLength(0);
  });

  it("rejects unbounded overlay strings", async () => {
    io.rows.push([io.conf]);
    const response = await request(app).post("/api/conferences/event/images").send({ overlayHeadline: "x".repeat(181) });
    expect(response.body.code).toBe("overlay_invalid");
    expect(io.inserts).toHaveLength(0);
  });

  it("does not silently clear a removed selection on an overlay save", async () => {
    io.rows.push([{ ...io.image, sourceRequired: true }], [io.conf]);
    const response = await request(app).patch("/api/conference-images/image").send({
      templateAssetId: null, backgroundId: null, sourceImageId: null, overlayHeadline: "New headline",
    });
    expect(response.status).toBe(200);
    expect(response.body.sourceRequired).toBe(true);
    io.rows.push([{ ...io.image, sourceRequired: true }], [io.conf]);
    const explicit = await request(app).patch("/api/conference-images/image").send({
      templateAssetId: null, backgroundId: null, sourceImageId: null, useBrandBackground: true,
    });
    expect(explicit.body.sourceRequired).toBe(false);
  });

  it("the editor Archive action removes an image from a full active pool and frees a slot", async () => {
    const pool = Array.from({ length: 20 }, (_, i) => ({ ...io.image, id: `image-${i}` }));
    io.onUpdate.mockImplementation(patch => Object.assign(pool[0], patch));
    io.rows.push([pool[0]], [io.conf]);
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      // Exercise the exact client action against the real Express handler.
      const response = await request(app).post(String(input)).send(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(response.body), { status: response.status });
    });
    try {
      await archiveEventPoolImage(pool[0].id);
      expect(fetch).toHaveBeenCalledWith("/api/conference-images/image-0/archive",
        expect.objectContaining({ method: "POST", body: '{"archived":true}' }));
      expect(pool[0].status).toBe("archived");
      const active = pool.filter(image => image.status === "active");
      io.rows.push([io.conf], active);
      const reload = await request(app).get("/api/conferences/event/images");
      expect(reload.body).toHaveLength(19);
      expect(reload.body.some((image: any) => image.id === pool[0].id)).toBe(false);
      io.rows.push([io.conf], [{ n: active.length }]);
      const added = await request(app).post("/api/conferences/event/images").send({ role: "anchor" });
      expect(added.status).toBe(201);
      expect([...active, added.body]).toHaveLength(20);
    } finally {
      fetch.mockRestore();
    }
  });
});
