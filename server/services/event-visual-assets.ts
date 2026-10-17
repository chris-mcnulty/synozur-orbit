import { randomUUID } from "crypto";
import { and, eq, isNull, inArray, or, sql } from "drizzle-orm";
import { brandAssets, conferences, conferenceImages, conferenceBackgrounds, type Conference } from "@shared/schema";
import { db } from "../db";
import { withEventAssetTag } from "@shared/event-asset-tags";

type AssetDb = Pick<typeof db, "select" | "insert" | "update">;
type EventScope = Pick<Conference, "id" | "name" | "tenantDomain" | "marketId" | "createdBy">;

/** Register one canonical library record; bytes and historical URLs stay put. */
export async function registerEventVisualAsset(
  tx: AssetDb,
  conf: EventScope,
  file: { fileUrl: string; fileType?: string | null; fileSize?: number | null; name?: string | null; createdBy?: string },
): Promise<string> {
  const [existing] = await tx.select({ id: brandAssets.id }).from(brandAssets).where(and(
    eq(brandAssets.tenantDomain, conf.tenantDomain),
    conf.marketId ? eq(brandAssets.marketId, conf.marketId) : isNull(brandAssets.marketId),
    eq(brandAssets.fileUrl, file.fileUrl),
    eq(brandAssets.status, "active"),
  )).limit(1);
  if (existing) {
    await tagEventVisualAsset(tx, existing.id, conf.tenantDomain);
    return existing.id;
  }
  const id = randomUUID();
  await tx.insert(brandAssets).values({
    id, tenantDomain: conf.tenantDomain, marketId: conf.marketId,
    name: file.name?.trim() || `${conf.name} — event image`,
    description: `Event image for ${conf.name}`,
    fileUrl: file.fileUrl, fileType: file.fileType || "image/png",
    fileSize: file.fileSize ?? null, assetType: "image", status: "active",
    tags: withEventAssetTag(null),
    createdBy: file.createdBy || conf.createdBy,
  });
  return id;
}

/** Atomic merge so linking an existing asset cannot overwrite another editor's tags. */
export async function tagEventVisualAsset(tx: AssetDb, assetId: string, tenantDomain: string) {
  await tx.update(brandAssets).set({
    tags: sql`jsonb_set(COALESCE(${brandAssets.tags}, '{}'::jsonb), '{topics}',
      COALESCE((SELECT jsonb_agg(topic) FROM jsonb_array_elements_text(
        COALESCE(${brandAssets.tags}->'topics', '[]'::jsonb)) AS topic
        WHERE lower(topic) <> 'event'), '[]'::jsonb) || '["Event"]'::jsonb)`,
    updatedAt: new Date(),
  }).where(and(eq(brandAssets.id, assetId), eq(brandAssets.tenantDomain, tenantDomain)));
}

/** Apply a canonical file replacement to event references, never published posts. */
export async function syncEventVisualAsset(
  tx: AssetDb,
  asset: typeof brandAssets.$inferSelect,
): Promise<void> {
  if (!asset.fileUrl) return;
  await tx.update(conferenceImages).set({
    fileUrl: asset.fileUrl, fileType: asset.fileType, fileSize: asset.fileSize,
    renderDirty: false, renderError: null, updatedAt: new Date(),
    renderRevision: sql`${conferenceImages.renderRevision} + 1`,
  }).where(and(eq(conferenceImages.brandAssetId, asset.id), eq(conferenceImages.tenantDomain, asset.tenantDomain)));
  await tx.update(conferenceBackgrounds).set({
    fileUrl: asset.fileUrl, fileType: asset.fileType, fileSize: asset.fileSize,
  }).where(and(eq(conferenceBackgrounds.brandAssetId, asset.id), eq(conferenceBackgrounds.tenantDomain, asset.tenantDomain)));
  await dirtyEventVisualAssetDependents(tx, asset.id, asset.tenantDomain);
}

export async function dirtyEventVisualAssetDependents(tx: AssetDb, assetId: string, tenantDomain: string) {
  const images = await tx.select({ id: conferenceImages.id }).from(conferenceImages)
    .where(and(eq(conferenceImages.brandAssetId, assetId), eq(conferenceImages.tenantDomain, tenantDomain)));
  const backgrounds = await tx.select({ id: conferenceBackgrounds.id }).from(conferenceBackgrounds)
    .where(and(eq(conferenceBackgrounds.brandAssetId, assetId), eq(conferenceBackgrounds.tenantDomain, tenantDomain)));
  await tx.update(conferenceImages).set({
    renderDirty: true, renderError: null, updatedAt: new Date(),
    renderRevision: sql`${conferenceImages.renderRevision} + 1`,
  }).where(and(eq(conferenceImages.tenantDomain, tenantDomain), or(
    eq(conferenceImages.templateAssetId, assetId),
    ...(images.length ? [inArray(conferenceImages.sourceImageId, images.map(i => i.id))] : []),
    ...(backgrounds.length ? [inArray(conferenceImages.backgroundId, backgrounds.map(i => i.id))] : []),
  )));
}

export async function archiveEventAssetSelections(tx: AssetDb, assetId: string, tenantDomain: string) {
  await tx.update(conferenceImages).set({
    status: "archived", archivedAt: new Date(), updatedAt: new Date(),
    renderRevision: sql`${conferenceImages.renderRevision} + 1`,
  }).where(and(eq(conferenceImages.brandAssetId, assetId), eq(conferenceImages.tenantDomain, tenantDomain)));
  await dirtyEventVisualAssetDependents(tx, assetId, tenantDomain);
}

/** Shared membership filter for paginated results and their total count. */
export function eventAssetFilter(
  tenantDomain: string,
  marketId: string | null,
  conferenceId?: string,
  queryDb: Pick<typeof db, "select"> = db,
) {
  const scope = and(eq(conferences.tenantDomain, tenantDomain),
    marketId ? eq(conferences.marketId, marketId) : isNull(conferences.marketId),
    conferenceId ? eq(conferences.id, conferenceId) : undefined);
  return or(
    inArray(brandAssets.id, queryDb.select({ id: conferenceImages.brandAssetId }).from(conferenceImages)
      .innerJoin(conferences, eq(conferenceImages.conferenceId, conferences.id)).where(and(scope,
        eq(conferenceImages.tenantDomain, tenantDomain)))),
    inArray(brandAssets.id, queryDb.select({ id: conferenceBackgrounds.brandAssetId }).from(conferenceBackgrounds)
      .innerJoin(conferences, eq(conferenceBackgrounds.conferenceId, conferences.id)).where(and(scope,
        eq(conferenceBackgrounds.tenantDomain, tenantDomain)))),
    // Include images classified for future events, even before an event selects
    // them. A specific event filter must still require an actual association.
    ...(!conferenceId ? [sql`COALESCE(${brandAssets.tags}->'topics', '[]'::jsonb) @> '["Event"]'::jsonb`] : []),
  )!;
}

export async function eventNamesForAssets(ids: string[], tenantDomain: string, queryDb: Pick<typeof db, "select"> = db): Promise<Map<string, string[]>> {
  const names = new Map<string, string[]>();
  if (!ids.length) return names;
  const [images, backgrounds] = await Promise.all([
    queryDb.select({ assetId: conferenceImages.brandAssetId, name: conferences.name }).from(conferenceImages)
      .innerJoin(conferences, eq(conferenceImages.conferenceId, conferences.id))
      .where(and(inArray(conferenceImages.brandAssetId, ids),
        eq(conferenceImages.tenantDomain, tenantDomain), eq(conferences.tenantDomain, tenantDomain))),
    queryDb.select({ assetId: conferenceBackgrounds.brandAssetId, name: conferences.name }).from(conferenceBackgrounds)
      .innerJoin(conferences, eq(conferenceBackgrounds.conferenceId, conferences.id))
      .where(and(inArray(conferenceBackgrounds.brandAssetId, ids),
        eq(conferenceBackgrounds.tenantDomain, tenantDomain), eq(conferences.tenantDomain, tenantDomain))),
  ]);
  for (const row of [...images, ...backgrounds]) {
    if (!row.assetId) continue;
    const values = names.get(row.assetId) || [];
    if (!values.includes(row.name)) values.push(row.name);
    names.set(row.assetId, values);
  }
  return names;
}
