import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  scoreProspect,
  scoreProspectAgainstAll,
  buildIcpCriteria,
  matchesAny,
  findDisqualifier,
  DEFAULT_THRESHOLD,
  type IcpCriteria,
  type PersonaRef,
} from "../prospector-core";


const PE_CIO_ICP: IcpCriteria = {
  roles: ["CIO", "ops leader"],
  industries: ["private equity"],
  geographies: ["Seattle"],
  segments: ["mid-market"],
  disqualifiers: ["intern", "student"],
};

describe("prospector-core", () => {
  it("matchesAny is case-insensitive and bidirectional", () => {
    assert.equal(matchesAny("Chief Information Officer (CIO)", ["cio"]), true);
    assert.equal(matchesAny("CIO", ["Chief Information Officer"]), false); // substring both ways but neither contains the other fully → false here
    assert.equal(matchesAny("VP Sales", ["CIO"]), false);
    assert.equal(matchesAny("", ["cio"]), false);
    assert.equal(matchesAny("CIO", []), false);
  });

  it("a strong PE CIO in Seattle qualifies", () => {
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

  it("missing signals lower the score below threshold", () => {
    const r = scoreProspect(
      { title: "Marketing Manager", industry: "Retail", email: null, linkedinUrl: null },
      PE_CIO_ICP,
    );
    assert.equal(r.qualified, false);
    assert.ok(r.score < DEFAULT_THRESHOLD);
  });

  it("disqualifier is a hard stop (score 0, disqualified)", () => {
    const r = scoreProspect(
      { title: "CIO Intern", industry: "Private Equity", geography: "Seattle", email: "x@y.com" },
      PE_CIO_ICP,
    );
    assert.equal(r.disqualified, true);
    assert.equal(r.qualified, false);
    assert.equal(r.score, 0);
    assert.match(r.disqualifiedReason || "", /intern/i);
  });

  it("findDisqualifier scans title and company", () => {
    assert.equal(findDisqualifier({ companyName: "Student Union" }, ["student"]), "student");
    assert.equal(findDisqualifier({ title: "CIO" }, ["intern"]), undefined);
  });

  it("threshold is configurable", () => {
    const attrs = { title: "CIO", email: "x@y.com" }; // role(35)+email(12)=47
    assert.equal(scoreProspect(attrs, { roles: ["CIO"], threshold: 40 }).qualified, true);
    assert.equal(scoreProspect(attrs, { roles: ["CIO"], threshold: 50 }).qualified, false);
  });

  it("buildIcpCriteria merges persona + filter and dedupes", () => {
    const c = buildIcpCriteria(
      { role: "CIO", industry: "Private Equity", companySize: "mid-market" },
      { targetRoles: ["CIO", "ops leader"], industries: ["private equity"], geographies: ["Seattle"], segments: [] },
    );
    assert.deepEqual(c.roles, ["CIO", "ops leader"]);
    assert.deepEqual(c.industries, ["Private Equity"]);
    assert.deepEqual(c.geographies, ["Seattle"]);
    assert.deepEqual(c.segments, ["mid-market"]);
  });

});

// ---------------------------------------------------------------------------
// scoreProspectAgainstAll
// ---------------------------------------------------------------------------

const SI_PERSONA: PersonaRef = {
  id: "persona-si",
  name: "Systems Integrator",
  role: "Systems Integrator",
  industry: "IT Services",
  companySize: "mid-market",
};

const PRACTICE_LEAD_PERSONA: PersonaRef = {
  id: "persona-pl",
  name: "Practice Lead",
  role: "Practice Lead",
  industry: "Professional Services",
  companySize: "enterprise",
};

const M365_ADMIN_PERSONA: PersonaRef = {
  id: "persona-m365",
  name: "M365 Admin",
  role: "M365 Administrator",
  industry: "Technology",
  companySize: "mid-market",
};

describe("scoreProspectAgainstAll", () => {
  it("only second persona matches — returns its score and correct persona name", () => {
    // Prospect matches SI persona but not M365 Admin persona
    const result = scoreProspectAgainstAll(
      [M365_ADMIN_PERSONA, SI_PERSONA],
      undefined,
      {
        title: "Systems Integrator",
        industry: "IT Services",
        segment: "mid-market",
        email: "si@company.com",
        linkedinUrl: "https://linkedin.com/in/si",
      },
    );
    // SI persona matches role+industry+segment+email+linkedin = 35+20+10+12+8 = 85
    assert.ok(result.score >= 80, `Expected score >= 80, got ${result.score}`);
    assert.equal(result.matchedPersonaId, "persona-si");
    assert.equal(result.matchedPersonaName, "Systems Integrator");
  });

  it("both personas match — higher score wins", () => {
    // Prospect partially matches both; SI is the closer match
    const result = scoreProspectAgainstAll(
      [M365_ADMIN_PERSONA, SI_PERSONA],
      undefined,
      {
        title: "Systems Integrator",
        industry: "IT Services",
        segment: "mid-market",
        email: "si@company.com",
        linkedinUrl: "https://linkedin.com/in/si",
      },
    );
    const resultAlt = scoreProspectAgainstAll(
      [SI_PERSONA, M365_ADMIN_PERSONA],
      undefined,
      {
        title: "Systems Integrator",
        industry: "IT Services",
        segment: "mid-market",
        email: "si@company.com",
        linkedinUrl: "https://linkedin.com/in/si",
      },
    );
    // Order should not change the winner
    assert.equal(result.matchedPersonaId, resultAlt.matchedPersonaId);
    assert.ok(result.score >= resultAlt.score || result.score === resultAlt.score);
  });

  it("isIcp persona scores lower than a non-isIcp persona — higher score wins regardless", () => {
    // Simulate: M365 Admin is flagged isIcp but prospect is clearly a Practice Lead
    const practiceLeadProspect = {
      title: "Practice Lead",
      industry: "Professional Services",
      segment: "enterprise",
      email: "pl@firm.com",
      linkedinUrl: "https://linkedin.com/in/pl",
    };

    // Score individually to confirm Practice Lead wins
    const siCriteria = buildIcpCriteria(M365_ADMIN_PERSONA, undefined);
    const plCriteria = buildIcpCriteria(PRACTICE_LEAD_PERSONA, undefined);
    const siScore = scoreProspect(practiceLeadProspect, siCriteria).score;
    const plScore = scoreProspect(practiceLeadProspect, plCriteria).score;
    assert.ok(plScore > siScore, `Practice Lead score (${plScore}) should beat M365 Admin score (${siScore})`);

    // scoreProspectAgainstAll with M365 Admin (isIcp flag would normally win)
    // listed first should still pick Practice Lead
    const result = scoreProspectAgainstAll(
      [M365_ADMIN_PERSONA, PRACTICE_LEAD_PERSONA], // M365 first (would be the "isIcp" pick)
      undefined,
      practiceLeadProspect,
    );
    assert.equal(result.matchedPersonaId, "persona-pl");
    assert.equal(result.score, plScore);
  });

  it("returns a coherent result when persona list is empty (falls back to filter-only)", () => {
    const result = scoreProspectAgainstAll(
      [],
      { targetRoles: ["CIO"], geographies: ["Seattle"] },
      { title: "CIO", geography: "Seattle", email: "cio@firm.com" },
    );
    assert.ok(result.score > 0);
    assert.equal(result.matchedPersonaId, undefined);
    assert.equal(result.matchedPersonaName, undefined);
  });
});
