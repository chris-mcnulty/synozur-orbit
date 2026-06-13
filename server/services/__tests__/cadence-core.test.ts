import { strict as assert } from "node:assert";
import {
  advanceProspectState,
  stepDate,
  toBusinessDay,
  nextDueStep,
  isExhausted,
  checkCaps,
  belowReplyFloor,
  type CapSettings,
  type CadenceStepLike,
} from "../cadence-core";

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

const CAPS: CapSettings = {
  globalPause: false,
  masterDailyCap: 100,
  emailDailyCap: 50,
  emailWeeklyCap: 200,
  linkedinDailyCap: 15,
  linkedinWeeklyCap: 50,
  weeklyPerDomainCap: 3,
};

(async () => {
  // ── State machine ──
  await test("state machine: sent draft → awaiting_reply → replied", () => {
    assert.equal(advanceProspectState("draft_pending_approval", "sent_detected"), "sent");
    assert.equal(advanceProspectState("sent", "sent_detected"), "awaiting_reply");
    assert.equal(advanceProspectState("awaiting_reply", "reply_detected"), "replied");
  });

  await test("state machine: step due + exhaustion + disqualify", () => {
    assert.equal(advanceProspectState("awaiting_reply", "step_due"), "cadence_step_due");
    assert.equal(advanceProspectState("awaiting_reply", "exhausted"), "dormant");
    assert.equal(advanceProspectState("awaiting_reply", "disqualified"), "dormant");
  });

  await test("state machine: invalid transitions return null", () => {
    assert.equal(advanceProspectState("new", "reply_detected"), null);
    assert.equal(advanceProspectState("dormant", "sent_detected"), null);
  });

  // ── Timing ──
  await test("toBusinessDay shifts weekend to Monday", () => {
    // 2026-06-13 is a Saturday, 2026-06-14 Sunday, 2026-06-15 Monday (UTC)
    assert.equal(toBusinessDay(new Date(Date.UTC(2026, 5, 13))).getUTCDate(), 15);
    assert.equal(toBusinessDay(new Date(Date.UTC(2026, 5, 14))).getUTCDate(), 15);
    assert.equal(toBusinessDay(new Date(Date.UTC(2026, 5, 15))).getUTCDate(), 15);
  });

  await test("stepDate supports negative (event-anchored back-dated) offsets", () => {
    const eventDate = new Date(Date.UTC(2026, 7, 28)); // Aug 28
    const d = stepDate(eventDate, -7, false);
    assert.equal(d.getUTCDate(), 21);
    assert.equal(d.getUTCMonth(), 7);
  });

  await test("nextDueStep returns the earliest pending step that's due", () => {
    const anchor = new Date(Date.UTC(2026, 0, 5)); // Mon
    const steps: CadenceStepLike[] = [
      { stepNumber: 1, dayOffset: 0, businessHoursOnly: true, channel: "email" },
      { stepNumber: 2, dayOffset: 3, businessHoursOnly: true, channel: "email" },
      { stepNumber: 3, dayOffset: 30, businessHoursOnly: true, channel: "linkedin" },
    ];
    const now = new Date(Date.UTC(2026, 0, 9)); // after step 2's date
    const due = nextDueStep(steps, [1], anchor, now);
    assert.equal(due?.stepNumber, 2);
    // Nothing due yet when all near-term steps are completed
    assert.equal(nextDueStep(steps, [1, 2], anchor, now), null);
  });

  await test("isExhausted true only when every step completed", () => {
    const steps: CadenceStepLike[] = [
      { stepNumber: 1, dayOffset: 0, businessHoursOnly: true, channel: "email" },
      { stepNumber: 2, dayOffset: 3, businessHoursOnly: true, channel: "email" },
    ];
    assert.equal(isExhausted(steps, [1]), false);
    assert.equal(isExhausted(steps, [1, 2]), true);
  });

  // ── Caps ──
  await test("caps allow a normal email approval", () => {
    const d = checkCaps("email", CAPS, { masterToday: 3, channelToday: 2, channelWeek: 10, domainWeek: 1 });
    assert.equal(d.allowed, true);
  });

  await test("global pause blocks everything", () => {
    const d = checkCaps("email", { ...CAPS, globalPause: true }, { masterToday: 0, channelToday: 0, channelWeek: 0, domainWeek: 0 });
    assert.equal(d.allowed, false);
    assert.match(d.reason!, /paused/i);
  });

  await test("LinkedIn daily cap is stricter and trips first", () => {
    const counts = { masterToday: 20, channelToday: 15, channelWeek: 20, domainWeek: 0 };
    assert.equal(checkCaps("linkedin", CAPS, counts).allowed, false);
    // same counts on email are fine (email daily cap is 50)
    assert.equal(checkCaps("email", CAPS, counts).allowed, true);
  });

  await test("master daily cap blocks regardless of channel headroom", () => {
    const d = checkCaps("email", CAPS, { masterToday: 100, channelToday: 0, channelWeek: 0, domainWeek: 0 });
    assert.equal(d.allowed, false);
    assert.match(d.reason!, /master/i);
  });

  await test("per-domain weekly cap blocks", () => {
    const d = checkCaps("email", CAPS, { masterToday: 0, channelToday: 0, channelWeek: 0, domainWeek: 3 });
    assert.equal(d.allowed, false);
    assert.match(d.reason!, /domain/i);
  });

  await test("reply-rate floor only trips with enough sample and below floor", () => {
    assert.equal(belowReplyFloor(0, 3, 0.1), false); // too few sends
    assert.equal(belowReplyFloor(0, 10, 0), false); // floor off
    assert.equal(belowReplyFloor(0, 10, 0.1), true); // 0% < 10%
    assert.equal(belowReplyFloor(3, 10, 0.1), false); // 30% >= 10%
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll cadence-core tests passed");
})();
