import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { brandAssets, conferenceImages, conferenceBackgrounds } from "@shared/schema";

const io = vi.hoisted(() => ({
  rows: [] as any[][], inserts: [] as any[], updates: [] as { table: any; patch: any; filter: any }[], filters: [] as any[],
}));
vi.mock("../../db", () => {
  const db: any = {
    select: () => ({ from: () => {
      const chain: any = { innerJoin: () => chain, where: (filter: any) => {
        io.filters.push(filter);
        const rows = Promise.resolve(io.rows.shift() || []);
        return Object.assign(rows, { limit: () => rows });
      } };
      return chain;
    } }),
    insert: (table: any) => ({ values: async (values: any) => { io.inserts.push({ table, values }); } }),
    update: (table: any) => ({ set: (patch: any) => ({ where: async (filter: any) => { io.updates.push({ table, patch, filter }); } }) }),
  };
  return { db };
});
import { db } from "../../db";
import { registerEventVisualAsset, syncEventVisualAsset, archiveEventAssetSelections, eventNamesForAssets, eventAssetFilter } from "../event-visual-assets";

const conf = { id: "event", name: "Webinar", tenantDomain: "tenant.example", marketId: "market", createdBy: "editor" };
const file = { fileUrl: "/public-objects/original.png", fileType: "image/png", fileSize: 100, name: "Original" };
const params = (sql: any) => new PgDialect().sqlToQuery(sql).params;
beforeEach(() => { io.rows = []; io.inserts = []; io.updates = []; io.filters = []; });

describe("shared event Visual Assets", () => {
  it("includes images tagged for future events in the general Event filter", () => {
    const query = new PgDialect().sqlToQuery(eventAssetFilter(conf.tenantDomain, conf.marketId, undefined, drizzle({} as any)));
    expect(query.sql).toContain(`'["Event"]'::jsonb`);
    expect(query.params).toEqual(expect.arrayContaining([conf.tenantDomain, conf.marketId]));
  });
  it("requires an actual association when filtering to one specific event", () => {
    const query = new PgDialect().sqlToQuery(eventAssetFilter(conf.tenantDomain, conf.marketId, conf.id, drizzle({} as any)));
    expect(query.sql).not.toContain(`'["Event"]'::jsonb`);
    expect(query.params).toEqual(expect.arrayContaining([conf.tenantDomain, conf.marketId, conf.id]));
  });
  it("registers the same file URL as a market-scoped image without moving bytes", async () => {
    const id = await registerEventVisualAsset(db, conf, file);
    expect(id).toBeTruthy();
    expect(io.inserts).toEqual([{ table: brandAssets, values: expect.objectContaining({
      ...file, id, marketId: "market", tenantDomain: "tenant.example", createdBy: "editor", assetType: "image",
      tags: { topics: ["Event"] },
    }) }]);
    expect(params(io.filters[0])).toEqual(expect.arrayContaining(["market", "tenant.example", file.fileUrl, "active"]));
  });
  it("reuses an existing canonical asset rather than registering duplicates", async () => {
    io.rows.push([{ id: "existing" }]);
    expect(await registerEventVisualAsset(db, conf, file)).toBe("existing");
    expect(io.inserts).toHaveLength(0);
    expect(io.updates).toHaveLength(1);
    expect(io.updates[0].table).toBe(brandAssets);
    expect(params(io.updates[0].filter)).toEqual(expect.arrayContaining(["existing", conf.tenantDomain]));
  });
  it("does not broaden a tenant-wide event into another market", async () => {
    await registerEventVisualAsset(db, { ...conf, marketId: null }, file);
    const query = new PgDialect().sqlToQuery(io.filters[0]);
    expect(query.sql).toContain('"market_id" is null');
    expect(io.inserts[0].values.marketId).toBeNull();
  });
  it("updates current image and background references without touching generated posts", async () => {
    io.rows.push([{ id: "source" }], [{ id: "background" }]);
    await syncEventVisualAsset(db, { ...file, id: "canonical", tenantDomain: conf.tenantDomain } as any);
    expect(io.updates.map(u => u.table)).toEqual([conferenceImages, conferenceBackgrounds, conferenceImages]);
    expect(io.updates[0].patch).toMatchObject({
      fileUrl: file.fileUrl, fileType: file.fileType, fileSize: file.fileSize, renderDirty: false, renderError: null,
    });
    expect(io.updates[0].patch.renderRevision).toBeTruthy();
    expect(io.updates[1].patch.fileUrl).toBe(file.fileUrl);
    expect(io.updates[2].patch.renderDirty).toBe(true);
    for (const update of io.updates) expect(params(update.filter)).toContain(conf.tenantDomain);
  });
  it("archives only event selections, retaining the reusable asset and historical file URLs", async () => {
    await archiveEventAssetSelections(db, "canonical", conf.tenantDomain);
    expect(io.updates[0]).toMatchObject({ table: conferenceImages, patch: { status: "archived" } });
    expect(io.updates[0].patch.fileUrl).toBeUndefined();
    expect(io.updates.every(u => u.table !== brandAssets)).toBe(true);
  });
  it("deduplicates event labels across pool and background references", async () => {
    io.rows.push([{ assetId: "shared", name: "Webinar" }], [
      { assetId: "shared", name: "Webinar" }, { assetId: "shared", name: "Summit" },
    ]);
    expect(await eventNamesForAssets(["shared"], conf.tenantDomain)).toEqual(new Map([["shared", ["Webinar", "Summit"]]]));
    for (const filter of io.filters) expect(params(filter)).toContain(conf.tenantDomain);
  });
  it("avoids unscoped queries for an empty page", async () => {
    expect(await eventNamesForAssets([], conf.tenantDomain)).toEqual(new Map());
    expect(io.filters).toHaveLength(0);
  });
});
