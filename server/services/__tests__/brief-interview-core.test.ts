import { strict as assert } from "node:assert";
import {
  suggestReleaseWindows,
  clampAmplificationEnd,
  suggestReleaseTempo,
  formatTempoForDisplay,
  clampBriefCount,
  formatInterviewForPrompt,
  normalizeInterviewBrief,
  coerceFitAssessment,
  coerceFormCategories,
  distributeDates,
  deliverableTitle,
  categoriesForFormat,
  addDays,
  MIN_AMPLIFICATION_DAYS,
  DEFAULT_RAMP_UP_DAYS,
  DEFAULT_AMPLIFICATION_DAYS,
  type BriefInterviewInput,
} from "../brief-interview-core";

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

const DAY_MS = 24 * 60 * 60 * 1000;

(async () => {
  await test("suggestReleaseWindows: ramp-up 6 weeks before, amplification 45 days after", () => {
    const release = new Date("2026-09-01T00:00:00Z");
    const w = suggestReleaseWindows(release);
    assert.equal((release.getTime() - w.rampUpStart.getTime()) / DAY_MS, DEFAULT_RAMP_UP_DAYS);
    assert.equal((w.amplificationEnd.getTime() - release.getTime()) / DAY_MS, DEFAULT_AMPLIFICATION_DAYS);
  });

  await test("clampAmplificationEnd: enforces the 30-day floor", () => {
    const release = new Date("2026-09-01T00:00:00Z");
    const tooSoon = addDays(release, 10);
    const clamped = clampAmplificationEnd(release, tooSoon);
    assert.equal((clamped.getTime() - release.getTime()) / DAY_MS, MIN_AMPLIFICATION_DAYS);

    const fine = addDays(release, 60);
    assert.equal(clampAmplificationEnd(release, fine).getTime(), fine.getTime());

    assert.equal(
      (clampAmplificationEnd(release, null).getTime() - release.getTime()) / DAY_MS,
      MIN_AMPLIFICATION_DAYS,
    );
  });

  await test("suggestReleaseTempo covers ramp-up, launch week, amplification", () => {
    const phases = suggestReleaseTempo();
    assert.deepEqual(phases.map((p) => p.phase), ["ramp_up", "launch_week", "amplification"]);
    const text = formatTempoForDisplay(phases);
    assert.ok(text.includes("press release on release day"));
    assert.equal(text.split("\n").length, 3);
  });

  await test("clampBriefCount clamps to 5-10 and defaults to 8", () => {
    assert.equal(clampBriefCount(undefined), 8);
    assert.equal(clampBriefCount(1), 5);
    assert.equal(clampBriefCount(25), 10);
    assert.equal(clampBriefCount(7), 7);
    assert.equal(clampBriefCount("nope" as any), 8);
  });

  await test("formatInterviewForPrompt includes release windows, product, and news", () => {
    const input: BriefInterviewInput = {
      campaignType: "product_release",
      themes: ["Theme A", "Theme B"],
      releaseDate: "2026-09-01",
      rampUpStart: "2026-07-21",
      amplificationEnd: "2026-10-16",
      tempo: "Ramp-up: 2 posts/week",
      newsItems: ["New dashboard ships GA", "SOC 2 Type II"],
      product: { productId: "p1", productName: "Orbit Analytics", features: ["Dashboards", "Alerts"] },
      notes: "Keep it technical",
    };
    const block = formatInterviewForPrompt(input);
    assert.ok(block.includes("Campaign type: product_release"));
    assert.ok(block.includes("Theme A"));
    assert.ok(block.includes("Release date (hard date): 2026-09-01"));
    assert.ok(block.includes("Ramp-up window: 2026-07-21"));
    assert.ok(block.includes("until 2026-10-16"));
    assert.ok(block.includes("Orbit Analytics"));
    assert.ok(block.includes("(tracked in Orbit)"));
    assert.ok(block.includes("Dashboards"));
    assert.ok(block.includes("New dashboard ships GA"));
    assert.ok(block.includes("Keep it technical"));
  });

  await test("formatInterviewForPrompt omits release lines for a theme campaign", () => {
    const block = formatInterviewForPrompt({
      campaignType: "theme",
      themes: ["POV"],
      timeframeStart: "2026-07-01",
      timeframeEnd: "2026-08-01",
    });
    assert.ok(!block.includes("Release date"));
    assert.ok(block.includes("Campaign timeframe: 2026-07-01 to 2026-08-01"));
  });

  await test("coerceFitAssessment defaults recommendation from weak fits", () => {
    const weak = coerceFitAssessment({ voiceFit: "weak", topicFit: "strong" });
    assert.equal(weak.recommendation, "reject");
    const strong = coerceFitAssessment({ voiceFit: "strong", topicFit: "strong" });
    assert.equal(strong.recommendation, "keep");
    const explicit = coerceFitAssessment({ voiceFit: "strong", topicFit: "strong", recommendation: "reject", rationale: "meh" });
    assert.equal(explicit.recommendation, "reject");
    assert.equal(explicit.rationale, "meh");
    const garbage = coerceFitAssessment({ voiceFit: "amazing" });
    assert.equal(garbage.voiceFit, "moderate");
  });

  await test("coerceFormCategories normalizes and dedupes", () => {
    assert.deepEqual(coerceFormCategories(["short_form", "Short-Form", "mid form", "bogus"]), [
      "short_form",
      "mid_form",
    ]);
    assert.deepEqual(coerceFormCategories("long_form, digital_interactive"), [
      "long_form",
      "digital_interactive",
    ]);
    assert.deepEqual(coerceFormCategories(undefined), []);
  });

  await test("normalizeInterviewBrief falls back to the anchor format's category", () => {
    const b = normalizeInterviewBrief({
      title: "Concept",
      format: "webinar",
      summary: "  A core idea  ",
      fitAssessment: { voiceFit: "strong", topicFit: "moderate" },
    });
    assert.ok(b);
    assert.equal(b!.summary, "A core idea");
    assert.deepEqual(b!.formCategories, ["digital_interactive"]);
    assert.equal(b!.fitAssessment.recommendation, "keep");
  });

  await test("normalizeInterviewBrief returns null without a title", () => {
    assert.equal(normalizeInterviewBrief({ summary: "no title" }), null);
  });

  await test("distributeDates: single date lands on window start", () => {
    const start = new Date("2026-09-01T00:00:00Z");
    const end = new Date("2026-09-30T00:00:00Z");
    const dates = distributeDates(start, end, 1);
    assert.equal(dates.length, 1);
    assert.equal(dates[0].getTime(), start.getTime());
  });

  await test("distributeDates: spreads evenly from start to end", () => {
    const start = new Date("2026-09-01T00:00:00Z");
    const end = new Date("2026-09-29T00:00:00Z");
    const dates = distributeDates(start, end, 3);
    assert.equal(dates.length, 3);
    assert.equal(dates[0].getTime(), start.getTime());
    assert.equal(dates[2].getTime(), end.getTime());
    assert.equal((dates[1].getTime() - start.getTime()) / DAY_MS, 14);
  });

  await test("distributeDates: clamps count and inverted windows", () => {
    const start = new Date("2026-09-10T00:00:00Z");
    const end = new Date("2026-09-01T00:00:00Z");
    const dates = distributeDates(start, end, 0);
    assert.equal(dates.length, 1);
    assert.equal(dates[0].getTime(), start.getTime());
    assert.equal(distributeDates(start, start, 99).length, 10);
  });

  await test("deliverableTitle numbers multi-piece items only", () => {
    assert.equal(deliverableTitle("Concept", "press_release", 0, 1), "Concept — Press release");
    assert.equal(deliverableTitle("Concept", "linkedin_post", 1, 3), "Concept — LinkedIn post 2 of 3");
  });

  await test("categoriesForFormat maps new formats", () => {
    assert.deepEqual(categoriesForFormat("webinar"), ["digital_interactive"]);
    assert.deepEqual(categoriesForFormat("press_release"), ["mid_form"]);
    assert.deepEqual(categoriesForFormat("other"), []);
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll brief-interview-core tests passed");
})();
