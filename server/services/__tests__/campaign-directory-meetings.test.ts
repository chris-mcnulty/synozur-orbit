import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ select: vi.fn(), execute: vi.fn(), filters: [] as unknown[] }));
vi.mock("../../db", () => ({ db: { select: mocks.select, execute: mocks.execute } }));
import { campaignDirectoryMeetings } from "../campaign-directory-meetings";
beforeEach(() => {
  vi.clearAllMocks(); mocks.filters.length = 0;
  mocks.select.mockImplementation(() => ({ from: () => ({ where: (filter: unknown) => {
    mocks.filters.push(filter); return Promise.resolve([{ presence: { timezone: "America/Los_Angeles" } }]);
  } }) }));
  mocks.execute.mockResolvedValue({ rows: [{ id: "person", status: "cancelled", timezone: "Europe/London" }] });
});
describe("directory meeting metadata", () => {
  it("returns event timezone and actual stored invitation state without contacting Outlook", async () => {
    const result = await campaignDirectoryMeetings("tenant", "campaign", "event");
    expect(result.timezone).toBe("America/Los_Angeles");
    expect(result.byPerson.get("person")).toEqual({ status: "cancelled", timezone: "Europe/London" });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.params).toContain("tenant");
    expect(query.params).toContain("campaign");
    const eventQuery = new PgDialect().sqlToQuery(mocks.filters[0] as any);
    expect(eventQuery.params).toContain("tenant");
    expect(eventQuery.params).toContain("event");
  });
  it("does not fabricate an invitation for manually booked meetings", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    const result = await campaignDirectoryMeetings("tenant", "campaign", "event");
    expect(result.byPerson.size).toBe(0);
  });
});
