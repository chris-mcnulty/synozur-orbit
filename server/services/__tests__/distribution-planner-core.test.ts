import { strict as assert } from "node:assert";
import {
  formatToChannel,
  bestHourForChannel,
  dateToTimeframe,
  buildSchedule,
  type PlanItemInput,
} from "../distribution-planner-core";

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

function items(n: number, format = "blog_post"): PlanItemInput[] {
  return Array.from({ length: n }, (_, i) => ({ id: `b${i}`, title: `Brief ${i}`, format }));
}

(async () => {
  await test("formatToChannel maps formats", () => {
    assert.equal(formatToChannel("linkedin_post"), "linkedin");
    assert.equal(formatToChannel("x_post"), "twitter");
    assert.equal(formatToChannel("newsletter"), "email");
    assert.equal(formatToChannel("blog_post"), "blog");
    assert.equal(formatToChannel("mystery"), "linkedin");
  });

  await test("dateToTimeframe maps calendar quarters", () => {
    assert.equal(dateToTimeframe(new Date(Date.UTC(2026, 0, 15))), "Q1");
    assert.equal(dateToTimeframe(new Date(Date.UTC(2026, 4, 1))), "Q2");
    assert.equal(dateToTimeframe(new Date(Date.UTC(2026, 7, 30))), "Q3");
    assert.equal(dateToTimeframe(new Date(Date.UTC(2026, 11, 31))), "Q4");
  });

  await test("buildSchedule: empty in, empty out", () => {
    assert.deepEqual(buildSchedule([], { periodStart: new Date(), periodEnd: new Date() }), []);
  });

  await test("buildSchedule spreads items in order within the window", () => {
    const start = new Date(Date.UTC(2026, 0, 5)); // Mon
    const end = new Date(Date.UTC(2026, 0, 30)); // Fri
    const sched = buildSchedule(items(5), { periodStart: start, periodEnd: end, skipWeekends: true });
    assert.equal(sched.length, 5);
    let prev = 0;
    for (const s of sched) {
      const t = new Date(s.scheduledAt).getTime();
      assert.ok(t >= start.getTime(), "after start");
      // within window + weekend nudge tolerance (2 days)
      assert.ok(t <= end.getTime() + 2 * 86_400_000, "before end (+weekend nudge)");
      assert.ok(t >= prev, "non-decreasing order");
      prev = t;
      const day = new Date(s.scheduledAt).getUTCDay();
      assert.ok(day !== 0 && day !== 6, `weekday only, got day ${day}`);
    }
  });

  await test("buildSchedule single item lands at start, best hour for channel", () => {
    const start = new Date(Date.UTC(2026, 2, 2)); // Mon
    const sched = buildSchedule([{ id: "x", title: "T", format: "linkedin_post" }], {
      periodStart: start,
      periodEnd: new Date(Date.UTC(2026, 2, 31)),
      skipWeekends: true,
    });
    assert.equal(sched.length, 1);
    assert.equal(sched[0].channel, "linkedin");
    assert.equal(new Date(sched[0].scheduledAt).getUTCHours(), bestHourForChannel("linkedin"));
    assert.equal(new Date(sched[0].scheduledAt).getUTCDate(), 2);
  });

  await test("buildSchedule places best-hour in the user's local timezone", () => {
    // UTC-5 -> getTimezoneOffset() = +300. LinkedIn best hour = 9 local.
    const sched = buildSchedule([{ id: "x", title: "T", format: "linkedin_post" }], {
      periodStart: new Date(Date.UTC(2026, 2, 2)),
      periodEnd: new Date(Date.UTC(2026, 2, 20)),
      skipWeekends: true,
      tzOffsetMinutes: 300,
    });
    const at = new Date(sched[0].scheduledAt);
    // 9:00 local + 5h = 14:00 UTC
    assert.equal(at.getUTCHours(), 14);
    // Local quarter preserved
    assert.equal(sched[0].timeframe, "Q1");
  });

  await test("buildSchedule honors preferredChannels over format", () => {
    const sched = buildSchedule(
      [{ id: "x", title: "T", format: "blog_post", preferredChannels: ["X"] }],
      { periodStart: new Date(Date.UTC(2026, 5, 1)), periodEnd: new Date(Date.UTC(2026, 5, 10)) },
    );
    assert.equal(sched[0].channel, "twitter");
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll distribution-planner-core tests passed");
})();
