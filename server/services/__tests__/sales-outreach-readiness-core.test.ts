import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  deriveSalesReadiness,
  type SalesReadinessInputs,
} from "../sales-outreach-readiness-core";


// A fully-ready tenant + seller.
function ready(): SalesReadinessInputs {
  return {
    personaCount: 3,
    icpPersonaCount: 1,
    messagingFrameworkGenerated: true,
    productCount: 2,
    battlecardWithObjectionsCount: 2,
    voiceProfileCount: 1,
    hasPersonalVoiceProfile: true,
    hubspotConnected: true,
    mailboxConnected: true,
    mailboxCanDraft: true,
  };
}

function status(report: ReturnType<typeof deriveSalesReadiness>, key: string) {
  return report.items.find((i) => i.key === key)?.status;
}

describe("sales-outreach-readiness-core", () => {
  it("all signals present → ready, score 100", () => {
    const r = deriveSalesReadiness(ready());
    assert.equal(r.overall, "ready");
    assert.equal(r.score, 100);
    assert.equal(r.missingCount, 0);
    assert.equal(r.thinCount, 0);
  });

  it("empty tenant → incomplete, key fields missing", () => {
    const r = deriveSalesReadiness({
      personaCount: 0,
      icpPersonaCount: 0,
      messagingFrameworkGenerated: false,
      productCount: 0,
      battlecardWithObjectionsCount: 0,
      voiceProfileCount: 0,
      hasPersonalVoiceProfile: false,
      hubspotConnected: false,
      mailboxConnected: false,
      mailboxCanDraft: false,
    });
    assert.equal(r.overall, "incomplete");
    assert.equal(status(r, "icp"), "missing");
    assert.equal(status(r, "messagingFramework"), "missing");
    assert.equal(status(r, "hubspot"), "missing");
    assert.equal(status(r, "mailbox"), "missing");
    // Objections degrade to "thin", not "missing" (recommended, not required).
    assert.equal(status(r, "objections"), "thin");
  });

  it("personas without ICP flag → thin", () => {
    const r = deriveSalesReadiness({ ...ready(), icpPersonaCount: 0 });
    assert.equal(status(r, "icp"), "thin");
  });

  it("firm voice but no personal voice → thin", () => {
    const r = deriveSalesReadiness({ ...ready(), hasPersonalVoiceProfile: false });
    assert.equal(status(r, "voiceProfile"), "thin");
  });

  it("mailbox connected without mail scope → thin", () => {
    const r = deriveSalesReadiness({ ...ready(), mailboxCanDraft: false });
    assert.equal(status(r, "mailbox"), "thin");
  });

  it("counts and score stay consistent", () => {
    const r = deriveSalesReadiness(ready());
    assert.equal(r.readyCount + r.thinCount + r.missingCount, r.totalCount);
    assert.ok(r.score >= 0 && r.score <= 100);
  });

});
