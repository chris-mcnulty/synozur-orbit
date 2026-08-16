import { describe, it, expect } from "vitest";
import {
  computeRoiScore,
  computeWhitespaceFlags,
  computeWhitespaceFlagsWithPresence,
  buildMatrixPrompt,
  parseMatrixScores,
  buildPresencePrompt,
  parsePresenceScores,
  PRESENCE_WHITESPACE_MAX,
} from "./market-matrix-core";

describe("computeRoiScore", () => {
  it("rewards high revenue and low effort", () => {
    expect(computeRoiScore(100, 0)).toBe(100);
    expect(computeRoiScore(100, 100)).toBe(0);
    expect(computeRoiScore(80, 50)).toBe(40);
  });
  it("clamps out-of-range inputs", () => {
    expect(computeRoiScore(150, -10)).toBe(100);
    expect(computeRoiScore(NaN, 20)).toBe(0);
  });
});

describe("computeWhitespaceFlags", () => {
  it("flags top-percentile cells above the floor", () => {
    const flags = computeWhitespaceFlags([90, 80, 40, 30, 20, 10, 5, 3, 2, 1]);
    expect(flags[0]).toBe(true); // 90 — top
    expect(flags[2]).toBe(false); // 40 — below floor 50
  });
  it("returns none when all cells are weak (floor gate)", () => {
    expect(computeWhitespaceFlags([10, 20, 30])).toEqual([false, false, false]);
  });
  it("handles empty input", () => {
    expect(computeWhitespaceFlags([])).toEqual([]);
  });
});

describe("computeWhitespaceFlagsWithPresence", () => {
  it("suppresses whitespace for high-ROI cells with high competitor presence", () => {
    const flags = computeWhitespaceFlagsWithPresence([
      { roiScore: 90, competitorPresence: 85 }, // top ROI but contested
      { roiScore: 90, competitorPresence: 10 }, // top ROI + uncontested → whitespace
      { roiScore: 20, competitorPresence: 0 }, // low ROI → never whitespace
    ]);
    expect(flags).toEqual([false, true, false]);
  });
  it("falls back to the ROI proxy when presence is null", () => {
    const flags = computeWhitespaceFlagsWithPresence([
      { roiScore: 90, competitorPresence: null },
      { roiScore: 10, competitorPresence: null },
    ]);
    expect(flags).toEqual([true, false]);
  });
  it("treats presence at the threshold as still whitespace", () => {
    const flags = computeWhitespaceFlagsWithPresence([
      { roiScore: 90, competitorPresence: PRESENCE_WHITESPACE_MAX },
      { roiScore: 90, competitorPresence: PRESENCE_WHITESPACE_MAX + 1 },
    ]);
    expect(flags).toEqual([true, false]);
  });
  it("handles empty input", () => {
    expect(computeWhitespaceFlagsWithPresence([])).toEqual([]);
  });
});

describe("buildPresencePrompt / parsePresenceScores", () => {
  it("includes competitors and channels in the prompt", () => {
    const p = buildPresencePrompt({
      segmentName: "RevOps",
      need: "manual data hygiene",
      channels: [{ key: "outbound", label: "Outbound / SDR" }],
      competitors: [{ name: "Acme", url: "https://acme.com", summary: "Data hygiene platform" }],
    });
    expect(p).toContain("Acme");
    expect(p).toContain("https://acme.com");
    expect(p).toContain("outbound");
    expect(p).toContain("competitorPresence");
  });
  it("parses, clamps, filters channels, and normalizes topCompetitors", () => {
    const text =
      '[{"channelKey":"outbound","competitorPresence":150,"topCompetitors":["Acme"," Beta "],"rationale":"crowded"},' +
      '{"channelKey":"bogus","competitorPresence":50,"topCompetitors":[]}]';
    const scores = parsePresenceScores(text, ["outbound", "content_seo"]);
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({ channelKey: "outbound", competitorPresence: 100, topCompetitors: ["Acme", "Beta"], rationale: "crowded" });
  });
  it("returns [] on garbage", () => {
    expect(parsePresenceScores("nope", ["outbound"])).toEqual([]);
  });
});

describe("buildMatrixPrompt", () => {
  it("lists the exact channel keys and the JSON contract", () => {
    const p = buildMatrixPrompt({
      segmentName: "RevOps",
      need: "manual data hygiene",
      samMid: 5_000_000,
      channels: [{ key: "outbound", label: "Outbound / SDR" }, { key: "content_seo", label: "Content & SEO" }],
    });
    expect(p).toContain("RevOps");
    expect(p).toContain("manual data hygiene");
    expect(p).toContain("outbound");
    expect(p).toContain("content_seo");
    expect(p).toContain("revenuePotential");
  });
});

describe("parseMatrixScores", () => {
  const allowed = ["outbound", "content_seo", "events"];
  it("parses, clamps, and filters to allowed channels", () => {
    const text =
      '[{"channelKey":"outbound","revenuePotential":120,"executionEffort":30,"rationale":"strong"},' +
      '{"channelKey":"content_seo","revenuePotential":60,"executionEffort":40},' +
      '{"channelKey":"hallucinated","revenuePotential":99,"executionEffort":1}]';
    const cells = parseMatrixScores(text, allowed);
    expect(cells).toHaveLength(2);
    expect(cells[0]).toMatchObject({ channelKey: "outbound", revenuePotential: 100, executionEffort: 30 });
    expect(cells.find((c) => c.channelKey === "hallucinated")).toBeUndefined();
  });
  it("dedupes repeated channel keys and tolerates fences", () => {
    const text = '```json\n[{"channelKey":"events","revenuePotential":10,"executionEffort":10},{"channelKey":"events","revenuePotential":90,"executionEffort":10}]\n```';
    const cells = parseMatrixScores(text, allowed);
    expect(cells).toHaveLength(1);
    expect(cells[0].revenuePotential).toBe(10); // first hit wins
  });
  it("returns [] on garbage", () => {
    expect(parseMatrixScores("not json", allowed)).toEqual([]);
  });
});
