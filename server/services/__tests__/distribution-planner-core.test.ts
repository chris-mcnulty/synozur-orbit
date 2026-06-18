import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  formatToChannel,
  bestHourForChannel,
  dateToTimeframe,
  buildSchedule,
  type PlanItemInput,
} from "../distribution-planner-core";


function items(n: number, format = "blog_post"): PlanItemInput[] {
  return Array.from({ length: n }, (_, i) => ({ id: `b${i}`, title: `Brief ${i}`, format }));
}

describe("distribution-planner-core", () => {
  it("formatToChannel maps formats", () => {
    assert.equal(formatToChannel("linkedin_post"), "linkedin");
    assert.equal(formatToChannel("x_post"), "twitter");
    assert.equal(formatToChannel("newsletter"), "email");
    assert.equal(formatToChannel("blog_post"), "blog");
    assert.equal(formatToChannel("ebook"), "blog");
    assert.equal(formatToChannel("mystery"), "linkedin");
  });

  it("dateToTimeframe maps calendar quarters", () => {
    assert.equal(dateToTimeframe(new Date(Date.UTC(2026, 0, 15))), "Q1");
    assert.equal(dateToTimeframe(new Date(Date.UTC(2026, 4, 1))), "Q2");
    assert.equal(dateToTimeframe(new Date(Date.UTC(2026, 7, 30))), "Q3");
    assert.equal(dateToTimeframe(new Date(Date.UTC(2026, 11, 31))), "Q4");
  });

  it("buildSchedule: empty in, empty out", () => {
    assert.deepEqual(buildSchedule([], { periodStart: new Date(), periodEnd: new Date() }), []);
  });

  it("buildSchedule spreads items in order within the window", () => {
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

  it("buildSchedule single item lands at start, best hour for channel", () => {
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

  it("buildSchedule places best-hour in the user's local timezone", () => {
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

  it("buildSchedule lets a brief's format win over its promo channels", () => {
    // A blog_post's `channels` are amplification channels (where we promote it),
    // not where the deliverable publishes. The blog must schedule on "blog".
    const sched = buildSchedule(
      [{ id: "x", title: "T", format: "blog_post", preferredChannels: ["X", "linkedin"] }],
      { periodStart: new Date(Date.UTC(2026, 5, 1)), periodEnd: new Date(Date.UTC(2026, 5, 10)) },
    );
    assert.equal(sched[0].channel, "blog");
  });

  it("buildSchedule falls back to preferredChannels for a generic format", () => {
    const sched = buildSchedule(
      [{ id: "x", title: "T", format: "other", preferredChannels: ["X"] }],
      { periodStart: new Date(Date.UTC(2026, 5, 1)), periodEnd: new Date(Date.UTC(2026, 5, 10)) },
    );
    assert.equal(sched[0].channel, "twitter");
  });

  it("buildSchedule falls back to preferredChannels for an unmapped format (podcast_outline)", () => {
    const sched = buildSchedule(
      [{ id: "x", title: "T", format: "podcast_outline", preferredChannels: ["email"] }],
      { periodStart: new Date(Date.UTC(2026, 5, 1)), periodEnd: new Date(Date.UTC(2026, 5, 10)) },
    );
    assert.equal(sched[0].channel, "email");
  });

  it("buildSchedule steers a single item off an already-busy day", () => {
    // Ideal lands on Mon Mar 2 but it's already crowded → nudges to an open day.
    const sched = buildSchedule([{ id: "x", title: "T", format: "blog_post" }], {
      periodStart: new Date(Date.UTC(2026, 2, 2)), // Mon
      periodEnd: new Date(Date.UTC(2026, 2, 20)),
      skipWeekends: true,
      existingDayCounts: { "2026-03-02": 5 },
    });
    const placed = new Date(sched[0].scheduledAt);
    const placedKey = `${placed.getUTCFullYear()}-03-${String(placed.getUTCDate()).padStart(2, "0")}`;
    assert.notEqual(placedKey, "2026-03-02", "should not stack on the busy day");
    const day = placed.getUTCDay();
    assert.ok(day !== 0 && day !== 6, "weekday only");
  });

  it("buildSchedule does not cluster many items on the same busy day", () => {
    const sched = buildSchedule(items(4, "blog_post"), {
      periodStart: new Date(Date.UTC(2026, 2, 2)),
      periodEnd: new Date(Date.UTC(2026, 2, 27)),
      skipWeekends: true,
    });
    const dayKeys = sched.map((s) => new Date(s.scheduledAt).toISOString().slice(0, 10));
    assert.equal(new Set(dayKeys).size, dayKeys.length, "each item on a distinct day");
  });

  it("buildSchedule with empty existing load matches plain spread", () => {
    const opts = {
      periodStart: new Date(Date.UTC(2026, 0, 5)),
      periodEnd: new Date(Date.UTC(2026, 0, 30)),
      skipWeekends: true,
    };
    const a = buildSchedule(items(5), opts);
    const b = buildSchedule(items(5), { ...opts, existingDayCounts: {} });
    assert.deepEqual(a.map((s) => s.scheduledAt), b.map((s) => s.scheduledAt));
  });

});
