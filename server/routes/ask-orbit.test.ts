import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { randomUUID } from "crypto";

const mock = vi.hoisted(() => ({
  getContext: vi.fn(), tenant: vi.fn(), plan: vi.fn(), gate: vi.fn(),
}));
vi.mock("../context", () => ({ getRequestContext: mock.getContext }));
vi.mock("../storage", () => ({ storage: { getTenant: mock.tenant } }));
vi.mock("../services/plan-policy", () => ({
  resolveEffectivePlan: mock.plan, checkFeatureAccessAsync: mock.gate,
}));
vi.mock("../db", () => ({ pool: {} }));
vi.mock("../services/ask-orbit/generation", () => ({ generateAnswer: vi.fn() }));
import { registerAskOrbitRoutes } from "./ask-orbit";
import type { OrbitRepository } from "../services/ask-orbit/repository";

const conversation = randomUUID(), turnId = randomUUID();
const endpoints: Array<["get" | "post" | "patch" | "delete", string]> = [
  ["get", "/api/ask-orbit"],
  ["post", "/api/ask-orbit/conversations"],
  ["get", `/api/ask-orbit/conversations/${conversation}`],
  ["patch", `/api/ask-orbit/conversations/${conversation}`],
  ["delete", `/api/ask-orbit/conversations/${conversation}`],
  ["post", `/api/ask-orbit/conversations/${conversation}/turns`],
  ["post", `/api/ask-orbit/conversations/${conversation}/turns/${turnId}/stop`],
];
const repo = { usage: vi.fn(), list: vi.fn(), create: vi.fn(), get: vi.fn(), rename: vi.fn(),
  delete: vi.fn(), turn: vi.fn(), reserve: vi.fn() };
function app(session = true) {
  const a = express();
  a.use(express.json());
  if (session) a.use((req, _, next) => { (req as any).session = { userId: "owner" }; next(); });
  registerAskOrbitRoutes(a, { repository: repo as unknown as OrbitRepository });
  return supertest(a);
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.getContext.mockResolvedValue({ userId: "owner", userRole: "Analyst", tenantId: "tenant", marketId: "market" });
  mock.tenant.mockResolvedValue({ id: "tenant" });
  mock.plan.mockReturnValue("enterprise");
  mock.gate.mockResolvedValue({ allowed: true });
  repo.usage.mockResolvedValue({ limit: 200, used: 0, remaining: 200 });
  repo.list.mockResolvedValue([]);
});
describe("Ask Orbit HTTP access boundary", () => {
  it.each(endpoints)("requires authentication on %s %s", async (method, path) => {
    expect((await app(false)[method](path).send({})).status).toBe(401);
    expect(mock.getContext).not.toHaveBeenCalled();
    expect(repo.reserve).not.toHaveBeenCalled();
  });
  it.each(endpoints)("does not accept bearer tokens as an alternate entry point on %s %s", async (method, path) => {
    expect((await app()[method](path).set("Authorization", "Bearer rejected").send({})).status).toBe(401);
  });
  it.each(["free", "trial", "pro"])("rejects %s even if askOrbit were enabled in its feature matrix", async plan => {
    mock.plan.mockReturnValue(plan);
    const http = app();
    for (const [method, path] of endpoints) expect((await http[method](path).send({})).status).toBe(403);
    expect(repo.reserve).not.toHaveBeenCalled();
    expect(repo.list).not.toHaveBeenCalled();
  });
  it("respects the Enterprise feature kill switch", async () => {
    mock.gate.mockResolvedValue({ allowed: false });
    for (const [method, path] of endpoints) expect((await app()[method](path).send({})).status).toBe(403);
    expect(repo.usage).not.toHaveBeenCalled();
  });
  it.each(["Standard User", "Analyst", "Domain Admin", "Consultant", "Global Admin"])("allows an authorized %s to read the workspace", async role => {
    mock.getContext.mockResolvedValue({ userId: "owner", userRole: role, tenantId: "tenant", marketId: "market" });
    expect((await app().get("/api/ask-orbit")).status).toBe(200);
  });
  it("fails closed on unknown roles, missing tenants, and invalid context headers", async () => {
    mock.getContext.mockResolvedValueOnce({ userRole: "unknown" });
    expect((await app().get("/api/ask-orbit")).status).toBe(403);
    mock.tenant.mockResolvedValueOnce(undefined);
    expect((await app().get("/api/ask-orbit")).status).toBe(403);
    mock.getContext.mockRejectedValueOnce(Object.assign(new Error("Requested market does not belong to tenant"), { status: 403 }));
    expect((await app().get("/api/ask-orbit").set("X-Active-Market-Id", randomUUID())).status).toBe(403);
    expect(repo.list).not.toHaveBeenCalled();
  });
  it("checks every source feature before material can be read and passes only current flags to retrieval", async () => {
    mock.gate.mockImplementation(async (_plan, feature) => ({ allowed: feature === "askOrbit" || feature === "gtmPlan" }));
    expect((await app().get("/api/ask-orbit")).status).toBe(200);
    for (const feature of ["askOrbit", "websiteMonitoring", "socialMonitoring", "intelligenceBriefings", "gtmPlan",
      "messagingFramework", "marketingPlanner", "productManagement"]) {
      expect(mock.gate).toHaveBeenCalledWith("enterprise", feature);
    }
  });
  it("validates question limits, title limits and UUIDs before quota reservation", async () => {
    const http = app();
    for (const body of [{ requestId: turnId, question: " " }, { requestId: turnId, question: "x".repeat(2001) },
      { requestId: "invalid", question: "Question" }, { requestId: turnId, question: "Question", tool: "crawl" }]) {
      expect((await http.post(`/api/ask-orbit/conversations/${conversation}/turns`).send(body)).status).toBe(400);
    }
    expect((await http.post("/api/ask-orbit/conversations").send({ title: "x".repeat(101) })).status).toBe(400);
    expect((await http.get("/api/ask-orbit/conversations/not-a-uuid")).status).toBe(400);
    expect(repo.reserve).not.toHaveBeenCalled();
  });
});
