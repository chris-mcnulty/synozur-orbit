import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), feature: vi.fn(), parse: vi.fn(), save: vi.fn(), contact: vi.fn(), select: vi.fn(), usage: vi.fn(), rows: [] as unknown[][] }));
vi.mock("../../context", () => ({ getRequestContext: mocks.context, ContextError: class extends Error { status = 401; } }));
vi.mock("../helpers", () => ({ guardFeature: mocks.feature, logAiUsage: mocks.usage }));
vi.mock("../../db", () => ({ db: { select: mocks.select } }));
vi.mock("../../services/email-thread-parser", () => ({ parseEmailThread: mocks.parse, EmailThreadError: class extends Error { constructor(message: string, public status = 422) { super(message); } } }));
vi.mock("../../services/email-thread-service", () => ({ saveEmailThread: mocks.save, emailThreadContact: mocks.contact }));
import { registerEmailThreadRoutes } from "../email-thread";
import { ContextError } from "../../context";
let app: ReturnType<typeof express>;
beforeEach(() => {
  vi.clearAllMocks(); mocks.rows.length = 0;
  mocks.context.mockResolvedValue({ tenantDomain: "tenant", marketId: "market", userId: "user", userRole: "Analyst" });
  mocks.feature.mockResolvedValue(true);
  mocks.rows.push([{ id: "campaign", marketId: "market" }]);
  mocks.select.mockImplementation(() => {
    const chain: any = { from: () => chain, innerJoin: () => chain, where: () => Promise.resolve(mocks.rows.shift() ?? []) };
    return chain;
  });
  mocks.parse.mockResolvedValue({ contacts: [], meetingTimes: [], warnings: [], completion: { provider: "test", model: "test", usage: { inputTokens: 1, outputTokens: 1 }, durationMs: 1 } });
  mocks.save.mockResolvedValue({ prospectId: "p", filledFields: [], skippedFields: [], meetingTimesSaved: 1 });
  app = express(); app.use(express.json()); registerEmailThreadRoutes(app);
});
const base = "/api/sales-outreach/campaigns/campaign/email-thread";
describe("reviewed email thread route boundaries", () => {
  it("parses without saving and verifies contact scope before extraction", async () => {
    const response = await request(app).post(`${base}/parse`).send({ text: "A thread", prospectId: "p" });
    expect(response.status).toBe(200);
    expect(mocks.contact).toHaveBeenCalledWith("tenant", "campaign", "p");
    expect(mocks.parse).toHaveBeenCalledWith("tenant", "A thread");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("passes authenticated scope and explicit confirmation to save", async () => {
    const body = { prospectId: "p", confirmed: true };
    expect((await request(app).post(`${base}/save`).send(body)).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith("tenant", "market", "user", "campaign", body);
    expect(mocks.parse).not.toHaveBeenCalled();
  });
  it.each(["Standard User", "Consultant"])("rejects write access for %s", async userRole => {
    mocks.context.mockResolvedValue({ userRole });
    expect((await request(app).post(`${base}/parse`).send({ text: "A thread" })).status).toBe(403);
    expect(mocks.parse).not.toHaveBeenCalled();
  });
  it("rejects a different market before calling AI or persistence", async () => {
    mocks.rows[0] = [{ id: "campaign", marketId: "other" }];
    expect((await request(app).post(`${base}/save`).send({})).status).toBe(404);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("returns authentication errors without reading correspondence", async () => {
    mocks.context.mockRejectedValue(new ContextError("Sign in", 401));
    expect((await request(app).get(`${base}/contact?prospectId=p`)).status).toBe(401);
    expect(mocks.contact).not.toHaveBeenCalled();
  });
});
