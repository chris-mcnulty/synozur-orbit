import { describe, expect, it } from "vitest";
import { buildOutreachWorkspace, type WorkspacePerson, type WorkspaceTouch } from "../outreach-workspace-core";
import { newProspectMetadata } from "@shared/outreach-campaign-workspace";
import { defaultMeetingContact } from "@shared/conference-meetings";

const now = new Date("2026-11-12T20:00:00Z");
const before = new Date("2026-11-10T12:00:00Z");
const campaign = { name: "Current campaign", status: "active", salesGoal: "Book meetings", conferenceId: null };
function person(id: string, patch: Partial<WorkspacePerson> = {}): WorkspacePerson {
  return { id, contactId: `contact-${id}`, name: id, companyName: null, status: "new",
    researchDossier: null, nextActionAt: null, classification: null, meeting: null,
    outreachHold: false, emailOptOut: false, ...patch };
}
const touch = (id: string, status = "draft_pending_approval"): WorkspaceTouch => ({
  id: `draft-${id}`, prospectId: id, status, generatedAt: before, sentAt: null,
});
describe("campaign next steps and factual summary", () => {
  it("includes companies, actual external communication and unscheduled meeting agreements", () => {
    const result = buildOutreachWorkspace(campaign, [person("a", { companyName: "Example Co" })], [],
      [{ contactId: "contact-a", direction: "outbound", outcome: "meeting_agreed", occurredAt: before, followUpAt: null }], now);
    expect(result.counts).toMatchObject({
      contacts: 1, worked: 1, communicated: 1, externallyContacted: 1, externalCommunications: 1,
      sent: 0, replied: 1, meetings: 1, bookedMeetings: 0, agreedMeetings: 1,
    });
    expect(result.meetings[0]).toMatchObject({ status: "agreed", meetingAt: null, contacts: [{ name: "a", companyName: "Example Co" }] });
    expect(result.summary).toContain("a (Example Co)");
    expect(result.summary).toContain("1 total meetings");
  });
  it("counts a linked booking once and lists every active participant with their company", () => {
    const meeting = { ...defaultMeetingContact(), stage: "meeting_booked" as const,
      sharedMeetingId: "a", meetingAt: "2026-11-18T16:00:00Z", meetingLocation: "Lobby", meetingOwner: "Owner" };
    const result = buildOutreachWorkspace(campaign, [
      person("a", { meeting, companyName: "Example" }), person("b", { meeting, companyName: "Example" }),
      person("removed", { meeting, removedAt: before }),
    ], [], [
      { contactId: "contact-a", direction: "outbound", outcome: "meeting_agreed", occurredAt: before, followUpAt: null },
      { contactId: "contact-removed", direction: "inbound", outcome: "meeting_agreed", occurredAt: before, followUpAt: null },
    ], now);
    expect(result.counts).toMatchObject({ contacts: 2, meetings: 1, bookedMeetings: 1, agreedMeetings: 0, externalCommunications: 1 });
    expect(result.meetings[0].contacts.map(contact => contact.prospectId)).toEqual(["a", "b"]);
    expect(result.summary).toContain("b (Example)");
    expect(result.summary).not.toContain("• removed");
  });
  it("keeps done reminders hidden across refreshes and leaves restrictions untouched", () => {
    const input = person("a", { outreachHold: true });
    const original = buildOutreachWorkspace(campaign, [input], [], [], now).items[0];
    input.signals = { preserved: "existing evidence", nextStepCompletions: {
      [original.id]: { version: original.version, completedAt: before.toISOString(), completedBy: "operator" },
    } };
    const refreshed = buildOutreachWorkspace(campaign, [input], [], [], new Date("2026-11-13T20:00:00Z"));
    expect(refreshed.items).toEqual([]);
    expect(refreshed.completedItems).toHaveLength(1);
    expect(refreshed.counts.held).toBe(1);
  });
  it("reopens a completed review when newer external conversation evidence arrives", () => {
    const activities = [{ contactId: "contact-a", direction: "inbound", outcome: "replied", occurredAt: before, followUpAt: null }];
    const input = person("a");
    const original = buildOutreachWorkspace(campaign, [input], [], activities, now).items[0];
    input.signals = { nextStepCompletions: { [original.id]: { version: original.version, completedAt: before.toISOString(), completedBy: "operator" } } };
    const changed = buildOutreachWorkspace(campaign, [input], [], [
      ...activities, { ...activities[0], occurredAt: now },
    ], now);
    expect(changed.items[0].version).not.toBe(original.version);
    expect(changed.completedItems).toEqual([]);
  });
  it("sorts urgent overdue actions before high drafts and normal research", () => {
    const result = buildOutreachWorkspace(campaign, [person("Normal"), person("Draft"), person("Late", { nextActionAt: before })], [touch("Draft")], [], now);
    expect(result.items.map(i => i.priority)).toEqual(["urgent", "high", "normal"]);
    expect(result.items[1]).toMatchObject({ action: "review_draft", touchId: "draft-Draft" });
    expect(result.counts).toMatchObject({ contacts: 3, pendingDrafts: 1, overdue: 1 });
  });
  it("never proposes outreach to held, opted-out or do-not-contact people", () => {
    const people = [person("held", { outreachHold: true }), person("opted", { emailOptOut: true }),
      person("blocked", { meeting: { ...defaultMeetingContact(), stage: "do_not_contact" } })];
    const result = buildOutreachWorkspace(campaign, people, people.map(p => touch(p.id)), [], now);
    expect(result.items.every(i => i.action === "review_history")).toBe(true);
    expect(result.counts.held).toBe(3);
  });
  it("does not mistake approval for a sent message", () => {
    const result = buildOutreachWorkspace(campaign, [person("a")], [touch("a", "approved")], [], now);
    expect(result.counts.sent).toBe(0);
    expect(result.items[0].title).toBe("Check approved message");
    expect(result.summary).toContain("Approved drafts are not counted as sent");
  });
  it("counts replied contacts once across internal and external history", () => {
    const result = buildOutreachWorkspace(campaign, [person("a", { status: "replied", nextActionAt: before })], [touch("a", "replied")],
      [{ contactId: "contact-a", direction: "inbound", outcome: "replied", occurredAt: before, followUpAt: null }], now);
    expect(result.counts.replied).toBe(1);
    expect(result.counts.overdue).toBe(0);
    expect(result.items[0].action).toBe("review_history");
  });
  it("uses external follow-up dates and produces unique action identifiers", () => {
    const result = buildOutreachWorkspace(campaign, [person("a")], [],
      [{ contactId: "contact-a", direction: "inbound", outcome: "replied", occurredAt: before, followUpAt: before }], now);
    expect(result.counts.overdue).toBe(1);
    expect(new Set(result.items.map(i => i.id)).size).toBe(result.items.length);
  });
  it("excludes removed contacts and their messages", () => {
    const result = buildOutreachWorkspace(campaign, [person("a", { removedAt: before })], [touch("a")], [], now);
    expect(result.counts.contacts).toBe(0);
    expect(result.counts.pendingDrafts).toBe(0);
    expect(result.items).toEqual([]);
  });
  it("routes requested meetings to meeting preparation only for event campaigns", () => {
    const people = [person("a", { classification: { tags: [], eventRoles: [], sourceDetail: "", meetingPriority: "requested_meeting" } })];
    expect(buildOutreachWorkspace(campaign, people, [], [], now).items[0].action).toBe("review_history");
    expect(buildOutreachWorkspace({ ...campaign, conferenceId: "event" }, people, [], [], now).items[0].action).toBe("meeting");
  });
  it("does not suggest starting outreach over existing external history", () => {
    const result = buildOutreachWorkspace(campaign, [person("a")], [],
      [{ contactId: "contact-a", direction: "outbound", outcome: "no_reply", occurredAt: before, followUpAt: null }], now);
    expect(result.items[0].action).toBe("review_history");
    expect(result.counts.sent).toBe(0);
  });
  it("keeps archived campaigns informational and summaries reproducible", () => {
    const result = buildOutreachWorkspace({ ...campaign, status: "archived" }, [person("a")], [], [], now);
    expect(result.items).toEqual([]);
    expect(result.generatedAt).toBe(now.toISOString());
    expect(result.summary).toContain("Book meetings");
  });
  it.each(["inbound", "outbound"])("uses shared %s history for recommendations but keeps campaign counts", direction => {
    const shared = [{ contactId: "contact-a", direction, outcome: direction === "inbound" ? "replied" : "no_reply",
      occurredAt: before, followUpAt: before }];
    const result = buildOutreachWorkspace(campaign, [person("a", { status: "researched" })], [], [], now, shared);
    expect(result.items.every(i => i.action === "review_history")).toBe(true);
    expect(result.items.some(i => i.title === "Review overdue follow-up")).toBe(true);
    expect(result.counts).toMatchObject({ contacts: 1, pendingDrafts: 0, sent: 0, replied: 0, held: 0, overdue: 0 });
  });
  it("does not let unrelated contact history suppress a fresh recommendation", () => {
    const result = buildOutreachWorkspace(campaign, [person("a", { status: "researched" })], [], [], now,
      [{ contactId: "contact-other", direction: "inbound", outcome: "replied", occurredAt: before, followUpAt: before }]);
    expect(result.items.map(i => i.action)).toEqual(["compose"]);
  });
  it("preserves campaign follow-up counts when shared replies change the recommended action", () => {
    const result = buildOutreachWorkspace(campaign, [person("a", { nextActionAt: before })], [touch("a")], [], now,
      [{ contactId: "contact-a", direction: "inbound", outcome: "replied", occurredAt: before, followUpAt: null }]);
    expect(result.counts).toMatchObject({ pendingDrafts: 1, replied: 0, overdue: 1 });
    expect(result.items.map(i => i.action)).toEqual(["review_draft", "review_history"]);
  });
});
describe("classification at contact creation", () => {
  it("inserts personal tags, relationship, priority and familiarity together", () => {
    const metadata = newProspectMetadata({ classification: { tags: ["personal"], relationships: ["partner"], meetingPriority: "high" }, familiarity: "known", messagingGroup: "partner" });
    expect(metadata.classification?.tags).toEqual(["personal"]);
    expect(metadata.meeting?.relationships).toEqual(["partner"]);
    expect(metadata.classification?.meetingPriority).toBe("high");
    expect(metadata.familiarity).toBe("known");
  });
  it("omits unprovided metadata and rejects invalid input before writes", () => {
    expect(newProspectMetadata({ name: "New person" })).toEqual({});
    expect(() => newProspectMetadata({ familiarity: "invented" })).toThrow();
    expect(() => newProspectMetadata({ classification: { relationships: ["personal_contact"] } })).toThrow();
    expect(() => newProspectMetadata({ classification: { tags: ["x".repeat(61)] } })).toThrow();
  });
});
