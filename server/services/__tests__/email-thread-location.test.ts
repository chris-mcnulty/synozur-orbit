import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../ai-provider", () => ({ completeForFeature: vi.fn() }));
import { validateEmailThread } from "../email-thread-parser";
import { signThreadLocation, signThreadMeetingReview, verifyThreadLocation } from "../email-thread-location";
import { defaultMeetingContact } from "@shared/conference-meetings";

export const venue = "Multipurpose Room, Convene, Galleria Park Hotel";
const thread = `From: Host <host@example.invalid>
Please use my official invitation. We will meet in ${venue}.
From: Guest <guest@example.invalid>
I cancelled my duplicate invitation, not our meeting. We will use your official invitation.
Signature: Pacific Time. Traveling November 17–21.
----- Original invitation -----
Where: TBD`;
const suggestion = { location: venue, evidence: `We will meet in ${venue}.`, status: "current" as const };
const scope = { tenantDomain: "tenant", marketId: "market", userId: "user", campaignId: "campaign" };
afterEach(() => vi.unstubAllEnvs());
describe("grounded venue extraction", () => {
  it("keeps the explicit room and hotel, not the earlier placeholder or signature timezone", () => {
    const result = validateEmailThread(thread, JSON.stringify({ contacts: [], meetingTimes: [], meetingLocations: [
      suggestion, { location: "TBD", evidence: "Where: TBD", status: "superseded" },
      { location: "Invented room", evidence: suggestion.evidence, status: "current" },
    ] }));
    expect(result.meetingLocations).toEqual([suggestion]);
    expect(result.meetingTimes).toEqual([]);
  });
  it("preserves actual cancellation and conflict classifications rather than turning them into current venues", () => {
    const result = validateEmailThread(`Meeting at ${venue} is cancelled. Room B is an alternative.`, JSON.stringify({
      contacts: [], meetingTimes: [], meetingLocations: [
        { location: venue, evidence: `Meeting at ${venue} is cancelled.`, status: "cancelled" },
        { location: "Room B", evidence: "Room B is an alternative.", status: "unclear" },
      ],
    }));
    expect(result.meetingLocations?.map(s => s.status)).toEqual(["cancelled", "unclear"]);
  });
  it("accepts old extraction responses without a venue", () => {
    expect(validateEmailThread("Hello", '{"contacts":[],"meetingTimes":[]}').meetingLocations).toEqual([]);
  });
});
describe("signed venue and full meeting snapshot", () => {
  it("rejects changed evidence, every scope boundary, expired and changed snapshots", () => {
    vi.stubEnv("SESSION_SECRET", "test-only-thread-review-secret");
    const meeting = { ...defaultMeetingContact(), meetingAt: "2026-11-18T17:00:00Z", meetingOwner: "Host", meetingLocation: "TBD" };
    const expires = Date.now() + 60_000;
    const token = signThreadLocation(scope, suggestion);
    const review = signThreadMeetingReview(scope, "person", "event", meeting, expires);
    const verify = (s = scope, m = meeting, candidate = suggestion, id = "person", event = "event", expiry = expires) =>
      verifyThreadLocation(s, candidate, token, review, id, event, m, expiry);
    expect(() => verify()).not.toThrow();
    expect(() => verify(scope, Object.fromEntries(Object.entries(meeting).reverse()) as typeof meeting)).not.toThrow();
    for (const field of ["tenantDomain", "marketId", "userId", "campaignId"] as const) {
      expect(() => verify({ ...scope, [field]: "wrong" })).toThrow();
    }
    for (const edit of [{ meetingOwner: "Other" }, { ownerNotes: "New note" }, { meetingLocation: venue }, { meetingAt: "2026-11-19T17:00:00Z" }]) {
      expect(() => verify(scope, { ...meeting, ...edit })).toThrow(/stale/);
    }
    expect(() => verify(scope, meeting, { ...suggestion, location: "Room B" })).toThrow(/evidence/);
    expect(() => verify(scope, meeting, suggestion, "other")).toThrow(/stale/);
    expect(() => verify(scope, meeting, suggestion, "person", "other")).toThrow(/stale/);
    expect(() => verify(scope, meeting, suggestion, "person", "event", Date.now() - 1)).toThrow(/stale/);
    expect(() => verifyThreadLocation(scope, { ...suggestion, status: "cancelled" }, token, review, "person", "event", meeting, expires)).toThrow(/evidence/);
  });
});
