import { describe, expect, it } from "vitest";
import { contextFingerprint, buildOutreachContextBlock } from "../outreach-context-core";
import { externalActivitySchema, segmentBriefsSchema } from "@shared/outreach-context";
describe("outreach context contracts", () => {
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
