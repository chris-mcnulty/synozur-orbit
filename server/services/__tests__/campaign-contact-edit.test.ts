import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), updatePerson: vi.fn() }));
vi.mock("../../db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("../prospect-contact-service", () => ({ updateContactPersonFields: mocks.updatePerson }));
import { editCampaignContact } from "../campaign-contact-edit-service";
import { defaultMeetingContact } from "@shared/conference-meetings";
beforeEach(() => vi.clearAllMocks());
function setup(overrides: Record<string, unknown> = {}, campaignMarket = "market") {
  const results = [
    [{ id: "person", contactId: "contact", campaignId: "campaign", classification: { tags: ["old"], sourceDetail: "existing", eventRoles: [] }, meeting: { ...defaultMeetingContact(), stage: "meeting_booked", meetingAt: "2026-12-01T14:00:00Z" }, ...overrides }],
    [{ id: "campaign", marketId: campaignMarket }],
    [{ id: "contact" }],
  ];
  const set = vi.fn(() => ({ where: async () => [] }));
  const tx = {
    select: () => {
      const value = results.shift();
      const chain: any = { from: () => chain, where: () => chain, for: () => Promise.resolve(value), then: (resolve: (v: unknown) => unknown) => Promise.resolve(value).then(resolve) };
      return chain;
    },
    update: () => ({ set }),
  };
  mocks.transaction.mockImplementation(async fn => fn(tx));
  return { tx, set };
}
describe("unified campaign contact editor", () => {
  it("saves details and classification in one transaction without changing the booked meeting", async () => {
    const { tx, set } = setup();
    await editCampaignContact("tenant", "market", "person", { name: "Casey", email: "casey@example.com" },
      { classification: { tags: ["friend"], relationships: ["partner"] }, familiarity: "personal_friend", messagingGroup: "partner" });
    expect(mocks.updatePerson).toHaveBeenCalledWith("contact", { name: "Casey", email: "casey@example.com" }, tx);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      classification: { tags: ["friend"], sourceDetail: "existing", eventRoles: [] },
      familiarity: "personal_friend", messagingGroup: "partner",
      meeting: expect.objectContaining({ relationships: ["partner"], stage: "meeting_booked", meetingAt: "2026-12-01T14:00:00Z" }),
    }));
  });
  it("supports clearing tags and messaging group deliberately", async () => {
    const { set } = setup();
    await editCampaignContact("tenant", "market", "person", { name: "Casey" }, { classification: { tags: [] }, messagingGroup: null, familiarity: "unknown" });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ classification: expect.objectContaining({ tags: [] }), messagingGroup: null, familiarity: "unknown" }));
  });
  it("rejects removed contacts and different markets before changing shared details", async () => {
    setup({ removedAt: new Date() });
    await expect(editCampaignContact("tenant", "market", "person", {}, { familiarity: "known" })).rejects.toThrow(/Contact not found/);
    expect(mocks.updatePerson).not.toHaveBeenCalled();
    setup({}, "other");
    await expect(editCampaignContact("tenant", "market", "person", {}, { familiarity: "known" })).rejects.toThrow(/Campaign not found/);
    expect(mocks.updatePerson).not.toHaveBeenCalled();
  });
  it("propagates shared-contact failures to roll back the whole transaction", async () => {
    const { set } = setup();
    mocks.updatePerson.mockRejectedValueOnce(new Error("email conflict"));
    await expect(editCampaignContact("tenant", "market", "person", {}, { familiarity: "personal_friend" })).rejects.toThrow("email conflict");
    expect(set).not.toHaveBeenCalled();
  });
});
