import { describe, it, expect } from "vitest";
import { expandCriteriaStatic } from "./discovery-intent-expansion";
import type { IcpCriteria } from "./prospector-core";

function criteria(partial: Partial<IcpCriteria>): IcpCriteria {
  return {
    roles: [],
    industries: [],
    geographies: [],
    segments: [],
    namedAccounts: [],
    disqualifiers: [],
    ...partial,
  } as IcpCriteria;
}

describe("expandCriteriaStatic", () => {
  it("expands a metro city into its surrounding suburbs", () => {
    const result = expandCriteriaStatic(criteria({ geographies: ["Seattle, Washington"] }));
    expect(result.detail.method).toBe("static");
    expect(result.criteria.geographies).toContain("Seattle, Washington");
    expect(result.criteria.geographies).toContain("Bellevue, Washington");
    expect(result.detail.addedGeographies).toContain("Redmond, Washington");
    // originals preserved first
    expect(result.criteria.geographies?.[0]).toBe("Seattle, Washington");
  });

  it("matches metro names case-insensitively and inside longer strings", () => {
    const result = expandCriteriaStatic(criteria({ geographies: ["Greater SEATTLE area"] }));
    expect(result.detail.addedGeographies.length).toBeGreaterThan(0);
  });

  it("expands fintech into adjacent financial verticals", () => {
    const result = expandCriteriaStatic(criteria({ industries: ["Fintech"] }));
    expect(result.criteria.industries).toContain("banking");
    expect(result.criteria.industries).toContain("insurance");
    expect(result.detail.addedIndustries).toContain("credit union");
  });

  it("expands CTO into common variant titles", () => {
    const result = expandCriteriaStatic(criteria({ roles: ["CTO"] }));
    expect(result.criteria.roles).toContain("CIO");
    expect(result.detail.addedRoles).toContain("VP Engineering");
  });

  it("does not duplicate items already present", () => {
    const result = expandCriteriaStatic(
      criteria({ industries: ["fintech", "banking"] }),
    );
    const lower = result.criteria.industries!.map((i) => i.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });

  it("caps each list at 10 entries (Apollo per-filter limit)", () => {
    const result = expandCriteriaStatic(
      criteria({ geographies: ["Seattle", "San Francisco", "New York", "Boston"] }),
    );
    expect(result.criteria.geographies!.length).toBeLessThanOrEqual(10);
  });

  it("returns method 'none' when nothing matches the tables", () => {
    const result = expandCriteriaStatic(
      criteria({ geographies: ["Ulaanbaatar"], industries: ["yak herding"], roles: ["Chief Yak Officer"] }),
    );
    expect(result.detail.method).toBe("none");
    expect(result.criteria.geographies).toEqual(["Ulaanbaatar"]);
  });
});
