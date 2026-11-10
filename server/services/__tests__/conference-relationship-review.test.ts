import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ connection: vi.fn(), token: vi.fn() }));
vi.mock("../../db", () => ({ db: {} }));
vi.mock("../../storage", () => ({ storage: { getHubspotConnection: mocks.connection } }));
vi.mock("../hubspot-integration", () => ({ getTenantAccessToken: mocks.token, HUBSPOT_REST_HOST: "https://api.hubapi.com" }));
import { readHubspotRelationship } from "../conference-relationship-review";

describe("HubSpot relationship history coverage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.connection.mockResolvedValue({});
    mocks.token.mockResolvedValue({ accessToken: "test-only-token", connection: { hubspotPortalId: "portal" } });
  });
  it("reports unavailable when not connected", async () => {
    mocks.connection.mockResolvedValue(null);
    const r = await readHubspotRelationship("tenant", "contact", new Date(0));
    expect(r.limitations).toEqual(["HubSpot is not connected."]);
    expect(r.activities).toEqual([]);
  });
  it("does not pretend permission failures mean no history", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const r = await readHubspotRelationship("tenant", "contact", new Date(0));
    expect(r.activities).toHaveLength(0);
    expect(r.limitations).toHaveLength(5);
    expect(r.limitations.join(" ")).toContain("permissions");
    vi.unstubAllGlobals();
  });
  it("reports bounded/truncated history, strips HTML, and filters old activity", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.includes("/associations/")
        ? { results: [{ toObjectId: "a" }, { toObjectId: "b" }], paging: { next: { after: "next" } } }
        : { results: [
          { id: "a", properties: { hs_timestamp: "2026-11-09T00:00:00Z", hs_lastmodifieddate: "2026-11-09T00:00:00Z", hs_note_body: "<p>Recent note</p>" } },
          { id: "b", properties: { hs_timestamp: "2020-01-01T00:00:00Z", hs_lastmodifieddate: "2020-01-01T00:00:00Z" } },
        ] },
    })));
    const r = await readHubspotRelationship("tenant", "contact", new Date("2026-11-01"));
    expect(r.activities).toHaveLength(5);
    expect(r.activities.find(a => a.kind === "notes")?.summary).toBe("Recent note");
    expect(r.limitations).toHaveLength(5);
    expect(r.activities[0].url).toContain("/portal/contact/contact");
    vi.unstubAllGlobals();
  });
  it("distinguishes missing batch records from an empty relationship", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true, json: async () => url.includes("/associations/") ? { results: [{ toObjectId: "a" }] } : { results: [] },
    })));
    const r = await readHubspotRelationship("tenant", "contact", new Date(0));
    expect(r.limitations.every(l => l.includes("could not be read"))).toBe(true);
    vi.unstubAllGlobals();
  });
});
