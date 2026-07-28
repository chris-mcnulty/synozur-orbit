import { describe, it, expect } from "vitest";
import { buildRelaxationTiers } from "./apollo-discovery-provider";

describe("buildRelaxationTiers", () => {
  const fullBody = {
    page: 1,
    per_page: 25,
    person_titles: ["CTO", "CIO"],
    person_locations: ["Seattle, Washington"],
    organization_num_employees_ranges: ["51,200"],
    q_organization_keyword_tags: ["fintech"],
    q_keywords: "wealth management",
  };

  it("builds three cumulative tiers from a fully-filtered body", () => {
    const tiers = buildRelaxationTiers(fullBody);
    expect(tiers).toHaveLength(3);

    // Tier 1: size dropped, everything else intact.
    expect(tiers[0].body.organization_num_employees_ranges).toBeUndefined();
    expect(tiers[0].body.q_organization_keyword_tags).toEqual(["fintech"]);
    expect(tiers[0].body.person_titles).toEqual(["CTO", "CIO"]);

    // Tier 2: size AND industry dropped.
    expect(tiers[1].body.q_organization_keyword_tags).toBeUndefined();
    expect(tiers[1].body.q_keywords).toBeUndefined();
    expect(tiers[1].body.person_titles).toEqual(["CTO", "CIO"]);

    // Tier 3: titles replaced with seniorities; location always kept.
    expect(tiers[2].body.person_titles).toBeUndefined();
    expect(tiers[2].body.person_seniorities).toContain("c_suite");
    expect(tiers[2].body.person_locations).toEqual(["Seattle, Washington"]);
  });

  it("skips tiers that have nothing to relax", () => {
    const tiers = buildRelaxationTiers({ page: 1, per_page: 25, person_titles: ["CTO"] });
    expect(tiers).toHaveLength(1);
    expect(tiers[0].body.person_seniorities).toBeDefined();
  });

  it("returns no tiers when there is nothing to relax", () => {
    expect(buildRelaxationTiers({ page: 1, per_page: 25 })).toHaveLength(0);
  });

  it("never mutates the base body", () => {
    const body = { ...fullBody };
    buildRelaxationTiers(body);
    expect(body).toEqual(fullBody);
  });

  it("labels each tier for the UI", () => {
    const tiers = buildRelaxationTiers(fullBody);
    for (const t of tiers) expect(t.label.length).toBeGreaterThan(5);
  });
});
