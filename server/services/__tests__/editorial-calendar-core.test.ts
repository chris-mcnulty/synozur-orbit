import { strict as assert } from "node:assert";
import {
  coerceFormat,
  coerceFunnelStage,
  normalizeBrief,
  computeFunnelBreakdown,
  assessCalendarWarnings,
  type DraftBrief,
} from "../editorial-calendar-core";

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`[ok]   ${name}`);
  } catch (err) {
    failures++;
    console.error(`[FAIL] ${name}`);
    console.error(err);
  }
}

function brief(over: Partial<DraftBrief> = {}): DraftBrief {
  return {
    title: "T",
    format: "blog_post",
    targetKeyword: "k",
    demandSignal: "d",
    funnelStage: "awareness",
    differentiationAngle: "a",
    targetReader: "r",
    cta: "c",
    channels: [],
    estimatedHours: 2,
    ...over,
  };
}

(async () => {
  await test("coerceFormat normalizes and falls back to other", () => {
    assert.equal(coerceFormat("Blog Post"), "blog_post");
    assert.equal(coerceFormat("linkedin-post"), "linkedin_post");
    assert.equal(coerceFormat("tweet"), "other");
    assert.equal(coerceFormat(undefined), "other");
  });

  await test("coerceFunnelStage falls back to awareness", () => {
    assert.equal(coerceFunnelStage("Decision"), "decision");
    assert.equal(coerceFunnelStage("middle"), "awareness");
  });

  await test("normalizeBrief maps snake_case and rejects empty titles", () => {
    assert.equal(normalizeBrief({ title: "  " }), null);
    const b = normalizeBrief({
      title: "How to X",
      format: "Blog Post",
      target_keyword: "how to x",
      demand_signal: "120 searches/mo",
      funnel_stage: "consideration",
      differentiation_angle: "contrarian take",
      target_reader: "Head of Demand Gen",
      call_to_action: "Book a demo",
      channels: "LinkedIn, Blog",
      estimated_hours: "3",
    });
    assert.ok(b);
    assert.equal(b!.format, "blog_post");
    assert.equal(b!.targetKeyword, "how to x");
    assert.equal(b!.funnelStage, "consideration");
    assert.deepEqual(b!.channels, ["LinkedIn", "Blog"]);
    assert.equal(b!.estimatedHours, 3);
  });

  await test("computeFunnelBreakdown counts and percentages", () => {
    const briefs = [
      brief({ funnelStage: "awareness" }),
      brief({ funnelStage: "awareness" }),
      brief({ funnelStage: "consideration" }),
      brief({ funnelStage: "decision" }),
    ];
    const r = computeFunnelBreakdown(briefs);
    assert.equal(r.total, 4);
    assert.equal(r.counts.awareness, 2);
    assert.equal(r.percentages.awareness, 50);
    assert.equal(r.percentages.decision, 25);
  });

  await test("warnings flag too-few briefs, concentration, and missing fields", () => {
    const briefs = [
      brief({ funnelStage: "awareness", demandSignal: null }),
      brief({ funnelStage: "awareness" }),
      brief({ funnelStage: "awareness", differentiationAngle: null }),
    ];
    const w = assessCalendarWarnings(briefs); // default minBriefs 15
    assert.ok(w.some((x) => x.includes("at least 15")), "expected too-few warning");
    assert.ok(w.some((x) => x.includes("awareness")), "expected concentration warning (100% awareness)");
    assert.ok(w.some((x) => x.includes("demand signal")), "expected demand-signal warning");
    assert.ok(w.some((x) => x.includes("differentiation")), "expected differentiation warning");
  });

  await test("a healthy 15-brief calendar produces no warnings", () => {
    const briefs: DraftBrief[] = [];
    // 6 awareness (40%), 5 consideration (~33%), 4 decision (~27%)
    for (let i = 0; i < 6; i++) briefs.push(brief({ funnelStage: "awareness" }));
    for (let i = 0; i < 5; i++) briefs.push(brief({ funnelStage: "consideration" }));
    for (let i = 0; i < 4; i++) briefs.push(brief({ funnelStage: "decision" }));
    assert.deepEqual(assessCalendarWarnings(briefs), []);
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll editorial-calendar-core tests passed");
})();
