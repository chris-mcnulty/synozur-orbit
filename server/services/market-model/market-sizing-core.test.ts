import { describe, it, expect } from "vitest";
import {
  computeBottomUp,
  reconcileSizing,
  agreementRatio,
  parseTopDownSizing,
  parseNeedsMap,
  parsePriority,
  buildSizingRationale,
  buildTopDownSizingPrompt,
  DEFAULT_SAM_REACHABLE_FRACTION,
} from "./market-sizing-core";

describe("computeBottomUp", () => {
  it("computes TAM = establishments × ACV and SAM = TAM × reachable fraction", () => {
    const r = computeBottomUp({ establishments: 1000, acv: 50_000 })!;
    expect(r.tam).toBe(50_000_000);
    expect(r.sam).toBe(Math.round(50_000_000 * DEFAULT_SAM_REACHABLE_FRACTION));
  });
  it("honors an explicit reachable fraction", () => {
    const r = computeBottomUp({ establishments: 100, acv: 1000, reachableFraction: 0.5 })!;
    expect(r.tam).toBe(100_000);
    expect(r.sam).toBe(50_000);
  });
  it("returns null when establishments or ACV are non-positive", () => {
    expect(computeBottomUp({ establishments: 0, acv: 1000 })).toBeNull();
    expect(computeBottomUp({ establishments: 100, acv: 0 })).toBeNull();
  });
});

describe("agreementRatio", () => {
  it("is 1 for identical, →0 for far apart, 0 when both zero", () => {
    expect(agreementRatio(100, 100)).toBe(1);
    expect(agreementRatio(25, 100)).toBe(0.25);
    expect(agreementRatio(0, 0)).toBe(0);
  });
});

describe("reconcileSizing", () => {
  it("triangulates two estimates: range spans both, method triangulated", () => {
    const r = reconcileSizing({ tam: 100, sam: 40 }, { tam: 200, sam: 60 }, { hasSources: true });
    expect(r.method).toBe("triangulated");
    expect(r.tam.low).toBe(100);
    expect(r.tam.high).toBe(200);
    expect(r.tam.mid).toBe(Math.round(Math.sqrt(100 * 200)));
    expect(r.confidence).toBe("high"); // ratio exactly 0.5 AND sourced → high
  });

  it("marks high confidence only when close AND sourced", () => {
    const close = reconcileSizing({ tam: 90, sam: 30 }, { tam: 100, sam: 35 }, { hasSources: true });
    expect(close.confidence).toBe("high");
    const closeNoSrc = reconcileSizing({ tam: 90, sam: 30 }, { tam: 100, sam: 35 }, { hasSources: false });
    expect(closeNoSrc.confidence).toBe("medium");
    const far = reconcileSizing({ tam: 10, sam: 3 }, { tam: 100, sam: 35 }, { hasSources: true });
    expect(far.confidence).toBe("low");
  });

  it("uses a ±30% band for a single method", () => {
    const r = reconcileSizing({ tam: 1000, sam: 400 }, null);
    expect(r.method).toBe("bottom_up");
    expect(r.tam.low).toBe(700);
    expect(r.tam.mid).toBe(1000);
    expect(r.tam.high).toBe(1300);
  });

  it("returns zeros + low confidence when nothing is available", () => {
    const r = reconcileSizing(null, null);
    expect(r.tam).toEqual({ low: 0, mid: 0, high: 0, currency: "USD" });
    expect(r.confidence).toBe("low");
  });

  it("clamps SAM to TAM so a bad SAM>TAM model response can't persist", () => {
    // Single top-down estimate with SAM larger than TAM (malformed).
    const r = reconcileSizing(null, { tam: 1000, sam: 5000 });
    expect(r.sam.low).toBeLessThanOrEqual(r.tam.low);
    expect(r.sam.mid).toBeLessThanOrEqual(r.tam.mid);
    expect(r.sam.high).toBeLessThanOrEqual(r.tam.high);
  });
});

describe("parseTopDownSizing", () => {
  it("parses fenced JSON with figures and sources", () => {
    const text =
      '```json\n{ "tamUsd": 12300000000, "samUsd": 4100000000, "asOfYear": 2024,' +
      ' "sources": [{ "title": "T", "publisher": "Gartner", "url": "https://x", "figure": "$12.3B", "year": 2024 }],' +
      ' "notes": "note" }\n```';
    const p = parseTopDownSizing(text);
    expect(p.estimate).toEqual({ tam: 12300000000, sam: 4100000000 });
    expect(p.sources[0].url).toBe("https://x");
    expect(p.notes).toBe("note");
  });
  it("returns null estimate for unusable output", () => {
    expect(parseTopDownSizing("no json here").estimate).toBeNull();
    expect(parseTopDownSizing('{ "tamUsd": null, "samUsd": null }').estimate).toBeNull();
  });
});

describe("parseNeedsMap / parsePriority", () => {
  it("parses a needs map, trimming and capping", () => {
    const nm = parseNeedsMap('{ "pains": ["a"," b "], "triggers": [], "barriers": ["x"], "buyingCriteria": [] }');
    expect(nm.pains).toEqual(["a", "b"]);
    expect(nm.barriers).toEqual(["x"]);
    expect(nm.triggers).toEqual([]);
  });
  it("defaults to empty arrays on garbage", () => {
    expect(parseNeedsMap("nope")).toEqual({ pains: [], triggers: [], barriers: [], buyingCriteria: [] });
  });
  it("clamps priority score into 1..10", () => {
    expect(parsePriority('{ "score": 15, "rationale": "big" }')).toEqual({ score: 10, rationale: "big" });
    expect(parsePriority('{ "score": 0 }').score).toBe(1);
  });
});

describe("prompt + rationale builders", () => {
  it("top-down prompt includes segment, industry, geography and JSON contract", () => {
    const p = buildTopDownSizingPrompt({
      segmentName: "Mid-market SaaS",
      firmographics: { industry: "Software Publishers", geography: "US", businessType: "b2b" },
    });
    expect(p).toContain("Mid-market SaaS");
    expect(p).toContain("Software Publishers");
    expect(p).toContain("tamUsd");
  });
  it("rationale reflects the method", () => {
    expect(buildSizingRationale({ bottomUp: { tam: 1, sam: 1 }, topDown: { tam: 1, sam: 1 }, method: "triangulated", confidence: "high" })).toContain("Triangulated");
    expect(buildSizingRationale({ bottomUp: null, topDown: { tam: 1, sam: 1 }, method: "top_down", confidence: "low" })).toContain("Top-down");
  });
});
