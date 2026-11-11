import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultMeetingContact, meetingBriefSchema, type MeetingDraftContext } from "@shared/conference-meetings";

const mocks = vi.hoisted(() => ({
  rows: [] as any[][], person: vi.fn(), contacts: vi.fn(), review: vi.fn(), write: vi.fn(),
}));
vi.mock("../../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(mocks.rows.shift() ?? []) }) }),
    update: mocks.write,
  },
}));
vi.mock("../prospect-contact-service", () => ({
  getProspectWithContact: mocks.person, listCampaignProspects: mocks.contacts,
}));
vi.mock("../conference-relationship-review", () => ({ reviewConferenceRelationship: mocks.review }));
vi.mock("../conference-outreach-context", () => ({
  loadConferenceOutreachContext: vi.fn().mockResolvedValue({
    sourceContext: {}, effectiveBrief: { goals: "Partner meetings" },
  }),
}));
import { meetingCompositionContext, validateMeetingApproval } from "../conference-meetings-service";

const campaign = { id: "campaign", tenantDomain: "tenant", conferenceId: "event", meetingBrief: meetingBriefSchema.parse({ enabled: true }) };
const conference = { id: "event", name: "Conference" };
const direction = "Write as a peer. Ask about agent reliability. Do not invent a session or name customers.";
let person: any;
let review: any;
function queueWorkspace() { mocks.rows.push([campaign], [conference], []); }
async function compose() {
  queueWorkspace();
  return meetingCompositionContext("tenant", "person", direction);
}
async function approve(context: MeetingDraftContext) {
  mocks.rows.push([campaign]);
  queueWorkspace();
  return validateMeetingApproval("tenant", "person", context, new Date());
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.length = 0;
  person = { id: "person", campaignId: "campaign", tenantDomain: "tenant", meeting: defaultMeetingContact() };
  review = { checkedAt: new Date().toISOString(), coverage: "partial", limitations: ["External messages not covered"], activities: [], relatedCampaigns: [], suppressed: false };
  mocks.person.mockImplementation(async () => person);
  mocks.contacts.mockImplementation(async () => [person]);
  mocks.review.mockImplementation(async () => review);
});

describe("operator-supplied event direction", () => {
  it("checks history and drafts without any saved review or angle, preserving the brief", async () => {
    const result = await compose();
    expect(mocks.review).toHaveBeenCalledWith("tenant", "person", campaign.meetingBrief.lookbackDays);
    expect(result!.context.operatorBrief).toBe(direction);
    expect(result!.context.relationshipReview).toEqual(review);
    expect(result!.block).toContain(direction);
    expect(result!.block).toContain("Do not invent recipient-specific");
    expect(mocks.write).not.toHaveBeenCalled();
    await expect(approve(result!.context)).resolves.toBeUndefined();
    expect(mocks.review).toHaveBeenCalledTimes(2);
  });
  it.each([undefined, "", "  "])("normal Compose uses saved campaign context with private context %j", async privateContext => {
    queueWorkspace();
    const result = await meetingCompositionContext("tenant", "person", privateContext);
    expect(result!.block).toContain("Partner meetings");
    expect(result!.context.operatorBrief).toContain("saved event and campaign brief");
    expect(mocks.review).toHaveBeenCalledTimes(1);
    await expect(approve(result!.context)).resolves.toBeUndefined();
  });
  it("normal Compose still blocks suppression without private context", async () => {
    review.suppressed = true;
    queueWorkspace();
    await expect(meetingCompositionContext("tenant", "person")).rejects.toThrow(/suppressed/);
  });
  it("fails closed on a failed relationship check", async () => {
    mocks.review.mockRejectedValue(new Error("History unavailable"));
    await expect(compose()).rejects.toThrow("History unavailable");
  });
  it("blocks suppressed contacts even with a complete brief", async () => {
    review.suppressed = true;
    await expect(compose()).rejects.toThrow(/suppressed/);
  });
  it.each(["do_not_contact", "declined", "unavailable"])("preserves the %s exclusion", async stage => {
    person.meeting.stage = stage;
    await expect(compose()).rejects.toThrow(/excluded/);
  });
  it("does not override known non-attendance", async () => {
    person.meeting.attendance = "not_attending";
    await expect(compose()).rejects.toThrow(/excluded/);
  });
  it("rejects changed prep at approval", async () => {
    const result = await compose();
    person.meeting.ownerNotes = "New commitment";
    await expect(approve(result!.context)).rejects.toThrow(/changed/);
  });
  it("rejects changed direction and missing server review snapshots", async () => {
    const result = await compose();
    await expect(approve({ ...result!.context, operatorBrief: "Different direction" })).rejects.toThrow(/changed/);
    await expect(approve({ ...result!.context, relationshipReview: undefined })).rejects.toThrow(/changed/);
  });
  it.each(["suppression", "activity", "coverage"])("rechecks %s before approval", async kind => {
    const result = await compose();
    review = { ...review,
      suppressed: kind === "suppression",
      activities: kind === "activity" ? [{ at: new Date(Date.now() + 60000).toISOString() }] : [],
      limitations: kind === "coverage" ? ["New missing source"] : review.limitations,
    };
    await expect(approve(result!.context)).rejects.toThrow(
      kind === "suppression" ? /suppressed/ : kind === "activity" ? /New contact activity/ : /coverage changed/,
    );
  });
});
