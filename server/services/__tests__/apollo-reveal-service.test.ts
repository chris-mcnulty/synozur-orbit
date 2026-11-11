import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  values: vi.fn(), claim: vi.fn(), reveal: vi.fn(), context: vi.fn(), score: vi.fn(),
}));
vi.mock("../../db", () => ({ db: {
  insert: () => ({ values: (data: unknown) => { mocks.values(data); return {
    onConflictDoNothing: () => ({ returning: mocks.claim }),
  }; } }),
} }));
vi.mock("../apollo-discovery-provider", () => ({ isApolloAvailable: () => true, revealApolloPersonById: mocks.reveal }));
vi.mock("../discovery-service", () => ({ loadCampaignContext: mocks.context }));
vi.mock("../prospector-core", () => ({ scoreProspectAgainstAll: mocks.score }));
import { scopedRevealedCandidate, revealApolloPreviews } from "../apollo-reveal-service";
import { signApolloPreviews, verifyApolloPreviews } from "../apollo-reveal-core";
import type { DiscoveryCandidate } from "../discovery-provider-core";
const scope = { tenantDomain: "tenant.example", campaignId: "campaign", userId: "operator" };
const person: DiscoveryCandidate = { name: "Alice Chen", companyName: "Acme", companyDomain: "acme.com", source: "apollo" };
function previews(count = 1, company = "Acme") {
  const signed = signApolloPreviews(Array.from({ length: count }, (_, i) => ({
    id: `person-${i}`, displayName: "Alice C***n", title: "Director", companyName: "Acme", companyDomain: "acme.com",
  })), scope, company, "test-secret");
  return { tokens: signed.map(p => p.token), verified: verifyApolloPreviews(signed.map(p => p.token), scope, "test-secret") };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.claim.mockResolvedValue([{ key: "claimed" }]);
  mocks.reveal.mockResolvedValue(person);
  mocks.context.mockResolvedValue({ campaign: { targetingFilter: { targetRoles: ["Director"] } }, campaignPersonas: [] });
  mocks.score.mockReturnValue({ score: 80, qualified: true, disqualified: false });
});
describe("reviewed Apollo reveal", () => {
  it("reveals only verified selected IDs, scores, and never persists contacts", async () => {
    const { tokens, verified } = previews();
    const result = await revealApolloPreviews(scope, tokens, verified);
    expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith("person-0");
    expect(result.candidates[0].candidate).toEqual(person);
    expect(result.attemptedCount).toBe(1);
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ tenantDomain: scope.tenantDomain, scope: "apollo-reveal-once", count: 1 }));
    expect(result.outcomes[0].status).toBe("revealed");
  });
  it("fails closed before spending credits if the persistent claim fails", async () => {
    mocks.claim.mockRejectedValueOnce(new Error("db unavailable"));
    const p = previews();
    const result = await revealApolloPreviews(scope, p.tokens, p.verified);
    expect(mocks.reveal).not.toHaveBeenCalled();
    expect(result.attemptedCount).toBe(0);
    expect(result.outcomes[0]).toMatchObject({ status: "failed", message: expect.stringContaining("No Apollo request") });
  });
  it("prevents concurrent/replayed requests from making a second paid call", async () => {
    let claimed = false;
    mocks.claim.mockImplementation(async () => {
      if (claimed) return [];
      claimed = true;
      return [{ key: "claim" }];
    });
    const p = previews();
    const results = await Promise.all([
      revealApolloPreviews(scope, p.tokens, p.verified),
      revealApolloPreviews(scope, p.tokens, p.verified),
    ]);
    expect(mocks.reveal).toHaveBeenCalledTimes(1);
    expect(results.flatMap(r => r.outcomes).map(r => r.status).sort()).toEqual(["already_attempted", "revealed"]);
  });
  it("reports partial failure without retrying or discarding successful contacts", async () => {
    mocks.reveal.mockResolvedValueOnce(person).mockRejectedValueOnce(new Error("timeout"));
    const p = previews(2);
    const result = await revealApolloPreviews(scope, p.tokens, p.verified);
    expect(mocks.reveal).toHaveBeenCalledTimes(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.attemptedCount).toBe(2);
    expect(result.outcomes.find(o => o.status === "failed")?.message).toContain("Credits may have been used");
  });
  it("withholds changed employers and incomplete identities after a paid attempt", async () => {
    mocks.reveal.mockResolvedValueOnce({ ...person, companyName: "Other" }).mockResolvedValueOnce(null);
    const p = previews(2);
    const result = await revealApolloPreviews(scope, p.tokens, p.verified);
    expect(result.candidates).toEqual([]);
    expect(result.outcomes.map(o => o.status).sort()).toEqual(["out_of_scope", "unavailable"]);
  });
  it("retains domain restrictions without inferring employer from email", () => {
    const p = previews(1, "acme.com").verified[0];
    expect(scopedRevealedCandidate({ ...person, companyDomain: undefined }, p)?.companyDomain).toBe("acme.com");
    expect(scopedRevealedCandidate({ ...person, companyDomain: "other.com" }, p)).toBeNull();
    expect(scopedRevealedCandidate({ ...person, companyName: "Other", email: "alice@acme.com" }, p)).toBeNull();
  });
});
