/**
 * A/B dispatch with a segment audience (incl. HubSpot-list-backed segments).
 *
 * Regression test for Task 709 review: dispatchEmailSend previously
 * snapshotted A/B cohorts only for listId sends, so a segment-targeted A/B
 * send created three send rows with zero pre-assigned recipients and
 * delivered to nobody. Verifies that segment audiences:
 *   - resolve through the materialized/HubSpot-aware segment resolver
 *     (which performs the pre-send HubSpot refresh),
 *   - are filtered by suppressions AND marketing-contact opt-outs,
 *   - are split into A / B / holdback pre_assigned cohorts covering the
 *     full deliverable set exactly once.
 */

import { describe, it, beforeEach, vi, expect } from "vitest";

const { state, makeMockDb } = vi.hoisted(() => {
  const state = {
    selectQ: [] as any[][],       // queued results for select().from()...where/limit
    insertedSends: [] as any[],    // rows inserted into email_sends (have status/abVariantLabel)
    insertedRecipients: [] as any[][], // batches inserted into email_send_recipients
    updates: [] as any[],
    deletes: 0,
  };

  function terminal(): any {
    const val = state.selectQ.shift() ?? [];
    const t: any = {
      then: (res: any, rej?: any) => Promise.resolve(val).then(res, rej),
      limit: () => Promise.resolve(val),
      orderBy: () => t,
    };
    return t;
  }

  function makeMockDb() {
    const db: any = {
      select: () => ({
        from: () => ({
          where: terminal,
          innerJoin: () => ({ where: terminal }),
          limit: () => Promise.resolve(state.selectQ.shift() ?? []),
        }),
      }),
      insert: (_table: any) => ({
        values: (v: any) => {
          const rows = Array.isArray(v) ? v : [v];
          if (rows[0] && "unsubscribeToken" in rows[0]) {
            state.insertedRecipients.push(rows);
            return Promise.resolve([]);
          }
          if (rows[0] && ("abVariantLabel" in rows[0] || "generatedEmailId" in rows[0])) {
            const withIds = rows.map((r: any, i: number) => ({ id: `send-${state.insertedSends.length + i + 1}`, ...r }));
            state.insertedSends.push(...withIds);
            return {
              returning: () => Promise.resolve(withIds),
              then: (res: any) => Promise.resolve([]).then(res),
            };
          }
          // audit log etc.
          return Object.assign(Promise.resolve([]), { returning: () => Promise.resolve(rows) });
        },
      }),
      update: () => ({
        set: (v: any) => {
          state.updates.push(v);
          return {
            where: () => Object.assign(Promise.resolve([]), {
              returning: () => Promise.resolve([{ id: "send-updated", ...v }]),
            }),
          };
        },
      }),
      delete: () => ({
        where: () => {
          state.deletes += 1;
          return Promise.resolve([]);
        },
      }),
    };
    return db;
  }

  return { state, makeMockDb };
});

vi.mock("../../db", () => ({ db: makeMockDb() }));
vi.mock("@sendgrid/mail", () => ({ default: { setApiKey: vi.fn(), send: vi.fn() } }));
vi.mock("../plan-policy", () => ({ checkFeatureAccessAsync: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock("../email-ab-test", () => ({ resolveTokens: vi.fn(), resolveTokensForEmail: vi.fn() }));
vi.mock("../email-sections-renderer", () => ({
  appendSectionsToBody: vi.fn(), reRenderSectionsHtml: vi.fn(), stripDuplicateAboutSection: vi.fn(),
}));
vi.mock("../marketing-links-helpers", () => ({ wrapOutboundLinksInText: vi.fn() }));
vi.mock("../hubspot-contact-resolver", () => ({ resolveSendRecipientContacts: vi.fn() }));
vi.mock("../hubspot-timeline", () => ({ pushSentEventsForSend: vi.fn() }));

const pullSubscriptionStatus = vi.hoisted(() => vi.fn());
vi.mock("../hubspot-email-sync", () => ({ pullSubscriptionStatus }));

const resolveMarketingSegmentContacts = vi.hoisted(() => vi.fn());
vi.mock("../hubspot-list-segment-service", () => ({ resolveMarketingSegmentContacts }));

const resolveSegmentContacts = vi.hoisted(() => vi.fn());
vi.mock("../marketing-contact-service", () => ({ resolveSegmentContacts }));

import { dispatchEmailSend, resolveDeliveryRecipients, deliverEmailSend, tickEmailSendWorker } from "../email-campaign-sender";

const email: any = {
  id: "email-1",
  abTestEnabled: true,
  abTestSplit: 25,
  abEvaluationHours: 4,
  abWinnerMetric: "open_rate",
};

function baseOpts(): any {
  return {
    tenantDomain: "acme.example.com",
    marketId: null,
    email,
    segmentId: "seg-1",
    createdBy: "user-1",
    baseUrl: "https://app.example.com",
  };
}

beforeEach(() => {
  state.selectQ.length = 0;
  state.deletes = 0;
  state.insertedSends.length = 0;
  state.insertedRecipients.length = 0;
  state.updates.length = 0;
  pullSubscriptionStatus.mockReset().mockResolvedValue({ optedOut: new Set() });
  resolveMarketingSegmentContacts.mockReset();
  resolveSegmentContacts.mockReset();
});

describe("dispatchEmailSend — A/B test with a segment audience", () => {
  it("snapshots A/B/holdback cohorts from the segment resolver, honoring suppressions and opt-outs", async () => {
    // select queue: 1) tenant mailing address, 2) B variant, 3) suppressions, 4) opted-out contacts
    state.selectQ.push([{ mailingAddress: "1 Main St" }]);
    state.selectQ.push([{ id: "var-b", variantLabel: "B" }]);
    state.selectQ.push([{ email: "suppressed@example.com" }]);
    state.selectQ.push([{ email: "optout@example.com" }]);

    const members = Array.from({ length: 8 }, (_, i) => ({
      email: `m${i}@example.com`, firstName: "M", lastName: `${i}`,
    }));
    resolveMarketingSegmentContacts.mockResolvedValue([
      ...members,
      { email: "suppressed@example.com", firstName: null, lastName: null },
      { email: "optout@example.com", firstName: null, lastName: null },
    ]);

    const result = await dispatchEmailSend(baseOpts());
    expect(result.queued).toBe(true);

    // The HubSpot-aware materialized resolver was used (this is where the
    // pre-send HubSpot list refresh happens).
    expect(resolveMarketingSegmentContacts).toHaveBeenCalledWith("seg-1", "acme.example.com", expect.any(Number));
    expect(resolveSegmentContacts).not.toHaveBeenCalled();

    // Three sends: A, B, holdback — every row persists the segment audience so
    // the queued-send worker can reconstruct delivery options after a restart.
    expect(state.insertedSends).toHaveLength(3);
    expect(state.insertedSends.map(s => s.abVariantLabel)).toEqual(["A", "B", null]);
    expect(state.insertedSends.every(s => s.segmentId === "seg-1")).toBe(true);

    // Cohorts cover every deliverable member exactly once; suppressed and
    // opted-out contacts never appear.
    const assigned = state.insertedRecipients.flat();
    const emails = assigned.map(r => r.email).sort();
    expect(emails).toEqual(members.map(m => m.email).sort());
    expect(assigned.every(r => r.status === "pre_assigned")).toBe(true);

    // 25% split of 8 deliverable → 2 / 2 / 4.
    const bySend = new Map<string, number>();
    for (const r of assigned) bySend.set(r.sendId, (bySend.get(r.sendId) ?? 0) + 1);
    expect([...bySend.values()].sort()).toEqual([2, 2, 4]);
  });

  it("falls back to the legacy rules-segment resolver when the segment isn't materialized", async () => {
    state.selectQ.push([{ mailingAddress: "1 Main St" }]);
    state.selectQ.push([{ id: "var-b", variantLabel: "B" }]);
    state.selectQ.push([]); // suppressions
    state.selectQ.push([]); // opt-outs

    resolveMarketingSegmentContacts.mockResolvedValue(null);
    resolveSegmentContacts.mockResolvedValue({
      contacts: [{ email: "legacy@example.com", firstName: null, lastName: null }],
    });

    await dispatchEmailSend(baseOpts());
    expect(resolveSegmentContacts).toHaveBeenCalled();
    const assigned = state.insertedRecipients.flat();
    expect(assigned.map(r => r.email)).toEqual(["legacy@example.com"]);
  });
});

describe("resolveDeliveryRecipients — delivery-time recipient assembly", () => {
  it("delivers ONLY the pre-assigned cohort and never re-resolves the segment", async () => {
    // select queue: pre_assigned rows for this send
    state.selectQ.push([
      { email: "a@example.com", name: "A" },
      { email: "b@example.com", name: null },
    ]);

    const { recipients, usePreAssigned } = await resolveDeliveryRecipients(
      { ...baseOpts(), abVariantLabel: "A" },
      "send-a",
    );

    expect(usePreAssigned).toBe(true);
    expect(recipients.map(r => r.email).sort()).toEqual(["a@example.com", "b@example.com"]);
    // Placeholder rows were cleared for fresh-token regeneration.
    expect(state.deletes).toBe(1);
    // The segment must NOT be re-resolved on top of the immutable cohort.
    expect(resolveMarketingSegmentContacts).not.toHaveBeenCalled();
    expect(resolveSegmentContacts).not.toHaveBeenCalled();
  });

  it("holdback sends also use only their pre-assigned cohort", async () => {
    state.selectQ.push([{ email: "hold@example.com", name: null }]);
    const { recipients, usePreAssigned } = await resolveDeliveryRecipients(
      { ...baseOpts(), isAbHoldback: true },
      "send-h",
    );
    expect(usePreAssigned).toBe(true);
    expect(recipients.map(r => r.email)).toEqual(["hold@example.com"]);
    expect(resolveMarketingSegmentContacts).not.toHaveBeenCalled();
  });

  it("excludes a recipient who opted out AFTER A/B dispatch from cohort delivery", async () => {
    // Regression: pre-assigned cohorts previously skipped ALL delivery-time
    // suppression, so a post-dispatch unsubscribe still got the email.
    // select queue for deliverEmailSend: 1) tenant plan, 2) tenant address,
    // 3) pre_assigned rows, 4) marketing-contact opt-outs, 5) suppressions
    state.selectQ.push([{ plan: "enterprise" }]);
    state.selectQ.push([{ mailingAddress: "1 Main St", name: "Acme" }]);
    state.selectQ.push([{ email: "late-optout@example.com", name: null }]); // the whole cohort
    state.selectQ.push([{ email: "late-optout@example.com" }]);             // opted out after dispatch
    state.selectQ.push([]);                                                 // no global suppressions

    const result = await deliverEmailSend({ ...baseOpts(), abVariantLabel: "B" }, "send-b");
    // Cohort emptied by suppression → completes with zero deliveries.
    expect(result.sentCount).toBe(0);
    expect(result.suppressed?.map(s => s.email)).toContain("late-optout@example.com");
    // Cohort was used (no audience re-resolution) — suppression alone emptied it.
    expect(resolveMarketingSegmentContacts).not.toHaveBeenCalled();
    // No recipients were inserted/delivered for the opted-out contact.
    expect(state.insertedRecipients.flat()).toHaveLength(0);
  });

  it("an EMPTY pre-assigned cohort is authoritative — never falls back to the source audience", async () => {
    // Small-audience rounding: one recipient at a 25% split leaves the A and
    // B cohorts empty and the holdback with the single member. The empty
    // cohorts must deliver to NOBODY, not re-resolve the whole segment.
    state.selectQ.push([{ plan: "enterprise" }]);
    state.selectQ.push([{ mailingAddress: "1 Main St", name: "Acme" }]);
    state.selectQ.push([]); // pre_assigned rows: cohort is empty

    resolveMarketingSegmentContacts.mockResolvedValue([
      { email: "whole-audience@example.com", firstName: null, lastName: null },
    ]);

    const result = await deliverEmailSend({ ...baseOpts(), abVariantLabel: "A" }, "send-a");
    expect(result.sentCount).toBe(0);
    expect(result.totalRecipients).toBe(0);
    // The source audience was never re-resolved and nobody received email.
    expect(resolveMarketingSegmentContacts).not.toHaveBeenCalled();
    expect(state.insertedRecipients.flat()).toHaveLength(0);
    // The send row completed cleanly (zero-recipient cohort ≠ failure).
    expect(state.updates.some(u => u.status === "sent" && u.sentCount === 0)).toBe(true);
    expect(state.updates.filter(u => u.status === "failed")).toHaveLength(0);
  });

  it("worker defers a send whose HubSpot audience isn't ready and keeps processing others", async () => {
    // Two due sends: the first targets a HubSpot segment whose first import
    // hasn't finished (resolver throws deferSend); the second is unrelated.
    // The worker must requeue the first (not fail it) and still process the
    // second — a not-ready HubSpot audience never blocks other sends.
    const sendRow = (id: string, segId: string | null) => ({
      send: {
        id, tenantDomain: "acme.example.com", marketId: null, listId: null,
        segmentId: segId, createdBy: "u", trackOpens: true, trackClicks: true,
        excludeActiveProspects: false, senderIdentityId: null,
        subscriptionTypeIds: [], abVariantLabel: null, isAbHoldback: false,
      },
      email: { ...email, abTestEnabled: false },
    });
    state.selectQ.push([sendRow("send-defer", "seg-hs"), sendRow("send-ok", "seg-ok")]);

    resolveMarketingSegmentContacts.mockImplementation(async (segId: string) => {
      if (segId === "seg-hs") {
        throw Object.assign(new Error("first import not finished"), { deferSend: true });
      }
      return [{ email: "ok@example.com", firstName: null, lastName: null }];
    });
    // Each delivery consumes: plan gate → tenant address → (pre_assigned,
    // opt-outs, suppressions default to []). pullSubscriptionStatus is mocked
    // to no opt-outs.
    state.selectQ.push([{ plan: "enterprise" }]);           // send-defer: plan gate
    state.selectQ.push([{ mailingAddress: "1 Main St", name: "Acme" }]); // send-defer: address
    state.selectQ.push([{ plan: "enterprise" }]);           // send-ok: plan gate
    state.selectQ.push([{ mailingAddress: "1 Main St", name: "Acme" }]); // send-ok: address

    const res = await tickEmailSendWorker({ baseUrl: "https://app.example.com" });
    expect(res.processed).toBe(2);

    // The deferred send was requeued (scheduledAt pushed, status untouched),
    // never marked failed — no failed update carries the defer error.
    const deferUpdate = state.updates.find(u => u.scheduledAt instanceof Date && !u.status);
    expect(deferUpdate).toBeTruthy();
    expect(deferUpdate.errorMessage).toMatch(/first import not finished/);
    expect(
      state.updates.filter(u => u.status === "failed" && /first import/.test(u.errorMessage ?? "")),
    ).toHaveLength(0);
    // The second send still resolved its audience.
    expect(resolveMarketingSegmentContacts).toHaveBeenCalledWith("seg-ok", "acme.example.com", expect.any(Number));
  });

  it("falls back to segment resolution when no cohort was pre-assigned (non-A/B segment send)", async () => {
    resolveMarketingSegmentContacts.mockResolvedValue([
      { email: "Seg@Example.com", firstName: "S", lastName: "One" },
    ]);
    const opts = { ...baseOpts(), email: { ...email, abTestEnabled: false } };
    const { recipients, usePreAssigned } = await resolveDeliveryRecipients(opts, "send-x");
    expect(usePreAssigned).toBe(false);
    expect(recipients).toEqual([{ email: "seg@example.com", name: "S One" }]);
    expect(resolveMarketingSegmentContacts).toHaveBeenCalledWith("seg-1", "acme.example.com", expect.any(Number));
  });
});
