import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import express from "express";
import supertest from "supertest";
import { OrbitRepository } from "./repository";
import { retrieveSources } from "./retrieval";
import { validateAnswer } from "./grounding";
import { registerAskOrbitRoutes } from "../../routes/ask-orbit";
import type { RequestContext } from "../../context";
import type { OrbitSource } from "@shared/ask-orbit";

// Only disposable schemas in the development database; no production access,
// intelligence mutation, real users, or paid provider calls.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite("Ask Orbit PostgreSQL and HTTP integration", () => {
  const schema = `ask_orbit_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6, options: `-c search_path=${schema}` });
  const ctx: RequestContext = {
    tenantId: randomUUID(), marketId: randomUUID(), userId: randomUUID(), userRole: "Analyst",
    tenantDomain: "orbit-test.invalid", isDefaultMarket: true,
  };
  const otherUser = { ...ctx, userId: randomUUID() };
  const otherMarket = { ...ctx, marketId: randomUUID(), isDefaultMarket: false };
  const otherTenant = { ...ctx, tenantId: randomUUID(), marketId: randomUUID(), tenantDomain: "other-test.invalid" };
  const repo = new OrbitRepository(pool, 3);
  const evidence: OrbitSource = { sourceId: "competitor:123", title: "Verified competitor", date: null, stale: true,
    url: "/app/competitors/123", text: "Acme offers enterprise analytics tools for retail teams." };
  const answer = validateAnswer(JSON.stringify({ evidence: [{ sourceId: evidence.sourceId, quote: evidence.text }], insufficient: false }), [evidence]);

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`CREATE TABLE tenants(id varchar PRIMARY KEY);
      CREATE TABLE markets(id varchar PRIMARY KEY);
      CREATE TABLE users(id varchar PRIMARY KEY);`);
    await pool.query(readFileSync("migrations/0109_ask_orbit.sql", "utf8"));
    for (const value of [ctx.tenantId, otherTenant.tenantId]) await pool.query("INSERT INTO tenants VALUES($1)", [value]);
    for (const value of [ctx.marketId, otherMarket.marketId, otherTenant.marketId]) await pool.query("INSERT INTO markets VALUES($1)", [value]);
    for (const value of [ctx.userId, otherUser.userId]) await pool.query("INSERT INTO users VALUES($1)", [value]);
    // LIKE checks every retrieval column against the real existing schema while
    // not copying production data or foreign keys. Defaults/not-null remain.
    for (const table of ["competitors", "activity", "intelligence_briefings", "long_form_recommendations",
      "marketing_plans", "marketing_tasks", "products", "roadmap_items"]) {
      await pool.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS)`);
    }
  }, 30_000);
  beforeEach(async () => {
    await pool.query(`TRUNCATE ask_orbit_turns,ask_orbit_conversations,ask_orbit_monthly_usage,
      competitors,activity,intelligence_briefings,long_form_recommendations,marketing_plans,marketing_tasks,products,roadmap_items CASCADE`);
  });
  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("persists named conversations, scopes every CRUD operation to owner/tenant/market, and cascades deletion", async () => {
    const conversation = await repo.create(ctx, "Original");
    await repo.rename(ctx, conversation.id, "Renamed");
    expect((await repo.list(ctx))[0].title).toBe("Renamed");
    for (const outsider of [otherUser, otherTenant, otherMarket, { ...otherUser, userRole: "Global Admin" }]) {
      expect(await repo.list(outsider)).toEqual([]);
      await expect(repo.get(outsider, conversation.id)).rejects.toMatchObject({ status: 404 });
      await expect(repo.rename(outsider, conversation.id, "Stolen")).rejects.toMatchObject({ status: 404 });
      await expect(repo.delete(outsider, conversation.id)).rejects.toMatchObject({ status: 404 });
      await expect(repo.reserve(outsider, conversation.id, randomUUID(), "Read private data")).rejects.toMatchObject({ status: 404 });
    }
    const id = randomUUID();
    await repo.reserve(ctx, conversation.id, id, "Question");
    expect(await repo.turn(otherUser, conversation.id, id)).toBeUndefined();
    expect(await repo.finish(otherUser, conversation.id, id, "completed", answer, null)).toBe(false);
    await repo.finish(ctx, conversation.id, id, "completed", answer, null);
    expect((await repo.get(ctx, conversation.id)).turns[0].answer).toEqual(answer);
    await repo.delete(ctx, conversation.id);
    expect((await pool.query("SELECT * FROM ask_orbit_turns")).rowCount).toBe(0);
    expect((await repo.usage(ctx)).used).toBe(1);
  });

  it("atomically shares the allowance across concurrent owners and markets", async () => {
    const contexts = [ctx, otherUser, otherMarket, ctx, otherUser, otherMarket];
    const conversations = await Promise.all(contexts.map(c => repo.create(c, "Race")));
    const results = await Promise.allSettled(conversations.map((c, i) => repo.reserve(contexts[i], c.id, randomUUID(), "Question")));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter(r => r.status === "rejected").map(r => (r as PromiseRejectedResult).reason.status)).toEqual([429, 429, 429]);
    expect((await repo.usage(ctx)).remaining).toBe(0);
    expect((await repo.usage(otherUser)).used).toBe(3);
    expect((await repo.usage(otherMarket)).used).toBe(3);
    expect((await repo.usage(otherTenant)).used).toBe(0);
  });

  it("reserves once for concurrent identical requests; changed payload and concurrent new turns do not spend quota", async () => {
    const c = await repo.create(ctx, "Idempotency"), id = randomUUID();
    const attempts = await Promise.all([repo.reserve(ctx, c.id, id, "Question"), repo.reserve(ctx, c.id, id, "Question")]);
    expect(attempts.map(a => a.created).sort()).toEqual([false, true]);
    expect((await repo.usage(ctx)).used).toBe(1);
    await expect(repo.reserve(ctx, c.id, id, "Changed")).rejects.toMatchObject({ status: 409 });
    await expect(repo.reserve(ctx, c.id, randomUUID(), "Concurrent")).rejects.toMatchObject({ status: 409 });
    expect((await repo.usage(ctx)).used).toBe(1);
    await repo.finish(ctx, c.id, id, "cancelled", null, "Stopped");
    expect((await repo.reserve(ctx, c.id, id, "Question")).turn.status).toBe("cancelled");
    expect(await repo.finish(ctx, c.id, id, "completed", answer, null)).toBe(false);
    expect((await repo.usage(ctx)).used).toBe(1);
  });

  it("recovers an interrupted turn without repeating generation or refunding the reservation", async () => {
    const c = await repo.create(ctx, "Recovery"), id = randomUUID();
    await repo.reserve(ctx, c.id, id, "Question");
    await repo.providerStarted(ctx, c.id, id);
    await pool.query("UPDATE ask_orbit_turns SET created_at=now()-interval '5 minutes' WHERE id=$1", [id]);
    expect((await repo.get(ctx, c.id)).turns[0].status).toBe("failed");
    expect((await repo.reserve(ctx, c.id, id, "Question")).created).toBe(false);
    expect((await repo.usage(ctx)).used).toBe(1);
  });

  it("fails closed when a monthly allowance is missing", async () => {
    const invalidRepo = new OrbitRepository(pool, 0);
    await expect(invalidRepo.usage(ctx)).rejects.toMatchObject({ status: 503 });
    const c = await repo.create(ctx, "Invalid config");
    await expect(invalidRepo.reserve(ctx, c.id, randomUUID(), "Question")).rejects.toMatchObject({ status: 503 });
    expect((await repo.usage(ctx)).used).toBe(0);
  });

  async function competitor(tenant = ctx.tenantDomain, market: string | null = ctx.marketId, project: string | null = null) {
    const id = randomUUID();
    await pool.query(`INSERT INTO competitors(id,name,url,user_id,tenant_domain,market_id,project_id,analysis_data)
      VALUES($1,'Acme','https://acme.invalid',$2,$3,$4,$5,'{"summary":"Enterprise analytics for retailers"}')`,
    [id, ctx.userId, tenant, market, project]);
    return id;
  }
  it("retrieves only active tenant/market profiles, default-market legacy sources, never project/null-tenant sources", async () => {
    const own = await competitor(), legacy = await competitor(ctx.tenantDomain, null);
    await competitor(otherTenant.tenantDomain, otherTenant.marketId);
    await competitor(ctx.tenantDomain, otherMarket.marketId);
    await competitor(ctx.tenantDomain, ctx.marketId, randomUUID());
    await competitor(null as unknown as string, ctx.marketId);
    const sources = await retrieveSources(ctx, {}, "Acme", pool);
    expect(sources.map(s => s.sourceId).sort()).toEqual([`competitor:${own}`, `competitor:${legacy}`].sort());
    expect(sources.every(s => s.date === null && s.stale)).toBe(true);
    const nonDefault = await retrieveSources(otherMarket, {}, "Acme", pool);
    expect(nonDefault).toHaveLength(1);
    expect(nonDefault[0].sourceId).not.toBe(`competitor:${legacy}`);
  });
  it("retrieves all six intelligence surfaces and enforces gates before material enters the result", async () => {
    const comp = await competitor();
    const plan = randomUUID(), product = randomUUID(), briefing = randomUUID(), roadmap = randomUUID();
    await pool.query(`INSERT INTO activity(competitor_id,competitor_name,type,description,date,impact,tenant_domain,market_id)
      VALUES($1,'Acme','website_change','Updated positioning for enterprise retailers','2026-10-01','High',$2,$3)`, [comp, ctx.tenantDomain, ctx.marketId]);
    await pool.query(`INSERT INTO intelligence_briefings(id,tenant_domain,market_id,period_start,period_end,briefing_data)
      VALUES($1,$2,$3,now(),now(),'{"executiveSummary":"Retail enterprise activity increased"}')`, [briefing, ctx.tenantDomain, ctx.marketId]);
    for (const type of ["gtm_plan", "messaging_framework"]) {
      await pool.query(`INSERT INTO long_form_recommendations(type,tenant_domain,market_id,content,status)
        VALUES($1,$2,$3,'Focus on enterprise retailers and their analytics needs','generated')`, [type, ctx.tenantDomain, ctx.marketId]);
    }
    await pool.query(`INSERT INTO marketing_plans(id,tenant_domain,market_id,name,fiscal_year,created_by)
      VALUES($1,$2,$3,'Retail marketing','2026',$4)`, [plan, ctx.tenantDomain, ctx.marketId, ctx.userId]);
    await pool.query(`INSERT INTO marketing_tasks(plan_id,title,activity_group,timeframe,status)
      VALUES($1,'Run enterprise retailer webinar','Events','Q1','accepted')`, [plan]);
    await pool.query(`INSERT INTO products(id,name,tenant_domain,market_id,is_baseline,created_by)
      VALUES($1,'Analytics',$2,$3,TRUE,$4)`, [product, ctx.tenantDomain, ctx.marketId, ctx.userId]);
    await pool.query(`INSERT INTO roadmap_items(id,product_id,tenant_domain,market_id,title)
      VALUES($1,$2,$3,$4,'Launch retail analytics')`, [roadmap, product, ctx.tenantDomain, ctx.marketId]);
    const sources = await retrieveSources(ctx, Object.fromEntries(["websiteMonitoring", "socialMonitoring", "intelligenceBriefings",
      "gtmPlan", "messagingFramework", "marketingPlanner", "productManagement"].map(f => [f, true])), "enterprise retailers", pool);
    expect(sources.map(s => s.sourceId.split(":")[0]).sort()).toEqual(
      ["competitor", "change", "briefing", "gtm_plan", "messaging_framework", "marketing", "roadmap"].sort());
    expect(sources.find(s => s.sourceId === `briefing:${briefing}`)?.url).toContain(`?id=${briefing}`);
    expect(sources.find(s => s.sourceId === `marketing:${plan}`)?.text).toContain("webinar");
    expect(sources.find(s => s.sourceId === `roadmap:${roadmap}`)?.url).toContain(`${product}?tab=roadmap`);
    expect(await retrieveSources(ctx, {}, "enterprise retailers", pool)).toHaveLength(1);
  });

  function api(generate = vi.fn(async () => answer), options: { timeoutMs?: number; empty?: boolean } = {}) {
    const app = express();
    app.use(express.json());
    registerAskOrbitRoutes(app, {
      repository: repo, authorize: async req => ({
        ctx: req.headers["x-test-user"] ? otherUser : ctx, access: {},
      }),
      retrieve: async () => options.empty ? [] : [evidence],
      generate, timeoutMs: options.timeoutMs ?? 5000,
    });
    return { app, generate };
  }
  it("answers over HTTP, reopens persisted citations and replays without extra charges or duplicate messages", async () => {
    const { app, generate } = api(), http = supertest(app);
    const c = (await http.post("/api/ask-orbit/conversations").send({ title: "Retail strategy" })).body;
    const id = randomUUID(), path = `/api/ask-orbit/conversations/${c.id}/turns`, body = { requestId: id, question: "What does Acme offer?" };
    const first = await http.post(path).send(body);
    expect(first.status).toBe(200);
    expect(first.text).toContain('"type":"done"');
    expect(first.text).toContain(evidence.text);
    const replay = await http.post(path).send(body);
    expect(replay.text).toContain('"type":"done"');
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await http.get(`/api/ask-orbit/conversations/${c.id}`)).body.turns).toHaveLength(1);
    expect((await http.get("/api/ask-orbit")).body.usage.used).toBe(1);
    expect((await http.get(`/api/ask-orbit/conversations/${c.id}`).set("x-test-user", "other")).status).toBe(404);
    expect((await http.post(path).set("x-test-user", "other").send(body)).status).toBe(404);
    expect((await http.post(`/api/ask-orbit/conversations/${c.id}/turns/${id}/stop`).set("x-test-user", "other")).status).toBe(404);
  });
  it("returns explicit insufficient evidence without invoking AI", async () => {
    const { app, generate } = api(undefined, { empty: true });
    const c = await repo.create(ctx, "No evidence");
    const result = await supertest(app).post(`/api/ask-orbit/conversations/${c.id}/turns`).send({ requestId: randomUUID(), question: "Future pricing?" });
    expect(result.text).toContain("enough verified evidence");
    expect(generate).not.toHaveBeenCalled();
    expect((await repo.usage(ctx)).used).toBe(1);
  });
  it("persists stream/provider failures; replay never regenerates", async () => {
    const generate = vi.fn(async () => { throw new Error("provider failed"); });
    const { app } = api(generate);
    const c = await repo.create(ctx, "Failure"), id = randomUUID(), body = { requestId: id, question: "Question" };
    const http = supertest(app), path = `/api/ask-orbit/conversations/${c.id}/turns`;
    expect((await http.post(path).send(body)).text).toContain('"type":"error"');
    expect((await repo.get(ctx, c.id)).turns[0].status).toBe("failed");
    await http.post(path).send(body);
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await repo.usage(ctx)).used).toBe(1);
  });
  it("stops provider work and prevents late answers, without stopping a later different turn", async () => {
    let started!: () => void;
    const ready = new Promise<void>(r => { started = r; });
    const generate = vi.fn(async (...args: Parameters<typeof import("./generation").generateAnswer>) => {
      started();
      await new Promise<void>((_, reject) => args[4].addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      return answer;
    });
    const { app } = api(generate);
    const c = await repo.create(ctx, "Stop"), id = randomUUID();
    const http = supertest(app), path = `/api/ask-orbit/conversations/${c.id}/turns`;
    const pending = http.post(path).send({ requestId: id, question: "Question" }).then(r => r);
    await ready;
    expect((await http.post(`${path}/${id}/stop`)).status).toBe(200);
    await pending;
    expect((await repo.turn(ctx, c.id, id))?.status).toBe("cancelled");
    expect(await repo.finish(ctx, c.id, id, "completed", answer, null)).toBe(false);
    expect((await repo.usage(ctx)).used).toBe(1);
  });
  it("times out stuck provider work and preserves the failed attempt", async () => {
    const generate = vi.fn(async (...args: Parameters<typeof import("./generation").generateAnswer>) => {
      await new Promise<void>((_, reject) => args[4].addEventListener("abort", () => reject(new Error("timeout")), { once: true }));
      return answer;
    });
    const { app } = api(generate, { timeoutMs: 100 });
    const c = await repo.create(ctx, "Timeout");
    const result = await supertest(app).post(`/api/ask-orbit/conversations/${c.id}/turns`).send({ requestId: randomUUID(), question: "Question" });
    expect(result.text).toContain("timed out");
    expect((await repo.get(ctx, c.id)).turns[0].status).toBe("failed");
    expect((await repo.usage(ctx)).used).toBe(1);
  });
});
