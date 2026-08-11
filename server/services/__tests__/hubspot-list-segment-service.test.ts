/**
 * Unit tests — hubspot-list-segment-service (Task 709).
 *
 * Verifies the import/refresh sync semantics:
 *   - list members are batch-upserted into the contact spine WITHOUT touching
 *     opt-out fields (so a sync can never re-activate an unsubscribed contact)
 *   - contacts without an email are skipped, duplicates deduped
 *   - membership is fully replaced (removals reconcile)
 *   - non-hubspot segments are rejected
 */

import { describe, it, beforeEach, vi, expect } from "vitest";

const { state, makeMockDb } = vi.hoisted(() => {
  const state = {
    deletes: [] as any[],
    contactBatches: [] as any[][], // batches upserted into marketing_contacts
    memberBatches: [] as any[][],  // batches inserted into marketing_segment_members
    updates: [] as any[],
    selectQ: [] as any[][],        // FIFO results for db.select() chains
  };

  let idCounter = 0;

  function mkChain(): any {
    const next = () => state.selectQ.shift() ?? [];
    return {
      from: () => mkChain(),
      innerJoin: () => mkChain(),
      limit: (_n: number) => Promise.resolve(next()),
      where: (..._: any[]) => {
        // Lazy thenable: pops from the queue exactly once, whether awaited
        // directly or extended with .limit().
        let popped: any[] | null = null;
        const pop = () => (popped ??= next());
        return {
          then: (res: any, rej?: any) => Promise.resolve(pop()).then(res, rej),
          limit: (_n: number) => Promise.resolve(pop()),
        };
      },
      set: (v: any) => {
        state.updates.push(v);
        return { where: () => Object.assign(Promise.resolve([]), { returning: () => Promise.resolve([]) }) };
      },
      values: (v: any) => {
        const rows = Array.isArray(v) ? v : [v];
        if (rows[0] && "segmentId" in rows[0]) {
          state.memberBatches.push(rows);
          return Promise.resolve([]);
        }
        // marketing_contacts batch upsert
        return {
          onConflictDoUpdate: (conflict: any) => {
            state.contactBatches.push(rows.map((r: any) => ({ ...r, __conflictSet: conflict.set })));
            return {
              returning: () => Promise.resolve(rows.map(() => ({ id: `c-${++idCounter}` }))),
            };
          },
          then: (res: any) => Promise.resolve([]).then(res),
        };
      },
    };
  }

  function makeMockDb() {
    const db: any = {
      select: mkChain,
      insert: mkChain,
      update: mkChain,
      delete: () => ({ where: (w: any) => { state.deletes.push(w); return Promise.resolve([]); } }),
      transaction: async (fn: any) => fn(db),
    };
    return db;
  }

  return { state, makeMockDb };
});

vi.mock("../../db", () => ({ db: makeMockDb() }));

vi.mock("../marketing-contact-service", () => ({
  normaliseEmail: (e: string) => e.trim().toLowerCase(),
}));

const listAllContactsFromHubspotList = vi.hoisted(() => vi.fn());
vi.mock("../hubspot-integration", () => ({ listAllContactsFromHubspotList }));

const enqueueMock = vi.hoisted(() => vi.fn((_t: any, _l: any, work: any) => work()));
vi.mock("../job-queue", () => ({ enqueue: enqueueMock }));

import { syncHubspotListSegment, resolveMarketingSegmentContacts } from "../hubspot-list-segment-service";

const segment: any = {
  id: "seg-1",
  tenantDomain: "acme.example.com",
  name: "HubSpot: Newsletter",
  source: "hubspot_list",
  hubspotListId: "10",
};

beforeEach(() => {
  state.deletes.length = 0;
  state.contactBatches.length = 0;
  state.memberBatches.length = 0;
  state.updates.length = 0;
  state.selectQ.length = 0;
  listAllContactsFromHubspotList.mockReset();
  enqueueMock.mockClear();
  enqueueMock.mockImplementation((_t: any, _l: any, work: any) => work());
});

describe("syncHubspotListSegment", () => {
  it("batch-upserts members without touching opt-out fields, dedupes, and skips no-email contacts", async () => {
    listAllContactsFromHubspotList.mockResolvedValue([
      { hubspotContactId: "1", email: "A@Example.com", firstName: "A", lastName: null, company: null, jobTitle: null },
      { hubspotContactId: "2", email: null }, // no email → skipped
      { hubspotContactId: "3", email: "a@example.com" }, // dupe of #1 after normalisation
      { hubspotContactId: "4", email: "b@example.com", firstName: "B" },
    ]);

    const count = await syncHubspotListSegment(segment);
    expect(count).toBe(2);

    // One batched round trip, not one call per member.
    expect(state.contactBatches).toHaveLength(1);
    const batch = state.contactBatches[0];
    expect(batch.map(r => r.email)).toEqual(["a@example.com", "b@example.com"]);

    for (const row of batch) {
      // A sync must never write opt-out state — preserved by omission, in
      // both the insert values and the ON CONFLICT update set.
      expect(row).not.toHaveProperty("emailOptOut");
      expect(row).not.toHaveProperty("emailOptOutAt");
      expect(row.__conflictSet).not.toHaveProperty("emailOptOut");
      expect(row.__conflictSet).not.toHaveProperty("emailOptOutAt");
      expect(row.source).toBe("hubspot");
    }
  });

  it("fully replaces membership so removals reconcile", async () => {
    listAllContactsFromHubspotList.mockResolvedValue([
      { hubspotContactId: "1", email: "a@example.com" },
    ]);
    await syncHubspotListSegment(segment);

    // One delete (wipe old membership) followed by one batch insert.
    expect(state.deletes.length).toBe(1);
    expect(state.memberBatches).toHaveLength(1);
    expect(state.memberBatches[0]).toHaveLength(1);
    expect(state.memberBatches[0][0].segmentId).toBe("seg-1");
    // Sync stamps are written (syncing → synced).
    const finalUpdate = state.updates.at(-1);
    expect(finalUpdate.hubspotSyncStatus).toBe("synced");
    expect(finalUpdate.lastHubspotSyncAt).toBeInstanceOf(Date);
  });

  it("marks the segment errored when HubSpot fails (incl. oversized-list rejection) and rethrows", async () => {
    listAllContactsFromHubspotList.mockRejectedValue(
      new Error("HubSpot list 10 has more than 50000 contacts, which exceeds the supported import size."),
    );
    await expect(syncHubspotListSegment(segment)).rejects.toThrow(/exceeds the supported import size/);
    const finalUpdate = state.updates.at(-1);
    expect(finalUpdate.hubspotSyncStatus).toBe("error");
    expect(finalUpdate.hubspotSyncError).toMatch(/exceeds the supported import size/);
  });

  it("rejects non-hubspot segments", async () => {
    await expect(syncHubspotListSegment({ ...segment, source: "rules" })).rejects.toThrow(/not a HubSpot/);
  });
});

describe("resolveMarketingSegmentContacts — send-cap safety", () => {
  const freshSegment = {
    ...segment,
    lastHubspotSyncAt: new Date(), // fresh → pre-send refresh skipped
  };

  it("returns membership when at or under the send cap", async () => {
    const members = [{ contact: { id: "c1" } }, { contact: { id: "c2" } }];
    state.selectQ.push([freshSegment], members);
    const out = await resolveMarketingSegmentContacts("seg-1", "acme.example.com", 2);
    expect(out).toHaveLength(2);
  });

  it("rejects explicitly when membership exceeds the send cap — never silently truncates", async () => {
    // limit=2 → resolver fetches 3; 3 rows back means over-cap.
    const members = [1, 2, 3].map((i) => ({ contact: { id: `c${i}` } }));
    state.selectQ.push([freshSegment], members);
    await expect(resolveMarketingSegmentContacts("seg-1", "acme.example.com", 2))
      .rejects.toThrow(/exceeds the maximum recipients per send/);
  });

  it("returns null for an unknown segment id (caller falls back to legacy resolution)", async () => {
    state.selectQ.push([]);
    expect(await resolveMarketingSegmentContacts("nope", "acme.example.com", 2)).toBeNull();
  });

  it("defers the send (deferSend) when the first import hasn't completed yet", async () => {
    enqueueMock.mockImplementationOnce(() => new Promise(() => {})); // import still running
    state.selectQ.push([{ ...segment, lastHubspotSyncAt: null, hubspotSyncStatus: "syncing" }]);
    await expect(resolveMarketingSegmentContacts("seg-1", "acme.example.com", 10))
      .rejects.toMatchObject({ deferSend: true });
  });

  it("uses the stale snapshot immediately — a hung HubSpot refresh never blocks delivery", async () => {
    // Background refresh hangs forever; the resolver must still return promptly.
    enqueueMock.mockImplementationOnce(() => new Promise(() => {}));
    const staleSegment = {
      ...segment,
      id: "seg-stale",
      lastHubspotSyncAt: new Date(Date.now() - 60 * 60 * 1000), // 1h old → stale
    };
    state.selectQ.push([staleSegment], [{ contact: { id: "c1", email: "a@example.com" } }]);

    const start = Date.now();
    const out = await resolveMarketingSegmentContacts("seg-stale", "acme.example.com", 10);
    expect(Date.now() - start).toBeLessThan(1000); // no awaited refresh
    expect(out).toHaveLength(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1); // refresh kicked off in background
  });

  it("coalesces background refreshes per segment — repeated sends don't enqueue duplicates", async () => {
    enqueueMock.mockImplementation(() => new Promise(() => {})); // never completes
    const staleSegment = {
      ...segment,
      id: "seg-coalesce",
      lastHubspotSyncAt: new Date(Date.now() - 60 * 60 * 1000),
    };
    state.selectQ.push([staleSegment], [], [staleSegment], []);
    await resolveMarketingSegmentContacts("seg-coalesce", "acme.example.com", 10);
    await resolveMarketingSegmentContacts("seg-coalesce", "acme.example.com", 10);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    enqueueMock.mockImplementation((_t: any, _l: any, work: any) => work());
  });
});
