import { describe, it, expect } from "vitest";
import { buildAreas, getActiveAreaId } from "./areaNavigation";

describe("buildAreas — top-nav inHeader flags", () => {
  const areas = buildAreas({ isEnterprise: true, isAdminUser: true, isGlobalAdmin: true });
  const byId = Object.fromEntries(areas.map((a) => [a.id, a]));

  const TOP_NAV_AREAS = ["research", "product", "marketing", "sales"] as const;

  for (const id of TOP_NAV_AREAS) {
    it(`${id} area has inHeader: true`, () => {
      expect(byId[id], `area "${id}" is missing from buildAreas output`).toBeDefined();
      expect(byId[id].inHeader).toBe(true);
    });
  }

  it("home area has inHeader: true — it must be a constant nav anchor (sessions resume on the last screen, so Home is otherwise never seen)", () => {
    expect(byId["home"].inHeader).toBe(true);
  });

  it("settings area has inHeader: false (sanity check)", () => {
    expect(byId["settings"].inHeader).toBe(false);
  });

  it("keeps both workspace settings and social accounts reachable from the settings area", () => {
    expect(byId["settings"].items.map((item) => item.href)).toContain("/app/settings");
    expect(byId["settings"].items.map((item) => item.href)).toContain("/app/marketing/social-accounts");
  });

  it.each([
    ["/app/settings", "settings"],
    ["/app/settings/integrations", "settings"],
    ["/app/marketing/social-accounts", "settings"],
  ] as const)("classifies %s under the settings area", (path, area) => {
    expect(getActiveAreaId(path)).toBe(area);
  });
});
