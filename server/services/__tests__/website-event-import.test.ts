import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const io = vi.hoisted(() => ({
  rows: [] as any[][], inserts: [] as any[], updates: [] as any[], filters: [] as any[],
  locks: [] as any[], tool: vi.fn(), connection: vi.fn(),
}));
vi.mock("../../db", () => {
  const db: any = {
    select: () => ({ from: () => ({ where: async (filter: any) => {
      io.filters.push(filter); return io.rows.shift() ?? [];
    } }) }),
    insert: (table: any) => ({ values: (values: any) => {
      io.inserts.push({ table, values });
      return { returning: async () => [{ id: "new-event", ...values }] };
    } }),
    update: (table: any) => ({ set: (values: any) => ({ where: (filter: any) => {
      io.updates.push({ table, values, filter });
      return { returning: async () => [{ id: "existing-event", ...values }] };
    } }) }),
    execute: async (query: any) => { io.locks.push(query); },
    transaction: async (fn: any) => fn(db),
  };
  return { db };
});
vi.mock("../website-mcp-client", () => ({
  callWebsiteTool: io.tool, getWebsiteConnection: io.connection,
}));
import { fetchWebsiteEvent, importWebsiteEvent, parseWebsiteEvent, websiteEventSlug } from "../website-event-import";
import { conferences, conferenceSessions } from "@shared/schema";

const origin = "https://website.example";
const scope = { tenantDomain: "tenant.example", marketId: "market-a", userId: "editor" };
const raw = {
  id: 21, slug: "annual-summit", title: "Annual Summit",
  startDate: "2026-11-03T15:00:00Z", endDate: null, timezone: "America/Los_Angeles",
  sessions: [{ id: 42, title: "Opening", speakers: "Guest Speaker", startTime: "2026-11-03T16:00:00Z", room: "Hall A" }],
};
const event = () => parseWebsiteEvent(raw);
beforeEach(() => {
  io.rows = []; io.inserts = []; io.updates = []; io.filters = []; io.locks = [];
  vi.clearAllMocks();
  io.connection.mockResolvedValue({ enabled: true, endpoint: `${origin}/api/mcp` });
  io.tool.mockResolvedValue(raw);
});

describe("website event source contract", () => {
  it.each(["annual-summit", `${origin}/events/annual-summit`, `${origin}/events/annual-summit/schedule?view=all`])(
    "accepts a website slug, event page, or schedule page: %s", source => {
      expect(websiteEventSlug(source, origin)).toBe("annual-summit");
    });
  it.each(["https://foreign.example/events/summit", `${origin}/blog/summit`, "../events", "", "https://user:pass@website.example/events/summit"])(
    "rejects invalid and foreign inputs: %s", source => {
      expect(() => websiteEventSlug(source, origin)).toThrow();
    });
  it("normalizes real website integer event/session IDs without losing dates", () => {
    expect(event()).toMatchObject({ id: "21", sessions: [{ id: "42", startTime: raw.sessions[0].startTime }] });
  });
  it("rejects missing schedules rather than silently importing no sessions", () => {
    expect(() => parseWebsiteEvent({ ...raw, sessions: undefined })).toThrow("invalid");
  });
  it("accepts sessionless events without fabricating a session", () => {
    expect(parseWebsiteEvent({ ...raw, sessions: [] }).sessions).toEqual([]);
  });
  it("rejects duplicate session identifiers and invalid dates", () => {
    expect(() => parseWebsiteEvent({ ...raw, sessions: [...raw.sessions, ...raw.sessions] })).toThrow("duplicate");
    expect(() => parseWebsiteEvent({ ...raw, startDate: "yesterday" })).toThrow("invalid");
    expect(() => parseWebsiteEvent({ ...raw, endDate: "2025-01-01T00:00:00Z" })).toThrow("before");
  });
  it("calls the actual get_event MCP tool with slug, not an invented ID parameter", async () => {
    await expect(fetchWebsiteEvent(scope.tenantDomain, `${origin}/events/annual-summit`))
      .resolves.toMatchObject({ origin, event: { id: "21" } });
    expect(io.tool).toHaveBeenCalledWith(scope.tenantDomain, "get_event", { slug: "annual-summit" });
  });
  it("fails before remote calls if the website is disconnected", async () => {
    io.connection.mockResolvedValue(null);
    await expect(fetchWebsiteEvent(scope.tenantDomain, "annual-summit")).rejects.toThrow("Connect");
    expect(io.tool).not.toHaveBeenCalled();
  });
  it("rejects a mismatched event returned by the website", async () => {
    io.tool.mockResolvedValue({ ...raw, slug: "different-event" });
    await expect(fetchWebsiteEvent(scope.tenantDomain, "annual-summit")).rejects.toThrow("different event");
  });
  it("normalizes relative source links and rejects executable links", async () => {
    io.tool.mockResolvedValue({ ...raw, sessions: [{ ...raw.sessions[0], sessionUrl: "/events/annual-summit" }] });
    const preview = await fetchWebsiteEvent(scope.tenantDomain, "annual-summit");
    expect(preview.event.sessions[0].sessionUrl).toBe(`${origin}/events/annual-summit`);
    io.tool.mockResolvedValue({ ...raw, registrationUrl: "javascript:alert(1)" });
    await expect(fetchWebsiteEvent(scope.tenantDomain, "annual-summit")).rejects.toThrow("unsupported link");
  });
});

describe("website event persistence", () => {
  it("creates an event and schedule, using scoped source identity and serialized imports", async () => {
    expect(await importWebsiteEvent(scope, event(), origin)).toMatchObject({
      conferenceId: "new-event", eventUpdated: false, sessionsAdded: 1, sessionsUpdated: 0,
    });
    expect(io.inserts[0]).toMatchObject({ table: conferences, values: {
      websiteEventId: `${origin}|21`, website: `${origin}/events/annual-summit`, tenantDomain: scope.tenantDomain,
      marketId: scope.marketId, createdBy: scope.userId,
    } });
    expect(io.inserts[1]).toMatchObject({ table: conferenceSessions, values: {
      websiteSessionId: "42", room: "Hall A", speaker: "Guest Speaker",
      sessionStart: new Date(raw.sessions[0].startTime),
      speakers: [{ name: "Guest Speaker", isStaff: false }],
    } });
    const lock = new PgDialect().sqlToQuery(io.locks[0]);
    expect(lock.sql).toContain("pg_advisory_xact_lock");
    expect(lock.params[0]).toBe(JSON.stringify([scope.tenantDomain, scope.marketId, `${origin}|21`]));
    const query = new PgDialect().sqlToQuery(io.filters[0]);
    expect(query.params).toEqual(expect.arrayContaining([scope.tenantDomain, scope.marketId]));
  });
  it("updates stable source IDs after titles and times change; preserves promotion configuration and manual sessions", async () => {
    io.rows.push([{ id: "existing-event", websiteEventId: `${origin}|21`, status: "active" }], [
      { id: "existing-session", websiteSessionId: "42", title: "Old title", status: "active", speaker: "Guest Speaker", speakers: [{ name: "Guest Speaker", isStaff: true }] },
      { id: "manual-session", title: "Manual", status: "active" },
    ]);
    expect(await importWebsiteEvent(scope, event(), origin)).toMatchObject({ eventUpdated: true, sessionsAdded: 0, sessionsUpdated: 1 });
    expect(io.inserts).toHaveLength(0);
    expect(io.updates).toHaveLength(2);
    expect(io.updates[0].values).not.toHaveProperty("promoStartDate");
    expect(io.updates[0].values).not.toHaveProperty("postsPerDay");
    expect(io.updates[1].values.speakers).toEqual([{ name: "Guest Speaker", isStaff: true }]);
    expect(io.updates[1].values).not.toHaveProperty("sessionEnd");
    expect(io.updates[1].values).not.toHaveProperty("abstract");
  });
  it("adopts an unambiguous legacy session and saves its source ID for subsequent changes", async () => {
    io.rows.push([{ id: "existing-event", status: "active" }], [
      { id: "legacy", title: "Opening", sessionStart: new Date(raw.sessions[0].startTime), status: "active" },
    ]);
    expect(await importWebsiteEvent(scope, event(), origin)).toMatchObject({ sessionsAdded: 0, sessionsUpdated: 1 });
    expect(io.updates[1].values.websiteSessionId).toBe("42");
  });
  it("does not resurrect deleted sessions or archived events", async () => {
    io.rows.push([{ id: "existing-event", status: "active" }], [
      { id: "deleted", websiteSessionId: "42", status: "deleted" },
    ]);
    expect(await importWebsiteEvent(scope, event(), origin)).toMatchObject({ sessionsSkipped: 1, sessionsAdded: 0, sessionsUpdated: 0 });
    io.rows.push([{ id: "archived-event", status: "archived" }]);
    await expect(importWebsiteEvent(scope, event(), origin)).rejects.toThrow("Restore");
  });
  it("rejects ambiguous legacy events instead of overwriting the first one", async () => {
    io.rows.push([{ id: "one" }, { id: "two" }]);
    await expect(importWebsiteEvent(scope, event(), origin)).rejects.toThrow("Multiple Orbit events");
    expect(io.inserts).toHaveLength(0);
    expect(io.updates).toHaveLength(0);
  });
  it("keeps tenant-wide imports scoped to null market", async () => {
    await importWebsiteEvent({ ...scope, marketId: null }, parseWebsiteEvent({ ...raw, sessions: [] }), origin);
    expect(new PgDialect().sqlToQuery(io.filters[0]).sql).toContain('"market_id" is null');
    expect(io.inserts[0].values.marketId).toBeNull();
  });
});
