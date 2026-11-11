import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { meetingBriefSchema } from "@shared/conference-meetings";
const mocks = vi.hoisted(() => ({ where: vi.fn() }));
vi.mock("../../db", () => ({ db: { select: () => ({ from: () => ({ where: mocks.where }) }) } }));
import { buildConferenceOutreachContext, loadConferenceOutreachContext } from "../conference-outreach-context";
import { meetingFactsFingerprint } from "../conference-meetings-core";
const event = { id: "event", name: "Conference", thematicBrief: "Partner collaboration around AI adoption.", description: "Annual industry conference." };
const outreach = { salesGoal: "Meet ten alliance contacts", interview: { message: "Find practical partner opportunities", notes: "Prioritize existing relationships", answers: [{ question: "What matters?", answer: "Joint customer projects" }] }, targetingFilter: { namedAccounts: ["Avanade"] }, meetingBrief: null };
const promotion = { name: "Original event plan", objective: "Build partner relationships", goal: "Ten qualified meetings", thematicBrief: "Practical AI outcomes", description: "A plan for our event activity" };
beforeEach(() => vi.clearAllMocks());
describe("reuse original event context without duplicating setup", () => {
  it("includes both description and full brief plus original objectives and interview answers", () => {
    const result = buildConferenceOutreachContext(event, outreach, promotion);
    expect(result.sourceContext.eventBrief).toBe(event.thematicBrief);
    expect(result.sourceContext.eventDescription).toBe(event.description);
    expect(result.sourceContext.eventGoals).toContain(promotion.goal);
    expect(result.sourceContext.campaignBrief).toContain("Joint customer projects");
    expect(result.sourceContext.campaignBrief).toContain(promotion.thematicBrief);
    expect(result.suggestedBrief.goals).toContain(outreach.salesGoal);
    expect(result.suggestedBrief.goals).toContain(promotion.objective);
    expect(result.suggestedBrief.targetAccounts).toBe("Avanade");
    expect(result.effectiveBrief).toBeNull();
    expect(outreach.meetingBrief).toBeNull();
  });
  it("preserves saved overrides and never enables a disabled brief", () => {
    const saved = meetingBriefSchema.parse({ enabled: false, goals: "Customer renewals", targetAccounts: "Existing customer", availability: "Tuesday", schedulingUrl: "https://example.com/book" });
    const result = buildConferenceOutreachContext(event, { ...outreach, meetingBrief: saved }, promotion);
    expect(result.effectiveBrief).toEqual(saved);
    expect(result.sourceContext.eventBrief).toBe(event.thematicBrief);
  });
  it("inherits missing goals/accounts without overwriting the stored brief", () => {
    const saved = meetingBriefSchema.parse({});
    const result = buildConferenceOutreachContext(event, { ...outreach, meetingBrief: saved }, promotion);
    expect(result.effectiveBrief?.goals).toContain(outreach.salesGoal);
    expect(result.effectiveBrief?.targetAccounts).toBe("Avanade");
    expect(saved.goals).toBe("");
  });
  it("does not invent context when no event plan or interview exists", () => {
    const result = buildConferenceOutreachContext({ thematicBrief: null, description: null }, { salesGoal: null, interview: null, targetingFilter: null, meetingBrief: null });
    expect(result.suggestedBrief.goals).toBe("");
    expect(result.sourceContext.sourceCampaignName).toBeNull();
    expect(result.effectiveBrief).toBeNull();
  });
  it("bounds suggested fields to editable brief limits", () => {
    const result = buildConferenceOutreachContext(event, { ...outreach, salesGoal: "x".repeat(5000) });
    expect(result.suggestedBrief.goals.length).toBe(4000);
    expect(() => meetingBriefSchema.parse(result.suggestedBrief)).not.toThrow();
  });
  it("invalidates reviewed context when original objectives change", () => {
    const source = buildConferenceOutreachContext(event, outreach, promotion).sourceContext;
    const first = meetingFactsFingerprint(event as any, [], null, source);
    expect(meetingFactsFingerprint(event as any, [], null, { ...source, eventGoals: "Changed objective" })).not.toBe(first);
    expect(meetingFactsFingerprint(event as any, [], null, { ...source, campaignBrief: "Changed brief" })).not.toBe(first);
  });
  it("loads the linked plan with tenant and deleted-status constraints", async () => {
    mocks.where.mockResolvedValue([{ ...promotion, marketId: "market" }]);
    const result = await loadConferenceOutreachContext("tenant", { ...event, campaignId: "promotion", marketId: "market" } as any, { ...outreach, marketId: "market" } as any);
    expect(result.sourceContext.sourceCampaignName).toBe(promotion.name);
    const sql = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0].getSQL());
    expect(sql.params).toEqual(["promotion", "tenant", "deleted"]);
  });
  it("does not inherit a different market's plan", async () => {
    mocks.where.mockResolvedValue([{ ...promotion, marketId: "other-market" }]);
    const result = await loadConferenceOutreachContext("tenant", { ...event, campaignId: "promotion", marketId: "market" } as any, { ...outreach, marketId: "market" } as any);
    expect(result.sourceContext.sourceCampaignName).toBeNull();
    expect(result.sourceContext.eventGoals).toBe("");
  });
});
