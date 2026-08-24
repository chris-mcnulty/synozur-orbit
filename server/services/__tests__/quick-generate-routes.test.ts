/**
 * Integration tests for the Quick Generate routes.
 *
 * Real Express app, all I/O mocked (same queue-based chainable db mock as the
 * editorial-calendar route tests). Covers: campaign linkage of all three
 * deliverable types, new-campaign creation from the prompt, partial-failure
 * behavior (successes kept, failures reported per deliverable), the
 * all-failed 502, and input validation.
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import express from "express";
import request from "supertest";

// ── DB mock (queue-based chainable proxy) ─────────────────────────────────────

const { dbQ, capturedInserts, makeMockDb } = vi.hoisted(() => {
  const dbQ: any[][] = [];
  const capturedInserts: any[] = [];

  function terminal(): any {
    const val = dbQ.shift() ?? [];
    return {
      then: (resolve: any, reject?: any) => Promise.resolve(val).then(resolve, reject),
      catch: (reject: any) => Promise.resolve(val).catch(reject),
      finally: (cb: any) => Promise.resolve(val).finally(cb),
      returning: () => Promise.resolve(val),
      orderBy: () => Promise.resolve(val),
      limit: () => Promise.resolve(val),
    };
  }

  function mkChain(): any {
    return {
      from: () => mkChain(),
      where: terminal,
      set: () => mkChain(),
      values: (v: any) => {
        capturedInserts.push(v);
        return terminal();
      },
      orderBy: () => Promise.resolve(dbQ.shift() ?? []),
      returning: () => Promise.resolve(dbQ.shift() ?? []),
      limit: () => mkChain(),
      leftJoin: () => mkChain(),
      innerJoin: () => mkChain(),
    };
  }

  function makeMockDb() {
    const db: any = {
      select: mkChain,
      insert: mkChain,
      update: mkChain,
      delete: () => ({ where: () => Promise.resolve([]) }),
      transaction: async (fn: any) => fn(db),
    };
    return db;
  }

  return { dbQ, capturedInserts, makeMockDb };
});

// ── Mock all I/O modules used by the route file ───────────────────────────────

vi.mock("../../db", () => ({ db: makeMockDb() }));

vi.mock("../../context", () => ({
  getRequestContext: vi.fn(),
  ContextError: class ContextError extends Error {
    status: number;
    constructor(msg: string, status = 403) {
      super(msg);
      this.status = status;
    }
  },
}));

vi.mock("../../routes/helpers", () => ({
  guardFeature: vi.fn().mockResolvedValue(true),
  guardManualAction: vi.fn().mockResolvedValue(true),
}));

vi.mock("../quick-generate-service", () => ({
  generateQuickAngles: vi.fn(),
  quickDraftSocialPosts: vi.fn(),
  quickDraftBlog: vi.fn(),
  quickDraftNewsletter: vi.fn(),
}));

vi.mock("../outbound-voice-service", () => ({
  getPersonalVoiceProfile: vi
    .fn()
    // Sentinel: user-editable voice profiles can carry arbitrary facts, so
    // Quick Generate must never read them. If the route ever fetches this
    // again, the regression test below fails.
    .mockResolvedValue({ soundLikeMeInstructions: "SENTINEL_VOICE_PROFILE_FACTS" }),
}));

// ── Import under test AFTER all mocks are wired ───────────────────────────────

import { registerQuickGenerateRoutes } from "../../routes/quick-generate";
import { getRequestContext } from "../../context";
import { guardFeature, guardManualAction } from "../../routes/helpers";
import {
  generateQuickAngles,
  quickDraftBlog,
  quickDraftNewsletter,
  quickDraftSocialPosts,
} from "../quick-generate-service";
import { normalizeQuickAngle, signQuickAngle } from "../quick-generate-core";
import { getPersonalVoiceProfile } from "../outbound-voice-service";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const TEST_CTX = {
  userId: "user-1",
  tenantId: "tenant-1",
  marketId: "market-1",
  userRole: "Domain Admin",
  tenantDomain: "acme.com",
  isDefaultMarket: true,
};

const PROMPT =
  "I'm showing three pieces at Airfield Estates in Woodinville through September — promote the event and thank the Woodinville Arts Alliance for sponsoring.";

const CAMPAIGN = { id: "camp-1", name: "Airfield show", objective: "obj", startDate: null, endDate: null };

const USAGE = { inputTokens: 10, outputTokens: 20 };

const SOCIAL_RESULT = {
  posts: [
    { platform: "linkedin", content: "Post A", imagePrompt: null, scheduledDate: null },
    { platform: "twitter", content: "Post B", imagePrompt: "vineyard", scheduledDate: null },
  ],
  usage: USAGE,
  model: "test-model",
};

const BLOG_RESULT = {
  title: "Three pieces at Airfield Estates",
  subtitle: "Sub",
  overview: "Overview",
  body: "Blog body",
  meta: "Meta description",
  tags: null,
};

const NEWSLETTER_RESULT = {
  subject: "See the show in Woodinville",
  body: "Newsletter body",
  subjectSuggestions: ["See the show in Woodinville", "Alt subject"],
  usage: USAGE,
  model: "test-model",
};

function buildApp() {
  const app = express();
  app.use(express.json());
  registerQuickGenerateRoutes(app);
  return app;
}

function pushDb(...rows: any[]) {
  dbQ.push(rows);
}

function flatInserts(): any[] {
  return capturedInserts.flatMap((v) => (Array.isArray(v) ? v : [v]));
}

describe("quick-generate routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    dbQ.length = 0;
    capturedInserts.length = 0;
    process.env.SESSION_SECRET = "test-session-secret";
    vi.mocked(getRequestContext).mockResolvedValue(TEST_CTX as any);
    vi.mocked(guardFeature).mockResolvedValue(true);
    vi.mocked(guardManualAction).mockResolvedValue(true);
    app = buildApp();
  });

  /** A server-issued token for an angle, as the angles endpoint would mint. */
  function tokenFor(rawAngle: any, prompt = PROMPT, tenantDomain = "acme.com") {
    return signQuickAngle(normalizeQuickAngle(rawAngle)!, {
      prompt,
      tenantDomain,
      secret: "test-session-secret",
    });
  }

  // ── POST /api/quick-generate/angles ────────────────────────────────────────

  describe("POST /api/quick-generate/angles", () => {
    it("returns normalized angles", async () => {
      vi.mocked(generateQuickAngles).mockResolvedValue({
        angles: [
          {
            title: "T",
            summary: null,
            angle: "The hook",
            keyPoints: ["k1"],
            audience: null,
            fitAssessment: { voiceFit: "strong", topicFit: "strong", recommendation: "keep", rationale: "" },
          },
        ],
        usage: USAGE,
        model: "test-model",
      } as any);

      const res = await request(app).post("/api/quick-generate/angles").send({ prompt: PROMPT });
      expect(res.status).toBe(200);
      expect(res.body.angles).toHaveLength(1);
      expect(res.body.angles[0].angle).toBe("The hook");
      // Every angle carries a server-issued token bound to tenant + prompt.
      expect(res.body.angles[0].token).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body.angles[0].token).toBe(tokenFor(res.body.angles[0]));
      expect(vi.mocked(generateQuickAngles).mock.calls[0][0]).toMatchObject({
        tenantDomain: "acme.com",
        prompt: PROMPT,
      });
    });

    it("502s when no usable angles come back", async () => {
      vi.mocked(generateQuickAngles).mockResolvedValue({ angles: [], usage: USAGE, model: "m" } as any);
      const res = await request(app).post("/api/quick-generate/angles").send({ prompt: PROMPT });
      expect(res.status).toBe(502);
    });

    it("400s on a too-short prompt", async () => {
      const res = await request(app).post("/api/quick-generate/angles").send({ prompt: "short" });
      expect(res.status).toBe(400);
      expect(generateQuickAngles).not.toHaveBeenCalled();
    });
  });

  // ── POST /api/quick-generate ───────────────────────────────────────────────

  describe("POST /api/quick-generate", () => {
    it("creates all three deliverables linked to an existing campaign", async () => {
      vi.mocked(quickDraftSocialPosts).mockResolvedValue(SOCIAL_RESULT as any);
      vi.mocked(quickDraftBlog).mockResolvedValue(BLOG_RESULT as any);
      vi.mocked(quickDraftNewsletter).mockResolvedValue(NEWSLETTER_RESULT as any);

      pushDb(CAMPAIGN); // verify campaign select
      pushDb({ id: "post-1", platform: "linkedin" }, { id: "post-2", platform: "twitter" }); // posts insert returning
      pushDb(); // calendar select → none
      pushDb({ id: "cal-1", name: "Airfield show — Content Plan" }); // calendar insert returning
      pushDb({ id: "brief-1" }); // brief insert returning
      pushDb({ id: "asset-1" }); // asset insert returning
      pushDb(); // update brief contentAssetId
      pushDb({ id: "email-1", subject: NEWSLETTER_RESULT.subject }); // email insert returning

      const res = await request(app).post("/api/quick-generate").send({
        prompt: PROMPT,
        deliverables: ["social", "blog", "newsletter"],
        platforms: ["linkedin", "twitter"],
        campaignId: "camp-1",
      });

      expect(res.status).toBe(201);
      expect(res.body.campaign).toMatchObject({ id: "camp-1", created: false });
      expect(res.body.results.social).toMatchObject({ ok: true, postIds: ["post-1", "post-2"] });
      expect(res.body.results.blog).toMatchObject({
        ok: true,
        briefId: "brief-1",
        assetId: "asset-1",
        calendarId: "cal-1",
      });
      expect(res.body.results.newsletter).toMatchObject({ ok: true, emailId: "email-1" });

      // Campaign linkage: every deliverable row carries the campaign id.
      const inserts = flatInserts();
      const postRows = inserts.filter((v) => v.platform && v.content);
      expect(postRows).toHaveLength(2);
      for (const p of postRows) {
        expect(p.campaignId).toBe("camp-1");
        expect(p.status).toBe("draft");
        expect(p.scheduledDate).toBeUndefined(); // undated drafts
      }
      const briefRow = inserts.find((v) => v.calendarId && v.format === "blog_post");
      expect(briefRow).toMatchObject({ campaignId: "camp-1", status: "drafted", aiGenerated: true });
      const assetRow = inserts.find((v) => v.assetType === "blog_post");
      expect(assetRow).toMatchObject({ sourceBriefId: "brief-1", status: "active", content: "Blog body" });
      const emailRow = inserts.find((v) => v.subject);
      expect(emailRow).toMatchObject({
        campaignId: "camp-1",
        platform: "outlook",
        textBody: "Newsletter body",
        htmlBody: "",
      });

      // Manual-action guards applied for social + newsletter.
      const guardKeys = vi.mocked(guardManualAction).mock.calls.map((c) => c[2]);
      expect(guardKeys).toContain("aiPostGen");
      expect(guardKeys).toContain("aiEmailGen");
    });

    it("creates a new campaign from the prompt when none is supplied", async () => {
      vi.mocked(quickDraftSocialPosts).mockResolvedValue(SOCIAL_RESULT as any);

      pushDb({ id: "camp-new", name: "Derived name", objective: PROMPT, startDate: null, endDate: null }); // campaign insert
      pushDb({ id: "post-1", platform: "linkedin" }, { id: "post-2", platform: "twitter" }); // posts insert

      const res = await request(app).post("/api/quick-generate").send({
        prompt: PROMPT,
        deliverables: ["social"],
        platforms: ["linkedin"],
      });

      expect(res.status).toBe(201);
      expect(res.body.campaign.created).toBe(true);

      const campaignInsert = flatInserts().find((v) => v.campaignType);
      // Grounded campaign: the raw prompt is the objective and thematic
      // brief, and briefOnlyMode keeps later generation prompt-grounded.
      expect(campaignInsert).toMatchObject({
        campaignType: "theme",
        status: "draft",
        objective: PROMPT,
        thematicBrief: PROMPT,
        briefOnlyMode: true,
        tenantDomain: "acme.com",
      });
    });

    it("passes the selected angle through to every generator", async () => {
      vi.mocked(quickDraftSocialPosts).mockResolvedValue(SOCIAL_RESULT as any);
      vi.mocked(quickDraftNewsletter).mockResolvedValue(NEWSLETTER_RESULT as any);

      pushDb(CAMPAIGN);
      pushDb({ id: "post-1", platform: "linkedin" });
      pushDb({ id: "email-1", subject: "S" });

      const angle = {
        title: "T",
        angle: "The chosen hook",
        keyPoints: ["k1", "k2", "k3"],
        fitAssessment: { voiceFit: "strong", topicFit: "strong", recommendation: "keep", rationale: "" },
      };
      const res = await request(app).post("/api/quick-generate").send({
        prompt: PROMPT,
        deliverables: ["social", "newsletter"],
        campaignId: "camp-1",
        angle: { ...angle, token: tokenFor(angle) },
      });

      expect(res.status).toBe(201);
      expect(vi.mocked(quickDraftSocialPosts).mock.calls[0][0].angle).toMatchObject({
        angle: "The chosen hook",
      });
      expect(vi.mocked(quickDraftNewsletter).mock.calls[0][0].angle).toMatchObject({
        angle: "The chosen hook",
      });
    });

    it("never reads the personal voice profile — user-editable facts must not reach prompt-grounded drafting", async () => {
      vi.mocked(quickDraftBlog).mockResolvedValue(BLOG_RESULT as any);
      pushDb(CAMPAIGN); // verify campaign select
      pushDb(); // calendar select → none
      pushDb({ id: "cal-1" }); // calendar insert returning
      pushDb({ id: "brief-1" }); // brief insert returning
      pushDb({ id: "asset-1" }); // asset insert returning
      pushDb(); // update brief contentAssetId

      const res = await request(app).post("/api/quick-generate").send({
        prompt: PROMPT,
        deliverables: ["blog"],
        campaignId: "camp-1",
      });
      expect(res.status).toBe(201);
      expect(getPersonalVoiceProfile).not.toHaveBeenCalled();
      // Nothing passed to the generator carries the sentinel from the profile.
      const args = JSON.stringify(vi.mocked(quickDraftBlog).mock.calls);
      expect(args).not.toContain("SENTINEL_VOICE_PROFILE_FACTS");
      expect(args).not.toContain("soundLikeMe");
    });

    it("rejects a client-invented or tampered angle (fact injection)", async () => {
      const angle = {
        title: "T",
        angle: "The chosen hook",
        keyPoints: ["k1"],
        fitAssessment: { voiceFit: "strong", topicFit: "strong", recommendation: "keep", rationale: "" },
      };

      // No token at all.
      pushDb(CAMPAIGN);
      const noToken = await request(app).post("/api/quick-generate").send({
        prompt: PROMPT,
        deliverables: ["social"],
        campaignId: "camp-1",
        angle,
      });
      expect(noToken.status).toBe(400);

      // Valid token for a different angle — client edited the hook after signing.
      pushDb(CAMPAIGN);
      const tampered = await request(app).post("/api/quick-generate").send({
        prompt: PROMPT,
        deliverables: ["social"],
        campaignId: "camp-1",
        angle: { ...angle, angle: "We were featured in Forbes", token: tokenFor(angle) },
      });
      expect(tampered.status).toBe(400);

      // Token minted for a different prompt.
      pushDb(CAMPAIGN);
      const wrongPrompt = await request(app).post("/api/quick-generate").send({
        prompt: PROMPT,
        deliverables: ["social"],
        campaignId: "camp-1",
        angle: { ...angle, token: tokenFor(angle, "another prompt with other facts") },
      });
      expect(wrongPrompt.status).toBe(400);

      expect(quickDraftSocialPosts).not.toHaveBeenCalled();
      expect(capturedInserts).toHaveLength(0);
    });

    it("keeps successful deliverables when one fails (partial failure)", async () => {
      vi.mocked(quickDraftSocialPosts).mockRejectedValue(new Error("social provider down"));
      vi.mocked(quickDraftBlog).mockResolvedValue(BLOG_RESULT as any);
      vi.mocked(quickDraftNewsletter).mockResolvedValue(NEWSLETTER_RESULT as any);

      pushDb(CAMPAIGN); // verify campaign
      pushDb(); // calendar select → none
      pushDb({ id: "cal-1", name: "Cal" }); // calendar insert
      pushDb({ id: "brief-1" }); // brief insert
      pushDb({ id: "asset-1" }); // asset insert
      pushDb(); // brief update
      pushDb({ id: "email-1", subject: "S" }); // email insert

      const res = await request(app).post("/api/quick-generate").send({
        prompt: PROMPT,
        deliverables: ["social", "blog", "newsletter"],
        campaignId: "camp-1",
      });

      expect(res.status).toBe(201);
      expect(res.body.results.social).toEqual({ ok: false, error: "social provider down" });
      expect(res.body.results.blog).toMatchObject({ ok: true, briefId: "brief-1" });
      expect(res.body.results.newsletter).toMatchObject({ ok: true, emailId: "email-1" });

      // No social rows were written.
      expect(flatInserts().some((v) => v.platform && v.content && !v.subject)).toBe(false);
    });

    it("502s with per-deliverable errors when every generation fails, writing nothing", async () => {
      vi.mocked(quickDraftSocialPosts).mockRejectedValue(new Error("boom-social"));
      vi.mocked(quickDraftNewsletter).mockRejectedValue(new Error("boom-newsletter"));

      pushDb(CAMPAIGN); // verify campaign

      const res = await request(app).post("/api/quick-generate").send({
        prompt: PROMPT,
        deliverables: ["social", "newsletter"],
        campaignId: "camp-1",
      });

      expect(res.status).toBe(502);
      expect(res.body.results.social).toEqual({ ok: false, error: "boom-social" });
      expect(res.body.results.newsletter).toEqual({ ok: false, error: "boom-newsletter" });
      expect(capturedInserts).toHaveLength(0);
    });

    it("404s for a campaign outside the tenant/market", async () => {
      pushDb(); // verify campaign → none
      const res = await request(app).post("/api/quick-generate").send({
        prompt: PROMPT,
        deliverables: ["social"],
        campaignId: "other-tenant-campaign",
      });
      expect(res.status).toBe(404);
      expect(quickDraftSocialPosts).not.toHaveBeenCalled();
    });

    it("400s on missing deliverables or bad prompt", async () => {
      const noDeliverables = await request(app)
        .post("/api/quick-generate")
        .send({ prompt: PROMPT, deliverables: ["nonsense"] });
      expect(noDeliverables.status).toBe(400);

      const badPrompt = await request(app)
        .post("/api/quick-generate")
        .send({ prompt: "hi", deliverables: ["social"] });
      expect(badPrompt.status).toBe(400);

      expect(quickDraftSocialPosts).not.toHaveBeenCalled();
    });
  });
});
