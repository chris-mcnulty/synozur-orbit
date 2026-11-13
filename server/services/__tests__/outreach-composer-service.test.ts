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

const { dbQ, makeMockDb, writes } = vi.hoisted(() => {
  const dbQ: any[][] = [];
  const writes = vi.fn();

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
      insert: (...args: unknown[]) => { writes(...args); return mkChain(); },
      update: (...args: unknown[]) => { writes(...args); return mkChain(); },
      delete: () => ({ where: () => Promise.resolve([]) }),
    };
  }

  return { dbQ, makeMockDb, writes };
});

// ── Mock all I/O dependencies ─────────────────────────────────────────────────

vi.mock("../../db", () => ({ db: makeMockDb() }));

vi.mock("../prospect-contact-service", () => ({
  getProspectWithContact: vi.fn(),
}));

vi.mock("../ai-provider", () => ({
  completeForFeature: vi.fn(),
}));
vi.mock("../outreach-context-service", () => ({
  outreachCompositionContext: vi.fn().mockResolvedValue({ block: "", snapshot: { fingerprint: "test", group: null } }),
  validateOutreachContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../strategic-context", () => ({
  loadStrategicContext: vi.fn().mockResolvedValue({}),
  formatStrategicContextForPrompt: vi.fn().mockReturnValue(""),
}));

vi.mock("../outreach-composer-core", async (importOriginal) => ({
  ...await importOriginal<typeof import("../outreach-composer-core")>(),
  buildComposePrompt: vi.fn().mockReturnValue("composed prompt"),
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
import { scanCompliance } from "../compliance-core";
import { buildComposePrompt } from "../outreach-composer-core";

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
  it.each(["email", "linkedin"] as const)("passes the signed-in sender and confirmed session identities to the real %s prompt", async channel => {
    const realCore = await vi.importActual<typeof import("../outreach-composer-core")>("../outreach-composer-core");
    vi.mocked(buildComposePrompt).mockImplementationOnce(realCore.buildComposePrompt);
    vi.mocked(getProspectWithContact).mockResolvedValue({ ...PROSPECT_NO_EMAIL, email: "jane@example.invalid" } as any);
    pushDb({ ...CAMPAIGN, conferenceId: "event-1" });
    pushDb({ name: "Chris McNulty" });
    pushDb(); // campaign resource
    pushDb({ id: "event-1", name: "Conference", tenantDomain: "acme.com", marketId: "market-1", startDate: null, status: "active" });
    pushDb({ id: "session-1", title: "AI breakout", speakers: [
      { name: "Chris McNulty", isStaff: true }, { name: "Other Staff", isStaff: true },
    ] });
    pushDb(); // suppression list
    pushDb({ ...TOUCH_ROW, channel });
    pushDb(UPDATED_PROSPECT);
    vi.mocked(completeForFeature).mockResolvedValue({
      text: `${channel === "email" ? "===SUBJECT===\nMeet at Conference\n" : ""}===BODY===\nHi Jane, I'm leading the AI breakout at Conference. Can we meet afterward?`,
      usage: { inputTokens: 10, outputTokens: 10 }, model: "test", provider: "test",
    } as any);
    const result = await composeTouch("acme.com", "prospect-1", { channel, userId: "authenticated-user" });
    const prompt = vi.mocked(completeForFeature).mock.calls[0][1];
    expect(prompt).toContain('Sender: "Chris McNulty" (signed-in user)');
    expect(prompt).toContain('"name":"Chris McNulty","isStaff":true,"isSender":true');
    expect(prompt).toContain('"name":"Other Staff","isStaff":true,"isSender":false');
    expect(result.touch.body).toBeTruthy();
    expect(buildComposePrompt).toHaveBeenCalledWith(expect.objectContaining({ sender: { name: "Chris McNulty", source: "signed_in_user" } }));
  });
  it("keeps a delegated personal voice-profile owner as the sender instead of impersonating the operator", async () => {
    vi.mocked(getProspectWithContact).mockResolvedValue(PROSPECT_NO_EMAIL as any);
    pushDb({ ...CAMPAIGN, voiceProfileId: "voice-1" });
    pushDb({ id: "voice-1", tenantDomain: "acme.com", ownerUserId: "profile-owner", person: "first" });
    pushDb({ name: "Another Sender" });
    pushDb(); // campaign resource
    pushDb(); // suppression list
    pushDb(TOUCH_ROW);
    pushDb(UPDATED_PROSPECT);
    vi.mocked(completeForFeature).mockResolvedValue({
      text: "===BODY===\nHi Jane, could we meet?",
      usage: { inputTokens: 10, outputTokens: 10 }, model: "test", provider: "test",
    } as any);
    await composeTouch("acme.com", "prospect-1", { channel: "linkedin", userId: "different-operator" });
    expect(buildComposePrompt).toHaveBeenCalledWith(expect.objectContaining({
      sender: { name: "Another Sender", source: "voice_profile_owner" },
    }));
  });

  it.each([
    "I can't draft this email. What is the event date?",
    "===NEEDS_INPUT===\nWhat is the event date?",
    "===REFUSED===\nI cannot help with this request.",
    "===SUBJECT===\nQuestions\n===BODY===\nBefore I can draft this, who is the sender?",
    "An arbitrary unformatted response",
  ])("does not save a touch or change prospect status for non-draft output: %s", async (text) => {
    vi.mocked(getProspectWithContact).mockResolvedValue({ ...PROSPECT_NO_EMAIL, email: "jane@fund.com" } as any);
    pushDb(CAMPAIGN);
    pushDb();
    vi.mocked(completeForFeature).mockResolvedValue({
      text, usage: { inputTokens: 10, outputTokens: 10 }, model: "test", provider: "test",
    } as any);
    await expect(composeTouch("acme.com", "prospect-1", { channel: "email" })).rejects.toThrow();
    expect(writes).not.toHaveBeenCalled();
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

  it("recovers malformed output before compliance and writes only the verified draft once", async () => {
    vi.mocked(getProspectWithContact).mockResolvedValue({ ...PROSPECT_NO_EMAIL, email: "jane@example.invalid" } as any);
    pushDb(CAMPAIGN); pushDb(); pushDb();
    pushDb({ ...TOUCH_ROW, channel: "email" }); pushDb(UPDATED_PROSPECT);
    vi.mocked(completeForFeature).mockResolvedValueOnce({
      text: "===SUBJECT===\nIncomplete response",
      usage: { inputTokens: 10, outputTokens: 10 }, model: "test", provider: "test",
    } as any).mockResolvedValueOnce({
      text: "===SUBJECT===\nMeet Tuesday?\n===BODY===\nHi Jane, could we meet Tuesday?\nChris",
      usage: { inputTokens: 20, outputTokens: 20 }, model: "test", provider: "test",
    } as any);
    const result = await composeTouch("acme.com", "prospect-1", { channel: "email" });
    expect(scanCompliance).toHaveBeenCalledOnce();
    expect(scanCompliance).toHaveBeenCalledWith(expect.objectContaining({
      subject: "Meet Tuesday?", body: "Hi Jane, could we meet Tuesday?\nChris",
    }));
    expect(writes).toHaveBeenCalledTimes(2); // one touch + one membership status update
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 30 });
  });
  it("never persists or advances a prospect when generated style cannot be repaired", async () => {
    vi.mocked(getProspectWithContact).mockResolvedValue({ ...PROSPECT_NO_EMAIL, email: "jane@fund.com" } as any);
    pushDb(CAMPAIGN);
    pushDb();
    vi.mocked(completeForFeature).mockResolvedValue({
      text: "===SUBJECT===\nMeeting—Tuesday\n===BODY===\nI hope this finds you well. Can we meet Tuesday?",
      usage: { inputTokens: 10, outputTokens: 10 }, model: "test", provider: "test",
    } as any);
    await expect(composeTouch("acme.com", "prospect-1", { channel: "email" })).rejects.toThrow("Nothing was saved or sent");
    expect(completeForFeature).toHaveBeenCalledTimes(3);
    expect(writes).not.toHaveBeenCalled();
  });

  it("completes ordinary email Compose with em dashes without asking for private context", async () => {
    vi.mocked(getProspectWithContact).mockResolvedValue({ ...PROSPECT_NO_EMAIL, email: "jane@fund.com" } as any);
    pushDb(CAMPAIGN);
    pushDb();
    pushDb();
    pushDb({ ...TOUCH_ROW, channel: "email" });
    pushDb(UPDATED_PROSPECT);
    vi.mocked(completeForFeature).mockResolvedValue({
      text: "===SUBJECT===\nMeeting—Tuesday\n===BODY===\nHi Jane—can we meet Tuesday?",
      usage: { inputTokens: 10, outputTokens: 10 }, model: "test", provider: "test",
    } as any);
    await composeTouch("acme.com", "prospect-1", { channel: "email" });
    expect(completeForFeature).toHaveBeenCalledOnce();
    expect(scanCompliance).toHaveBeenCalledWith(expect.objectContaining({
      subject: "Meeting, Tuesday", body: "Hi Jane, can we meet Tuesday?",
    }));
    expect(writes).toHaveBeenCalledTimes(2);
  });

  it("passes the sender's known-reseller facts and exploratory ask through the real prompt and saves a recipient question", async () => {
    const realCore = await vi.importActual<typeof import("../outreach-composer-core")>("../outreach-composer-core");
    vi.mocked(buildComposePrompt).mockImplementationOnce(realCore.buildComposePrompt);
    const notes = "Alex is our key contact and active reseller. We would like to get in sync with any Microsoft work they are doing.";
    vi.mocked(getProspectWithContact).mockResolvedValue({
      ...PROSPECT_NO_EMAIL, name: "Alex", email: "alex@example.invalid",
      researchDossier: "Partnership status, Microsoft certification and AI practice unconfirmed.",
    } as any);
    pushDb(CAMPAIGN); pushDb(); pushDb();
    pushDb({ ...TOUCH_ROW, channel: "email" }); pushDb(UPDATED_PROSPECT);
    vi.mocked(completeForFeature).mockResolvedValue({
      text: "===SUBJECT===\nMicrosoft work\n===BODY===\nHi Alex,\nCould we catch up on any Microsoft work your team is doing and where we might collaborate?\nThanks,\nSam",
      usage: { inputTokens: 10, outputTokens: 10 }, model: "test", provider: "test",
    } as any);
    await composeTouch("acme.com", "prospect-1", { channel: "email", additionalContext: notes });
    expect(completeForFeature).toHaveBeenCalledOnce();
    const prompt = vi.mocked(completeForFeature).mock.calls[0][1];
    expect(prompt).toContain(notes);
    expect(prompt).toContain("Partnership status, Microsoft certification and AI practice unconfirmed.");
    expect(prompt).toContain("Missing public evidence is not contrary evidence");
    expect(prompt).toContain("An exploratory ask is not an assertion");
    expect(scanCompliance).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining("any Microsoft work"),
    }));
    expect(writes).toHaveBeenCalledTimes(2);
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
