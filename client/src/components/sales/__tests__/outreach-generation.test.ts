import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/queryClient";
import { generateWithOutreachReview, isOutreachContextError } from "../outreach-generation";
import { matchesAssignedMessagingGroup } from "../use-outreach-context";

const conflict = () => new ApiError(409, "Context changed", undefined, undefined, { code: "OUTREACH_CONTEXT_CHANGED" });
const hold = () => new ApiError(409, "Contact on hold", undefined, undefined, { code: "OUTREACH_ON_HOLD", questions: ["This must never become a private clarification."] });
describe("bounded outreach generation", () => {
  it("reopens preflight once after a context conflict and uses the new fingerprint", async () => {
    const confirm = vi.fn().mockResolvedValueOnce("initial").mockResolvedValueOnce("refreshed");
    const generate = vi.fn().mockRejectedValueOnce(conflict()).mockResolvedValueOnce("draft");
    await expect(generateWithOutreachReview({ confirm, generate, fingerprint: "previous" })).resolves.toBe("draft");
    expect(confirm.mock.calls).toEqual([["previous"], []]);
    expect(generate.mock.calls).toEqual([["initial"], ["refreshed"]]);
  });
  it("stops after a repeated conflict instead of creating an infinite review/retry loop", async () => {
    const confirm = vi.fn().mockResolvedValue("snapshot");
    const generate = vi.fn().mockRejectedValue(conflict());
    await expect(generateWithOutreachReview({ confirm, generate })).rejects.toMatchObject({ code: "OUTREACH_CONTEXT_CHANGED" });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("returns hold errors immediately without retrying or treating them as private questions", async () => {
    const confirm = vi.fn().mockResolvedValue("snapshot");
    const generate = vi.fn().mockRejectedValue(hold());
    await expect(generateWithOutreachReview({ confirm, generate })).rejects.toMatchObject({ code: "OUTREACH_ON_HOLD" });
    expect(confirm).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledOnce();
    expect(isOutreachContextError(hold())).toBe(true);
    expect(isOutreachContextError(conflict())).toBe(true);
    expect(isOutreachContextError(new ApiError(422, "Missing event date", undefined, undefined, { code: "OUTREACH_NEEDS_INPUT" }))).toBe(false);
  });
  it("leaves normal model clarification and transport errors to the existing recovery flow", async () => {
    const error = new ApiError(422, "Needs event details", undefined, undefined, { code: "OUTREACH_NEEDS_INPUT" });
    const confirm = vi.fn().mockResolvedValue("snapshot");
    const generate = vi.fn().mockRejectedValue(error);
    await expect(generateWithOutreachReview({ confirm, generate })).rejects.toBe(error);
    expect(confirm).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledOnce();
  });
});
describe("canonical messaging-group filter", () => {
  it("matches only explicit assignments, and includes no-group contacts in the shared-brief filter", () => {
    expect(matchesAssignedMessagingGroup({ messagingGroup: "partner_prospect" }, "partner_prospect")).toBe(true);
    expect(matchesAssignedMessagingGroup({ messagingGroup: "partner" }, "partner_prospect")).toBe(false);
    expect(matchesAssignedMessagingGroup({ messagingGroup: null }, "unassigned")).toBe(true);
    expect(matchesAssignedMessagingGroup({}, "unassigned")).toBe(true);
    expect(matchesAssignedMessagingGroup({ messagingGroup: "customer" }, "unassigned")).toBe(false);
    expect(matchesAssignedMessagingGroup({}, "all")).toBe(true);
  });
  it("does not infer a group from a contact title, company, or relationship classification", () => {
    const unassigned = { title: "Partner", companyName: "Customer Systems", classification: { relationship: "customer" }, messagingGroup: null };
    expect(matchesAssignedMessagingGroup(unassigned, "partner")).toBe(false);
    expect(matchesAssignedMessagingGroup(unassigned, "customer")).toBe(false);
    expect(matchesAssignedMessagingGroup(unassigned, "unassigned")).toBe(true);
  });
});
