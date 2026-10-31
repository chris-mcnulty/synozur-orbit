import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ preview: vi.fn(), export: vi.fn(), confirm: vi.fn(), guard: vi.fn() }));
vi.mock("../../context", () => ({ getRequestContext: async () => ({ tenantDomain: "tenant.example", marketId: "market", userId: "editor" }) }));
vi.mock("../../routes/helpers", () => ({ guardFeature: io.guard }));
vi.mock("../artifact-storage-helper", () => ({ storeArtifact: vi.fn().mockResolvedValue({}) }));
vi.mock("../event-post-export", async importOriginal => {
  const actual = await importOriginal<typeof import("../event-post-export")>();
  return { ...actual, previewEventExport: io.preview, exportEventPosts: io.export, confirmEventExport: io.confirm };
});
import { registerEventPostExportRoutes } from "../../routes/event-post-export";
import { EventExportError } from "../event-post-export";

const app = express();
app.use(express.json());
registerEventPostExportRoutes(app);
const selection = { conferenceIds: ["one", "two"], socialAccountIds: ["account"] };
describe("event bulk export API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    io.guard.mockResolvedValue(true);
    io.preview.mockResolvedValue({ exportablePosts: 2 });
    io.export.mockResolvedValue({ csv: "combined csv", postIds: ["p1", "p2"] });
    io.confirm.mockResolvedValue({ updated: 2 });
  });
  it("previews all selected events and destinations under request scope", async () => {
    const res = await request(app).post("/api/conferences/export-preview").send(selection);
    expect(res.status).toBe(200);
    expect(io.preview).toHaveBeenCalledWith(expect.objectContaining({ tenantDomain: "tenant.example", marketId: "market" }), selection);
  });
  it("downloads one file and returns only included post IDs", async () => {
    const res = await request(app).post("/api/conferences/export-csv").send({ ...selection, format: "socialpilot", tzOffset: 420 });
    expect(res.status).toBe(200);
    expect(res.text).toBe("combined csv");
    expect(res.headers["x-exported-post-ids"]).toBe("p1,p2");
    expect(res.headers["content-disposition"]).toContain("events-socialpilot.csv");
    expect(io.confirm).not.toHaveBeenCalled();
  });
  it("marks only explicitly confirmed IDs under the same selection", async () => {
    const res = await request(app).post("/api/conferences/mark-export-delivered").send({ ...selection, postIds: ["p1", "p2"] });
    expect(res.status).toBe(200);
    expect(io.confirm).toHaveBeenCalledWith(expect.objectContaining({ tenantDomain: "tenant.example" }), selection, ["p1", "p2"]);
  });
  it.each([
    {}, { conferenceIds: [], socialAccountIds: ["account"] },
    { conferenceIds: ["one"], socialAccountIds: [] },
    { ...selection, format: "invalid" }, { ...selection, tzOffset: 900 },
  ])("rejects invalid or empty selection/options", async body => {
    const res = await request(app).post("/api/conferences/export-csv").send(body);
    expect(res.status).toBe(400);
    expect(io.export).not.toHaveBeenCalled();
  });
  it("returns conflict details without sending a CSV for an in-flight post", async () => {
    io.export.mockRejectedValue(new EventExportError("A selected post is already being sent.", 409));
    const res = await request(app).post("/api/conferences/export-csv").send(selection);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("already being sent");
  });
});
