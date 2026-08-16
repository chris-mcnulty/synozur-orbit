/**
 * Mark-sent externally (HubSpot) — Task #781
 *
 * POST /api/generated-emails/:id/mark-sent cancels any pending/queued
 * email_sends rows so an external "sent via HubSpot" flag can never race a
 * queued Orbit (SendGrid) delivery into a duplicate.
 *
 * Covers:
 *   1. Worker integration — the REAL tickEmailSendWorker (unmocked
 *      email-campaign-sender) never delivers a send cancelled by mark-sent,
 *      while a still-queued control send for a different email IS picked up.
 *   2. Route behaviour — cancellation semantics (pending+queued → failed,
 *      in-flight "sending" left alone), HubSpot URL validation (https +
 *      hubspot.com hosts only; javascript:/data:/http rejected), and id
 *      derivation from pasted URLs.
 *
 * The db mock is a small in-memory store; drizzle WHERE clauses are rendered
 * to SQL via PgDialect and genuinely evaluated against the stored rows, so
 * the tests exercise the production predicates (e.g. the worker's
 * status='queued' filter) rather than re-implementing them.
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

// ── In-memory store + drizzle WHERE evaluation ───────────────────────────────

const state = vi.hoisted(() => ({
  store: {
    generated_emails: [] as any[],
    email_sends: [] as any[],
    tenants: [] as any[],
  } as Record<string, any[]>,
  updates: [] as Array<{ table: string; payload: any }>,
  sgSendCalls: [] as any[],
}));

const dialect = new PgDialect();

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/** Evaluate a drizzle condition (conjunctions of =, in, <=, is not null) against a row. */
function rowMatches(cond: any, row: any): boolean {
  if (!cond) return true;
  const { sql, params } = dialect.sqlToQuery(cond);
  // Flat conjunctions only — enough for the predicates under test.
  const clauses = sql.replace(/[()]/g, "").split(" and ");
  return clauses.every((clause) => {
    const m = clause.trim().match(/^"[\w]+"\."(\w+)"\s+(.*)$/);
    if (!m) throw new Error(`Unsupported clause in test evaluator: ${clause}`);
    const value = row[snakeToCamel(m[1])];
    const rest = m[2].trim();
    const paramAt = (token: string) => params[parseInt(token.slice(1), 10) - 1];
    if (rest === "is not null") return value !== null && value !== undefined;
    let pm = rest.match(/^=\s+(\$\d+)$/);
    if (pm) return value === paramAt(pm[1]);
    pm = rest.match(/^<=\s+(\$\d+)$/);
    if (pm) return new Date(value).getTime() <= new Date(paramAt(pm[1]) as any).getTime();
    if (rest.startsWith("in ")) {
      const tokens = rest.match(/\$\d+/g) ?? [];
      return tokens.some((t) => paramAt(t) === value);
    }
    throw new Error(`Unsupported operator in test evaluator: ${rest}`);
  });
}

vi.mock("../../db", () => {
  function makeSelect(fields?: any) {
    const q: any = { table: "", cond: undefined, limitN: Infinity };
    const resolve = () => {
      const rows = (state.store[q.table] ?? []).filter((r: any) => rowMatches(q.cond, r)).slice(0, q.limitN);
      // Worker-shaped join: select({ send, email }).from(emailSends).innerJoin(generatedEmails, ...)
      if (fields && "send" in fields && "email" in fields) {
        return rows
          .map((send: any) => ({ send, email: state.store.generated_emails.find((e: any) => e.id === send.generatedEmailId) }))
          .filter((r: any) => r.email);
      }
      return rows.map((r: any) => ({ ...r }));
    };
    const chain: any = {
      from: (t: any) => { q.table = getTableName(t); return chain; },
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: (cond: any) => { q.cond = cond; return chain; },
      orderBy: () => chain,
      groupBy: () => chain,
      limit: (n: number) => { q.limitN = n; return chain; },
      then: (res: any, rej: any) => Promise.resolve(resolve()).then(res, rej),
    };
    return chain;
  }
  function makeUpdate(t: any) {
    const table = getTableName(t);
    return {
      set: (payload: any) => ({
        where: (cond: any) => {
          const matched = (state.store[table] ?? []).filter((r: any) => rowMatches(cond, r));
          matched.forEach((r: any) => Object.assign(r, payload));
          state.updates.push({ table, payload });
          const p: any = {
            then: (res: any, rej: any) => Promise.resolve(matched).then(res, rej),
            returning: () => Promise.resolve(matched.map((r: any) => ({ id: r.id }))),
          };
          return p;
        },
      }),
    };
  }
  return {
    db: {
      select: makeSelect,
      update: makeUpdate,
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]), then: (res: any) => Promise.resolve([]).then(res), onConflictDoNothing: () => Promise.resolve([]) }) }),
      delete: () => ({ where: () => Promise.resolve([]) }),
    },
  };
});

// ── Environment mocks (auth, plan, heavy transitive imports) ─────────────────

vi.mock("../../context", () => ({
  getRequestContext: vi.fn().mockResolvedValue({ tenantDomain: "acme.example.com", marketId: null }),
}));

vi.mock("../../storage", () => ({
  storage: {
    getTenantByDomain: vi.fn().mockResolvedValue({ domain: "acme.example.com", plan: "enterprise" }),
    getUser: vi.fn().mockResolvedValue({ id: "user-1", role: "Standard User" }),
  },
}));

vi.mock("../../services/plan-policy", () => ({
  checkFeatureAccessAsync: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("../../utils/encryption", () => ({ encryptSecret: vi.fn(), decryptSecret: vi.fn() }));
vi.mock("../../services/social-publishers", () => ({ getPublisher: vi.fn() }));
vi.mock("../../services/social-publishers/linkedin", () => ({ LinkedInPublisher: class {} }));
vi.mock("../../services/marketing-publish-worker", () => ({ publishPostNow: vi.fn() }));
vi.mock("../../services/hubspot-timeline", () => ({ pushEmailTimelineEvent: vi.fn(), pushSentEventsForSend: vi.fn() }));
vi.mock("../../services/hubspot-email-sync-core", () => ({ timelineEventId: vi.fn(), reconcileSuppression: vi.fn() }));
vi.mock("../../services/hubspot-email-sync", () => ({
  pushUnsubscribe: vi.fn(), pushSubscribe: vi.fn(), pullSubscriptionStatus: vi.fn(),
}));
vi.mock("../../services/hubspot-contact-resolver", () => ({ resolveSendRecipientContacts: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("../../services/email-ab-test", () => ({
  resolveTokensPreview: vi.fn(), KNOWN_TOKENS: [],
  resolveTokens: vi.fn((s: string) => s), resolveTokensForEmail: vi.fn((s: string) => s),
}));
vi.mock("../../services/marketing-links-helpers", () => ({ wrapOutboundLinksInText: vi.fn((s: string) => s) }));

// SendGrid must never be reached for a cancelled send.
vi.mock("@sendgrid/mail", () => ({
  default: {
    setApiKey: vi.fn(),
    send: vi.fn(async (msg: any) => { state.sgSendCalls.push(msg); return [{ statusCode: 202 }]; }),
  },
}));

// NOTE: ../../services/email-campaign-sender is intentionally NOT mocked —
// the worker test runs the real tickEmailSendWorker.
import { registerMarketingDeliveryRoutes } from "../marketing-delivery";
import { tickEmailSendWorker } from "../../services/email-campaign-sender";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.session = { userId: "user-1" }; next(); });
  registerMarketingDeliveryRoutes(app);
  return app;
}

const TENANT = "acme.example.com";

function seedEmail(id: string, overrides: any = {}) {
  const row = {
    id, tenantDomain: TENANT, status: "approved", sentAt: null,
    subject: "Hello", htmlBody: "<p>Hi</p>", textBody: "Hi",
    hubspotEmailId: null, hubspotEmailUrl: null, ...overrides,
  };
  state.store.generated_emails.push(row);
  return row;
}

function seedSend(id: string, generatedEmailId: string, status: string, overrides: any = {}) {
  const row = {
    id, tenantDomain: TENANT, generatedEmailId, status,
    scheduledAt: new Date(Date.now() - 60_000), marketId: null,
    listId: "list-1", segmentId: null, createdBy: "user-1",
    trackOpens: true, trackClicks: true, excludeActiveProspects: false,
    senderIdentityId: null, subscriptionTypeIds: [],
    abVariantLabel: null, isAbHoldback: false, errorMessage: null, completedAt: null,
    ...overrides,
  };
  state.store.email_sends.push(row);
  return row;
}

beforeEach(() => {
  state.store.generated_emails = [];
  state.store.email_sends = [];
  state.store.tenants = [];
  state.updates.length = 0;
  state.sgSendCalls.length = 0;
});

// ── 1. Worker never delivers a cancelled send ────────────────────────────────

describe("tickEmailSendWorker after mark-sent cancellation", () => {
  it("skips the cancelled send entirely while still processing other due queued sends", async () => {
    seedEmail("email-hs");
    seedEmail("email-orbit");
    const cancelledTarget = seedSend("send-hs", "email-hs", "queued");
    const control = seedSend("send-orbit", "email-orbit", "queued");

    // Operator flags the first email as already sent via HubSpot.
    const res = await request(makeApp()).post("/api/generated-emails/email-hs/mark-sent").send({});
    expect(res.status).toBe(200);
    expect(res.body.cancelledQueuedSends).toBe(1);
    expect(cancelledTarget.status).toBe("failed");
    expect(cancelledTarget.errorMessage).toMatch(/marked as sent externally/i);
    expect(cancelledTarget.completedAt).toBeInstanceOf(Date);

    // Real worker tick: only the control send is due — the cancelled one must
    // never be picked up (the worker's own status='queued' predicate is
    // evaluated against the store, not re-implemented here).
    const result = await tickEmailSendWorker({ baseUrl: "https://app.example.com" });
    expect(result.processed).toBe(1);
    expect(result.sent).toBe(0);

    // Nothing was handed to SendGrid, and the cancelled row kept its
    // cancellation marker (it was not re-processed / re-stamped).
    expect(state.sgSendCalls).toHaveLength(0);
    expect(cancelledTarget.status).toBe("failed");
    expect(cancelledTarget.errorMessage).toMatch(/marked as sent externally/i);

    // The control send WAS picked up (it terminalizes as failed here because
    // the test tenant has no CAN-SPAM mailing address — proving the worker
    // genuinely attempted delivery of the still-queued row).
    expect(control.status).toBe("failed");
    expect(control.errorMessage).not.toMatch(/marked as sent externally/i);
  });

  it("processes nothing when the only due send was cancelled by mark-sent", async () => {
    seedEmail("email-1");
    seedSend("send-1", "email-1", "queued");

    await request(makeApp()).post("/api/generated-emails/email-1/mark-sent").send({});
    const result = await tickEmailSendWorker({ baseUrl: "https://app.example.com" });
    expect(result).toEqual({ processed: 0, sent: 0, failed: 0 });
    expect(state.sgSendCalls).toHaveLength(0);
  });
});

// ── 2. Route cancellation semantics ──────────────────────────────────────────

describe("POST /api/generated-emails/:id/mark-sent — send cancellation", () => {
  it("cancels pending + queued sends but leaves in-flight and terminal sends alone", async () => {
    seedEmail("email-1");
    const pending = seedSend("s-pending", "email-1", "pending");
    const queued = seedSend("s-queued", "email-1", "queued");
    const sending = seedSend("s-sending", "email-1", "sending");
    const done = seedSend("s-sent", "email-1", "sent");
    // Another email's queued send must be untouched.
    seedEmail("email-2");
    const other = seedSend("s-other", "email-2", "queued");

    const res = await request(makeApp()).post("/api/generated-emails/email-1/mark-sent").send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.cancelledQueuedSends).toBe(2);

    expect(pending.status).toBe("failed");
    expect(queued.status).toBe("failed");
    expect(sending.status).toBe("sending");
    expect(done.status).toBe("sent");
    expect(other.status).toBe("queued");

    const email = state.store.generated_emails.find((e) => e.id === "email-1")!;
    expect(email.status).toBe("sent");
    expect(email.sentAt).toBeInstanceOf(Date);
  });

  it("404s for an unknown email without touching any sends", async () => {
    seedEmail("email-1");
    const queued = seedSend("s-1", "email-1", "queued");
    const res = await request(makeApp()).post("/api/generated-emails/nope/mark-sent").send({});
    expect(res.status).toBe(404);
    expect(queued.status).toBe("queued");
  });
});

// ── 3. HubSpot URL validation + id derivation ────────────────────────────────

describe("POST /api/generated-emails/:id/mark-sent — HubSpot link handling", () => {
  const post = (body: any) => {
    seedEmail("email-1");
    return request(makeApp()).post("/api/generated-emails/email-1/mark-sent").send(body);
  };

  it.each([
    ["javascript:alert(1)", /https/i],
    ["data:text/html,<script>alert(1)</script>", /https|valid URL/i],
    ["http://app.hubspot.com/email/123456", /https/i], // https required
    ["https://evil.com/email/123456", /hubspot\.com/i], // host allow-list
    ["https://nothubspot.com/email/123456", /hubspot\.com/i],
    ["https://hubspot.com.evil.com/email/123456", /hubspot\.com/i], // suffix spoof
    ["not a url at all", /valid URL/i],
  ])("rejects %s with 400", async (url, msgPattern) => {
    const res = await post({ hubspotEmailUrl: url });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(msgPattern);
    const email = state.store.generated_emails.find((e) => e.id === "email-1")!;
    expect(email.status).not.toBe("sent");
    expect(email.hubspotEmailUrl).toBeNull();
  });

  it("accepts https URLs on hubspot.com and subdomains", async () => {
    for (const url of ["https://hubspot.com/email/123456", "https://app.hubspot.com/email/123456"]) {
      state.store.generated_emails = [];
      const res = await post({ hubspotEmailUrl: url });
      expect(res.status).toBe(200);
      const email = state.store.generated_emails.find((e) => e.id === "email-1")!;
      expect(email.hubspotEmailUrl).toBe(url);
    }
  });

  it("derives the email id from a marketing-email path URL", async () => {
    const res = await post({ hubspotEmailUrl: "https://app.hubspot.com/marketing-email/12345678/performance" });
    expect(res.status).toBe(200);
    const email = state.store.generated_emails.find((e) => e.id === "email-1")!;
    expect(email.hubspotEmailId).toBe("12345678");
  });

  it("derives the email id from an ?emailId= query param", async () => {
    const res = await post({ hubspotEmailUrl: "https://app.hubspot.com/email-tool/?emailId=98765" });
    expect(res.status).toBe(200);
    const email = state.store.generated_emails.find((e) => e.id === "email-1")!;
    expect(email.hubspotEmailId).toBe("98765");
  });

  it("prefers an explicitly supplied numeric id over URL derivation, and ignores non-numeric ids", async () => {
    const res = await post({
      hubspotEmailId: "424242",
      hubspotEmailUrl: "https://app.hubspot.com/marketing-email/12345678/performance",
    });
    expect(res.status).toBe(200);
    const email = state.store.generated_emails.find((e) => e.id === "email-1")!;
    expect(email.hubspotEmailId).toBe("424242");

    state.store.generated_emails = [];
    const res2 = await post({ hubspotEmailId: "<script>", hubspotEmailUrl: "https://app.hubspot.com/marketing-email/555555/x" });
    expect(res2.status).toBe(200);
    const email2 = state.store.generated_emails.find((e) => e.id === "email-1")!;
    expect(email2.hubspotEmailId).toBe("555555");
  });
});
