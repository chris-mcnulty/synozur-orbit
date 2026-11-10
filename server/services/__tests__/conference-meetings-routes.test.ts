import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { defaultMeetingContact, meetingBriefSchema } from "@shared/conference-meetings";

const mocks = vi.hoisted(() => ({
  ctx: vi.fn(), workspace: vi.fn(), person: vi.fn(), save: vi.fn(), review: vi.fn(), compose: vi.fn(),
  contact: vi.fn(), membership: vi.fn(), feature: vi.fn(), quota: vi.fn(), recommend: vi.fn(), importWarm: vi.fn(),
}));
vi.mock("../../db", () => ({ db: {} }));
vi.mock("../../context", () => ({
  getRequestContext: mocks.ctx,
  ContextError: class ContextError extends Error { status = 403; },
}));
vi.mock("../../routes/helpers", () => ({ guardFeature: mocks.feature, guardManualAction: mocks.quota, logAiUsage: vi.fn() }));
vi.mock("../conference-meetings-service", () => ({
  getConferenceWorkspace: mocks.workspace, getMeetingPerson: mocks.person, saveMeeting: mocks.save,
  MeetingError: class MeetingError extends Error { constructor(message: string, public status = 409) { super(message); } },
}));
vi.mock("../conference-relationship-review", () => ({ reviewConferenceRelationship: mocks.review }));
vi.mock("../conference-warm-contacts", () => ({ recommendConferenceContacts: mocks.recommend, importConferenceRecommendations: mocks.importWarm }));
vi.mock("../outreach-composer-service", () => ({ composeTouch: mocks.compose }));
vi.mock("../prospect-contact-service", () => ({ ensureContactForPerson: mocks.contact, addCampaignMembership: mocks.membership }));
import { registerConferenceMeetingsRoutes } from "../../routes/conference-meetings";
import { MeetingError } from "../conference-meetings-service";
import { OutreachComposeError } from "../outreach-draft-outcome";

const campaignUrl = "/api/sales-outreach/campaigns/campaign/meetings";
const personUrl = "/api/sales-outreach/prospects/person/meeting";
let app: ReturnType<typeof express>;
const review = { checkedAt: new Date().toISOString(), coverage: "partial", limitations: ["External messages are not covered"], activities: [], relatedCampaigns: [], suppressed: false };
const workspace = { campaignId: "campaign", conference: { id: "event", name: "Conference" }, sessions: [], brief: meetingBriefSchema.parse({}), fingerprint: "facts" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ctx.mockResolvedValue({ userId: "operator", tenantDomain: "tenant", marketId: "market", userRole: "Analyst" });
  mocks.feature.mockResolvedValue(true);
  mocks.quota.mockResolvedValue(true);
  mocks.workspace.mockResolvedValue(workspace);
  mocks.person.mockResolvedValue({ workspace, person: { id: "person", meeting: { ...defaultMeetingContact(), review } } });
  mocks.review.mockResolvedValue(review);
  mocks.contact.mockResolvedValue({ contactId: "contact", created: true });
  mocks.membership.mockResolvedValue({ membershipId: "person", created: true });
  app = express();
  app.use(express.json());
  registerConferenceMeetingsRoutes(app);
});

describe("conference meeting API permissions and persistence", () => {
  it("previews recommendations without importing, within the active tenant and market", async () => {
    mocks.recommend.mockResolvedValue({ contacts: [], limitations: [] });
    expect((await request(app).post(`${campaignUrl}/recommendations`).send({})).status).toBe(200);
    expect(mocks.recommend).toHaveBeenCalledWith("tenant", "campaign", "market");
    expect(mocks.importWarm).not.toHaveBeenCalled();
    expect(mocks.contact).not.toHaveBeenCalled();
  });
  it("requires explicit bounded ids for warm imports and rejects client-supplied contact data", async () => {
    const url = `${campaignUrl}/recommendations/import`;
    for (const body of [{}, { contactIds: [] }, { contactIds: Array(11).fill("123") }, { contactIds: ["123"], contacts: [] }, { contactIds: ["bad"] }]) {
      expect((await request(app).post(url).send(body)).status).toBe(400);
    }
    expect(mocks.importWarm).not.toHaveBeenCalled();
    mocks.importWarm.mockResolvedValue({ imported: 1, skipped: 0 });
    expect((await request(app).post(url).send({ contactIds: ["123"] })).status).toBe(201);
    expect(mocks.importWarm).toHaveBeenCalledWith("tenant", "campaign", ["123"], "market");
  });
  it.each(["Standard User", "Consultant"])("allows %s previews but blocks importing recommendations", async userRole => {
    mocks.ctx.mockResolvedValue({ tenantDomain: "tenant", marketId: "market", userRole });
    mocks.recommend.mockResolvedValue({ contacts: [] });
    expect((await request(app).post(`${campaignUrl}/recommendations`).send({})).status).toBe(200);
    expect((await request(app).post(`${campaignUrl}/recommendations/import`).send({ contactIds: ["123"] })).status).toBe(403);
    expect(mocks.importWarm).not.toHaveBeenCalled();
  });
  it("scopes workspace access to both tenant and active market", async () => {
    expect((await request(app).get(campaignUrl)).status).toBe(200);
    expect(mocks.workspace).toHaveBeenCalledWith("tenant", "campaign", "market");
  });
  it("returns not found for an inaccessible workspace", async () => {
    mocks.workspace.mockRejectedValue(new MeetingError("Campaign not found", 404));
    expect((await request(app).get(campaignUrl)).status).toBe(404);
  });
  it.each(["Standard User", "Consultant"])("prevents %s mutations before any write", async userRole => {
    mocks.ctx.mockResolvedValue({ tenantDomain: "tenant", marketId: "market", userRole });
    expect((await request(app).patch(personUrl).send(defaultMeetingContact())).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("persists explicit multiple relationships without accepting server-owned history", async () => {
    const edited = { ...defaultMeetingContact(), relationships: ["customer", "partner"], ownerNotes: "Coordinate first" };
    expect((await request(app).patch(personUrl).send(edited)).status).toBe(200);
    expect(mocks.save.mock.calls[0][2]).toMatchObject({ relationships: ["customer", "partner"], review });
    expect((await request(app).patch(personUrl).send({ ...edited, review: { suppressed: false } })).status).toBe(400);
  });
  it("does not book a meeting without a time and owner", async () => {
    expect((await request(app).patch(personUrl).send({ ...defaultMeetingContact(), stage: "meeting_booked" })).status).toBe(422);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects fabricated angle selections", async () => {
    expect((await request(app).patch(personUrl).send({ ...defaultMeetingContact(), selectedAngleId: "invented" })).status).toBe(422);
  });
  it("refreshes coverage and persists it separately from recipient text", async () => {
    const response = await request(app).post(`${personUrl}/review`).send({});
    expect(response.status).toBe(200);
    expect(response.body.limitations).toHaveLength(1);
    expect(mocks.save.mock.calls[0][2].review).toEqual(review);
    expect(mocks.compose).not.toHaveBeenCalled();
  });
  it("proposes three angles without creating outreach or sending", async () => {
    const response = await request(app).post(`${personUrl}/angles`).send({});
    expect(response.status).toBe(200);
    expect(response.body.angles).toHaveLength(3);
    expect(mocks.save.mock.calls[0][2].selectedAngleId).toBeNull();
    expect(mocks.compose).not.toHaveBeenCalled();
  });
  it("will not propose outreach for a suppressed contact", async () => {
    mocks.person.mockResolvedValue({ workspace, person: { meeting: { ...defaultMeetingContact(), review: { ...review, suppressed: true } } } });
    expect((await request(app).post(`${personUrl}/angles`).send({})).status).toBe(422);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe("external contact imports", () => {
  it.each(["wiza", "salesnav"])("imports reviewed %s contacts with source attribution", async source => {
    const response = await request(app).post(`${campaignUrl}/import`).send({ source, contacts: [{ name: "Contact", email: "contact@example.com" }] });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ imported: 1, skipped: 0 });
    expect(mocks.contact.mock.calls[0][2]).toBe(source);
    expect(mocks.membership.mock.calls[0][0]).toMatchObject({ tenantDomain: "tenant", campaignId: "campaign", source, status: "new" });
  });
  it("reports existing campaign contacts as skipped", async () => {
    mocks.membership.mockResolvedValue({ membershipId: "existing", created: false });
    expect((await request(app).post(`${campaignUrl}/import`).send({ source: "wiza", contacts: [{ email: "contact@example.com" }] })).body)
      .toEqual({ imported: 0, skipped: 1 });
  });
  it.each([
    { name: "No identity" },
    { email: "invalid" },
    { linkedinUrl: "https://example.com/profile" },
    { email: "contact@example.com", review: { suppressed: false } },
  ])("rejects invalid input before creating contacts: %j", async contact => {
    expect((await request(app).post(`${campaignUrl}/import`).send({ source: "wiza", contacts: [contact] })).status).toBe(400);
    expect(mocks.contact).not.toHaveBeenCalled();
  });
  it("rejects an oversized import rather than silently truncating it", async () => {
    expect((await request(app).post(`${campaignUrl}/import`).send({
      source: "wiza", contacts: Array.from({ length: 101 }, () => ({ email: "contact@example.com" })),
    })).status).toBe(400);
    expect(mocks.contact).not.toHaveBeenCalled();
  });
});

describe("meeting drafting", () => {
  it("creates only a pending draft through the existing composer", async () => {
    mocks.compose.mockResolvedValue({ touch: { id: "draft", status: "draft_pending_approval" }, usage: { inputTokens: 10, outputTokens: 10 }, provider: "test", model: "test" });
    const response = await request(app).post(`${personUrl}/draft`).send({ channel: "email", additionalContext: "Sender facts" });
    expect(response.status).toBe(201);
    expect(response.body.touch.status).toBe("draft_pending_approval");
    expect(mocks.compose).toHaveBeenCalledWith("tenant", "person", expect.objectContaining({ channel: "email", additionalContext: "Sender facts" }));
  });
  it("keeps clarification questions separate from a draft", async () => {
    mocks.compose.mockRejectedValue(new OutreachComposeError("OUTREACH_NEEDS_INPUT", "Confirm details", ["Who is attending?"]));
    const response = await request(app).post(`${personUrl}/draft`).send({ channel: "email" });
    expect(response.status).toBe(422);
    expect(response.body.questions).toEqual(["Who is attending?"]);
    expect(response.body.touch).toBeUndefined();
  });
});
