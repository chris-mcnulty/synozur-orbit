import { describe, expect, it } from "vitest";
import { effectiveScoringFacts, rescoreRequestSchema } from "./prospect-scoring";
import { scoreProspect } from "../server/services/prospector-core";
import { applyCampaignClassification } from "./campaign-classification";
describe("operator scoring facts", () => {
  it("uses supplied facts rather than stale enrichment, including explicit unknowns", () => {
    const facts = { title: "CIO", industry: "IT Services", geography: "US", segment: "" };
    expect(effectiveScoringFacts({ title: "Old role", signals: { segment: "Enterprise" }, classification: { scoringFacts: facts } })).toEqual(facts);
  });
  it("distinguishes absent data from a genuine mismatch", () => {
    const scored = scoreProspect({ title: "CIO", email: "test@example.invalid", linkedinUrl: "https://linkedin.com/in/test" }, { roles: ["Alliances Lead"], industries: ["IT Services"], geographies: ["United States"], segments: ["Enterprise"] });
    expect(scored.score).toBe(20);
    expect(scored.breakdown.signals.find(s => s.key === "role")).toMatchObject({ matched: false });
    expect(scored.breakdown.signals.find(s => s.key === "industry")).toMatchObject({ absent: true });
  });
  it("accepts US country aliases without inventing title fit", () => {
    const scored = scoreProspect({ title: "CIO", industry: "IT Services", geography: "US", email: "test@example.invalid", linkedinUrl: "https://linkedin.com/in/test" }, { roles: ["Alliances Lead"], industries: ["IT Services"], geographies: ["United States"], segments: ["Enterprise"] });
    expect(scored.score).toBe(55);
  });
  it("stores requested-meeting priority without changing attendance or fit facts", () => {
    const facts = { title: "", industry: "", geography: "", segment: "" };
    const result = applyCampaignClassification({ tags: [], eventRoles: [], sourceDetail: "", scoringFacts: facts }, null, { meetingPriority: "requested_meeting" });
    expect(result).not.toHaveProperty("meeting");
    expect(result.classification.scoringFacts).toEqual(facts);
    expect(result.classification.meetingPriority).toBe("requested_meeting");
  });
  it("rejects arbitrary score overrides and overlong facts", () => {
    expect(rescoreRequestSchema.safeParse({ score: 100 }).success).toBe(false);
    expect(rescoreRequestSchema.safeParse({ facts: { title: "a".repeat(301), industry: "", geography: "", segment: "" } }).success).toBe(false);
  });
});
