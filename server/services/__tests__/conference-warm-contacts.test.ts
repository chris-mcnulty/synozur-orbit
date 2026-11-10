import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultMeetingContact, meetingBriefSchema } from "@shared/conference-meetings";
const mocks = vi.hoisted(() => ({
  workspace: vi.fn(), crm: vi.fn(), history: vi.fn(), ensure: vi.fn(), membership: vi.fn(),
  rows: [] as unknown[][], selects: vi.fn(),
}));
vi.mock("../../db", () => ({
  db: {
    select: (...args: unknown[]) => {
      mocks.selects(...args);
      const rows = mocks.rows.shift() ?? [];
      const chain: any = {
        from: () => chain, innerJoin: () => chain, where: () => chain,
        orderBy: () => chain, limit: () => chain,
        then: (resolve: (value: unknown[]) => void) => Promise.resolve(rows).then(resolve),
      };
      return chain;
    },
  },
}));
vi.mock("../conference-meetings-service", () => ({
  getConferenceWorkspace: mocks.workspace,
  MeetingError: class extends Error { constructor(message: string, public status = 409) { super(message); } },
}));
vi.mock("../hubspot-integration", () => ({ readConferenceHubspotContacts: mocks.crm }));
vi.mock("../conference-relationship-review", () => ({ readHubspotRelationship: mocks.history }));
vi.mock("../prospect-contact-service", () => ({ ensureContactForPerson: mocks.ensure, addCampaignMembership: mocks.membership }));
import { importConferenceRecommendations, recommendConferenceContacts } from "../conference-warm-contacts";

const crmPerson = (id: string, patch: object = {}) => ({
  hubspotContactId: id, name: `Person ${id}`, email: `${id}@example.invalid`, firstName: "Person", lastName: id,
  company: "Acme", jobTitle: "Strategy Director", linkedinUrl: null, crmOwnerId: "crm-owner", lifecycleStage: "customer",
  optedOut: false, ...patch,
});
const localPerson = (patch: object = {}) => ({
  id: "shared", tenantDomain: "tenant", hubspotContactId: "123", email: "123@example.invalid",
  linkedinUrl: null, emailOptOut: false, lifecycleStage: "customer", ...patch,
});
const membership = (patch: object = {}) => ({
  person: { id: "other-person", campaignId: "other", contactId: "shared", ownerUserId: "existing-owner", meeting: { ...defaultMeetingContact(), relationships: ["partner"] }, ...patch },
  campaignName: "Other campaign",
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rows = [];
  mocks.workspace.mockResolvedValue({
    campaignId: "campaign", conference: { marketId: "market" }, brief: meetingBriefSchema.parse({ goals: "Strategy", targetAccounts: "Acme" }),
  });
  mocks.crm.mockResolvedValue({ contacts: [crmPerson("123")], limitations: ["Bounded sample"] });
  mocks.history.mockResolvedValue({ activities: [], limitations: ["HubSpot emails history is unavailable."] });
  mocks.membership.mockResolvedValue({ created: true });
  mocks.ensure.mockResolvedValue({ contactId: "new-shared" });
});

describe("conference warm shortlist safeguards", () => {
  it("previews shared contacts with reasons and coverage without creating contacts or memberships", async () => {
    mocks.rows = [[localPerson()], [membership()], [], []];
    const result = await recommendConferenceContacts("tenant", "campaign", "market");
    expect(mocks.workspace).toHaveBeenCalledWith("tenant", "campaign", "market");
    expect(result.contacts[0]).toMatchObject({
      hubspotContactId: "123", attendance: "unknown", ownerUserIds: ["existing-owner"], relationships: ["partner", "customer"],
    });
    expect(result.contacts[0].limitations.join(" ")).toContain("unavailable");
    expect(result.contacts[0].reasons.join(" ")).toContain("Acme");
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.membership).not.toHaveBeenCalled();
  });
  it("excludes suppressed, opted-out, existing campaign members and do-not-contact relationships", async () => {
    mocks.crm.mockResolvedValue({ contacts: [crmPerson("123"), crmPerson("2", { optedOut: true }), crmPerson("3")], limitations: [] });
    mocks.rows = [
      [localPerson(), localPerson({ id: "third", hubspotContactId: "3", email: "3@example.invalid" })],
      [membership({ meeting: { ...defaultMeetingContact(), stage: "do_not_contact" } })],
      [{ email: "3@example.invalid" }],
    ];
    const result = await recommendConferenceContacts("tenant", "campaign", "market");
    expect(result.contacts).toEqual([]);
    expect(mocks.history).not.toHaveBeenCalled();
    mocks.rows = [[localPerson()], [membership({ campaignId: "campaign" })], []];
    mocks.crm.mockResolvedValue({ contacts: [crmPerson("123")], limitations: [] });
    expect((await recommendConferenceContacts("tenant", "campaign", "market")).contacts).toEqual([]);
  });
  it("never chooses between conflicting shared identities", async () => {
    mocks.rows = [[localPerson(), localPerson({ id: "email-match", hubspotContactId: null })], [], []];
    expect((await recommendConferenceContacts("tenant", "campaign")).contacts).toEqual([]);
  });
  it("bounds history reads and result count to ten contacts", async () => {
    mocks.crm.mockResolvedValue({ contacts: Array.from({ length: 30 }, (_, i) => crmPerson(String(i + 1))), limitations: [] });
    mocks.rows = [[], []];
    const result = await recommendConferenceContacts("tenant", "campaign");
    expect(result.contacts).toHaveLength(10);
    expect(mocks.history).toHaveBeenCalledTimes(10);
    expect(result.candidateCount).toBe(30);
  });
  it("rejects an absent or disabled brief before making CRM requests", async () => {
    mocks.workspace.mockResolvedValue({ brief: null });
    await expect(recommendConferenceContacts("tenant", "campaign")).rejects.toThrow("Save an active");
    expect(mocks.crm).not.toHaveBeenCalled();
  });
  it("prevents concurrent CRM preview fan-out and releases the lock after failure", async () => {
    let reject!: (error: Error) => void;
    mocks.crm.mockReturnValueOnce(new Promise((_, r) => { reject = r; }));
    const first = recommendConferenceContacts("tenant", "campaign");
    await vi.waitFor(() => expect(mocks.crm).toHaveBeenCalled());
    await expect(recommendConferenceContacts("tenant", "other")).rejects.toThrow("already being checked");
    reject(new Error("unavailable"));
    await expect(first).rejects.toThrow("HubSpot contacts are unavailable");
    mocks.rows = [[], []];
    await expect(recommendConferenceContacts("tenant", "campaign")).resolves.toBeDefined();
  });
});

describe("explicit warm shortlist imports", () => {
  it("revalidates selected CRM records and reuses shared identity and existing owner even when email changed", async () => {
    mocks.crm.mockResolvedValue({ contacts: [crmPerson("123", { email: "changed@example.invalid" })], limitations: [] });
    mocks.rows = [[localPerson()], [membership()], []];
    expect(await importConferenceRecommendations("tenant", "campaign", ["123", "123"], "market")).toEqual({ imported: 1, skipped: 0 });
    expect(mocks.crm).toHaveBeenCalledWith("tenant", { ids: ["123"] });
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.membership).toHaveBeenCalledWith(expect.objectContaining({
      contactId: "shared", ownerUserId: "existing-owner", tenantDomain: "tenant", marketId: "market",
      meeting: expect.objectContaining({ attendance: "unknown", attendanceEvidence: "", relationships: ["partner", "customer"] }),
    }));
  });
  it("does not overwrite existing membership or owner on repeated import", async () => {
    mocks.rows = [[localPerson()], [membership({ campaignId: "campaign" })], []];
    expect(await importConferenceRecommendations("tenant", "campaign", ["123"])).toEqual({ imported: 0, skipped: 1 });
    expect(mocks.membership).not.toHaveBeenCalled();
    expect(mocks.ensure).not.toHaveBeenCalled();
  });
  it("does not assign a CRM owner ID as an Orbit user or choose among multiple owners", async () => {
    mocks.rows = [[localPerson()], [membership(), membership({ id: "third", ownerUserId: "another" })], []];
    await importConferenceRecommendations("tenant", "campaign", ["123"]);
    expect(mocks.membership).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: null }));
  });
  it("excludes opt-outs and suppression discovered after preview", async () => {
    mocks.rows = [[localPerson()], [membership()], [{ email: "123@example.invalid" }]];
    expect(await importConferenceRecommendations("tenant", "campaign", ["123"])).toEqual({ imported: 0, skipped: 1 });
    expect(mocks.membership).not.toHaveBeenCalled();
  });
  it("creates a shared identity only after selection, preserving HubSpot attribution", async () => {
    mocks.rows = [[], []];
    await importConferenceRecommendations("tenant", "campaign", ["123"]);
    expect(mocks.ensure).toHaveBeenCalledWith("tenant", expect.objectContaining({ hubspotContactId: "123" }), "hubspot");
    expect(mocks.membership).toHaveBeenCalledWith(expect.objectContaining({ contactId: "new-shared", source: "hubspot" }));
  });
});
