import { describe, expect, it } from "vitest";
import { applyCampaignClassification, campaignClassificationRequestSchema, classificationPatchSchema } from "./campaign-classification";
import { defaultMeetingContact } from "./conference-meetings";

describe("campaign classification", () => {
  it("adds and removes case-insensitive tags without replacing existing ones", () => {
    const current = { tags: ["VIP"], eventRoles: ["speaker" as const], sourceDetail: "From me" };
    const added = applyCampaignClassification(current, null, { tags: ["vip", "Breakfast"], tagsMode: "add" });
    expect(added.classification).toEqual({ ...current, tags: ["VIP", "Breakfast"] });
    expect(applyCampaignClassification(added.classification, null, { tags: ["VIP"], tagsMode: "remove" }).classification.tags).toEqual(["Breakfast"]);
    expect(applyCampaignClassification(current, null, { tags: [] }).classification.tags).toEqual([]);
  });
  it("updates canonical relationship and attendance without discarding meeting history or angles", () => {
    const meeting = { ...defaultMeetingContact(), ownerNotes: "Private", selectedHook: "Saved hook", anglesFingerprint: "fingerprint" };
    const result = applyCampaignClassification(null, meeting, { relationships: ["customer", "partner", "unknown"], attendance: "confirmed" });
    expect(result.meeting).toMatchObject({ relationships: ["customer", "partner"], attendance: "confirmed", ownerNotes: "Private", selectedHook: "Saved hook", anglesFingerprint: "fingerprint" });
    expect(meeting.relationships).toEqual(["unknown"]);
  });
  it("does not imply attendance or alter prep when assigning speaker or tags", () => {
    expect(applyCampaignClassification(null, null, { eventRoles: ["speaker"], tags: ["Confirmed attendee"] })).not.toHaveProperty("meeting");
  });
  it("clears explicit fields but preserves omitted fields", () => {
    const result = applyCampaignClassification({ tags: ["VIP"], eventRoles: ["speaker"], sourceDetail: "Referral" }, null, { eventRoles: [], sourceDetail: "" });
    expect(result.classification).toEqual({ tags: ["VIP"], eventRoles: [], sourceDetail: "" });
  });
  it.each([{ source: "hubspot" }, { status: "sent" }, { meeting: {} }, { tags: [" "] }, { relationships: [] }, { attendance: "yes" }, { eventRoles: ["attendee"] }, {}, { tagsMode: "add" }])("rejects invalid or protected fields %j", patch => {
    expect(classificationPatchSchema.safeParse(patch).success).toBe(false);
  });
  it("bounds bulk requests and tag counts after merging", () => {
    expect(campaignClassificationRequestSchema.safeParse({ prospectIds: Array(201).fill("id"), patch: { tags: [] } }).success).toBe(false);
    expect(() => applyCampaignClassification({ tags: Array.from({ length: 30 }, (_, i) => `tag${i}`), eventRoles: [], sourceDetail: "" }, null, { tags: ["extra"], tagsMode: "add" })).toThrow(/30/);
  });
});
