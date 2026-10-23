import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const io = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn(), allowed: true }));
vi.mock("../website-event-import", async original => ({
  ...await original<typeof import("../website-event-import")>(),
  fetchWebsiteEvent: io.fetch, importWebsiteEvent: io.save,
}));
vi.mock("../../context", () => ({ getRequestContext: async () => ({
  tenantDomain: "tenant.example", marketId: "market-a", userId: "editor",
}) }));
vi.mock("../../routes/helpers", () => ({
  guardFeature: async (_req: any, res: any) => {
    if (!io.allowed) res.status(403).json({ error: "Feature unavailable" });
    return io.allowed;
  },
  guardManualAction: async () => true,
}));
import { WebsiteEventImportError } from "../website-event-import";
import { registerConferencePromotionRoutes } from "../../routes/conference-promotion";

const app = express();
app.use(express.json());
registerConferencePromotionRoutes(app);
const event = { id: "source-event", title: "Source Event", sessions: [] };
beforeEach(() => {
  vi.clearAllMocks(); io.allowed = true;
  io.fetch.mockResolvedValue({ event, origin: "https://website.example" });
  io.save.mockResolvedValue({ conferenceId: "saved-event", eventUpdated: false, sessionsAdded: 0, sessionsUpdated: 0, sessionsSkipped: 0 });
});

describe("website event import endpoints", () => {
  it("resolves the preview route before the dynamic conference-ID route", async () => {
    const response = await request(app).get("/api/conferences/website-preview?source=source-event");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ event });
    expect(io.fetch).toHaveBeenCalledWith("tenant.example", "source-event");
    expect(io.save).not.toHaveBeenCalled();
  });
  it("fetches authoritative website content on import and ignores injected tenant, event and sessions", async () => {
    const response = await request(app).post("/api/conferences/import-website").send({
      source: "source-event", tenantDomain: "foreign.example", marketId: "foreign-market",
      event: { title: "Injected" }, sessions: [{ title: "Injected" }],
    });
    expect(response.status).toBe(200);
    expect(io.fetch).toHaveBeenCalledWith("tenant.example", "source-event");
    expect(io.save).toHaveBeenCalledWith(
      { tenantDomain: "tenant.example", marketId: "market-a", userId: "editor" },
      event, "https://website.example",
    );
  });
  it.each(["get", "post"] as const)("feature-gates %s before reading or writing website content", async method => {
    io.allowed = false;
    const response = method === "get"
      ? await request(app).get("/api/conferences/website-preview?source=source-event")
      : await request(app).post("/api/conferences/import-website").send({ source: "source-event" });
    expect(response.status).toBe(403);
    expect(io.fetch).not.toHaveBeenCalled();
    expect(io.save).not.toHaveBeenCalled();
  });
  it("returns actionable source validation errors without persisting anything", async () => {
    io.fetch.mockRejectedValue(new WebsiteEventImportError("Use an event URL from the connected website."));
    const response = await request(app).post("/api/conferences/import-website").send({ source: "bad" });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("connected website");
    expect(io.save).not.toHaveBeenCalled();
  });
  it("preserves conflict status and hides unexpected remote error details", async () => {
    io.save.mockRejectedValue(new WebsiteEventImportError("Multiple Orbit events match.", 409));
    expect((await request(app).post("/api/conferences/import-website").send({ source: "source-event" })).status).toBe(409);
    io.fetch.mockRejectedValue(new Error("private upstream error"));
    const response = await request(app).get("/api/conferences/website-preview?source=source-event");
    expect(response.status).toBe(502);
    expect(response.body.error).not.toContain("private upstream");
  });
});
