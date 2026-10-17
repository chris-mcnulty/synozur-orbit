import { describe, expect, it } from "vitest";
import { withEventAssetTag } from "@shared/event-asset-tags";

describe("managed event asset tag", () => {
  it("tags newly registered event images", () => {
    expect(withEventAssetTag(null)).toEqual({ topics: ["Event"] });
  });
  it("retains all unrelated tags", () => {
    expect(withEventAssetTag({ topics: ["Leadership"], seasons: ["Autumn"], locations: ["Seattle"] }))
      .toEqual({ topics: ["Leadership", "Event"], seasons: ["Autumn"], locations: ["Seattle"] });
  });
  it("normalizes the classification without accumulating duplicates", () => {
    expect(withEventAssetTag({ topics: ["event", "Launch", "Event"] })).toEqual({ topics: ["Launch", "Event"] });
    const once = withEventAssetTag({ topics: ["Launch"] });
    expect(withEventAssetTag(once)).toEqual(once);
  });
});
