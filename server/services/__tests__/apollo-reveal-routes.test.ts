import express from "express";
import request from "supertest";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  feature: vi.fn(), context: vi.fn(), campaign: vi.fn(), reserve: vi.fn(), reveal: vi.fn(), tenant: vi.fn(),
}));
vi.mock("../../context", () => ({ getRequestContext: mocks.context }));
vi.mock("../../routes/helpers", () => ({
  guardFeature: mocks.feature,
  denyReadOnly: (ctx: { userRole: string }, res: any) => {
    if (ctx.userRole === "Consultant") { res.status(403).json({ error: "Read only" }); return true; }
    return false;
  },
}));
vi.mock("../outreach-interview-service", () => ({ getCampaign: mocks.campaign }));
vi.mock("../../storage", () => ({ storage: { getTenantByDomain: mocks.tenant } }));
vi.mock("../manual-action-quota", () => ({ reserveManualAction: mocks.reserve }));
vi.mock("../apollo-reveal-service", () => ({ revealApolloPreviews: mocks.reveal }));
import { registerApolloRevealRoutes } from "../../routes/apollo-reveal";
import { signApolloPreviews } from "../apollo-reveal-core";
const scope = { tenantDomain: "tenant.example", campaignId: "campaign", userId: "operator" };
const path = "/api/sales-outreach/campaigns/campaign/discover/reveal";
function body(count = 1) {
  return { confirmCredits: true, tokens: signApolloPreviews(Array.from({ length: count }, (_, i) => ({
    id: `person-${i}`, displayName: "Alice C***n", title: null, companyName: "Acme", companyDomain: "acme.com",
  })), scope, "Acme", "test-secret").map(p => p.token) };
}
let app: ReturnType<typeof express>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SESSION_SECRET", "test-secret");
  mocks.feature.mockResolvedValue(true);
  mocks.context.mockResolvedValue({ ...scope, userRole: "Analyst" });
  mocks.campaign.mockResolvedValue({ id: scope.campaignId });
  mocks.tenant.mockResolvedValue({ plan: "enterprise" });
  mocks.reserve.mockImplementation(async () => ({ ok: true, commit: vi.fn() }));
  mocks.reveal.mockResolvedValue({ candidates: [], outcomes: [], attemptedCount: 1, attemptedIds: ["person-0"] });
  app = express(); app.use(express.json()); registerApolloRevealRoutes(app);
});
afterEach(() => vi.unstubAllEnvs());
describe("Apollo reveal API guardrails", () => {
  it("requires the feature and an editable role", async () => {
    mocks.feature.mockImplementationOnce(async (_req, res) => { res.status(403).json({ error: "Denied" }); return false; });
    expect((await request(app).post(path).send(body())).status).toBe(403);
    mocks.context.mockResolvedValueOnce({ ...scope, userRole: "Consultant" });
    expect((await request(app).post(path).send(body())).status).toBe(403);
    expect(mocks.reveal).not.toHaveBeenCalled();
  });
  it("requires tenant-owned campaign, confirmation and bounded selection", async () => {
    mocks.campaign.mockResolvedValueOnce(null);
    expect((await request(app).post(path).send(body())).status).toBe(404);
    expect((await request(app).post(path).send({ ...body(), confirmCredits: false })).status).toBe(400);
    expect((await request(app).post(path).send(body(11))).status).toBe(400);
    expect(mocks.reveal).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it("rejects tampered, cross-tenant and expired previews before reserving or revealing", async () => {
    const data = body();
    expect((await request(app).post(path).send({ ...data, tokens: [data.tokens[0] + "x"] })).status).toBe(400);
    mocks.context.mockResolvedValueOnce({ ...scope, tenantDomain: "other.example", userRole: "Analyst" });
    expect((await request(app).post(path).send(data)).status).toBe(403);
    const expired = signApolloPreviews([{ id: "person", displayName: "A C***n", title: null, companyName: "Acme", companyDomain: null }], scope, "Acme", "test-secret", Date.now() - 3_600_000);
    expect((await request(app).post(path).send({ confirmCredits: true, tokens: [expired[0].token] })).status).toBe(410);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.reveal).not.toHaveBeenCalled();
  });
  it("reserves quota per person before any paid call and refunds the batch when quota is insufficient", async () => {
    const commit = vi.fn();
    mocks.reserve.mockResolvedValueOnce({ ok: true, commit }).mockResolvedValueOnce({ ok: false, reason: "Limit reached", requiredPlan: "unlimited" });
    expect((await request(app).post(path).send(body(2))).status).toBe(403);
    expect(mocks.reveal).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledWith(false);
  });
  it("commits only actual attempts and returns review candidates without internal accounting IDs", async () => {
    const first = vi.fn(), second = vi.fn();
    mocks.reserve.mockResolvedValueOnce({ ok: true, commit: first }).mockResolvedValueOnce({ ok: true, commit: second });
    const response = await request(app).post(path).send(body(2));
    expect(response.status).toBe(200);
    expect(response.body.attemptedIds).toBeUndefined();
    expect(mocks.reserve).toHaveBeenCalledTimes(2);
    expect(mocks.reserve).toHaveBeenCalledWith(scope.tenantDomain, "enterprise", "enrichProspectContact", scope.userId);
    expect(first).toHaveBeenCalledWith(true);
    expect(second).toHaveBeenCalledWith(false);
  });
});
