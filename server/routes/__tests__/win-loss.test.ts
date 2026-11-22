import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
const m = vi.hoisted(() => ({
  context: vi.fn(), feature: vi.fn(), competitors: vi.fn(), cards: vi.fn(), card: vi.fn(), ai: vi.fn(),
  hubspot: vi.fn(), preview: vi.fn(), discover: vi.fn(), usage: vi.fn(),
  results: [] as any[], queries: [] as any[], db: {} as any,
}));
vi.mock("../../db", () => {
  const db: any = {};
  for (const method of ["select", "insert", "update", "delete"]) db[method] = (table?: any) => {
    const result = m.results.shift() ?? [];
    const q: any = { method, table }; m.queries.push(q);
    const chain: any = { then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject) };
    for (const step of ["from", "where", "orderBy", "limit", "for", "set", "values"]) chain[step] = (value: any) => { q[step] = value; return chain; };
    chain.returning = () => Promise.resolve(result);
    return chain;
  };
  db.execute = vi.fn();
  db.transaction = (fn: any) => fn(db);
  m.db = db;
  return { db };
});
vi.mock("../../context", () => ({ getRequestContext: m.context, ContextError: class extends Error { status = 401; } }));
vi.mock("../helpers", () => ({
  guardFeature: m.feature, logAiUsage: m.usage,
  toContextFilter: (ctx: any) => ({ tenantDomain: ctx.tenantDomain, marketId: ctx.marketId }),
  validateResourceContext: (r: any, ctx: any) => r.tenantDomain === ctx.tenantDomain && r.marketId === ctx.marketId,
}));
vi.mock("../../storage", () => ({ storage: {
  getCompetitorsByContext: m.competitors, getBattlecardsByContext: m.cards, getBattlecard: m.card,
} }));
vi.mock("../../services/ai-provider", () => ({ completeForFeature: m.ai }));
vi.mock("../../services/win-loss-hubspot", () => ({ hubspotReader: m.hubspot, previewDeals: m.preview, discoverDeals: m.discover }));
import { registerWinLossRoutes } from "../win-loss";
import { salesOutcomes, salesOutcomeReviews, battlecards } from "@shared/schema";
const BASE = "/api/sales/win-loss";
const ctx = { userId: "editor", tenantId: "tenant-id", tenantDomain: "tenant.test", marketId: "market", userRole: "Analyst" };
const data = { dealLabel: "Reviewed deal", outcome: "won", closeDate: "2026-11-21", amount: "100", currency: "USD", segment: "Enterprise",
  competitorId: null, competitorConfirmed: false, reasonCodes: ["price"], notes: "Buyer feedback" };
const row = { id: "deal1", tenantDomain: ctx.tenantDomain, marketId: ctx.marketId, data, source: "manual", externalId: null, sourceSnapshot: null,
  version: 1, createdAt: new Date("2026-11-21"), updatedAt: new Date("2026-11-21") };
const card = { id: "card", competitorId: "competitor", tenantDomain: ctx.tenantDomain, marketId: ctx.marketId, customNotes: "Old notes", updatedAt: new Date("2026-11-20") };
const proposal = { id: "proposal", kind: "battlecard", tenantDomain: ctx.tenantDomain, marketId: ctx.marketId, approvedAt: null,
  payload: { proposal: { battlecardId: card.id, beforeNotes: card.customNotes, addition: "New cited notes [deal1]" },
    battlecardUpdatedAt: card.updatedAt.toISOString(), scope: { recordIds: ["deal1"] }, evidence: [{ id: "deal1", version: 1 }] } };
const dialect = new PgDialect();
const params = (q: any) => dialect.sqlToQuery(q.where).params;
let app: express.Express;
beforeEach(() => {
  vi.clearAllMocks(); m.results = []; m.queries = [];
  m.context.mockResolvedValue({ ...ctx }); m.feature.mockResolvedValue(true);
  m.competitors.mockResolvedValue([{ id: "competitor", name: "Explicit competitor" }]); m.cards.mockResolvedValue([]); m.card.mockResolvedValue(card);
  app = express(); app.use(express.json()); registerWinLossRoutes(app);
});
describe("scoped record CRUD", () => {
  it("creates a manual outcome without calling HubSpot", async () => {
    m.results = [[row]];
    const r = await request(app).post(BASE).send(data);
    expect(r.status).toBe(201); expect(r.body.dealLabel).toBe(data.dealLabel);
    expect(m.queries[0].values).toMatchObject({ tenantDomain: ctx.tenantDomain, marketId: ctx.marketId, source: "manual", createdBy: "editor" });
    expect(m.hubspot).not.toHaveBeenCalled();
  });
  it("reads only the active tenant and market, including summaries", async () => {
    m.results = [[row], []];
    const r = await request(app).get(BASE);
    expect(r.status).toBe(200); expect(r.body.records).toHaveLength(1);
    expect(params(m.queries[0])).toEqual([ctx.tenantDomain, ctx.marketId]);
    expect(params(m.queries[1])).toContain(ctx.tenantDomain); expect(params(m.queries[1])).toContain(ctx.marketId);
    m.results = [[row]];
    expect((await request(app).get(BASE + "/summary?from=2026-11-21")).body).toMatchObject({ denominator: 1, winRate: 1, scope: { undatedExcluded: true } });
  });
  it("validates competitor ownership and explicit confirmation before creating", async () => {
    expect((await request(app).post(BASE).send({ ...data, competitorId: "foreign", competitorConfirmed: true })).status).toBe(400);
    expect((await request(app).post(BASE).send({ ...data, competitorId: "competitor", competitorConfirmed: false })).status).toBe(400);
    expect(m.queries).toHaveLength(0);
    expect(m.competitors).toHaveBeenCalledWith({ tenantDomain: ctx.tenantDomain, marketId: ctx.marketId });
  });
  it("updates manually corrected data with an optimistic version and scoped predicates", async () => {
    m.results = [[{ ...row, data: { ...data, notes: "Correction" }, version: 2 }]];
    const r = await request(app).patch(BASE + "/deal1").send({ data: { ...data, notes: "Correction" }, version: 1 });
    expect(r.status).toBe(200); expect(r.body.version).toBe(2);
    expect(m.queries[0].set.data.notes).toBe("Correction");
    expect(params(m.queries[0])).toEqual([ctx.tenantDomain, ctx.marketId, "deal1", 1]);
  });
  it("rejects stale/cross-scope edits without falling back", async () => {
    m.results = [[]];
    expect((await request(app).patch(BASE + "/foreign").send({ data, version: 1 })).status).toBe(409);
    expect(params(m.queries[0])).toContain(ctx.marketId);
  });
  it("requires exact deal-label confirmation plus version for deletion", async () => {
    m.results = [[]];
    expect((await request(app).delete(BASE + "/deal1").send({ version: 1, confirmLabel: "wrong" })).status).toBe(409);
    expect(params(m.queries[0])).toEqual([ctx.tenantDomain, ctx.marketId, "deal1", 1, "wrong"]);
    m.results = [[row]];
    expect((await request(app).delete(BASE + "/deal1").send({ version: 1, confirmLabel: data.dealLabel })).status).toBe(200);
  });
});
describe("authorization and feature gates", () => {
  it.each(["Standard User", "Consultant", "Unrecognized"])("permits inspection but denies every mutation to %s", async userRole => {
    m.context.mockResolvedValue({ ...ctx, userRole });
    m.results = [[], []];
    const read = await request(app).get(BASE);
    expect(read.status).toBe(200); expect(read.body.canEdit).toBe(false);
    m.queries = [];
    for (const [verb, path, body] of [
      ["post", "", data], ["patch", "/deal1", { data, version: 1 }], ["delete", "/deal1", { version: 1, confirmLabel: data.dealLabel }],
      ["post", "/hubspot/preview", {}], ["post", "/hubspot/import", {}], ["post", "/themes", {}], ["post", "/reviews/proposal/approve", { approve: true }],
    ] as const) expect((await (request(app) as any)[verb](BASE + path).send(body)).status).toBe(403);
    expect((await request(app).get(BASE + "/hubspot/discovery")).status).toBe(403);
    expect(m.queries).toHaveLength(0); expect(m.ai).not.toHaveBeenCalled(); expect(m.hubspot).not.toHaveBeenCalled();
  });
  it("denies unavailable plans and does not loosen existing entitlement conventions", async () => {
    m.feature.mockImplementation(async (_req, res, feature) => {
      if (feature === "hubspotIntegration") { res.status(403).json({ error: "Upgrade required" }); return false; } return true;
    });
    expect((await request(app).get(BASE + "/hubspot/discovery")).status).toBe(403);
    m.results = [[row]];
    expect((await request(app).post(BASE).send(data)).status).toBe(201);
    expect(m.feature).toHaveBeenCalledWith(expect.anything(), expect.anything(), "battlecards");
  });
  it("requires authentication and does not expose a new unscoped partner API", async () => {
    const { ContextError } = await import("../../context");
    m.context.mockRejectedValueOnce(new ContextError("Not authenticated"));
    expect((await request(app).get(BASE)).status).toBe(401);
    m.context.mockResolvedValueOnce({ ...ctx, isPartnerApi: true });
    expect((await request(app).get(BASE)).status).toBe(403);
    expect(m.queries).toHaveLength(0);
  });
});
const selection = { externalId: "123", data, expectedVersion: null, replace: false, reviewed: true };
const batch = (existing: any = null, warnings: string[] = []) => ({ id: "review", kind: "import", createdBy: ctx.userId, approvedAt: null,
  payload: { portalId: "portal", mapping: {}, rows: [{ externalId: "123", raw: { amount: "100" }, existing, warnings }],
    expiresAt: new Date(Date.now() + 3600000).toISOString() } });
describe("reviewed idempotent imports", () => {
  it("imports only selected preview rows and retains review provenance", async () => {
    m.results = [[batch()], [], [], []];
    const r = await request(app).post(BASE + "/hubspot/import").send({ reviewId: "review", selected: [selection] });
    expect(r.status).toBe(200); expect(r.body.imported).toBe(1);
    const inserted = m.queries.find(q => q.method === "insert");
    expect(inserted.values).toMatchObject({ externalId: "portal:123", source: "hubspot", tenantDomain: ctx.tenantDomain, marketId: ctx.marketId,
      sourceSnapshot: { dealId: "123", reviewedBy: ctx.userId, reviewId: "review" } });
    expect(m.hubspot).not.toHaveBeenCalled();
  });
  it("never overwrites manual corrections without explicit replacement review", async () => {
    m.results = [[batch({ version: 1 })], [{ ...row, externalId: "portal:123" }]];
    const r = await request(app).post(BASE + "/hubspot/import").send({ reviewId: "review", selected: [{ ...selection, expectedVersion: 1 }] });
    expect(r.status).toBe(409); expect(m.queries.filter(q => q.method === "insert" || q.method === "update")).toHaveLength(0);
  });
  it("replaces only a matching, explicitly reviewed current version", async () => {
    m.results = [[batch({ version: 1 })], [row], [], []];
    const r = await request(app).post(BASE + "/hubspot/import").send({ reviewId: "review", selected: [{ ...selection, expectedVersion: 1, replace: true }] });
    expect(r.status).toBe(200);
    expect(m.queries.find(q => q.method === "update" && q.table === salesOutcomes).set).toMatchObject({ version: 2, sourceSnapshot: { priorRecord: { version: 1, notes: data.notes } } });
  });
  it.each(["stale", "replayed", "expired", "other-user", "unknown-deal", "forged-version", "unmapped"])("blocks unsafe %s imports", async mode => {
    const review: any = batch(mode === "stale" || mode === "forged-version" ? { version: 1 } : null, mode === "unmapped" ? ["Unmapped pipeline outcome: choose"] : []);
    if (mode === "replayed") review.approvedAt = new Date();
    if (mode === "expired") review.payload.expiresAt = "2000-01-01";
    if (mode === "other-user") review.createdBy = "someone-else";
    const chosen = { ...selection, ...(mode === "stale" ? { expectedVersion: 1, replace: true } : {}),
      ...(mode === "unknown-deal" ? { externalId: "forged" } : {}) };
    m.results = [[review], mode === "stale" ? [{ ...row, version: 2 }] : []];
    const r = await request(app).post(BASE + "/hubspot/import").send({ reviewId: "review", selected: [chosen] });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(m.queries.some(q => ["insert", "update", "delete"].includes(q.method))).toBe(false);
  });
  it("requires completed previews, rejects duplicate selections and missing explicit review", async () => {
    expect((await request(app).post(BASE + "/hubspot/import").send({ reviewId: "r", selected: [selection, selection] })).status).toBe(400);
    expect((await request(app).post(BASE + "/hubspot/import").send({ reviewId: "r", selected: [{ ...selection, reviewed: false }] })).status).toBe(400);
    m.results = [[]];
    expect((await request(app).post(BASE + "/hubspot/import").send({ reviewId: "missing", selected: [selection] })).status).toBe(404);
  });
  it("does not persist incomplete or rate-limited previews", async () => {
    m.hubspot.mockResolvedValue({ read: vi.fn(), portalId: "p" }); m.preview.mockRejectedValue(new Error("page failed"));
    const mapping = { label: "name", closeDate: "closedate", amount: "amount", currency: null, segment: null, competitor: null, reason: null, stages: { "p:s": "won" }, reasons: {} };
    expect((await request(app).post(BASE + "/hubspot/preview").send(mapping)).status).toBe(502);
    expect(m.queries.some(q => q.method === "insert")).toBe(false);
  });
});
describe("evidence and explicit battlecard approval", () => {
  it("generates only persisted review proposals, logs usage, and never updates a battlecard", async () => {
    const evidence = { ...row, data: { ...data, competitorId: "competitor", competitorConfirmed: true } };
    m.results = [[evidence], [{ id: "proposal", kind: "battlecard" }]];
    m.ai.mockResolvedValue({ text: JSON.stringify({ themes: [{ title: "Price", summary: "Buyer cited price", evidenceIds: ["deal1"] }], addition: "Buyer cited price [deal1]" }),
      usage: { inputTokens: 100, outputTokens: 50 }, provider: "test", model: "test", durationMs: 10 });
    expect((await request(app).post(BASE + "/themes").send({ recordIds: ["deal1"], battlecardId: "card" })).status).toBe(201);
    expect(m.queries.some(q => q.method === "update")).toBe(false);
    expect(m.queries.find(q => q.method === "insert").table).toBe(salesOutcomeReviews);
    expect(m.usage).toHaveBeenCalledWith(ctx, "win_loss_themes", "test", "test", { input_tokens: 100, output_tokens: 50 }, 10);
  });
  it("rejects cross-scope evidence and unconfirmed competitor attribution before calling AI", async () => {
    m.results = [[]];
    expect((await request(app).post(BASE + "/themes").send({ recordIds: ["foreign"] })).status).toBe(404);
    m.results = [[row]];
    expect((await request(app).post(BASE + "/themes").send({ recordIds: ["deal1"], battlecardId: "card" })).status).toBe(400);
    expect(m.ai).not.toHaveBeenCalled();
  });
  it("approves the reviewed addition only after explicit approval and records approver", async () => {
    m.results = [[proposal], [card], [row], [], []];
    expect((await request(app).post(BASE + "/reviews/proposal/approve").send({ approve: true })).status).toBe(200);
    const updated = m.queries.find(q => q.method === "update" && q.table === battlecards);
    expect(updated.set.customNotes).toBe("Old notes\n\nReviewed win/loss evidence\nNew cited notes [deal1]");
    expect(m.queries.find(q => q.method === "update" && q.table === salesOutcomeReviews).set.approvedBy).toBe("editor");
  });
  it.each(["no-consent", "already-approved", "changed-card", "changed-evidence", "deleted-evidence", "foreign-card"])("blocks %s approval", async mode => {
    m.results = [[mode === "already-approved" ? { ...proposal, approvedAt: new Date() } : proposal],
      [mode === "changed-card" ? { ...card, customNotes: "New manual notes" } : mode === "foreign-card" ? { ...card, marketId: "foreign" } : card],
      mode === "deleted-evidence" ? [] : [{ ...row, version: mode === "changed-evidence" ? 2 : 1 }]];
    const r = await request(app).post(BASE + "/reviews/proposal/approve").send({ approve: mode !== "no-consent" });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(m.queries.some(q => q.method === "update")).toBe(false);
  });
});
