import { describe, expect, it } from "vitest";
import { contextFingerprint, buildOutreachContextBlock } from "../outreach-context-core";
import { bulkMessagingSchema, externalActivitySchema, segmentBriefsSchema } from "@shared/outreach-context";
describe("outreach context contracts", () => {
  it("keeps familiarity independent from all four messaging groups", () => {
    for (const group of ["customer", "prospect", "partner", "partner_prospect"]) {
      expect(buildOutreachContextBlock(group, [], [], "cold")).toContain("introduce the sender briefly");
      expect(buildOutreachContextBlock(group, [], [], "known")).toContain("skip the sender bio");
      expect(buildOutreachContextBlock(group, [], [], "unknown")).toContain("Do not infer familiarity from CRM");
    }
    expect(buildOutreachContextBlock("customer", [], [{ message: "Already introduced myself" }], "cold"))
      .toContain("Recorded correspondence takes precedence");
  });
  it("validates independent bulk edits, reset, duplicate IDs and the explicit size limit", () => {
    expect(bulkMessagingSchema.safeParse({ prospectIds: ["a"], familiarity: "known" }).success).toBe(true);
    expect(bulkMessagingSchema.safeParse({ prospectIds: ["a"], messagingGroup: null }).success).toBe(true);
    for (const input of [
      { prospectIds: [] , familiarity: "known" },
      { prospectIds: ["a"] },
      { prospectIds: ["a", "a"], familiarity: "known" },
      { prospectIds: ["a"], familiarity: "friend" },
      { prospectIds: ["a"], messagingGroup: "customer", hold: false },
      { prospectIds: Array.from({ length: 201 }, (_, i) => String(i)), familiarity: "cold" },
    ]) expect(bulkMessagingSchema.safeParse(input).success).toBe(false);
  });
  it("round-trips reordered JSONB without losing real-change detection", () => {
    expect(contextFingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(contextFingerprint({ b: { d: 3, c: 2 }, a: 1 }));
    expect(contextFingerprint({ reply: "" })).not.toBe(contextFingerprint({ reply: "yes" }));
  });
  it("never invents a group, relationship or send permission", () => {
    const text = buildOutreachContextBlock(null, [], []);
    expect(text).toContain("no messaging group was selected");
    expect(text).toContain("not send authorization");
    expect(text).toContain("not factual relationship status");
  });
  it("rejects duplicate group definitions and unknown fields", () => {
    const brief = { group: "customer", goal: "", ask: "", guidance: "", exclusions: "" };
    expect(segmentBriefsSchema.safeParse([brief, brief]).success).toBe(false);
    expect(externalActivitySchema.safeParse({ channel: "email", occurredAt: new Date().toISOString(), sender: "Me", message: "sent", outcome: "no_reply", send: true }).success).toBe(false);
  });
});
