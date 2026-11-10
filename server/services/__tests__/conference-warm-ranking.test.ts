import { describe, expect, it } from "vitest";
import type { WarmConferenceContact } from "@shared/conference-meetings";
import { rankWarmContact, sortWarmContacts } from "../conference-warm-ranking";
const person = (patch: Partial<WarmConferenceContact> = {}): WarmConferenceContact => ({
  hubspotContactId: "1", name: "Contact", email: null, company: null, jobTitle: null, linkedinUrl: null,
  crmOwnerId: null, ownerUserIds: [], relatedCampaigns: [], relationships: ["unknown"],
  score: 0, reasons: [], activities: [], limitations: [], attendance: "unknown", ...patch,
});
const brief = { goals: "AI strategy workshops", targetAccounts: "Acme, Walmart" };
describe("warm conference ranking", () => {
  it("explains exact account, goal and recorded relationship matches without attendance inference", () => {
    const result = rankWarmContact(person({ company: "Acme", jobTitle: "Strategy Director", relationships: ["customer", "partner"] }), brief);
    expect(result.score).toBe(65);
    expect(result.reasons.join(" ")).toContain("Acme");
    expect(result.reasons.join(" ")).toContain("strategy");
    expect(result.reasons.join(" ")).toContain("customer, partner");
    expect(result.attendance).toBe("unknown");
  });
  it("does not confuse substring accounts or treat missing activity access as inactivity", () => {
    const unavailable = rankWarmContact(person({ company: "Art", limitations: ["HubSpot history is unavailable"] }), brief);
    const accessibleEmpty = rankWarmContact(person({ company: "Art" }), brief);
    expect(unavailable.score).toBe(0);
    expect(unavailable.score).toBe(accessibleEmpty.score);
    expect(unavailable.limitations).toContain("HubSpot history is unavailable");
    expect(unavailable.reasons.join(" ")).not.toMatch(/inactive|no history/i);
  });
  it("uses dated accessible evidence and includes an owner coordination warning", () => {
    const result = rankWarmContact(person({
      ownerUserIds: ["owner"], relatedCampaigns: ["Existing campaign"],
      activities: [{ id: "a", source: "orbit", kind: "email sent", at: "2026-11-09T00:00:00Z", summary: "Workshops follow-up" }],
    }), brief);
    expect(result.score).toBe(25);
    expect(result.reasons.join(" ")).toContain("2026-11-09");
    expect(result.reasons.join(" ")).toContain("Ownership will not be reassigned");
    expect(result.reasons.join(" ")).toContain("does not establish a reply");
  });
  it("keeps ranking deterministic, and does not accumulate scores on reranking", () => {
    const first = rankWarmContact(person({ company: "Acme" }), brief);
    expect(rankWarmContact(first, brief).score).toBe(first.score);
    expect(sortWarmContacts([person({ hubspotContactId: "2", name: "Z", score: 40 }), first])[0]).toBe(first);
  });
});
