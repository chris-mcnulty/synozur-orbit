import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { conferences, conferenceSessions } from "@shared/schema";
import { importWebsiteEvent, parseWebsiteEvent } from "../website-event-import";

// Opt-in: exercises the real SQL using temporary tables only. The outer
// transaction is always rolled back; no existing tenant/user rows are touched.
describe.skipIf(process.env.RUN_WEBSITE_EVENT_DB_TEST !== "1")("website event import SQL", () => {
  it("reimports atomically, retains local work, isolates scope, and rolls back ambiguous schedules", async () => {
    const rollback = new Error("fixture rollback");
    await expect(db.transaction(async tx => {
      await tx.execute(sql`CREATE TEMP TABLE conferences (LIKE public.conferences INCLUDING DEFAULTS) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMP TABLE conference_sessions (LIKE public.conference_sessions INCLUDING DEFAULTS) ON COMMIT DROP`);
      const database = { transaction: (fn: any) => tx.transaction(fn) } as Pick<typeof db, "transaction">;
      const scope = { tenantDomain: "fixture.example", marketId: "market-a", userId: "fixture-editor" };
      const source = {
        id: 12, slug: "sample", title: "Sample Event", startDate: "2026-11-02T15:00:00Z",
        sessions: [{ id: 34, title: "Opening", speakers: "Alex", startTime: "2026-11-02T16:00:00Z" }],
      };
      const first = await importWebsiteEvent(scope, parseWebsiteEvent(source), "https://website.example", database);
      expect(first.sessionsAdded).toBe(1);
      await tx.update(conferences).set({ postsPerDay: 7 }).where(eq(conferences.id, first.conferenceId));
      const [initialSession] = await tx.select().from(conferenceSessions);
      await tx.insert(conferenceSessions).values({
        conferenceId: first.conferenceId, tenantDomain: scope.tenantDomain, title: "Manual session",
      });
      const second = await importWebsiteEvent(scope, parseWebsiteEvent({
        ...source, title: "Renamed event",
        sessions: [{ ...source.sessions[0], title: "Renamed session", startTime: "2026-11-02T17:00:00Z" }],
      }), "https://website.example", database);
      expect(second).toMatchObject({ conferenceId: first.conferenceId, eventUpdated: true, sessionsAdded: 0, sessionsUpdated: 1 });
      const [savedEvent] = await tx.select().from(conferences).where(eq(conferences.id, first.conferenceId));
      expect(savedEvent.postsPerDay).toBe(7);
      const savedSessions = await tx.select().from(conferenceSessions).where(eq(conferenceSessions.conferenceId, first.conferenceId));
      expect(savedSessions).toHaveLength(2);
      expect(savedSessions.find(s => s.id === initialSession.id)?.title).toBe("Renamed session");
      const otherMarket = await importWebsiteEvent({ ...scope, marketId: "market-b" }, parseWebsiteEvent(source), "https://website.example", database);
      const otherTenant = await importWebsiteEvent({ ...scope, tenantDomain: "other.example" }, parseWebsiteEvent(source), "https://website.example", database);
      expect(new Set([first.conferenceId, otherMarket.conferenceId, otherTenant.conferenceId]).size).toBe(3);

      // A late schedule conflict must undo the event update as well.
      await tx.insert(conferenceSessions).values([1, 2].map(() => ({
        conferenceId: first.conferenceId, tenantDomain: scope.tenantDomain, title: "Ambiguous",
      })));
      await expect(importWebsiteEvent(scope, parseWebsiteEvent({
        ...source, title: "Must roll back",
        sessions: [{ id: 56, title: "Ambiguous" }],
      }), "https://website.example", database)).rejects.toThrow("Multiple sessions");
      const [afterFailure] = await tx.select().from(conferences).where(eq(conferences.id, first.conferenceId));
      expect(afterFailure.name).toBe("Renamed event");
      throw rollback;
    })).rejects.toBe(rollback);
  }, 30000);
});
