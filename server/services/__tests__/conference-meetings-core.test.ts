import { describe, expect, it } from "vitest";
import {
  defaultMeetingContact, eventPresenceSchema, meetingBriefSchema, meetingContactEditSchema,
} from "@shared/conference-meetings";
import {
  activityAfterDraft, assertMeetingCanDraft, meetingContactFingerprint, meetingDraftFingerprint,
  meetingFactsFingerprint, proposeMeetingAngles,
} from "../conference-meetings-core";

const event = {
  id: "event", name: "Example conference", startDate: new Date("2026-11-17T00:00:00Z"), endDate: new Date("2026-11-20T00:00:00Z"),
  location: "Venue", website: "https://example.com", boothDetails: null, presence: null,
};
const review = {
  checkedAt: "2026-11-10T12:00:00Z", coverage: "partial" as const, limitations: ["LinkedIn not covered"],
  activities: [], relatedCampaigns: [], suppressed: false,
};
const brief = meetingBriefSchema.parse({});

describe("conference meeting facts and validation", () => {
  it("rejects invalid zones, huge history windows and unknown writable fields", () => {
    expect(eventPresenceSchema.safeParse({ timezone: "Invalid/Zone" }).success).toBe(false);
    expect(meetingBriefSchema.safeParse({ lookbackDays: 999 }).success).toBe(false);
    expect(meetingContactEditSchema.safeParse({ ...defaultMeetingContact(), review }).success).toBe(false);
  });
  it("supports overlapping relationships independently of job titles", () => {
    expect(meetingContactEditSchema.parse({ ...defaultMeetingContact(), relationships: ["customer", "partner"] }).relationships).toHaveLength(2);
  });
  it("requires timezone offset for booked meeting timestamps", () => {
    expect(meetingContactEditSchema.safeParse({ ...defaultMeetingContact(), meetingAt: "2026-11-18T10:00:00" }).success).toBe(false);
    expect(meetingContactEditSchema.safeParse({ ...defaultMeetingContact(), meetingAt: "2026-11-18T10:00:00-08:00" }).success).toBe(true);
  });
  it("changes fingerprints for relevant facts, not input order", () => {
    const a = { id: "a", title: "A", sessionStart: null, sessionEnd: null, room: null, speakers: [], url: null };
    const b = { ...a, id: "b" };
    const original = meetingFactsFingerprint(event, [a, b], brief);
    expect(meetingFactsFingerprint(event, [b, a], brief)).toBe(original);
    expect(meetingFactsFingerprint({ ...event, name: "Changed" }, [a, b], brief)).not.toBe(original);
    expect(meetingFactsFingerprint(event, [a, { ...b, room: "New room" }], brief)).not.toBe(original);
    expect(meetingFactsFingerprint(event, [a, b], { ...brief, goals: "Customers first" })).not.toBe(original);
  });
  it.each(["attendanceEvidence", "relationshipNotes", "ownerNotes"] as const)("invalidates angles when %s changes", field => {
    const contact = defaultMeetingContact();
    expect(meetingContactFingerprint("facts", { ...contact, [field]: "new" })).not.toBe(meetingContactFingerprint("facts", contact));
  });
  it("invalidates drafts when the selected ask changes", () => {
    const contact = defaultMeetingContact();
    expect(meetingDraftFingerprint("facts", { ...contact, selectedAsk: "New ask" })).not.toBe(meetingDraftFingerprint("facts", contact));
  });
});

describe("grounded meeting angles", () => {
  it("proposes three choices without inventing history, attendance or a staff session", () => {
    const angles = proposeMeetingAngles(event.name, defaultMeetingContact(), review, []);
    expect(angles).toHaveLength(3);
    expect(angles[0].evidence.join(" ")).toMatch(/No recent conversation evidence/);
    expect(angles.every(a => a.cautions.some(c => c.includes("Attendance is not confirmed")))).toBe(true);
    expect(angles[2].evidence.join(" ")).toMatch(/no staff speaking session/);
  });
  it("does not describe another company's speaker as ours", () => {
    const angles = proposeMeetingAngles(event.name, defaultMeetingContact(), review, [{ id: "s", title: "Other session", speakers: [{ name: "Other", isStaff: false }] }]);
    expect(angles[2].hook).not.toContain("Other session");
  });
  it("uses explicit staff sessions and customer/partner relationship context", () => {
    const angles = proposeMeetingAngles(event.name, { ...defaultMeetingContact(), relationships: ["customer", "partner"] }, review,
      [{ id: "s", title: "Confirmed session", speakers: [{ name: "Staff", isStaff: true }] }]);
    expect(angles[1].hook).toBe("Customer priorities check-in");
    expect(angles[2].hook).toContain("Confirmed session");
    expect(angles[2].cautions.join(" ")).toContain("not proof");
  });
  it("warns about overlap and preserves source evidence", () => {
    const angles = proposeMeetingAngles(event.name, defaultMeetingContact(), {
      ...review, relatedCampaigns: ["Other campaign"],
      activities: [{ id: "a", source: "hubspot", kind: "email", at: "2026-11-09T00:00:00Z", summary: "Discussed roadmap" }],
    }, []);
    expect(angles[0].evidence[0]).toContain("Discussed roadmap");
    expect(angles[0].cautions.join(" ")).toContain("relationship owner");
  });
});

describe("draft and approval boundaries", () => {
  const meeting = () => {
    const contact = { ...defaultMeetingContact(), review };
    const angles = proposeMeetingAngles(event.name, contact, review, []);
    return { ...contact, angles, selectedAngleId: angles[0].id, selectedHook: angles[0].hook, selectedAsk: angles[0].ask, anglesFingerprint: "current" };
  };
  it("allows a reviewed selected angle", () => {
    expect(() => assertMeetingCanDraft(meeting(), "current")).not.toThrow();
  });
  it.each(["do_not_contact", "declined", "unavailable"] as const)("blocks %s", stage => {
    expect(() => assertMeetingCanDraft({ ...meeting(), stage }, "current")).toThrow();
  });
  it("blocks nonattendees, suppressions, stale evidence and unselected angles", () => {
    expect(() => assertMeetingCanDraft({ ...meeting(), attendance: "not_attending" }, "current")).toThrow();
    expect(() => assertMeetingCanDraft({ ...meeting(), review: { ...review, suppressed: true } }, "current")).toThrow();
    expect(() => assertMeetingCanDraft(meeting(), "changed")).toThrow(/changed/);
    expect(() => assertMeetingCanDraft({ ...meeting(), selectedAngleId: null }, "current")).toThrow(/select/);
  });
  it("detects activity after a draft, not earlier activity", () => {
    const withActivity = { ...review, activities: [{ id: "a", source: "hubspot" as const, kind: "email", at: "2026-11-10T13:00:00Z", summary: "Reply" }] };
    expect(activityAfterDraft(withActivity, new Date("2026-11-10T12:00:00Z"))).toBe(true);
    expect(activityAfterDraft(withActivity, new Date("2026-11-10T14:00:00Z"))).toBe(false);
  });
});
