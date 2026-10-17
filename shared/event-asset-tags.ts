import type { BrandAsset } from "./schema";

export const EVENT_ASSET_TAG = "Event";

/** Keep user tags intact while normalizing the managed event classification. */
export function withEventAssetTag(tags: BrandAsset["tags"]): NonNullable<BrandAsset["tags"]> {
  return {
    ...tags,
    topics: [
      ...(tags?.topics ?? []).filter(topic => topic.toLowerCase() !== "event"),
      EVENT_ASSET_TAG,
    ],
  };
}
