import { strict as assert } from "node:assert";
import { analyzeOutreachPerformance, type PerfProspect } from "../outreach-performance-core";

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

// Build a prospect with a role-signal match flag and a status.
function p(status: string, roleMatched: boolean): PerfProspect {
  return {
    status,
    icpScore: roleMatched ? 70 : 30,
    scoreBreakdown: {
      signals: [
        { key: "role", label: "Role / title fit", weight: 35, matched: roleMatched },
        { key: "industry", label: "Industry fit", weight: 20, matched: true },
      ],
      total: roleMatched ? 70 : 30,
      threshold: 50,
    },
  };
}

(async () => {
  await test("funnel + reply rate over contacted", () => {
    const r = analyzeOutreachPerformance([
      p("new", true),
      p("researched", true),
      p("awaiting_reply", true),
      p("replied", true),
    ]);
    assert.equal(r.total, 4);
    assert.equal(r.contacted, 3); // excludes 'new'
    assert.equal(r.replied, 1);
    assert.ok(Math.abs(r.replyRate - 1 / 3) < 1e-9);
    assert.equal(r.funnel["new"], 1);
  });

  await test("signal lift: role-matched prospects reply more → positive lift, recommendation", () => {
    const prospects: PerfProspect[] = [
      // role matched: 3 of 4 replied
      p("replied", true), p("replied", true), p("replied", true), p("awaiting_reply", true),
      // role not matched: 0 of 4 replied
      p("awaiting_reply", false), p("awaiting_reply", false), p("dormant", false), p("sent", false),
    ];
    const r = analyzeOutreachPerformance(prospects);
    const role = r.signals.find((s) => s.key === "role")!;
    assert.equal(role.matched, 4);
    assert.equal(role.matchedReplied, 3);
    assert.ok((role.lift ?? 0) > 0.5);
    // Strongest converting signal sorts first.
    assert.equal(r.signals[0].key, "role");
    assert.ok(r.recommendations.some((x) => /Role/.test(x)));
  });

  await test("small sample → cautious recommendation, no false signal claims", () => {
    const r = analyzeOutreachPerformance([p("researched", true), p("awaiting_reply", true)]);
    assert.ok(r.recommendations.some((x) => /Too few/i.test(x)));
  });

  await test("empty input is safe", () => {
    const r = analyzeOutreachPerformance([]);
    assert.equal(r.total, 0);
    assert.equal(r.replyRate, 0);
    assert.equal(r.signals.length, 0);
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll outreach-performance-core tests passed");
})();
