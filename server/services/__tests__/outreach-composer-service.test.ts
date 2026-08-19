/**
 * Unit tests for composeTouch — recipient guard.
 *
 * These tests exercise the REAL composeTouch implementation. Only I/O
 * dependencies (db, AI provider, strategic context, prompt helpers,
 * compliance scanner, prospect-contact-service) are mocked. This means the
 * guard logic in outreach-composer-service.ts is actually run, so removing or
 * inverting the guard would cause the tests to fail.
 *
 * Covered scenarios
 * -----------------
 * 1. channel=email + no prospect email → throws before AI is called.
 * 2. channel=linkedin + no prospect email → proceeds through the full pipeline.
 */

import { describe, it, beforeEach, vi, expect } from "vitest";

// ── DB mock (queue-based chainable proxy) ─────────────────────────────────────
//
// Each db.select/insert/update call pops one queued result when .where() or
// .values() is reached, so tests can pre-load results in call order with
// pushDb(...rows).

const { dbQ, makeMockDb } = vi.hoisted(() => {
  const dbQ: any[][] = [];

  function terminal(): any {
    const val = dbQ.shift() ?? [];
    const t: any = {
      then: (resolve: any, reject?: any) => Promise.resolve(val).then(resolve, reject),
      catch: (reject: any) => Promise.resolve(val).catch(reject),
      finally: (cb: any) => Promise.resolve(val).finally(cb),
      // update().set().where().returning() and insert().values().returning()
      // all use the SAME popped value so a single pushDb covers the chain.
      returning: () => Promise.resolve(val),
      orderBy: () => Promise.resolve(val),
      limit: () => t,
    };
    return t;
  }

  function mkChain(): any {
    return {
      from: () => mkChain(),
      innerJoin: () => mkChain(),
      leftJoin: () => mkChain(),
      where: terminal,
      set: () => mkChain(),
      values: terminal,
      orderBy: () => Promise.resolve(dbQ.shift() ?? []),
      returning: () => Promise.resolve(dbQ.shift() ?? []),
      onConflictDoUpdate: () => ({ returning: () => Promise.resolve(dbQ.shift() ?? []) }),
    };
  }

  function makeMockDb() {
    return {
      select: mkChain,
      insert: mkChain,
      update: mkChain,
      delete: () => ({ where: () => Promise.resolve([]) }),
    };
  }

  return { dbQ, makeMockDb };
});

// ── Mock all I/O dependencies ─────────────────────────────────────────────────

vi.mock("../../db", () => ({ db: makeMockDb() }));

vi.mock("../prospect-contact-service", () => ({
  getProspectWithContact: vi.fn(),
}));

vi.mock("../ai-provider", () => ({
  completeForFeature: vi.fn(),
}));

vi.mock("../strategic-context", () => ({
  loadStrategicContext: vi.fn().mockResolvedValue({}),
  formatStrategicContextForPrompt: vi.fn().mockReturnValue(""),
}));

vi.mock("../outreach-composer-core", () => ({
  buildComposePrompt: vi.fn().mockReturnValue("composed prompt"),
  parseComposeResponse: vi.fn().mockReturnValue({ subject: null, body: "Hi Jane via LinkedIn" }),
  enforceLength: vi.fn().mockImplementation((body: string) => body),
  COMPOSER_SYSTEM_PROMPT: "system prompt",
}));

vi.mock("../compliance-core", () => ({
  scanCompliance: vi.fn().mockReturnValue({ pass: true, flags: [], suggestedFixes: [] }),
}));

// ── Import under test AFTER all mocks are wired ───────────────────────────────

import { composeTouch } from "../outreach-composer-service";
import { getProspectWithContact } from "../prospect-contact-service";
import { completeForFeature } from "../ai-provider";

// ── Shared fixtures ───────────────────────────────────────────────────────────

// Campaign with no cadence, voice profile, or conference so the test queue
// stays minimal — only the db calls under test need entries.
const CAMPAIGN = {
  id: "camp-1",
  tenantDomain: "acme.com",
  channels: ["linkedin"],
  cadenceTemplateId: null,
  voiceProfileId: null,
  conferenceId: null,
  salesGoal: "Book a discovery call",
  marketId: "market-1",
  interview: null,
};

// LinkedIn-only prospect — email is null, linkedinUrl is present.
const PROSPECT_NO_EMAIL = {
  id: "prospect-1",
  tenantDomain: "acme.com",
  campaignId: "camp-1",
  contactId: "contact-1",
  name: "Jane Doe",
  email: null,
  linkedinUrl: "https://linkedin.com/in/jane",
  title: "CIO",
  companyName: "Apex PE",
  status: "new",
  researchDossier: null,
};

const TOUCH_ROW = {
  id: "touch-1",
  prospectId: "prospect-1",
  campaignId: "camp-1",
  tenantDomain: "acme.com",
  channel: "linkedin",
  subject: null,
  body: "Hi Jane via LinkedIn",
  status: "draft_pending_approval",
};

const UPDATED_PROSPECT = { ...PROSPECT_NO_EMAIL, status: "draft_pending_approval" };

function pushDb(...rows: any[]) {
  dbQ.push(rows);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("composeTouch — recipient guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbQ.length = 0;
  });

  it("throws before calling the AI when channel=email and the prospect has no email address", async () => {
    vi.mocked(getProspectWithContact).mockResolvedValue(PROSPECT_NO_EMAIL as any);
    // Campaign fetch is needed; the guard fires immediately after.
    pushDb(CAMPAIGN);

    await expect(
      composeTouch("acme.com", "prospect-1", { channel: "email" }),
    ).rejects.toThrow(/no email address/i);

    // The AI must never be reached — billing and tokens would be consumed if it were.
    expect(completeForFeature).not.toHaveBeenCalled();
  });

  it("composes a LinkedIn touch for a prospect with no email address", async () => {
    vi.mocked(getProspectWithContact).mockResolvedValue(PROSPECT_NO_EMAIL as any);

    // DB call order:
    // 1. outreachCampaigns select
    pushDb(CAMPAIGN);
    // 2. resolveStepResource → outreachCampaignResources → no rows → returns null
    pushDb();
    // 3. emailSuppressions select → none
    pushDb();
    // 4. outreachTouches insert returning
    pushDb(TOUCH_ROW);
    // 5. prospects update returning (status: new → draft_pending_approval)
    pushDb(UPDATED_PROSPECT);

    vi.mocked(completeForFeature).mockResolvedValue({
      text: "===BODY===\nHi Jane via LinkedIn",
      usage: { inputTokens: 120, outputTokens: 50 },
      model: "gpt-4o",
      provider: "openai",
    } as any);

    const result = await composeTouch("acme.com", "prospect-1", { channel: "linkedin" });

    // Guard did not fire — the touch was created successfully.
    expect(result.touch).toMatchObject({ id: "touch-1", channel: "linkedin" });
    // AI was invoked, proving the full pipeline ran for the LinkedIn path.
    expect(completeForFeature).toHaveBeenCalledOnce();
  });
});
