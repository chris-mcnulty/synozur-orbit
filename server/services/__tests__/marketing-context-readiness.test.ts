import { strict as assert } from "node:assert";
import { deriveReadiness, type ReadinessInputs } from "../marketing-context-readiness-core";

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

const FULL: ReadinessInputs = {
  hasCompanyProfile: true,
  companyHasDescription: true,
  personaCount: 3,
  icpPersonaCount: 1,
  messagingFrameworkGenerated: true,
  gtmPlanGenerated: true,
  productCount: 2,
  competitorCount: 4,
  brand: { primaryColorCustomised: true, hasLogo: true, fontCount: 2 },
};

const EMPTY: ReadinessInputs = {
  hasCompanyProfile: false,
  companyHasDescription: false,
  personaCount: 0,
  icpPersonaCount: 0,
  messagingFrameworkGenerated: false,
  gtmPlanGenerated: false,
  productCount: 0,
  competitorCount: 0,
  brand: { primaryColorCustomised: false, hasLogo: false, fontCount: 0 },
};

function statusFor(input: ReadinessInputs, key: string) {
  return deriveReadiness(input).items.find((i) => i.key === key)?.status;
}

(async () => {
  await test("fully-populated tenant scores 100 and is ready", () => {
    const r = deriveReadiness(FULL);
    assert.equal(r.score, 100);
    assert.equal(r.overall, "ready");
    assert.equal(r.missingCount, 0);
    assert.equal(r.thinCount, 0);
    assert.equal(r.readyCount, r.totalCount);
  });

  await test("empty tenant is incomplete with a low score", () => {
    const r = deriveReadiness(EMPTY);
    assert.equal(r.overall, "incomplete");
    assert.ok(r.score < 50, `expected score < 50, got ${r.score}`);
    // gtmPlan is "thin" (recommended, not required) even when everything else is missing
    assert.equal(statusFor(EMPTY, "gtmPlan"), "thin");
    assert.equal(statusFor(EMPTY, "companyProfile"), "missing");
  });

  await test("personas without an ICP flag are thin, not ready", () => {
    const input = { ...FULL, personaCount: 2, icpPersonaCount: 0 };
    assert.equal(statusFor(input, "icp"), "thin");
  });

  await test("1–2 competitors is thin; 3+ is ready; 0 is missing", () => {
    assert.equal(statusFor({ ...FULL, competitorCount: 2 }, "competitors"), "thin");
    assert.equal(statusFor({ ...FULL, competitorCount: 3 }, "competitors"), "ready");
    assert.equal(statusFor({ ...FULL, competitorCount: 0 }, "competitors"), "missing");
  });

  await test("company profile without description is thin", () => {
    assert.equal(
      statusFor({ ...FULL, hasCompanyProfile: true, companyHasDescription: false }, "companyProfile"),
      "thin",
    );
  });

  await test("brand kit: logo + (color or font) is ready; partial is thin; none is missing", () => {
    assert.equal(
      statusFor({ ...FULL, brand: { primaryColorCustomised: false, hasLogo: true, fontCount: 1 } }, "brandKit"),
      "ready",
    );
    assert.equal(
      statusFor({ ...FULL, brand: { primaryColorCustomised: true, hasLogo: false, fontCount: 0 } }, "brandKit"),
      "thin",
    );
    assert.equal(
      statusFor({ ...FULL, brand: { primaryColorCustomised: false, hasLogo: false, fontCount: 0 } }, "brandKit"),
      "missing",
    );
  });

  await test("messaging framework (MPF) is binary ready/missing", () => {
    assert.equal(statusFor({ ...FULL, messagingFrameworkGenerated: true }, "messagingFramework"), "ready");
    assert.equal(statusFor({ ...FULL, messagingFrameworkGenerated: false }, "messagingFramework"), "missing");
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll marketing-context-readiness tests passed");
})();
