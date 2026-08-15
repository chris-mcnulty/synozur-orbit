import { describe, it, expect } from "vitest";
import {
  depthConfig,
  initialStages,
  STUDY_STAGE_PLAN,
  parseProposedSegments,
  buildProposeSegmentsPrompt,
  buildExecSummaryPrompt,
} from "./market-study-core";

describe("depthConfig", () => {
  it("scales breadth by depth", () => {
    expect(depthConfig("explore").maxSegments).toBeLessThan(depthConfig("focus").maxSegments);
    expect(depthConfig("focus").maxSegments).toBeLessThan(depthConfig("dominate").maxSegments);
    expect(depthConfig("dominate").proposeCount).toBeGreaterThan(depthConfig("explore").proposeCount);
  });
  it("defaults unknown depth to focus", () => {
    // @ts-expect-error deliberately invalid
    expect(depthConfig("nonsense")).toEqual(depthConfig("focus"));
  });
});

describe("initialStages", () => {
  it("mirrors the stage plan, all pending", () => {
    const stages = initialStages();
    expect(stages).toHaveLength(STUDY_STAGE_PLAN.length);
    expect(stages.every((s) => s.status === "pending")).toBe(true);
    expect(stages.map((s) => s.key)).toEqual(STUDY_STAGE_PLAN.map((s) => s.key));
  });
});

describe("parseProposedSegments", () => {
  it("parses segments with firmographics and pains", () => {
    const text =
      '[{"name":"Mid-market RevOps","description":"d","industry":"Software","companySize":"50-500","geography":"US","pains":["manual data"," slow reporting "]}]';
    const segs = parseProposedSegments(text);
    expect(segs).toHaveLength(1);
    expect(segs[0].name).toBe("Mid-market RevOps");
    expect(segs[0].firmographics.industry).toBe("Software");
    expect(segs[0].pains).toEqual(["manual data", "slow reporting"]);
  });
  it("skips entries without a name and tolerates fences", () => {
    const text = '```json\n[{"description":"no name"},{"name":"Ok","pains":[]}]\n```';
    const segs = parseProposedSegments(text);
    expect(segs.map((s) => s.name)).toEqual(["Ok"]);
  });
  it("returns [] on garbage", () => {
    expect(parseProposedSegments("nope")).toEqual([]);
  });
});

describe("prompt builders", () => {
  it("propose prompt carries the brief, count, and JSON contract", () => {
    const p = buildProposeSegmentsPrompt({ brief: "We sell RevOps tooling", count: 4, businessType: "b2b" });
    expect(p).toContain("We sell RevOps tooling");
    expect(p).toContain("up to 4");
    expect(p).toContain('"pains"');
  });
  it("exec summary prompt lists segments and opportunities with markdown sections", () => {
    const p = buildExecSummaryPrompt({
      brief: "b",
      segments: [{ name: "Seg A", tamMid: 12_000_000, samMid: 4_000_000, priorityScore: 8 }],
      opportunities: [{ segmentName: "Seg A", need: "hygiene", channel: "outbound", roiScore: 72, isWhitespace: true }],
    });
    expect(p).toContain("Seg A");
    expect(p).toContain("$12.0M");
    expect(p).toContain("whitespace");
    expect(p).toContain("## Priority segments");
  });
});
