import { strict as assert } from "node:assert";
import {
  scoreProspect,
  buildIcpCriteria,
  matchesAny,
  findDisqualifier,
  DEFAULT_THRESHOLD,
  type IcpCriteria,
} from "../prospector-core";

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

const PE_CIO_ICP: IcpCriteria = {
  roles: ["CIO", "ops leader"],
  industries: ["private equity"],
  geographies: ["Seattle"],
  segments: ["mid-market"],
  disqualifiers: ["intern", "student"],
};

(async () => {
  await test("matchesAny is case-insensitive and bidirectional", () => {
    assert.equal(matchesAny("Chief Information Officer (CIO)", ["cio"]), true);
    assert.equal(matchesAny("CIO", ["Chief Information Officer"]), false); // substring both ways but neither contains the other fully → false here
    assert.equal(matchesAny("VP Sales", ["CIO"]), false);
    assert.equal(matchesAny("", ["cio"]), false);
    assert.equal(matchesAny("CIO", []), false);
  });

  await test("a strong PE CIO in Seattle qualifies", () => {
    const r = scoreProspect(
      {
        title: "CIO",
        industry: "Private Equity",
        geography: "Seattle, WA",
        segment: "mid-market",
        email: "jane@fund.com",
        linkedinUrl: "https://linkedin.com/in/jane",
      },
      PE_CIO_ICP,
    );
    assert.equal(r.disqualified, false);
    assert.equal(r.qualified, true);
    assert.equal(r.score, 100);
  });

  await test("missing signals lower the score below threshold", () => {
    const r = scoreProspect(
      { title: "Marketing Manager", industry: "Retail", email: null, linkedinUrl: null },
      PE_CIO_ICP,
    );
    assert.equal(r.qualified, false);
    assert.ok(r.score < DEFAULT_THRESHOLD);
  });

  await test("disqualifier is a hard stop (score 0, disqualified)", () => {
    const r = scoreProspect(
      { title: "CIO Intern", industry: "Private Equity", geography: "Seattle", email: "x@y.com" },
      PE_CIO_ICP,
    );
    assert.equal(r.disqualified, true);
    assert.equal(r.qualified, false);
    assert.equal(r.score, 0);
    assert.match(r.disqualifiedReason || "", /intern/i);
  });

  await test("findDisqualifier scans title and company", () => {
    assert.equal(findDisqualifier({ companyName: "Student Union" }, ["student"]), "student");
    assert.equal(findDisqualifier({ title: "CIO" }, ["intern"]), undefined);
  });

  await test("threshold is configurable", () => {
    const attrs = { title: "CIO", email: "x@y.com" }; // role(35)+email(12)=47
    assert.equal(scoreProspect(attrs, { roles: ["CIO"], threshold: 40 }).qualified, true);
    assert.equal(scoreProspect(attrs, { roles: ["CIO"], threshold: 50 }).qualified, false);
  });

  await test("buildIcpCriteria merges persona + filter and dedupes", () => {
    const c = buildIcpCriteria(
      { role: "CIO", industry: "Private Equity", companySize: "mid-market" },
      { targetRoles: ["CIO", "ops leader"], industries: ["private equity"], geographies: ["Seattle"], segments: [] },
    );
    assert.deepEqual(c.roles, ["CIO", "ops leader"]);
    assert.deepEqual(c.industries, ["Private Equity"]);
    assert.deepEqual(c.geographies, ["Seattle"]);
    assert.deepEqual(c.segments, ["mid-market"]);
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll prospector-core tests passed");
})();
