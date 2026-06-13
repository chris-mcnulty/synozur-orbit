import { strict as assert } from "node:assert";
import {
  classifyGoalType,
  archetypeForGoal,
  defaultCadence,
  normalizeTargetingFilter,
  normalizeChannels,
  assembleCampaign,
  INTERVIEW_STEPS,
} from "../outreach-interview-core";

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

(async () => {
  await test("interview steps include the required brief fields", () => {
    const keys = INTERVIEW_STEPS.map((s) => s.key);
    for (const k of ["goal", "message", "icp", "refinements", "cta", "event", "resources", "voice"]) {
      assert.ok(keys.includes(k), `missing step ${k}`);
    }
  });

  await test("classifyGoalType reads intent from free text", () => {
    assert.equal(classifyGoalType("book 10 discovery calls"), "meeting");
    assert.equal(classifyGoalType("invite VC leaders to a dinner roundtable"), "event_invite");
    assert.equal(classifyGoalType("introduce Zenith to IT directors"), "intro");
    assert.equal(classifyGoalType("re-engage dormant accounts"), "nurture");
    assert.equal(classifyGoalType(""), "meeting");
  });

  await test("event intent wins over meeting when both appear", () => {
    // "book a meeting at the conference" — event-anchored, not plain meeting-drive
    assert.equal(classifyGoalType("book a meeting at the conference"), "event_invite");
  });

  await test("archetype maps from goal type", () => {
    assert.equal(archetypeForGoal("meeting"), "meeting_drive");
    assert.equal(archetypeForGoal("intro"), "meeting_drive");
    assert.equal(archetypeForGoal("event_invite"), "event_invite");
    assert.equal(archetypeForGoal("nurture"), "nurture");
  });

  await test("event-invite cadence is event-anchored and back-dated", () => {
    const c = defaultCadence("event_invite");
    assert.equal(c.anchor, "event_date");
    assert.ok(c.steps.every((s) => s.dayOffset <= 0), "all steps before the event");
    assert.ok(c.steps.length >= 3);
  });

  await test("meeting-drive cadence is start-anchored and forward-dated", () => {
    const c = defaultCadence("meeting_drive");
    assert.equal(c.anchor, "start_date");
    assert.equal(c.steps[0].dayOffset, 0);
    assert.ok(c.steps[c.steps.length - 1].dayOffset > 0);
  });

  await test("normalizeTargetingFilter trims, dedupes, drops empties", () => {
    const f = normalizeTargetingFilter({
      geographies: ["Seattle", " Seattle ", ""],
      industries: ["Finance"],
      segments: [],
      targetRoles: ["CIO", "CIO"],
    });
    assert.deepEqual(f.geographies, ["Seattle"]);
    assert.deepEqual(f.industries, ["Finance"]);
    assert.equal(f.segments, undefined);
    assert.deepEqual(f.targetRoles, ["CIO"]);
  });

  await test("normalizeChannels validates and defaults to email", () => {
    assert.deepEqual(normalizeChannels(["email", "linkedin"]), ["email", "linkedin"]);
    assert.deepEqual(normalizeChannels(["EMAIL", "twitter"]), ["email"]);
    assert.deepEqual(normalizeChannels(undefined), ["email"]);
    assert.deepEqual(normalizeChannels([]), ["email"]);
  });

  await test("assembleCampaign ties the brief together (Seattle conference case)", () => {
    const a = assembleCampaign({
      goal: "drive meetings with financial leaders at the Seattle conference",
      refinements: { geographies: ["Seattle"], industries: ["Financial Services"], targetRoles: ["CFO", "VP Finance"] },
      channels: ["email", "linkedin"],
    });
    assert.equal(a.goalType, "event_invite");
    assert.equal(a.archetype, "event_invite");
    assert.equal(a.cadence.anchor, "event_date");
    assert.deepEqual(a.targetingFilter.geographies, ["Seattle"]);
    assert.deepEqual(a.channels, ["email", "linkedin"]);
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll outreach-interview-core tests passed");
})();
