import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({ ctx: vi.fn(), feature: vi.fn(), campaign: vi.fn(), parse: vi.fn(), usage: vi.fn() }));
vi.mock("../../context", () => ({
  getRequestContext: mocks.ctx,
  ContextError: class ContextError extends Error { status = 403; },
}));
vi.mock("../../routes/helpers", () => ({ guardFeature: mocks.feature, logAiUsage: mocks.usage }));
vi.mock("../outreach-interview-service", () => ({ getCampaign: mocks.campaign }));
vi.mock("../rough-contact-parser", async importOriginal => {
  const actual = await importOriginal<typeof import("../rough-contact-parser")>();
  return { ...actual, parseRoughContacts: mocks.parse };
});
vi.mock("../ai-provider", () => ({ completeForFeature: vi.fn() }));
import { registerRoughContactImportRoutes } from "../../routes/rough-contact-import";
import { ContextError } from "../../context";
import { ContactParseError } from "../rough-contact-parser";

let app: ReturnType<typeof express>;
let user = 0;
const url = "/api/sales-outreach/campaigns/c1/parse-contacts";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ctx.mockResolvedValue({ tenantDomain: "tenant.test", marketId: "m1", userId: `u${++user}` });
  mocks.feature.mockResolvedValue(true);
  mocks.campaign.mockResolvedValue({ id: "c1" });
  mocks.parse.mockResolvedValue({
    contacts: [{ name: "Jane Doe", title: "", companyName: "", email: "", linkedinUrl: "" }],
    warnings: [],
    completion: { provider: "test", model: "test", usage: { inputTokens: 2, outputTokens: 3 }, durationMs: 5 },
  });
  app = express();
  app.use(express.json());
  registerRoughContactImportRoutes(app);
});

describe("rough contact preview route", () => {
  it("checks tenant campaign access and returns only a preview", async () => {
    const response = await request(app).post(url).send({ text: "Jane Doe" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ contacts: [{ name: "Jane Doe", title: "", companyName: "", email: "", linkedinUrl: "" }], warnings: [] });
    expect(mocks.campaign).toHaveBeenCalledWith("tenant.test", "c1");
    expect(mocks.parse).toHaveBeenCalledWith("tenant.test", "Jane Doe");
    expect(mocks.usage).toHaveBeenCalledOnce();
  });
  it("rejects unavailable campaigns before calling AI", async () => {
    mocks.campaign.mockResolvedValue(null);
    expect((await request(app).post(url).send({ text: "Jane" })).status).toBe(404);
    expect(mocks.parse).not.toHaveBeenCalled();
  });
  it("rejects empty and oversized text before calling AI", async () => {
    expect((await request(app).post(url).send({ text: "" })).status).toBe(400);
    expect((await request(app).post(url).send({ text: "x".repeat(30001) })).status).toBe(400);
    expect(mocks.parse).not.toHaveBeenCalled();
  });
  it("preserves authentication failures", async () => {
    mocks.ctx.mockRejectedValue(new ContextError("No access"));
    expect((await request(app).post(url).send({ text: "Jane" })).status).toBe(403);
    expect(mocks.parse).not.toHaveBeenCalled();
  });
  it("returns actionable extraction errors without exposing provider details", async () => {
    mocks.parse.mockRejectedValueOnce(new ContactParseError("Try a smaller selection"));
    expect((await request(app).post(url).send({ text: "Jane" })).status).toBe(422);
    mocks.parse.mockRejectedValueOnce(new Error("private provider details"));
    const response = await request(app).post(url).send({ text: "Jane" });
    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).not.toContain("private");
  });
  it("blocks concurrent extraction requests for the same user", async () => {
    let resolve!: (result: any) => void;
    const result = await mocks.parse();
    mocks.parse.mockReturnValue(new Promise(r => { resolve = r; }));
    const first = request(app).post(url).send({ text: "Jane Doe" }).then(r => r);
    await vi.waitFor(() => expect(mocks.parse).toHaveBeenCalledTimes(2));
    const second = await request(app).post(url).send({ text: "Jane Doe" });
    expect(second.status).toBe(429);
    resolve(result);
    expect((await first).status).toBe(200);
  });
});
