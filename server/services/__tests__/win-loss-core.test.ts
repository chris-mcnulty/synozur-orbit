import { describe, expect, it } from "vitest";
import { outcomeInput, summarizeOutcomes, type OutcomeInput } from "@shared/win-loss";
import { assertImportDecision, canEditOutcomes, filterOutcomes, filterSchema, validateThemes } from "../win-loss-core";

const deal = (patch: Partial<OutcomeInput> = {}): OutcomeInput => ({
  dealLabel: "A deal", outcome: "won", closeDate: "2026-11-21", amount: null, currency: null,
  segment: null, competitorId: null, competitorConfirmed: false, reasonCodes: [], notes: "", ...patch,
});
describe("win/loss records and arithmetic", () => {
  it("allows manual records with explicitly unknown optional data", () => {
    expect(outcomeInput.parse(deal())).toEqual(deal());
  });
  it.each([{ closeDate: "2026-02-30" }, { amount: "-1" }, { amount: "NaN" }, { currency: "dollars" },
    { reasonCodes: ["invented"] }, { competitorId: "competitor", competitorConfirmed: false }, { tenantDomain: "forged" }])("rejects invalid or forged fields %j", patch => {
    expect(outcomeInput.safeParse({ ...deal(), ...patch }).success).toBe(false);
  });
  it("excludes no-decision from the win-rate denominator, not the sample", () => {
    const s = summarizeOutcomes([deal(), deal({ outcome: "lost" }), deal({ outcome: "no_decision" })]);
    expect(s).toMatchObject({ total: 3, won: 1, lost: 1, noDecision: 1, denominator: 2, winRate: 0.5 });
    expect(s.coverage).toMatchObject({ missingReasons: 3, missingAmount: 3, missingCompetitor: 3 });
  });
  it("returns no rate for empty/no-decision-only samples", () => {
    expect(summarizeOutcomes([]).winRate).toBeNull();
    expect(summarizeOutcomes([deal({ outcome: "no_decision" })]).winRate).toBeNull();
  });
  it("keeps currencies separate, preserves zeros and exact decimals; missing currency is never assumed USD", () => {
    const s = summarizeOutcomes([deal({ amount: "0.1", currency: "USD" }), deal({ amount: "0.2", currency: "USD" }),
      deal({ amount: "0", currency: "EUR", outcome: "lost" }), deal({ amount: "200", currency: null }),
      deal({ amount: "9", currency: "USD", outcome: "no_decision" })]);
    expect(s.currencies.USD).toEqual({ count: 3, won: "0.3", lost: "0", noDecision: "9", total: "9.3" });
    expect(s.currencies.EUR).toEqual({ count: 1, won: "0", lost: "0", noDecision: "0", total: "0" });
    expect(s.coverage.missingCurrency).toBe(1);
  });
  it("does not round large amount totals", () => {
    const s = summarizeOutcomes([deal({ amount: "999999999999.9999", currency: "USD" }), deal({ amount: "999999999999.9999", currency: "USD" })]);
    expect(s.currencies.USD.total).toBe("1999999999999.9998");
  });
  it("reports competitor and segment denominators including unknown groups", () => {
    const s = summarizeOutcomes([deal({ competitorId: "c", competitorConfirmed: true, segment: "SMB" }),
      deal({ competitorId: "c", competitorConfirmed: true, segment: "SMB", outcome: "lost" }), deal({ outcome: "no_decision" })]);
    expect(s.competitors.find(c => c.name === "c")).toMatchObject({ total: 2, denominator: 2, winRate: 0.5 });
    expect(s.segments.find(c => c.name === "Unknown")).toMatchObject({ total: 1, denominator: 0, noDecision: 1 });
  });
  it("uses inclusive close dates and explicitly excludes undated data only when date-scoped", () => {
    const rows = [deal(), deal({ closeDate: null }), deal({ closeDate: "2026-11-20" })];
    expect(filterOutcomes(rows, {}).length).toBe(3);
    expect(filterOutcomes(rows, { from: "2026-11-21", to: "2026-11-21" })).toEqual([rows[0]]);
    expect(filterSchema.safeParse({ from: "2026-11-22", to: "2026-11-21" }).success).toBe(false);
    expect(filterSchema.safeParse({ from: "2026-13-01" }).success).toBe(false);
  });
  it("combines competitor, segment, currency and outcome filters", () => {
    expect(filterOutcomes([deal({ competitorId: "c", competitorConfirmed: true, segment: "S", currency: "USD" }), deal()],
      { competitorId: "c", segment: "S", currency: "USD", outcome: "won" })).toHaveLength(1);
  });
});
describe("review boundaries", () => {
  it.each(["Analyst", "Domain Admin", "Global Admin"])("permits editor %s", role => expect(canEditOutcomes(role)).toBe(true));
  it.each(["Standard User", "Consultant", "unknown"])("denies mutation for %s", role => expect(canEditOutcomes(role)).toBe(false));
  it("requires reviewed replacement and exact version to protect manual corrections", () => {
    expect(() => assertImportDecision({ version: 2 }, { reviewed: true, replace: false, expectedVersion: 2 })).toThrow(/already exists/);
    expect(() => assertImportDecision({ version: 3 }, { reviewed: true, replace: true, expectedVersion: 2 })).toThrow(/changed/);
    expect(() => assertImportDecision({ version: 2 }, { reviewed: true, replace: true, expectedVersion: 2 })).not.toThrow();
    expect(() => assertImportDecision(undefined, { reviewed: true, replace: false, expectedVersion: null })).not.toThrow();
    expect(() => assertImportDecision(undefined, { reviewed: true, replace: true, expectedVersion: 2 })).toThrow(/deleted/);
    expect(() => assertImportDecision(undefined, { reviewed: false, replace: false, expectedVersion: null })).toThrow(/Review/);
  });
  it("rejects invented AI citations and empty unreviewable battlecard changes", () => {
    const evidence = [{ ...deal(), id: "real" }];
    expect(() => validateThemes({ themes: [{ title: "T", summary: "S", evidenceIds: ["fake"] }] }, evidence, false)).toThrow(/citation/);
    expect(() => validateThemes({ themes: [{ title: "T", summary: "S", evidenceIds: ["real"] }] }, evidence, true)).toThrow(/addition/);
  });
  it("discloses small samples and missing reasons alongside cited themes", () => {
    const result = validateThemes({ themes: [{ title: "T", summary: "S", evidenceIds: ["real"] }] }, [{ ...deal(), id: "real" }], false);
    expect(result.warnings.join(" ")).toMatch(/Small sample.*missing reasons/);
  });
  it("requires valid outcome citations in every proposed battlecard addition", () => {
    const themes = [{ title: "Theme", summary: "Summary", evidenceIds: ["real"] }];
    const evidence = [{ ...deal(), id: "real" }];
    expect(() => validateThemes({ themes, addition: "No citations" }, evidence, true)).toThrow(/citations/);
    expect(() => validateThemes({ themes, addition: "Cites [real] plus [invented]" }, evidence, true)).toThrow(/citations/);
    expect(() => validateThemes({ themes, addition: "Cites actual outcome [real]" }, evidence, true)).not.toThrow();
  });
});
