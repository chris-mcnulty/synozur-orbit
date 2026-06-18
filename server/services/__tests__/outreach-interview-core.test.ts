import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  classifyGoalType,
  archetypeForGoal,
  defaultCadence,
  normalizeTargetingFilter,
  normalizeChannels,
  assembleCampaign,
  INTERVIEW_STEPS,
} from "../outreach-interview-core";


describe("outreach-interview-core", () => {
  it("interview steps include the required brief fields", () => {
    const keys = INTERVIEW_STEPS.map((s) => s.key);
    for (const k of ["goal", "message", "icp", "refinements", "cta", "event", "resources", "voice"]) {
      assert.ok(keys.includes(k), `missing step ${k}`);
    }
  });

  it("classifyGoalType reads intent from free text", () => {
    assert.equal(classifyGoalType("book 10 discovery calls"), "meeting");
    assert.equal(classifyGoalType("invite VC leaders to a dinner roundtable"), "event_invite");
    assert.equal(classifyGoalType("introduce Zenith to IT directors"), "intro");
    assert.equal(classifyGoalType("re-engage dormant accounts"), "nurture");
    assert.equal(classifyGoalType(""), "meeting");
  });

  it("event intent wins over meeting when both appear", () => {
    // "book a meeting at the conference" — event-anchored, not plain meeting-drive
    assert.equal(classifyGoalType("book a meeting at the conference"), "event_invite");
  });

  it("archetype maps from goal type", () => {
    assert.equal(archetypeForGoal("meeting"), "meeting_drive");
    assert.equal(archetypeForGoal("intro"), "meeting_drive");
    assert.equal(archetypeForGoal("event_invite"), "event_invite");
    assert.equal(archetypeForGoal("nurture"), "nurture");
  });

  it("event-invite cadence is event-anchored and back-dated", () => {
    const c = defaultCadence("event_invite");
    assert.equal(c.anchor, "event_date");
    assert.ok(c.steps.every((s) => s.dayOffset <= 0), "all steps before the event");
    assert.ok(c.steps.length >= 3);
  });

  it("meeting-drive cadence is start-anchored and forward-dated", () => {
    const c = defaultCadence("meeting_drive");
    assert.equal(c.anchor, "start_date");
    assert.equal(c.steps[0].dayOffset, 0);
    assert.ok(c.steps[c.steps.length - 1].dayOffset > 0);
  });

  it("normalizeTargetingFilter trims, dedupes, drops empties", () => {
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

  it("normalizeChannels validates and defaults to email", () => {
    assert.deepEqual(normalizeChannels(["email", "linkedin"]), ["email", "linkedin"]);
    assert.deepEqual(normalizeChannels(["EMAIL", "twitter"]), ["email"]);
    assert.deepEqual(normalizeChannels(undefined), ["email"]);
    assert.deepEqual(normalizeChannels([]), ["email"]);
  });

  it("assembleCampaign ties the brief together (Seattle conference case)", () => {
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

});
